//! Webview — wry WebView + IPC channel + **native context menu popup** +
//! **native app-menu bar** (`useAppMenu`) + **app quit** (`quit()`).
//!
//! All three are handled entirely on the Rust side (see
//! `show_native_context_menu`, `handle_app_menu_message`, and
//! `QUIT_REQUESTED`/`quit_requested` below): `Application::run()` blocks
//! Node's libuv loop for as long as the app is open, so a round-trip through
//! `onIpcMessage` back into JS never fires. Instead the IPC handler below
//! intercepts `{ kind: "contextMenu" }`, `{ kind: "appMenu" }`, and
//! `{ kind: "appQuit" }` messages itself.
//!
//! Context menus pop the muda menu synchronously — via a modal call that
//! pumps its own nested run/message loop (`show_context_menu_for_nsview` on
//! macOS, `show_context_menu_for_hwnd` on Windows) — and report the clicked
//! item back to the page via `evaluate_script` (which runs inside the
//! platform webview — WebKit on macOS, WebView2 on Windows — and isn't
//! affected by the blocked Node loop).
//!
//! The app menu (`useAppMenu`) instead **replaces** the standing menu
//! bar/NSMenu — see `AppMenuContext` and `handle_app_menu_message` — and its
//! clicks arrive asynchronously (whenever the user picks an item, not
//! synchronously like a popup), picked up by `poll_app_menu_events` (macOS)
//! / `poll_menu_bar_events` (Windows), polled once per tao event-loop tick
//! from `Application::run` and `launcher.rs`'s per-platform launchers.
//!
//! `appQuit` (`quit()`) sets `QUIT_REQUESTED` instead of acting immediately —
//! the ipc_handler closure has no access to the event loop's `ControlFlow`,
//! so like the two polls above, it's read once per tick (`quit_requested`)
//! by those same three event loops, which do have access to it.

use napi::{
  bindgen_prelude::{Error, Result, Status},
  threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode},
};
use napi_derive::napi;
use std::{
  borrow::Cow,
  cell::RefCell,
  path::Path,
  rc::Rc,
  sync::{atomic::AtomicBool, Arc},
};

use wry::{
  http::{header::CONTENT_TYPE, Response, StatusCode},
  WebContext, WebView, WebViewBuilder,
};

use crate::{
  menu::{build_menu, AppMenuSpec, SharedMenu},
  types::{MenuItemOptions, MenuOptions, Position, WebviewOptions},
  window::SharedWindow,
};

/// Just enough of the IPC envelope to dispatch on `kind` before deciding
/// whether to handle a message natively or forward it to Node.
#[derive(serde::Deserialize)]
struct IpcEnvelope {
  kind: Option<String>,
}

/// Payload for `{ kind: "contextMenu", items, x, y }` messages posted by
/// `useGlobalContextMenu` (see `packages/murasaki/src/react/rpc.ts`).
#[derive(serde::Deserialize)]
struct ContextMenuPayload {
  items: Vec<MenuItemOptions>,
  #[serde(default)]
  x: Option<f64>,
  #[serde(default)]
  y: Option<f64>,
}

/// Payload for `{ kind: "appMenu", menus }` messages posted by `useAppMenu`
/// (see `packages/murasaki/src/react/app-menu.tsx`).
#[derive(serde::Deserialize)]
struct AppMenuPayload {
  menus: Vec<AppMenuSpec>,
}

/// Set synchronously by the IPC handler below when `{ kind: "appQuit" }`
/// arrives (posted by `quit()` — see the updater install→quit→apply
/// handshake, contract §7). Like `contextMenu`/`appMenu`, this can't be
/// handled by calling into `ControlFlow` directly — the ipc_handler closure
/// has no access to it — so it's a flag instead, read once per tao
/// event-loop tick by `Application::run` (dev) and both of `launcher.rs`'s
/// prod event loops (`quit_requested` below) so *they* can set
/// `ControlFlow::Exit`. A plain `static` (rather than a field threaded
/// through `Application`/the launchers) is enough: murasaki only ever drives
/// one window/webview per process (see `SharedWebview`'s doc comment).
static QUIT_REQUESTED: AtomicBool = AtomicBool::new(false);

/// Whether `{ kind: "appQuit" }` has been requested since the last check —
/// see `QUIT_REQUESTED`'s doc comment. Consumes the flag (so once an
/// event-loop tick acts on it, later ticks don't see it again), the same way
/// `poll_menu_bar_events`/`poll_app_menu_events` drain their event channel.
pub(crate) fn quit_requested() -> bool {
  QUIT_REQUESTED.swap(false, std::sync::atomic::Ordering::SeqCst)
}

