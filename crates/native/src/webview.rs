//! Webview — wry WebView + IPC channel + **native context menu popup**.
//!
//! Context menus are handled entirely on the Rust side (see
//! `show_native_context_menu` below): `Application::run()` blocks Node's
//! libuv loop for as long as the app is open, so a round-trip through
//! `onIpcMessage` back into JS never fires. Instead the IPC handler below
//! intercepts `{ kind: "contextMenu" }` messages itself, pops the muda menu
//! synchronously, and reports the clicked item back to the page via
//! `evaluate_script` (which runs inside WebKit and isn't affected by the
//! blocked Node loop).

use napi::{
  bindgen_prelude::{Error, Result, Status},
  threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode},
};
use napi_derive::napi;
use std::{borrow::Cow, cell::RefCell, path::Path, rc::Rc, sync::Arc};

use wry::{
  http::{header::CONTENT_TYPE, Response, StatusCode},
  WebContext, WebView, WebViewBuilder,
};

use crate::{
  menu::build_menu,
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

#[napi]
pub struct Webview {
  webview: Rc<RefCell<Option<WebView>>>,
  on_ipc: Rc<RefCell<Option<Arc<ThreadsafeFunction<String>>>>>,
  /// Keep the tao window alive for as long as the webview exists. wry's WebView
  /// only *borrows* the window's NSView — if the tao `Window` is dropped, the
  /// NSWindow closes and the webview goes offscreen. Holding a clone of the
  /// shared window handle prevents that even when the intermediate
  /// `BrowserWindow` returned by `Application::createWindow` goes out of scope.
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
  pub(crate) fn new(window: SharedWindow, opts: WebviewOptions) -> Result<Self> {
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

    // IPC: JS calls window.ipc.postMessage(str). Context menus are handled
    // synchronously right here (Node's loop is blocked by `Application::run`
    // and can't round-trip); everything else still forwards to Node.
    let ipc_slot = on_ipc.clone();
    let ipc_webview_slot = webview_slot.clone();
    builder = builder.with_ipc_handler(move |request| {
      let body = request.body().clone();

      let kind = serde_json::from_str::<IpcEnvelope>(&body)
        .ok()
        .and_then(|e| e.kind);

      if kind.as_deref() == Some("contextMenu") {
        if let Ok(payload) = serde_json::from_str::<ContextMenuPayload>(&body) {
          show_native_context_menu(&ipc_webview_slot, &payload.items, payload.x, payload.y);
        }
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
    #[cfg(target_os = "macos")]
    {
      let (x, y) = match position {
        Some(p) => (Some(p.x), Some(p.y)),
        None => (None, None),
      };
      show_native_context_menu(&self.webview, &menu.items, x, y);
    }
    #[cfg(target_os = "windows")]
    {
      // Windows path — needs the parent window's HWND, not the webview's.
      // Deferred to a follow-up; the JS API shape is stable.
      let _ = (menu, position);
      return Err(Error::new(
        Status::GenericFailure,
        "showContextMenu on Windows is wired up but not yet implemented",
      ));
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
/// `x`/`y` are accepted but currently unused — position is always `None`
/// (cursor position). See the two open questions in the doc comment below.
#[cfg(target_os = "macos")]
fn show_native_context_menu(
  webview_slot: &Rc<RefCell<Option<WebView>>>,
  items: &[MenuItemOptions],
  _x: Option<f64>,
  _y: Option<f64>,
) {
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
    let id = event.id().as_ref();
    let js = format!(
      "window.dispatchEvent(new CustomEvent('murasaki:menuclick',{{detail:{}}}))",
      serde_json::to_string(id).unwrap_or_else(|_| "null".to_string())
    );
    if let Some(wv) = webview_slot.borrow().as_ref() {
      let _ = wv.evaluate_script(&js);
    }
  }
}

/// Windows/Linux: not wired through the Rust IPC handler yet — mirrors the
/// (also unimplemented) direct-call path in `Webview::show_context_menu`.
#[cfg(not(target_os = "macos"))]
fn show_native_context_menu(
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