/// A clone-able handle to the internal wry `WebView`, so `Application`/the
/// prod launchers can reach into it from the tao event loop to dispatch
/// native menu clicks (see `poll_menu_bar_events` / `poll_app_menu_events`
/// below). Named/typed like `window::SharedWindow` for the same reason: the
/// menu bar/app menu is persistent, so unlike the context-menu popup below,
/// nothing can grab this synchronously off a single call's `self`.
#[cfg(any(target_os = "macos", target_os = "windows"))]
pub(crate) type SharedWebview = Rc<RefCell<Option<WebView>>>;

/// Extra context `Webview::new` needs to install/replace the application
/// menu on demand — see `{ kind: "appMenu" }` in `with_ipc_handler` below and
/// `handle_app_menu_message`. Bundled into one struct (rather than loose
/// `Webview::new` parameters) so `about_info` (macOS-only) can be
/// `#[cfg]`-gated per-field instead of needing a different `Webview::new`
/// signature per platform.
#[derive(Clone)]
pub(crate) struct AppMenuContext {
  /// The currently-installed application menu. The caller (`Application` /
  /// `launcher.rs`'s per-platform launcher) has already built and installed
  /// the startup default menu into this exact slot before constructing the
  /// `Webview` — a `{ kind: "appMenu" }` IPC message replaces its contents
  /// (old dropped, new installed) with an app-declared one instead. Shared
  /// (not owned) so `Application`'s/the launcher's own bookkeeping and this
  /// replacement logic always agree on what's currently installed.
  pub menu_slot: SharedMenu,
  /// Resolved once at startup (see `Application::create_window` /
  /// `launcher.rs`'s locale resolvers) — reused so `useAppMenu`'s
  /// `'editMenu'`/`'windowMenu'`/item-role labels are localized exactly like
  /// the startup default menu, without a second (webview-side) locale
  /// lookup.
  pub menu_labels: Option<crate::types::MenuLabels>,
  /// macOS only — needed to prepend the standard app-name (About/Services/
  /// Hide/Quit) submenu ahead of whatever `useAppMenu` declares. See
  /// `handle_app_menu_message`'s doc comment for why v1 always prepends it.
  #[cfg(target_os = "macos")]
  pub about_info: crate::menu::AboutInfoOwned,
}

#[napi]
pub struct Webview {
  webview: Rc<RefCell<Option<WebView>>>,
  on_ipc: Rc<RefCell<Option<Arc<ThreadsafeFunction<String>>>>>,
  /// Keep the tao window alive for as long as the webview exists. wry's WebView
  /// only *borrows* the window's NSView/HWND — if the tao `Window` is dropped,
  /// the native window closes and the webview goes offscreen. Holding a clone
  /// of the shared window handle prevents that even when the intermediate
  /// `BrowserWindow` returned by `Application::createWindow` goes out of scope.
  /// Also doubles, on Windows, as how `show_native_context_menu` gets the
  /// HWND to pop the context menu against (see that function) — macOS instead
  /// reaches through `webview` for the NSView, so there `_window` is held but
  /// never explicitly read.
  _window: SharedWindow,
}

/// A writable directory for WebView2's user-data folder, or `None` to accept
/// wry's default.
///
/// On Windows, wry lets WebView2 default its user-data folder to a location
/// next to the host executable. For `murasaki dev`/prod that host is `node.exe`
/// — commonly `C:\Program Files\nodejs\`, which isn't writable — so WebView2
/// aborts environment creation with `E_ACCESSDENIED` (0x80070005). Pin it under
/// `%LOCALAPPDATA%` instead. macOS/Linux keep the default (`None`).
///
/// Uses `cfg!(..)` rather than `#[cfg]` so the whole function type-checks on
/// every host (the Windows branch is dead code off-Windows, but still compiled).
fn webview2_data_dir() -> Option<std::path::PathBuf> {
  if cfg!(target_os = "windows") {
    let base = std::env::var_os("LOCALAPPDATA")?;
    let dir = std::path::PathBuf::from(base).join("murasaki").join("WebView2");
    // Best-effort: WebView2 creates missing dirs itself, but only one level.
    let _ = std::fs::create_dir_all(&dir);
    Some(dir)
  } else {
    None
  }
}

/// Whether a navigation target should open in the system browser rather than
/// inside the app window. Only `http(s)` URLs to a non-loopback host count as
/// external — the dev server (localhost), the `murasaki://` prod protocol, and
/// non-http schemes (`about:`, `data:`, `blob:`, `file:`, …) always load in-app.
///
/// The host is compared on the *parsed* URL, not a string prefix: a prefix
/// check treats `http://localhost.evil.com` / `http://127.0.0.1.evil.com` as
/// loopback and loads the external page in-app. Matching on the parsed host —
/// the `localhost` domain, or an IP that `is_loopback()` — closes that hole.
fn is_external_url(target: &str) -> bool {
  let Ok(parsed) = url::Url::parse(target) else {
    return false;
  };
  if !matches!(parsed.scheme(), "http" | "https") {
    return false;
  }
  match parsed.host() {
    Some(url::Host::Domain("localhost")) => false,
    Some(url::Host::Ipv4(ip)) => !ip.is_loopback(),
    Some(url::Host::Ipv6(ip)) => !ip.is_loopback(),
    Some(url::Host::Domain(_)) => true,
    None => false,
  }
}

impl Webview {
  pub(crate) fn new(window: SharedWindow, opts: WebviewOptions, app_menu: AppMenuContext) -> Result<Self> {
    let on_ipc: Rc<RefCell<Option<Arc<ThreadsafeFunction<String>>>>> =
      Rc::new(RefCell::new(None));
    // Created empty and filled in *after* `builder.build()` below, but a
    // clone is handed to the IPC handler closure up front — the closure only
    // ever fires on messages posted from page JS, which can't happen before
    // the page has loaded, which can't happen before `build()` returns and
    // the slot is filled. So the handler never observes an empty slot.
    let webview_slot: Rc<RefCell<Option<WebView>>> = Rc::new(RefCell::new(None));

    // Pin the WebView2 user-data directory to a writable location. wry's
    // default puts it next to the host executable — for `murasaki dev`/prod
    // that's `node.exe`, frequently under `C:\Program Files\nodejs\`, which
    // isn't writable → `build webview` fails with E_ACCESSDENIED (0x80070005)
    // on Windows. Leaked because the WebContext must outlive the webview and
    // there's exactly one webview per app process.
    let web_context: &'static mut WebContext =
      Box::leak(Box::new(WebContext::new(webview2_data_dir())));
    let mut builder = WebViewBuilder::new_with_web_context(web_context)
      .with_devtools(opts.devtools.unwrap_or(cfg!(debug_assertions)))
      .with_transparent(opts.transparent.unwrap_or(false));

    // IPC: JS calls window.ipc.postMessage(str). Context menus and app-menu
    // (re)installs are handled synchronously right here (Node's loop is
    // blocked by `Application::run` and can't round-trip); everything else
    // still forwards to Node.
    let ipc_slot = on_ipc.clone();
    let ipc_webview_slot = webview_slot.clone();
    // Only read on Windows (see `show_native_context_menu`'s HWND lookup) —
    // cloned unconditionally to keep this closure identical across
    // platforms rather than duplicating `with_ipc_handler`.
    let ipc_window_slot = window.clone();
    // Moved in (not cloned): nothing else in `Webview::new` needs `app_menu`
    // after this point.
    let ipc_app_menu = app_menu;
    builder = builder.with_ipc_handler(move |request| {
      let body = request.body().clone();

      let kind = serde_json::from_str::<IpcEnvelope>(&body)
        .ok()
        .and_then(|e| e.kind);

      if kind.as_deref() == Some("contextMenu") {
        if let Ok(payload) = serde_json::from_str::<ContextMenuPayload>(&body) {
          show_native_context_menu(
            &ipc_window_slot,
            &ipc_webview_slot,
            &payload.items,
            payload.x,
            payload.y,
          );
        }
        return;
      }

      if kind.as_deref() == Some("appMenu") {
        if let Ok(payload) = serde_json::from_str::<AppMenuPayload>(&body) {
          handle_app_menu_message(&ipc_window_slot, &ipc_app_menu, &payload.menus);
        }
        return;
      }

      if kind.as_deref() == Some("appQuit") {
        QUIT_REQUESTED.store(true, std::sync::atomic::Ordering::SeqCst);
        return;
      }

      if let Some(tsf) = ipc_slot.borrow().as_ref() {
        let _ = tsf.call(Ok(body), ThreadsafeFunctionCallMode::NonBlocking);
      }
    });

    // Off-origin navigations (a plain `<a href="https://…">` to another site)
    // open in the user's default browser instead of replacing the app inside
    // its own window. In-app navigations — the dev server on localhost, the
    // `murasaki://` prod protocol, and non-http schemes — load normally.
    // Returning `false` cancels the in-window navigation.
    builder = builder.with_navigation_handler(|url| {
      if is_external_url(&url) {
        let _ = open::that_detached(&url);
        return false;
      }
      true
    });

    // Production loads static files (the built client) through wry's custom
    // protocol instead of `url`/`html` — see the module doc comment on why an
    // in-process HTTP server can't work once `Application::run()` is called.
    // Takes priority over `url`/`html` when set.
    if let Some(dir) = &opts.serve_dir {
      let dir = dir.clone();
      builder = builder.with_custom_protocol("murasaki".into(), move |_id, request| {
        serve_static(&dir, request.uri().path())
      });
      builder = builder.with_url("murasaki://localhost/");
    } else if let Some(url) = &opts.url {
      builder = builder.with_url(url);
    } else if let Some(html) = &opts.html {
      builder = builder.with_html(html);
    }

    let webview = {
      let window_ref = window.borrow();
      let w = window_ref
        .as_ref()
        .ok_or_else(|| Error::new(Status::GenericFailure, "window disposed"))?;
      builder
        .build(w)
        .map_err(|e| Error::new(Status::GenericFailure, format!("build webview: {e}")))?
    };

    *webview_slot.borrow_mut() = Some(webview);

    Ok(Self {
      webview: webview_slot,
      on_ipc,
      _window: window,
    })
  }

  /// See `SharedWebview`'s doc comment.
  #[cfg(any(target_os = "macos", target_os = "windows"))]
  pub(crate) fn handle(&self) -> SharedWebview {
    self.webview.clone()
  }
}

#[napi]
impl Webview {
  #[napi(js_name = "loadUrl")]
  pub fn load_url(&self, url: String) -> Result<()> {
    if let Some(wv) = self.webview.borrow().as_ref() {
      wv.load_url(&url)
        .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;
    }
    Ok(())
  }

  #[napi(js_name = "loadHtml")]
  pub fn load_html(&self, html: String) -> Result<()> {
    if let Some(wv) = self.webview.borrow().as_ref() {
      wv.load_html(&html)
        .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;
    }
    Ok(())
  }

  #[napi(js_name = "evaluate")]
  pub fn evaluate(&self, js: String) -> Result<()> {
    if let Some(wv) = self.webview.borrow().as_ref() {
      let _ = wv.evaluate_script(&js);
    }
    Ok(())
  }

  #[napi(js_name = "openDevtools")]
  pub fn open_devtools(&self) -> Result<()> {
    if let Some(wv) = self.webview.borrow().as_ref() {
      wv.open_devtools();
    }
    Ok(())
  }

  #[napi(js_name = "onIpcMessage")]
  pub fn on_ipc_message(&self, callback: ThreadsafeFunction<String>) -> Result<()> {
    *self.on_ipc.borrow_mut() = Some(Arc::new(callback));
    Ok(())
  }

  /// **Show a native context menu at the given position.**
  ///
  /// Public API kept for direct callers; the IPC path (`useGlobalContextMenu`)
  /// no longer goes through here and instead calls `show_native_context_menu`
  /// directly from the IPC handler — see the module doc comment.
  #[napi(js_name = "showContextMenu")]
  pub fn show_context_menu(&self, menu: MenuOptions, position: Option<Position>) -> Result<()> {
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    {
      let (x, y) = match position {
        Some(p) => (Some(p.x), Some(p.y)),
        None => (None, None),
      };
      show_native_context_menu(&self._window, &self.webview, &menu.items, x, y);
    }
    #[cfg(all(unix, not(target_os = "macos"), not(target_os = "android"), not(target_os = "freebsd")))]
    {
      let _ = (menu, position);
      return Err(Error::new(
        Status::GenericFailure,
        "showContextMenu on Linux is wired up but not yet implemented",
      ));
    }

    Ok(())
  }

  #[napi]
  pub fn dispose(&self) -> Result<()> {
    self.webview.borrow_mut().take();
    Ok(())
  }
}

/// Build a muda menu from `items` and pop it up **synchronously** over the
/// webview, then report the clicked item id (if any) back into page JS as a
/// `murasaki:menuclick` `CustomEvent`. Called both from the IPC handler
/// (`{ kind: "contextMenu" }`) and from the public `showContextMenu` method.
///
/// `window_slot` is unused here (macOS reaches through `webview_slot` for the
/// NSView instead) — it exists only so the three platform variants of this
/// function share one signature/call site. `x`/`y` are accepted but
/// currently unused — position is always `None` (cursor position). See the
/// two open questions in the doc comment below. (The Windows variant below
/// *does* honor `x`/`y` — muda's Windows backend makes the screen-coordinate
/// conversion straightforward via `ClientToScreen`, whereas the equivalent
/// for `show_context_menu_for_nsview` was left as an open question here.)
#[cfg(target_os = "macos")]
fn show_native_context_menu(
  window_slot: &SharedWindow,
  webview_slot: &Rc<RefCell<Option<WebView>>>,
  items: &[MenuItemOptions],
  _x: Option<f64>,
  _y: Option<f64>,
) {
  let _ = window_slot;

  use muda::ContextMenu;
  use wry::WebViewExtMacOS;

  let menu = match build_menu(items) {
    Ok(m) => m,
    Err(_) => return,
  };

  // Grab the NSView pointer and drop the RefCell borrow *before* calling
  // `show_context_menu_for_nsview` below — that call is modal (it pumps a
  // nested run loop) and re-entrant access to `webview_slot` while our
  // borrow was still live would panic with `BorrowError`.
  let ns_view_ptr: *const std::ffi::c_void = {
    let guard = webview_slot.borrow();
    match guard.as_ref() {
      Some(wv) => objc2::rc::Retained::as_ptr(&wv.webview()) as *const std::ffi::c_void,
      None => return,
    }
  };

  // Unconfirmed on real hardware (flagged for manual verification):
  //  (a) passing `None` here is assumed to show the menu at the current
  //      cursor position, per muda's own doc example.
  //  (b) `MenuEvent::receiver().try_recv()` immediately after this modal
  //      call returns is assumed to already have the click queued (i.e.
  //      muda pushes to the channel synchronously before unwinding the
  //      nested run loop). This is the primary approach; wiring
  //      `MenuEvent::receiver()` into `Application::run`'s event loop is
  //      the fallback if it turns out not to be.
  unsafe {
    menu.show_context_menu_for_nsview(ns_view_ptr, None);
  }

  if let Ok(event) = muda::MenuEvent::receiver().try_recv() {
    dispatch_menu_click(webview_slot, event.id().as_ref());
  }
}

/// Windows: same shape as the macOS version above — build the muda menu, pop
/// it up synchronously, then report the clicked item back into page JS.
///
/// Two differences from macOS, both because muda's Windows backend makes them
/// straightforward where the NSView-based macOS one didn't (see that
/// function's doc comment):
///  - Anchored to the top-level window's **HWND** (`window_slot`, not
///    `webview_slot` — the webview has no separate HWND of its own here) via
///    `tao::platform::windows::WindowExtWindows::hwnd`.
///  - Honors the caller's `x`/`y` instead of always falling back to the
///    cursor position. `x`/`y` are the IPC payload's `clientX`/`clientY`
///    (see `packages/murasaki/src/react/rpc.ts` and `context-menu.tsx`) —
///    logical pixels relative to the webview's client area. Passed through
///    as `Position::Logical` and converted to a screen point internally via
///    `ClientToScreen`, which is exact *as long as the webview fills the
///    window's entire client area with no offset* (true today — see
///    `Webview::new`, which never sub-positions the webview within the
///    window). If murasaki ever adds custom window chrome that insets the
///    webview, this mapping would need to add that offset.
#[cfg(target_os = "windows")]
fn show_native_context_menu(
  window_slot: &SharedWindow,
  webview_slot: &Rc<RefCell<Option<WebView>>>,
  items: &[MenuItemOptions],
  x: Option<f64>,
  y: Option<f64>,
) {
  use muda::{
    dpi::{LogicalPosition, Position},
    ContextMenu,
  };
  use tao::platform::windows::WindowExtWindows;

  let menu = match build_menu(items) {
    Ok(m) => m,
    Err(_) => return,
  };

  // Grab the HWND and drop the RefCell borrow *before* calling
  // `show_context_menu_for_hwnd` below — like the macOS call above, it's
  // modal (internally it's a `TrackPopupMenu` call, which pumps its own
  // nested message loop until the user dismisses the menu or picks an item),
  // and re-entrant access to `window_slot` while our borrow was still live
  // would panic with `BorrowError` if a window event fires during that
  // nested loop.
  let hwnd: isize = {
    let guard = window_slot.borrow();
    match guard.as_ref() {
      Some(w) => w.hwnd(),
      None => return,
    }
  };

  let position = match (x, y) {
    (Some(x), Some(y)) => Some(Position::Logical(LogicalPosition::new(x, y))),
    _ => None,
  };

  // SAFETY: `hwnd` was read from a live tao `Window` just above (the borrow
  // guard is dropped before this call, per the comment above).
  //
  // `MenuEvent::receiver().try_recv()` below is guaranteed to already have
  // the click queued by the time `show_context_menu_for_hwnd` returns: muda's
  // Windows backend calls `MenuEvent::send` (the same global channel
  // `MenuEvent::receiver()` reads on every platform) from inside the
  // `TrackPopupMenu`-driven nested loop, before that call unwinds — unlike
  // the macOS path above, this isn't an assumption, it's how
  // `show_context_menu_for_hwnd` is implemented (see
  // `muda::platform_impl::windows::MenuChild::show_context_menu_for_hwnd`).
  unsafe {
    menu.show_context_menu_for_hwnd(hwnd, position);
  }

  if let Ok(event) = muda::MenuEvent::receiver().try_recv() {
    dispatch_menu_click(webview_slot, event.id().as_ref());
  }
}

/// Dispatches `id` into the webview as a `murasaki:menuclick` `CustomEvent`
/// — the click-reporting half of every native-menu code path in this file:
/// context-menu popups on both platforms above, the Windows menu bar's
/// unrecognized-id fallback, and macOS's app-menu poll below.
fn dispatch_menu_click(webview_slot: &Rc<RefCell<Option<WebView>>>, id: &str) {
  let js = format!(
    "window.dispatchEvent(new CustomEvent('murasaki:menuclick',{{detail:{}}}))",
    serde_json::to_string(id).unwrap_or_else(|_| "null".to_string())
  );
  if let Some(wv) = webview_slot.borrow().as_ref() {
    let _ = wv.evaluate_script(&js);
  }
}

/// Windows only: polls muda's global menu-event channel for clicks on the
/// **native menu bar** built by `menu::build_windows_menu_bar` and installed
/// via `Menu::init_for_hwnd` (see `application.rs::create_window` and
/// `launcher.rs`'s `imp_win`). Unlike the context-menu popup above — modal,
/// so it reads its one expected event synchronously right after
/// `show_context_menu_for_hwnd` returns — the menu bar is persistent: clicks
/// arrive asynchronously, whenever the user picks an item, so this is called
/// once per tao event-loop tick instead (see both call sites' `event_loop.run`
/// closures).
///
/// Drains every pending event (`while let`, not just the first) in case more
/// than one queued up between two ticks. Ids outside `windows_menu_bar_ids`
/// are treated as a `useAppMenu` custom-item click (see
/// `menu::build_windows_app_menu_from_spec`) and dispatched via
/// `dispatch_menu_click` — in principle an app's own `useContextMenu` popup
/// also posts to this same global channel, but never actually reaches here:
/// its own `try_recv()` above runs synchronously in the same call stack as
/// its click, before this function's caller gets a turn.
///
/// Returns whether the Exit item was clicked — Minimize/Zoom, the Edit
/// items, and unrecognized (custom) ids are fully handled inside this
/// function (native window call / webview dispatch respectively), but Exit
/// needs process-shutdown semantics that differ between callers (kill the
/// spawned `node` child in the prod launcher vs. run the registered
/// `onQuit` JS callback in the dev path via `Application`), so it's left for
/// the caller to act on.
#[cfg(target_os = "windows")]
pub(crate) fn poll_menu_bar_events(window_slot: &SharedWindow, webview_slot: &SharedWebview) -> bool {
  use crate::menu::windows_menu_bar_ids as ids;

  let mut exit_requested = false;

  while let Ok(event) = muda::MenuEvent::receiver().try_recv() {
    let id = event.id().as_ref();
    if id == ids::EXIT {
      exit_requested = true;
    } else if id == ids::MINIMIZE {
      if let Some(w) = window_slot.borrow().as_ref() {
        w.set_minimized(true);
      }
    } else if id == ids::ZOOM {
      if let Some(w) = window_slot.borrow().as_ref() {
        w.set_maximized(!w.is_maximized());
      }
    } else if id == ids::UNDO {
      run_menu_bar_edit_command(webview_slot, "undo", ids::UNDO);
    } else if id == ids::REDO {
      run_menu_bar_edit_command(webview_slot, "redo", ids::REDO);
    } else if id == ids::CUT {
      run_menu_bar_edit_command(webview_slot, "cut", ids::CUT);
    } else if id == ids::COPY {
      run_menu_bar_edit_command(webview_slot, "copy", ids::COPY);
    } else if id == ids::PASTE {
      run_menu_bar_edit_command(webview_slot, "paste", ids::PASTE);
    } else if id == ids::SELECT_ALL {
      run_menu_bar_edit_command(webview_slot, "selectAll", ids::SELECT_ALL);
    } else {
      dispatch_menu_click(webview_slot, id);
    }
  }

  exit_requested
}

/// macOS only: polls muda's global menu-event channel for clicks on CUSTOM
/// (non-role) application-menu items declared via `useAppMenu` — see
/// `menu::build_macos_app_menu_from_spec`. macOS's role items (Undo/Redo/
/// Cut/Copy/Paste/Select All/Minimize/Zoom/Close/Quit) are real muda
/// `PredefinedMenuItem`s riding Cocoa's responder chain straight into the
/// focused `WKWebView` or the window manager — those never reach this
/// channel, so every event seen here is, by construction, a custom
/// `useAppMenu` item click that needs dispatching into the webview. Called
/// once per tao event-loop tick from `Application::run` and `launcher.rs`'s
/// `imp_macos`, mirroring `poll_menu_bar_events`'s role on Windows in the
/// same two call sites. (Before `useAppMenu`, macOS never needed this: the
/// startup default menu was 100% predefined items, so nothing was ever
/// pushed to this channel — that's why this function is new while
/// `poll_menu_bar_events` already existed.)
#[cfg(target_os = "macos")]
pub(crate) fn poll_app_menu_events(webview_slot: &SharedWebview) {
  while let Ok(event) = muda::MenuEvent::receiver().try_recv() {
    dispatch_menu_click(webview_slot, event.id().as_ref());
  }
}

/// Replaces the currently-installed application menu — the "REPLACE the
/// retained menu" half of the `{ kind: "appMenu" }` IPC branch (see
/// `Webview::new`'s `with_ipc_handler`).
///
/// **Ordering matters on Windows**: muda's `Menu::Drop` impl calls
/// `SetMenu(hwnd, null)` for every hwnd it's still attached to. If the OLD
/// menu were dropped *after* the new one's `init_for_hwnd`, that drop would
/// immediately blank out the just-installed bar — so the old menu is taken
/// out of `ctx.menu_slot` (dropping it) *before* building/attaching the new
/// one. (macOS's `Menu::init_for_nsapp` just overwrites `NSApp.mainMenu`'s
/// pointer — Cocoa's own retain keeps the old `NSMenu`'s Objective-C side
/// alive independent of muda's Rust wrapper, so this ordering isn't strictly
/// required there, but the same take-first pattern is applied uniformly
/// since it's harmless and keeps the two platform variants symmetric.)
#[cfg(target_os = "macos")]
fn handle_app_menu_message(_window_slot: &SharedWindow, ctx: &AppMenuContext, menus: &[AppMenuSpec]) {
  let about = ctx.about_info.as_ref();
  let menu = match crate::menu::build_macos_app_menu_from_spec(menus, &about, ctx.menu_labels.as_ref()) {
    Ok(m) => m,
    Err(_) => return,
  };

  ctx.menu_slot.borrow_mut().take();
  menu.init_for_nsapp();
  *ctx.menu_slot.borrow_mut() = Some(menu);
}

/// Windows counterpart of the macOS `handle_app_menu_message` above — see
/// that function's doc comment for the drop-before-install ordering
/// requirement, which is load-bearing here (unlike on macOS).
#[cfg(target_os = "windows")]
fn handle_app_menu_message(window_slot: &SharedWindow, ctx: &AppMenuContext, menus: &[AppMenuSpec]) {
  use tao::platform::windows::WindowExtWindows;

  let hwnd: isize = {
    let guard = window_slot.borrow();
    match guard.as_ref() {
      Some(w) => w.hwnd(),
      None => return,
    }
  };

  let menu = match crate::menu::build_windows_app_menu_from_spec(menus, ctx.menu_labels.as_ref()) {
    Ok(m) => m,
    Err(_) => return,
  };

  // Drop the OLD menu first — see this function's doc comment.
  ctx.menu_slot.borrow_mut().take();
  // SAFETY: `hwnd` was read from a live tao `Window` just above.
  if let Err(e) = unsafe { menu.init_for_hwnd(hwnd) } {
    eprintln!("murasaki: failed to attach app menu: {e}");
  }
  *ctx.menu_slot.borrow_mut() = Some(menu);
}

/// Linux: not implemented yet — mirrors the (also unimplemented) direct-call
/// path in `Webview::show_context_menu`.
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn handle_app_menu_message(_window_slot: &SharedWindow, _ctx: &AppMenuContext, _menus: &[AppMenuSpec]) {}

/// Runs `document.execCommand(command)` in the webview for a native menu-bar
/// Edit item — see `menu::build_windows_menu_bar`'s doc comment for why these
/// are custom items dispatched this way instead of muda `PredefinedMenuItem`s.
///
/// Also fires the same `murasaki:menuclick` `CustomEvent` the context-menu
/// path above dispatches (with `id`, one of `windows_menu_bar_ids`, as
/// `detail`), so an app can still observe or override these via the same
/// mechanism `useContextMenu` listens on — but doesn't *depend* on any
/// listener existing: the framework's own default-menu-action JS layer (from
/// an earlier custom-title-bar iteration, since reverted — see git history)
/// no longer ships, so `execCommand` runs unconditionally first, up front in
/// this same script, rather than only as an app-registered handler's effect.
#[cfg(target_os = "windows")]
fn run_menu_bar_edit_command(webview_slot: &SharedWebview, command: &str, id: &str) {
  let js = format!(
    "document.execCommand('{command}');window.dispatchEvent(new CustomEvent('murasaki:menuclick',{{detail:{}}}))",
    serde_json::to_string(id).unwrap_or_else(|_| "null".to_string())
  );
  if let Some(wv) = webview_slot.borrow().as_ref() {
    let _ = wv.evaluate_script(&js);
  }
}

/// Linux: not wired through the Rust IPC handler yet — mirrors the (also
/// unimplemented) direct-call path in `Webview::show_context_menu`.
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn show_native_context_menu(
  _window_slot: &SharedWindow,
  _webview_slot: &Rc<RefCell<Option<WebView>>>,
  _items: &[MenuItemOptions],
  _x: Option<f64>,
  _y: Option<f64>,
) {
}

/// Custom-protocol handler backing `serve_dir` (production static file
/// serving — see the `serve_dir` doc comment on `WebviewOptions`).
///
/// `uri_path` is the request's URL path, e.g. `/assets/x.js` for
/// `murasaki://localhost/assets/x.js` (the `murasaki://localhost` part is
/// scheme + host and is irrelevant here — only the path is used). Resolves
/// the path under `dir`, guards against path traversal by requiring the
/// canonicalized target to stay under `dir`'s canonical form, and falls back
/// to `dir/index.html` (SPA routing) when the target is missing or isn't a
/// file.
fn serve_static(dir: &str, uri_path: &str) -> Response<Cow<'static, [u8]>> {
  let rel = uri_path.trim_start_matches('/');
  let rel = if rel.is_empty() { "index.html" } else { rel };

  let base = Path::new(dir);
  if let Ok(canonical_base) = base.canonicalize() {
    let resolved = base
      .join(rel)
      .canonicalize()
      .ok()
      .filter(|p| p.starts_with(&canonical_base) && p.is_file());

    if let Some(path) = resolved {
      if let Ok(bytes) = std::fs::read(&path) {
        return static_response(bytes, mime_for(rel));
      }
    }
  }

  // Not found (or outside `dir`) → SPA fallback to index.html.
  match std::fs::read(base.join("index.html")) {
    Ok(bytes) => static_response(bytes, "text/html; charset=utf-8"),
    Err(_) => Response::builder()
      .status(StatusCode::NOT_FOUND)
      .body(Cow::Borrowed(&[][..]))
      .unwrap_or_else(|_| Response::new(Cow::Borrowed(&[][..]))),
  }
}

fn static_response(bytes: Vec<u8>, mime: &str) -> Response<Cow<'static, [u8]>> {
  Response::builder()
    .header(CONTENT_TYPE, mime)
    .body(Cow::Owned(bytes))
    .unwrap_or_else(|_| Response::new(Cow::Borrowed(&[][..])))
}

/// Mirrors the MIME map in `assets/prod-launcher.mjs` (pre-custom-protocol
/// version) so behavior stays identical after the switch.
fn mime_for(path: &str) -> &'static str {
  let ext = Path::new(path)
    .extension()
    .and_then(|e| e.to_str())
    .unwrap_or("")
    .to_ascii_lowercase();
  match ext.as_str() {
    "html" => "text/html; charset=utf-8",
    "js" | "mjs" => "text/javascript; charset=utf-8",
    "css" => "text/css; charset=utf-8",
    "json" => "application/json; charset=utf-8",
    "svg" => "image/svg+xml",
    "png" => "image/png",
    "jpg" | "jpeg" => "image/jpeg",
    "gif" => "image/gif",
    "webp" => "image/webp",
    "ico" => "image/x-icon",
    "woff" => "font/woff",
    "woff2" => "font/woff2",
    "ttf" => "font/ttf",
    "map" => "application/json",
    _ => "application/octet-stream",
  }
}
