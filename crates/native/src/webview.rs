//! Webview — wry WebView + IPC channel + **native context menu popup** +
//! **native app-menu bar** (`useAppMenu`) + **app quit** (`quit()`).
//!
//! All three are handled entirely on the Rust side (see
//! `show_native_context_menu`, `handle_app_menu_message`, and
//! `QUIT_REQUESTED`/`quit_requested` below): `Application::run()` blocks
//! Node's libuv loop for as long as the app is open, so a round-trip through
//! `onIpcMessage` back into JS never fires. Instead the IPC handler below
//! intercepts `{ kind: "contextMenu" }`, `{ kind: "appMenu" }`, and
//! authorized `app.quit` native calls itself.
//!
//! Context menus pop the muda menu synchronously — via a modal call that
//! pumps its own nested run/message loop (`show_context_menu_for_nsview` on
//! macOS, `show_context_menu_for_hwnd` on Windows, `show_context_menu_for_gtk_window`
//! on Linux) — and report the clicked item back to the page via
//! `evaluate_script` (which runs inside the platform webview — WebKit on
//! macOS/Linux, WebView2 on Windows — and isn't affected by the blocked Node
//! loop).
//!
//! The app menu (`useAppMenu`) instead **replaces** the standing menu
//! bar/NSMenu — see `AppMenuContext` and `handle_app_menu_message` — and its
//! clicks arrive asynchronously (whenever the user picks an item, not
//! synchronously like a popup), picked up by `poll_app_menu_events` (macOS)
//! / `poll_menu_bar_events` (Windows and Linux), polled once per tao
//! event-loop tick from `Application::run` and `launcher.rs`'s per-platform
//! launchers (the Linux dev-mode poll lives in `application.rs`; the prod
//! launcher's Linux support is a later phase — see that module's doc
//! comment).
//!
//! `app.quit` (`quit()`) sets `QUIT_REQUESTED` instead of acting immediately —
//! the ipc_handler closure has no access to the event loop's `ControlFlow`,
//! so like the two polls above, it's read once per tick (`quit_requested`)
//! by those same three event loops, which do have access to it.

use napi::{
    bindgen_prelude::{Error, Result, Status},
    threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode},
};
use napi_derive::napi;
#[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
use std::collections::VecDeque;
use std::{
    borrow::Cow,
    cell::{Cell, RefCell},
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    rc::Rc,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};

use tray_icon::{Icon as TrayIconImage, TrayIconBuilder, TrayIconEvent};
use wry::{
    cookie,
    http::{header::CONTENT_TYPE, Response, StatusCode},
    DragDropEvent, NewWindowResponse, ProxyConfig, ProxyEndpoint, WebContext, WebView,
    WebViewBuilder,
};

use crate::{
    capability_policy::{CapabilityPolicy, CapabilityResource},
    download,
    menu::{build_menu, AppMenuSpec, SharedMenu},
    types::{MenuItemOptions, MenuOptions, Position, WebviewOptions},
    window::{SharedProcessTray, SharedWindow, SharedWindowRegistry, WindowRegistry},
};

/// Coarse gate applied to every renderer IPC message *before* its `kind` (and,
/// for `nativeCall`, its `method`) is known — see `with_ipc_handler` below.
/// Deliberately generous (16 MiB) so a `clipboard.writeImage` body can be
/// parsed at all; the real per-message ceiling is enforced afterward by
/// `DEFAULT_MAX_METHOD_BODY_BYTES`/`max_native_call_body_bytes` once the
/// message kind/method is known, exactly as `MAX_IPC_BODY_BYTES` alone used
/// to (pre-0.38, this constant *was* that ceiling).
const MAX_IPC_PREPARSE_BODY_BYTES: usize = 16 * 1024 * 1024;
/// Per-method cap applied to every renderer `nativeCall`, plus every
/// `contextMenu`/`appMenu` message and the plain Node-forwarded IPC channel —
/// the original blanket ceiling every one of those relied on before the
/// pre-parse gate above was raised to accommodate large `nativeCall` bodies.
const DEFAULT_MAX_METHOD_BODY_BYTES: usize = 256 * 1024;
/// `clipboard.writeImage` carries a base64-encoded PNG (see `clipboard.rs`);
/// its wire budget matches `clipboard::MAX_CLIPBOARD_READ_IMAGE_PNG_BYTES` so
/// the read and write directions share one round-trip size budget.
const MAX_CLIPBOARD_WRITE_IMAGE_BODY_BYTES: usize = 16 * 1024 * 1024;
/// `clipboard.writeHtml` carries HTML plus an optional plain-text alternative
/// (see `clipboard::MAX_CLIPBOARD_HTML_BYTES`/`MAX_CLIPBOARD_HTML_ALT_TEXT_BYTES`),
/// with headroom for JSON-string escaping overhead.
const MAX_CLIPBOARD_WRITE_HTML_BODY_BYTES: usize = 2 * 1024 * 1024;
const MAX_MENU_ITEMS: usize = 256;
const MAX_MENU_DEPTH: usize = 8;
const MAX_MENU_STRING_BYTES: usize = 1024;
const MAX_USER_AGENT_BYTES: usize = 512;
const MAX_PROXY_HOST_BYTES: usize = 253;
const TRAY_MENU_ID_PREFIX: &str = "murasaki-tray-menu:";
static TRAY_MENU_GENERATION: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, Debug, PartialEq, Eq)]
struct WebContextIdentity {
    app_id: Option<String>,
    incognito: bool,
}

/// One browser context per application process. The Application/launcher owns
/// this handle and every Webview retains a clone, so the context is dropped
/// only after the final platform WebView. Wry deliberately ignores this
/// context for incognito WebViews, so private sessions are not promised to be
/// shared between windows.
#[derive(Default)]
pub(crate) struct ProcessWebContext {
    identity: Option<WebContextIdentity>,
    context: Option<WebContext>,
}

pub(crate) type SharedWebContext = Rc<RefCell<ProcessWebContext>>;

impl ProcessWebContext {
    fn context_for(
        &mut self,
        app_id: Option<&str>,
        incognito: bool,
    ) -> std::result::Result<&mut WebContext, String> {
        let identity = WebContextIdentity {
            app_id: app_id.map(str::to_string),
            incognito,
        };
        if let Some(existing) = &self.identity {
            if existing != &identity {
                return Err(
                    "all application windows must share the same appId and incognito WebContext settings"
                        .to_string(),
                );
            }
        } else {
            self.identity = Some(identity);
            self.context = Some(WebContext::new(if incognito {
                None
            } else {
                webview2_data_dir(app_id)
            }));
        }
        self.context
            .as_mut()
            .ok_or_else(|| "application WebContext is unavailable".to_string())
    }
}

fn ipc_body_is_allowed(len: usize) -> bool {
    len <= MAX_IPC_PREPARSE_BODY_BYTES
}

/// Per-method cap for a `nativeCall`'s raw IPC body length — measured the
/// same way as `ipc_body_is_allowed` above, just against a tighter,
/// method-specific ceiling once `method` is known.
fn max_native_call_body_bytes(method: &str) -> usize {
    match method {
        "clipboard.writeImage" => MAX_CLIPBOARD_WRITE_IMAGE_BODY_BYTES,
        "clipboard.writeHtml" => MAX_CLIPBOARD_WRITE_HTML_BODY_BYTES,
        _ => DEFAULT_MAX_METHOD_BODY_BYTES,
    }
}

fn native_call_body_is_allowed(method: &str, body_len: usize) -> bool {
    body_len <= max_native_call_body_bytes(method)
}

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

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct MenuPollOutcome {
    pub quit: bool,
    pub close: bool,
}

fn has_capability(capabilities: &[String], capability: &str) -> bool {
    capabilities.iter().any(|entry| entry == capability)
}

fn context_menu_is_allowed(capabilities: &[String]) -> bool {
    has_capability(capabilities, "menu:context")
}

fn app_menu_is_allowed(label: &str, capabilities: &[String]) -> bool {
    label == "main" && has_capability(capabilities, "menu:application")
}

fn role_capability(role: &str) -> std::result::Result<Option<&'static str>, String> {
    match role {
        "quit" => Ok(Some("app:quit")),
        "close" | "closeWindow" | "close-window" => Ok(Some("window:close")),
        "minimize" => Ok(Some("window:minimize")),
        "zoom" | "maximize" | "fullscreen" | "toggleFullscreen" => {
            Ok(Some("window:toggleMaximize"))
        }
        "copy" | "cut" => Ok(Some("clipboard:writeText")),
        "paste" => Ok(Some("clipboard:readText")),
        "about" | "selectAll" | "select-all" | "undo" | "redo" | "separator" => Ok(None),
        _ => Err(format!("unsupported renderer menu role {role}")),
    }
}

fn validate_menu_string(value: Option<&str>) -> std::result::Result<(), String> {
    if value.is_some_and(|value| value.len() > MAX_MENU_STRING_BYTES) {
        return Err("menu strings must not exceed 1024 bytes".to_string());
    }
    Ok(())
}

fn validate_menu_items(
    items: &[MenuItemOptions],
    capabilities: &[String],
    depth: usize,
    total: &mut usize,
) -> std::result::Result<(), String> {
    if depth > MAX_MENU_DEPTH {
        return Err("menu nesting exceeds the maximum depth of 8".to_string());
    }
    for item in items {
        *total += 1;
        if *total > MAX_MENU_ITEMS {
            return Err("menu exceeds the maximum of 256 items".to_string());
        }
        for value in [
            item.id.as_deref(),
            item.label.as_deref(),
            item.accelerator.as_deref(),
            item.icon.as_deref(),
            item.role.as_deref(),
        ] {
            validate_menu_string(value)?;
        }
        if item.id.as_deref().is_some_and(|id| {
            id.starts_with("murasaki-menu:")
                || id.starts_with("murasaki-menu-bar:")
                || id.starts_with(TRAY_MENU_ID_PREFIX)
        }) {
            return Err("menu item id uses a reserved Murasaki menu prefix".to_string());
        }
        if let Some(role) = item.role.as_deref() {
            if let Some(capability) = role_capability(role)? {
                if !has_capability(capabilities, capability) {
                    return Err(format!("menu role {role} requires capability {capability}"));
                }
            }
        }
        if let Some(children) = item.submenu.as_deref() {
            validate_menu_items(children, capabilities, depth + 1, total)?;
        }
    }
    Ok(())
}

fn namespace_tray_menu_items(
    items: &[MenuItemOptions],
    generation: u64,
    public_ids: &mut HashSet<String>,
    native_to_public: &mut HashMap<String, String>,
) -> std::result::Result<Vec<MenuItemOptions>, String> {
    let mut namespaced = Vec::with_capacity(items.len());
    for item in items {
        if item.role.is_some() {
            return Err(
                "tray menu roles are not supported; use an id and handle it with tray.onMenuItem()"
                    .to_string(),
            );
        }
        let mut item = item.clone();
        if let Some(children) = item.submenu.as_deref() {
            // A submenu heading is not clickable and muda does not emit an event
            // for it. Discard a manually supplied wire id so only namespaced leaf
            // ids can ever enter the process-global menu event channel.
            item.id = None;
            item.submenu = Some(namespace_tray_menu_items(
                children,
                generation,
                public_ids,
                native_to_public,
            )?);
        } else if !item.separator.unwrap_or(false) {
            let public_id = item
                .id
                .as_deref()
                .filter(|id| !id.is_empty())
                .ok_or_else(|| {
                    "every clickable tray menu item requires a non-empty id".to_string()
                })?;
            if !public_ids.insert(public_id.to_string()) {
                return Err(format!("duplicate tray menu item id {public_id}"));
            }
            let native_id = format!("{TRAY_MENU_ID_PREFIX}{generation}:{public_id}");
            native_to_public.insert(native_id.clone(), public_id.to_string());
            item.id = Some(native_id);
        }
        namespaced.push(item);
    }
    Ok(namespaced)
}

fn build_tray_menu(
    items: &[MenuItemOptions],
    capabilities: &[String],
) -> std::result::Result<(muda::Menu, HashMap<String, String>), String> {
    let (namespaced, native_to_public) = prepare_tray_menu_items(items, capabilities)?;
    let menu = build_menu(&namespaced).map_err(|error| error.to_string())?;
    Ok((menu, native_to_public))
}

fn prepare_tray_menu_items(
    items: &[MenuItemOptions],
    capabilities: &[String],
) -> std::result::Result<(Vec<MenuItemOptions>, HashMap<String, String>), String> {
    let mut total = 0;
    validate_menu_items(items, capabilities, 1, &mut total)?;
    let generation = TRAY_MENU_GENERATION.fetch_add(1, Ordering::Relaxed);
    let mut public_ids = HashSet::new();
    let mut native_to_public = HashMap::new();
    let namespaced =
        namespace_tray_menu_items(items, generation, &mut public_ids, &mut native_to_public)?;
    Ok((namespaced, native_to_public))
}

fn validate_context_menu_payload(
    payload: &ContextMenuPayload,
    capabilities: &[String],
) -> std::result::Result<(), String> {
    if payload.x.is_some_and(|value| !value.is_finite())
        || payload.y.is_some_and(|value| !value.is_finite())
    {
        return Err("context menu coordinates must be finite".to_string());
    }
    if menu_items_contain_id_prefix(&payload.items, "murasaki-app-menu-") {
        return Err("context menu item id uses a reserved application-menu prefix".to_string());
    }
    let mut total = 0;
    validate_menu_items(&payload.items, capabilities, 1, &mut total)
}

fn menu_items_contain_id_prefix(items: &[MenuItemOptions], prefix: &str) -> bool {
    items.iter().any(|item| {
        item.id.as_deref().is_some_and(|id| id.starts_with(prefix))
            || item
                .submenu
                .as_deref()
                .is_some_and(|children| menu_items_contain_id_prefix(children, prefix))
    })
}

fn validate_app_menu_payload(
    payload: &AppMenuPayload,
    capabilities: &[String],
) -> std::result::Result<(), String> {
    let mut total = 0;
    for menu in &payload.menus {
        total += 1;
        if total > MAX_MENU_ITEMS {
            return Err("menu exceeds the maximum of 256 items".to_string());
        }
        validate_menu_string(menu.role.as_deref())?;
        validate_menu_string(menu.label.as_deref())?;
        match menu.role.as_deref() {
            Some("editMenu") => {
                for capability in ["clipboard:readText", "clipboard:writeText"] {
                    if !has_capability(capabilities, capability) {
                        return Err(format!(
                            "menu role editMenu requires capability {capability}"
                        ));
                    }
                }
            }
            Some("windowMenu") => {
                for capability in ["window:minimize", "window:toggleMaximize"] {
                    if !has_capability(capabilities, capability) {
                        return Err(format!(
                            "menu role windowMenu requires capability {capability}"
                        ));
                    }
                }
            }
            Some(role) => return Err(format!("unsupported application menu role {role}")),
            None => {}
        }
        if let Some(items) = menu.items.as_deref() {
            validate_menu_items(items, capabilities, 1, &mut total)?;
        }
    }
    Ok(())
}

/// Authenticated renderer -> native-host RPC. The IPC handler already checks
/// that the sender belongs to the exact application origin before parsing
/// this payload, so native privileges never follow an off-origin navigation.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct NativeCallPayload {
    request_id: String,
    method: String,
    #[serde(default)]
    args: serde_json::Value,
}

struct NativeCallContext<'a> {
    window_slot: &'a SharedWindow,
    webview_slot: &'a Rc<RefCell<Option<WebView>>>,
    tray_slot: &'a SharedProcessTray,
    default_tray_icon: Option<&'a str>,
    capabilities: &'a [String],
    capability_policy: &'a CapabilityPolicy,
    app_id: Option<&'a str>,
    current_label: &'a str,
    windows: &'a SharedWindowRegistry,
    wake: &'a dyn Fn(),
}

/// Set synchronously by the IPC handler below when an authorized `app.quit`
/// call arrives (posted by `quit()` — see the updater install→quit→apply
/// handshake, contract §7). Like `contextMenu`/`appMenu`, this can't be
/// handled by calling into `ControlFlow` directly — the ipc_handler closure
/// has no access to it — so it's a flag instead, read once per tao
/// event-loop tick by `Application::run` (dev) and both of `launcher.rs`'s
/// prod event loops (`quit_requested` below) so *they* can set
/// `ControlFlow::Exit`. App quit remains process-wide even when several
/// labeled windows are registered.
static QUIT_REQUESTED: AtomicBool = AtomicBool::new(false);

// `muda` exposes one process-global event channel for every menu type. A
// context popup is modal, but an application-menu click may already be
// queued when that popup opens. Preserve those unrelated ids here instead
// of letting the popup consume and mis-dispatch them.
#[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
thread_local! {
  static DEFERRED_APP_MENU_EVENTS: RefCell<VecDeque<String>> = const {
    RefCell::new(VecDeque::new())
  };
}

/// Whether `app.quit` has been requested since the last check —
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
pub(crate) type SharedWebview = crate::window::SharedWebview;

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
    label: String,
    windows: SharedWindowRegistry,
    tray: SharedProcessTray,
    _web_context: SharedWebContext,
    wake: Rc<dyn Fn()>,
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
fn webview2_data_dir(app_id: Option<&str>) -> Option<std::path::PathBuf> {
    if cfg!(target_os = "windows") {
        let base = std::env::var_os("LOCALAPPDATA")?;
        // Never share browser state between unrelated Murasaki apps. Besides
        // surprising cookie/localStorage leakage, a shared WebView2 directory
        // also prevents two different apps from opening it concurrently.
        let profile = app_id
            .filter(|value| !value.is_empty())
            .map(sanitize_profile_name)
            .unwrap_or_else(|| "default".to_string());
        let dir = std::path::PathBuf::from(base)
            .join("murasaki")
            .join(profile)
            .join("WebView2");
        // Best-effort: WebView2 creates missing dirs itself, but only one level.
        let _ = std::fs::create_dir_all(&dir);
        Some(dir)
    } else {
        None
    }
}

fn sanitize_profile_name(value: &str) -> String {
    use sha2::{Digest, Sha256};

    // Retain a short human-readable prefix for diagnostics, but make the
    // identity collision-resistant. Replacing separators alone made distinct
    // app IDs such as `com.example/app` and `com.example?app` share cookies,
    // localStorage and a concurrently locked WebView2 profile directory.
    let mut prefix: String = value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '.' | '-' | '_') {
                ch
            } else {
                '_'
            }
        })
        .take(48)
        .collect();
    if prefix.is_empty() {
        prefix.push_str("app");
    }
    let hash: String = Sha256::digest(value.as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    format!("{prefix}-{hash}")
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum ValidatedProxyProtocol {
    Http,
    Socks5,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct ValidatedProxy {
    protocol: ValidatedProxyProtocol,
    host: String,
    port: u16,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
struct ValidatedWebviewNetwork {
    user_agent: Option<String>,
    incognito: bool,
    proxy: Option<ValidatedProxy>,
}

fn validate_webview_network(
    opts: &WebviewOptions,
) -> std::result::Result<ValidatedWebviewNetwork, String> {
    let user_agent = opts
        .user_agent
        .as_deref()
        .map(validate_user_agent)
        .transpose()?;
    let proxy = opts
        .proxy
        .as_ref()
        .map(|proxy| {
            let protocol = match proxy.protocol.as_str() {
                "http" => ValidatedProxyProtocol::Http,
                "socks5" => ValidatedProxyProtocol::Socks5,
                _ => return Err("webview proxy protocol must be http or socks5".to_string()),
            };
            if !valid_proxy_host(&proxy.host) {
                return Err(
                    "webview proxy host must be a hostname or IP literal without URL or credential components"
                        .to_string(),
                );
            }
            let port = u16::try_from(proxy.port)
                .ok()
                .filter(|port| *port > 0)
                .ok_or_else(|| "webview proxy port must be between 1 and 65535".to_string())?;
            ensure_proxy_platform_support()?;
            Ok(ValidatedProxy {
                protocol,
                host: proxy.host.clone(),
                port,
            })
        })
        .transpose()?;
    Ok(ValidatedWebviewNetwork {
        user_agent,
        incognito: opts.incognito.unwrap_or(false),
        proxy,
    })
}

fn validate_user_agent(value: &str) -> std::result::Result<String, String> {
    if value.is_empty()
        || value.trim() != value
        || value.len() > MAX_USER_AGENT_BYTES
        || value.chars().any(char::is_control)
    {
        return Err(format!(
            "webview user agent must be trimmed, non-empty, at most {MAX_USER_AGENT_BYTES} UTF-8 bytes, and contain no control characters"
        ));
    }
    Ok(value.to_string())
}

fn valid_proxy_host(host: &str) -> bool {
    if host.is_empty()
        || host.trim() != host
        || host.len() > MAX_PROXY_HOST_BYTES
        || !host.is_ascii()
        || host
            .bytes()
            .any(|byte| byte <= b' ' || byte == 0x7f || b"/\\@?#".contains(&byte))
    {
        return false;
    }
    if let Some(ipv6) = host
        .strip_prefix('[')
        .and_then(|host| host.strip_suffix(']'))
    {
        return ipv6.parse::<std::net::Ipv6Addr>().is_ok();
    }
    if host.contains(':') || host.contains('[') || host.contains(']') {
        return false;
    }
    if host.parse::<std::net::Ipv4Addr>().is_ok() {
        return true;
    }
    host.len() <= MAX_PROXY_HOST_BYTES
        && host.split('.').all(|label| {
            !label.is_empty()
                && label.len() <= 63
                && label
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
                && label
                    .as_bytes()
                    .first()
                    .is_some_and(u8::is_ascii_alphanumeric)
                && label
                    .as_bytes()
                    .last()
                    .is_some_and(u8::is_ascii_alphanumeric)
        })
}

#[cfg(target_os = "macos")]
fn ensure_proxy_platform_support() -> std::result::Result<(), String> {
    use objc2_foundation::NSProcessInfo;
    let major = NSProcessInfo::processInfo()
        .operatingSystemVersion()
        .majorVersion;
    if major < 14 {
        return Err("webview proxy requires macOS 14 or newer".to_string());
    }
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn ensure_proxy_platform_support() -> std::result::Result<(), String> {
    Ok(())
}

fn wry_proxy(proxy: ValidatedProxy) -> ProxyConfig {
    let endpoint = ProxyEndpoint {
        host: proxy.host,
        port: proxy.port.to_string(),
    };
    match proxy.protocol {
        ValidatedProxyProtocol::Http => ProxyConfig::Http(endpoint),
        ValidatedProxyProtocol::Socks5 => ProxyConfig::Socks5(endpoint),
    }
}

#[derive(Debug, PartialEq, Eq)]
enum NavigationPolicy {
    Allow,
    OpenExternal,
    Deny,
}

/// Enforce an exact app origin rather than trusting every loopback port. An
/// unrelated localhost page must never inherit the renderer's native IPC
/// privileges. Unsafe local schemes are denied; normal web links and
/// mail/tel links are delegated to the system instead of replacing the app.
fn navigation_policy(target: &str, trusted: Option<&url::Url>) -> NavigationPolicy {
    let Ok(parsed) = url::Url::parse(target) else {
        return NavigationPolicy::Deny;
    };

    if parsed.scheme() == "about" && parsed.path() == "blank" {
        return NavigationPolicy::Allow;
    }
    if parsed.scheme() == "blob" {
        // A blob URL serializes its creator URL after `blob:`. Only blobs created
        // by the exact application origin may stay inside the privileged webview.
        return target
            .strip_prefix("blob:")
            .and_then(|inner| url::Url::parse(inner).ok())
            .filter(|inner| same_origin(inner, trusted))
            .map(|_| NavigationPolicy::Allow)
            .unwrap_or(NavigationPolicy::Deny);
    }

    if same_origin(&parsed, trusted) {
        return NavigationPolicy::Allow;
    }

    match parsed.scheme() {
        "http" | "https" | "mailto" | "tel" => NavigationPolicy::OpenExternal,
        "file" | "data" | "javascript" => NavigationPolicy::Deny,
        _ => NavigationPolicy::Deny,
    }
}

fn same_origin(candidate: &url::Url, trusted: Option<&url::Url>) -> bool {
    trusted.is_some_and(|trusted| {
        candidate.scheme() == trusted.scheme()
            && candidate.host() == trusted.host()
            && candidate.port_or_known_default() == trusted.port_or_known_default()
    })
}

/// Privileged IPC is stricter than top-level navigation. `about:blank` and
/// `blob:` inherit an origin at runtime, but the callback only exposes their
/// serialized URI; it cannot prove which frame created them. Requiring the
/// exact configured application origin prevents a remote child frame from
/// manufacturing an inherited-looking URI and reaching native capabilities.
fn ipc_origin_is_trusted(target: &str, trusted: Option<&url::Url>) -> bool {
    url::Url::parse(target)
        .ok()
        .is_some_and(|parsed| same_origin(&parsed, trusted))
}

fn permission_for_native_method(method: &str) -> Option<&'static str> {
    match method {
        "app.quit" => Some("app:quit"),
        "dialog.openFile" => Some("dialog:openFile"),
        "dialog.openDirectory" => Some("dialog:openDirectory"),
        "dialog.saveFile" => Some("dialog:saveFile"),
        "dialog.showMessage" => Some("dialog:message"),
        "clipboard.readText" => Some("clipboard:readText"),
        "clipboard.writeText" => Some("clipboard:writeText"),
        "clipboard.readImage" => Some("clipboard:readImage"),
        "clipboard.writeImage" => Some("clipboard:writeImage"),
        "clipboard.writeHtml" => Some("clipboard:writeHtml"),
        "notification.show" => Some("notification:show"),
        "shell.openExternal" => Some("shell:openExternal"),
        "shell.showItemInFolder" => Some("shell:showItemInFolder"),
        "shell.trashItem" => Some("shell:trashItem"),
        "shell.openPath" => Some("shell:openPath"),
        "secureStorage.get" => Some("secureStorage:get"),
        "secureStorage.set" => Some("secureStorage:set"),
        "secureStorage.delete" => Some("secureStorage:delete"),
        "systemPermission.status" => Some("systemPermission:status"),
        "systemPermission.request" => Some("systemPermission:request"),
        "window.setTitle" => Some("window:setTitle"),
        "window.setSize" => Some("window:setSize"),
        "window.minimize" => Some("window:minimize"),
        "window.toggleMaximize" => Some("window:toggleMaximize"),
        "window.show" => Some("window:show"),
        "window.hide" => Some("window:hide"),
        "window.focus" => Some("window:focus"),
        "window.close" => Some("window:close"),
        "window.setAlwaysOnTop" => Some("window:setAlwaysOnTop"),
        "window.isVisible" => Some("window:isVisible"),
        "window.isFocused" => Some("window:isFocused"),
        "window.isMaximized" => Some("window:isMaximized"),
        "window.isMinimized" => Some("window:isMinimized"),
        "window.getLabel" => Some("window:getLabel"),
        "window.open" => Some("window:open"),
        "window.list" => Some("window:list"),
        "window.showOther" | "window.hideOther" | "window.focusOther" | "window.closeOther" => {
            Some("window:manage")
        }
        "window.startDragging"
        | "window.setFullscreen"
        | "window.isFullscreen"
        | "window.setMaxSize"
        | "window.getMonitors" => Some("window:manage"),
        "globalShortcut.register" => Some("globalShortcut:register"),
        "globalShortcut.unregister" | "globalShortcut.unregisterAll" => {
            Some("globalShortcut:unregister")
        }
        "tray.create" => Some("tray:create"),
        "tray.remove" => Some("tray:remove"),
        "tray.setTooltip" => Some("tray:setTooltip"),
        "tray.setIcon" => Some("tray:setIcon"),
        "tray.setMenu" => Some("tray:setMenu"),
        "webview.getCookies" => Some("webview:readCookies"),
        "webview.setCookie" | "webview.deleteCookie" => Some("webview:writeCookies"),
        "webview.setZoom" => Some("webview:zoom"),
        "webview.print" => Some("webview:print"),
        _ => None,
    }
}

fn native_method_is_allowed(method: &str, capabilities: &[String]) -> bool {
    permission_for_native_method(method)
        .is_some_and(|permission| capabilities.iter().any(|entry| entry == permission))
}

impl Webview {
    pub(crate) fn new(
        window: SharedWindow,
        opts: WebviewOptions,
        app_menu: AppMenuContext,
        label: String,
        windows: SharedWindowRegistry,
        web_context: SharedWebContext,
        wake: Box<dyn Fn() + 'static>,
    ) -> Result<Self> {
        Self::new_internal(
            window,
            opts,
            app_menu,
            label,
            windows,
            web_context,
            wake,
            true,
        )
    }

    pub(crate) fn new_unregistered(
        window: SharedWindow,
        opts: WebviewOptions,
        app_menu: AppMenuContext,
        label: String,
        windows: SharedWindowRegistry,
        web_context: SharedWebContext,
        wake: Box<dyn Fn() + 'static>,
    ) -> Result<Self> {
        Self::new_internal(
            window,
            opts,
            app_menu,
            label,
            windows,
            web_context,
            wake,
            false,
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn new_internal(
        window: SharedWindow,
        opts: WebviewOptions,
        app_menu: AppMenuContext,
        label: String,
        windows: SharedWindowRegistry,
        web_context: SharedWebContext,
        wake: Box<dyn Fn() + 'static>,
        attach_to_registry: bool,
    ) -> Result<Self> {
        let network = validate_webview_network(&opts)
            .map_err(|error| Error::new(Status::InvalidArg, error))?;
        let wake: Rc<dyn Fn()> = Rc::from(wake);
        let trusted_origin = opts
            .url
            .as_deref()
            .and_then(|value| url::Url::parse(value).ok())
            .or_else(|| {
                opts.serve_dir
                    .as_ref()
                    .and_then(|_| url::Url::parse("murasaki://localhost/").ok())
            });
        let on_ipc: Rc<RefCell<Option<Arc<ThreadsafeFunction<String>>>>> =
            Rc::new(RefCell::new(None));
        // Created empty and filled in *after* `builder.build()` below, but a
        // clone is handed to the IPC handler closure up front — the closure only
        // ever fires on messages posted from page JS, which can't happen before
        // the page has loaded, which can't happen before `build()` returns and
        // the slot is filled. So the handler never observes an empty slot.
        let webview_slot: Rc<RefCell<Option<WebView>>> = Rc::new(RefCell::new(None));
        let tray_slot = windows.borrow().tray();

        // Resolved up front (rather than down by the IPC handler, as before)
        // so the download/drag-drop/zoom-hotkey builder options below — which,
        // unlike `nativeCall` dispatch, must be decided before
        // `WebViewBuilder::build()` — can gate on the same capability list and
        // policy the IPC handler uses later.
        let capability_policy = CapabilityPolicy::parse(opts.capability_policy.as_deref())
            .map_err(|error| {
                Error::new(
                    Status::InvalidArg,
                    format!("rejected malformed native capability policy: {error}"),
                )
            })?;
        let mut capabilities = opts.capabilities.clone().unwrap_or_default();
        capabilities.retain(|permission| capability_policy.grants_permission(permission));

        let mut web_context_borrow = web_context.borrow_mut();
        let process_context = web_context_borrow
            .context_for(opts.app_id.as_deref(), network.incognito)
            .map_err(|error| Error::new(Status::InvalidArg, error))?;
        let mut builder = WebViewBuilder::new_with_web_context(process_context)
            .with_devtools(opts.devtools.unwrap_or(cfg!(debug_assertions)))
            .with_transparent(opts.transparent.unwrap_or(false))
            .with_incognito(network.incognito)
            .with_new_window_req_handler(|_url, _features| NewWindowResponse::Deny)
            // Windows-only effect (WebView2); no-op elsewhere — see
            // `WebviewOptions::hotkeys_zoom`'s doc comment. Config-owned, not
            // capability-gated, so it's applied unconditionally.
            .with_hotkeys_zoom(opts.hotkeys_zoom.unwrap_or(false));
        if let Some(user_agent) = network.user_agent {
            builder = builder.with_user_agent(user_agent);
        }
        if let Some(proxy) = network.proxy {
            builder = builder.with_proxy_config(wry_proxy(proxy));
        }

        // `webview:download` — `webview_slot` is still empty here, same as
        // `ipc_webview_slot` below: neither handler can fire before the page
        // has loaded, which can't happen before `build()` fills the slot.
        if has_capability(&capabilities, "webview:download") {
            let downloads_dir = opts
                .downloads
                .as_ref()
                .and_then(|downloads| downloads.directory.as_deref())
                .map(PathBuf::from)
                .or_else(download::default_downloads_dir);
            if let Some(downloads_dir) = downloads_dir {
                let started_webview_slot = webview_slot.clone();
                builder = builder.with_download_started_handler(move |url, destination| {
                    handle_download_started(&downloads_dir, &started_webview_slot, url, destination)
                });
                let completed_webview_slot = webview_slot.clone();
                builder = builder.with_download_completed_handler(move |url, path, success| {
                    handle_download_completed(&completed_webview_slot, url, path, success);
                });
            } else {
                // Granted, but no configured directory and no resolvable OS
                // default (for example `$HOME`/`%USERPROFILE%` unset) — deny
                // rather than saving somewhere unconfined.
                builder = builder.with_download_started_handler(|_url, _destination| false);
            }
        } else {
            builder = builder.with_download_started_handler(|_url, _destination| false);
        }

        // `webview:dragDrop` — always returns `false` (never blocks the OS
        // default; see the module doc comment above `Webview::new`), so file
        // inputs keep working whether or not this capability is granted. Not
        // installed at all when denied, rather than installed-and-denying.
        if has_capability(&capabilities, "webview:dragDrop") {
            let drag_webview_slot = webview_slot.clone();
            let last_dragover: Rc<Cell<Option<Instant>>> = Rc::new(Cell::new(None));
            builder = builder.with_drag_drop_handler(move |event| {
                handle_drag_drop_event(&drag_webview_slot, &last_dragover, event);
                false
            });
        }

        // `webview.initScripts` — config-owned and trusted, not
        // capability-gated (like `userAgent`/`incognito`/`proxy` above).
        // Applied in declaration order; empty entries are already filtered
        // out at config load, but `with_initialization_script_for_main_only`
        // also no-ops on an empty string regardless.
        for script in opts.init_scripts.iter().flatten() {
            builder = builder.with_initialization_script_for_main_only(script.clone(), true);
        }

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
        let ipc_trusted_origin = trusted_origin.clone();
        let ipc_capability_policy = capability_policy.clone();
        let ipc_capabilities = capabilities.clone();
        let ipc_app_id = opts.app_id.clone();
        let ipc_label = label.clone();
        let ipc_windows = windows.clone();
        let ipc_tray_slot = tray_slot.clone();
        let ipc_tray_icon = opts.tray_icon.clone();
        let ipc_wake = wake.clone();
        builder = builder.with_ipc_handler(move |request| {
            if !ipc_origin_is_trusted(&request.uri().to_string(), ipc_trusted_origin.as_ref()) {
                return;
            }
            if !ipc_body_is_allowed(request.body().len()) {
                eprintln!("murasaki: rejected oversized renderer IPC payload");
                return;
            }
            let body = request.body().clone();
            let body_len = body.len();

            let kind = serde_json::from_str::<IpcEnvelope>(&body)
                .ok()
                .and_then(|e| e.kind);

            if kind.as_deref() == Some("contextMenu") {
                // contextMenu/appMenu don't carry a per-method cap of their
                // own (see `max_native_call_body_bytes`); re-enforce the
                // original blanket ceiling here now that the pre-parse gate
                // above has been raised for `nativeCall`'s sake.
                if body_len > DEFAULT_MAX_METHOD_BODY_BYTES {
                    eprintln!("murasaki: rejected oversized contextMenu payload");
                    return;
                }
                if !context_menu_is_allowed(&ipc_capabilities) {
                    return;
                }
                if let Ok(payload) = serde_json::from_str::<ContextMenuPayload>(&body) {
                    if validate_context_menu_payload(&payload, &ipc_capabilities).is_err() {
                        return;
                    }
                    let outcome = show_native_context_menu(
                        &ipc_window_slot,
                        &ipc_webview_slot,
                        &payload.items,
                        payload.x,
                        payload.y,
                    );
                    apply_menu_outcome(&ipc_label, &ipc_windows, ipc_wake.as_ref(), outcome);
                }
                return;
            }

            if kind.as_deref() == Some("appMenu") {
                if body_len > DEFAULT_MAX_METHOD_BODY_BYTES {
                    eprintln!("murasaki: rejected oversized appMenu payload");
                    return;
                }
                if !app_menu_is_allowed(&ipc_label, &ipc_capabilities) {
                    return;
                }
                if let Ok(payload) = serde_json::from_str::<AppMenuPayload>(&body) {
                    if validate_app_menu_payload(&payload, &ipc_capabilities).is_err() {
                        return;
                    }
                    handle_app_menu_message(&ipc_window_slot, &ipc_app_menu, &payload.menus);
                }
                return;
            }

            if kind.as_deref() == Some("nativeCall") {
                if let Ok(payload) = serde_json::from_str::<NativeCallPayload>(&body) {
                    if !native_call_body_is_allowed(&payload.method, body_len) {
                        eprintln!(
                            "murasaki: rejected oversized nativeCall payload for {}",
                            payload.method
                        );
                        return;
                    }
                    handle_native_call(
                        NativeCallContext {
                            window_slot: &ipc_window_slot,
                            webview_slot: &ipc_webview_slot,
                            tray_slot: &ipc_tray_slot,
                            default_tray_icon: ipc_tray_icon.as_deref(),
                            capabilities: &ipc_capabilities,
                            capability_policy: &ipc_capability_policy,
                            app_id: ipc_app_id.as_deref(),
                            current_label: &ipc_label,
                            windows: &ipc_windows,
                            wake: ipc_wake.as_ref(),
                        },
                        payload,
                    );
                }
                return;
            }

            // Plain Node-forwarded messages (`onIpcMessage`) never had a
            // per-kind cap beyond the original blanket ceiling either.
            if body_len > DEFAULT_MAX_METHOD_BODY_BYTES {
                eprintln!("murasaki: rejected oversized forwarded IPC payload");
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
        builder = builder.with_navigation_handler(move |url| {
            match navigation_policy(&url, trusted_origin.as_ref()) {
                NavigationPolicy::Allow => true,
                NavigationPolicy::OpenExternal => {
                    let _ = open::that_detached(&url);
                    false
                }
                NavigationPolicy::Deny => false,
            }
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
        drop(web_context_borrow);
        if attach_to_registry {
            if let Err(error) = windows
                .borrow_mut()
                .attach_webview(&label, webview_slot.clone())
            {
                // The IPC handler closes over this same slot. Break that cycle
                // before returning the construction error or the native
                // WebView would remain alive without a registry owner.
                let raw = webview_slot.borrow_mut().take();
                drop(raw);
                return Err(Error::new(Status::InvalidArg, error));
            }
        }

        Ok(Self {
            webview: webview_slot,
            label,
            windows,
            tray: tray_slot,
            _web_context: web_context,
            wake,
            on_ipc,
            _window: window,
        })
    }

    pub(crate) fn shared_slot(&self) -> SharedWebview {
        self.webview.clone()
    }

    /// Break the WebView↔IPC-handler ownership cycle before a registry commit
    /// fails. Callers then drop the tao Window only after this returns.
    pub(crate) fn drop_unregistered(self) {
        let raw = self.webview.borrow_mut().take();
        drop(raw);
    }
}

fn native_error(error: impl std::fmt::Display) -> serde_json::Value {
    serde_json::json!({ "ok": false, "error": { "message": error.to_string() } })
}

fn dispatch_native_response(
    webview_slot: &Rc<RefCell<Option<WebView>>>,
    request_id: &str,
    response: serde_json::Value,
) {
    let detail = serde_json::json!({ "requestId": request_id, "response": response });
    let Ok(detail_json) = serde_json::to_string(&detail) else {
        return;
    };
    let script = format!(
        "window.dispatchEvent(new CustomEvent('murasaki:nativeresponse',{{detail:{detail_json}}}))"
    );
    if let Some(webview) = webview_slot.borrow().as_ref() {
        let _ = webview.evaluate_script(&script);
    }
}

fn apply_menu_outcome(
    current_label: &str,
    windows: &SharedWindowRegistry,
    wake: &dyn Fn(),
    outcome: MenuPollOutcome,
) {
    if outcome.quit {
        QUIT_REQUESTED.store(true, std::sync::atomic::Ordering::SeqCst);
        wake();
    }
    if outcome.close {
        if windows.borrow().is_primary(current_label) {
            if windows.borrow_mut().request_close(current_label).is_ok() {
                wake();
            }
        } else {
            let window = windows.borrow().live_window(current_label);
            if let Ok(window) = window {
                crate::window::set_window_visible(&window, false);
                windows
                    .borrow_mut()
                    .record_lifecycle("hidden", current_label);
            }
        }
    }
}

/// Dispatches `name` as a `CustomEvent` with the given JSON `detail` into the
/// webview. Shared plumbing for every native -> renderer event fired from
/// this file outside the request-correlated `nativeCall` response above
/// (downloads, drag-drop, and — pre-existing — global shortcuts, tray, menu
/// clicks).
fn dispatch_custom_event(
    webview_slot: &Rc<RefCell<Option<WebView>>>,
    name: &str,
    detail: serde_json::Value,
) {
    let Ok(detail_json) = serde_json::to_string(&detail) else {
        return;
    };
    let script =
        format!("window.dispatchEvent(new CustomEvent('{name}',{{detail:{detail_json}}}))");
    if let Some(webview) = webview_slot.borrow().as_ref() {
        let _ = webview.evaluate_script(&script);
    }
}

/// `webview:download`'s URL bound: a `data:` download URL can be megabytes
/// long, and dispatching it whole as a `CustomEvent` detail would spam the
/// page with a huge JSON payload for no benefit (the id/path already identify
/// the download). Only `data:` URLs are bounded — ordinary http(s) download
/// URLs stay far under this regardless. The download itself always proceeds;
/// this only gates whether an event is dispatched about it.
const MAX_EVENTABLE_DATA_URL_BYTES: usize = 4 * 1024;

fn download_event_url_is_eventable(url: &str) -> bool {
    !(url.starts_with("data:") && url.len() > MAX_EVENTABLE_DATA_URL_BYTES)
}

/// `with_download_started_handler` callback installed when `webview:download`
/// is granted (see `Webview::new_internal`). Sanitizes wry's suggested
/// filename down to a safe basename, confines it inside `downloads_dir`,
/// mutates `destination` in place, and reports `murasaki:downloadstarted`.
fn handle_download_started(
    downloads_dir: &Path,
    webview_slot: &Rc<RefCell<Option<WebView>>>,
    url: String,
    destination: &mut PathBuf,
) -> bool {
    let suggested = destination
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("");
    let filename = download::sanitize_filename(suggested);
    let confined = match download::confine_download_path(downloads_dir, &filename) {
        Ok(path) => path,
        Err(error) => {
            eprintln!("murasaki: rejected download destination: {error}");
            return false;
        }
    };
    if download_event_url_is_eventable(&url) {
        let id = download::generate_download_id().unwrap_or_default();
        dispatch_custom_event(
            webview_slot,
            "murasaki:downloadstarted",
            serde_json::json!({ "id": id, "url": url, "path": confined.display().to_string() }),
        );
    }
    *destination = confined;
    true
}

/// `with_download_completed_handler` callback installed alongside the started
/// handler above. Fires whether the download succeeded or not. `path` is
/// always `None` on macOS — an upstream wry/WebKit API limitation, not a bug
/// here (see `with_download_completed_handler`'s doc comment) — and there is
/// no reliable id to correlate this event with the `murasaki:downloadstarted`
/// event it followed (see `capabilities.json`'s `webview-session-network`
/// limitations); concurrent same-URL downloads may be ambiguous to the page.
fn handle_download_completed(
    webview_slot: &Rc<RefCell<Option<WebView>>>,
    url: String,
    path: Option<PathBuf>,
    success: bool,
) {
    if !download_event_url_is_eventable(&url) {
        return;
    }
    dispatch_custom_event(
        webview_slot,
        "murasaki:downloadcompleted",
        serde_json::json!({
            "url": url,
            "path": path.map(|path| path.display().to_string()),
            "success": success,
        }),
    );
}

/// Minimum interval between dispatched `murasaki:dragover` events — caps the
/// rate at 20/sec. Without this, `DragDropEvent::Over` fires on every OS
/// drag-move tick, which is far more often than a page needs to reposition a
/// drop-target highlight.
const MIN_DRAGOVER_INTERVAL: Duration = Duration::from_millis(50);

fn drag_drop_paths_to_json(paths: &[PathBuf]) -> Vec<String> {
    paths
        .iter()
        .map(|path| path.display().to_string())
        .collect()
}

/// Whether a `murasaki:dragover` event should be dispatched now, given the
/// previous dispatch time (`None` — never dispatched yet — always allows).
/// Factored out of `handle_drag_drop_event` so the throttle boundary is
/// unit-testable without a real `Instant::now()` clock.
fn should_dispatch_dragover(last_dispatched: Option<Instant>, now: Instant) -> bool {
    last_dispatched.is_none_or(|previous| now.duration_since(previous) >= MIN_DRAGOVER_INTERVAL)
}

/// Pure `DragDropEvent` -> (`CustomEvent` name, JSON detail) mapping, factored
/// out of `handle_drag_drop_event` so the wry event -> murasaki event contract
/// is unit-testable without constructing a real `WebView`. An empty name
/// means "no event" (the `#[non_exhaustive]` catch-all below).
fn drag_drop_event_payload(event: &DragDropEvent) -> (&'static str, serde_json::Value) {
    match event {
        DragDropEvent::Enter { paths, position } => (
            "murasaki:dragenter",
            serde_json::json!({
                "paths": drag_drop_paths_to_json(paths),
                "x": position.0,
                "y": position.1,
            }),
        ),
        DragDropEvent::Over { position } => (
            "murasaki:dragover",
            serde_json::json!({ "x": position.0, "y": position.1 }),
        ),
        DragDropEvent::Drop { paths, position } => (
            "murasaki:dragdrop",
            serde_json::json!({
                "paths": drag_drop_paths_to_json(paths),
                "x": position.0,
                "y": position.1,
            }),
        ),
        DragDropEvent::Leave => ("murasaki:dragleave", serde_json::json!({})),
        // `DragDropEvent` is `#[non_exhaustive]` — treat any future variant as
        // a silent no-op rather than failing to compile on a wry upgrade.
        _ => ("", serde_json::Value::Null),
    }
}

/// `with_drag_drop_handler` callback installed when `webview:dragDrop` is
/// granted (see `Webview::new_internal`). The caller always returns `false`
/// regardless of what happens here — this handler only ever observes.
fn handle_drag_drop_event(
    webview_slot: &Rc<RefCell<Option<WebView>>>,
    last_dragover: &Rc<Cell<Option<Instant>>>,
    event: DragDropEvent,
) {
    if matches!(event, DragDropEvent::Over { .. }) {
        let now = Instant::now();
        if !should_dispatch_dragover(last_dragover.get(), now) {
            return;
        }
        last_dragover.set(Some(now));
    }
    let (name, detail) = drag_drop_event_payload(&event);
    if name.is_empty() {
        return;
    }
    dispatch_custom_event(webview_slot, name, detail);
}

/// The murasaki runtime session auth cookie — see
/// `packages/murasaki/src/vite-plugin/runtime-security.ts`'s `RUNTIME_COOKIE`
/// and `assets/prod-server.mjs`'s identically-named constant. Invisible and
/// immutable through `webview.getCookies`/`setCookie`/`deleteCookie` (see the
/// cookie handlers in `handle_native_call` below), so a compromised renderer
/// holding `webview:readCookies`/`webview:writeCookies` can never read or
/// forge the app's own privileged session.
const PROTECTED_SESSION_COOKIE_NAME: &str = "murasaki_runtime";

const MAX_COOKIES_RESULT: usize = 1000;
const MAX_COOKIE_VALUE_BYTES: usize = 4 * 1024;
const MAX_COOKIE_NAME_BYTES: usize = 256;

fn is_protected_cookie_name(name: &str) -> bool {
    name.eq_ignore_ascii_case(PROTECTED_SESSION_COOKIE_NAME)
}

/// RFC 6265's `cookie-name` is an RFC 2616 `token`: visible US-ASCII
/// characters excluding separators and space. Enforcing that here (rather
/// than trusting whatever the underlying platform cookie store accepts) keeps
/// a malformed name from smuggling separator/control characters into the
/// native CookieManager API.
fn is_valid_cookie_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= MAX_COOKIE_NAME_BYTES
        && name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"!#$%&'*+-.^_`|~".contains(&byte))
}

/// A conservative `cookie-value` charset: printable ASCII excluding the `;`
/// wire separator (RFC 6265's DQUOTE-wrapped/backslash forms are rejected
/// rather than accepted-but-mishandled).
fn is_valid_cookie_value(value: &str) -> bool {
    value.len() <= MAX_COOKIE_VALUE_BYTES
        && value
            .bytes()
            .all(|byte| (0x21..0x7f).contains(&byte) && byte != b';')
}

fn parse_cookie_url(url: &str) -> std::result::Result<url::Url, String> {
    let parsed = url::Url::parse(url).map_err(|_| "url must be an absolute URL".to_string())?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("url must be an http or https URL".to_string());
    }
    Ok(parsed)
}

fn truncate_utf8(value: &str, max_bytes: usize) -> String {
    if value.len() <= max_bytes {
        return value.to_string();
    }
    let mut end = max_bytes;
    while end > 0 && !value.is_char_boundary(end) {
        end -= 1;
    }
    value[..end].to_string()
}

/// Projects a wry/platform cookie into the wire shape returned by
/// `webview.getCookies` — see `packages/murasaki/src/native/index.ts`'s
/// `WebviewCookie`. The caller (`handle_native_call`) has already filtered out
/// `PROTECTED_SESSION_COOKIE_NAME` before this runs.
fn cookie_to_json(entry: &cookie::Cookie<'static>) -> serde_json::Value {
    let expires_at = match entry.expires() {
        Some(cookie::Expiration::DateTime(at)) => Some(at.unix_timestamp().saturating_mul(1000)),
        _ => None,
    };
    serde_json::json!({
        "name": entry.name(),
        "value": truncate_utf8(entry.value(), MAX_COOKIE_VALUE_BYTES),
        "domain": entry.domain(),
        "path": entry.path(),
        "secure": entry.secure().unwrap_or(false),
        "httpOnly": entry.http_only().unwrap_or(false),
        "expiresAt": expires_at,
    })
}

/// Builds an owned (`'static`) cookie for `webview.setCookie`/`deleteCookie`.
/// The caller has already rejected `PROTECTED_SESSION_COOKIE_NAME` and
/// validated `name`/`value` before this runs.
#[allow(clippy::too_many_arguments)]
fn build_writable_cookie(
    name: String,
    value: String,
    domain: String,
    path: String,
    secure: bool,
    http_only: bool,
    expires_at: Option<i64>,
) -> std::result::Result<cookie::Cookie<'static>, String> {
    let mut builder = cookie::Cookie::build((name, value))
        .domain(domain)
        .path(path)
        .secure(secure)
        .http_only(http_only);
    if let Some(expires_at) = expires_at {
        let seconds = expires_at.div_euclid(1000);
        let datetime = cookie::time::OffsetDateTime::from_unix_timestamp(seconds)
            .map_err(|_| "expiresAt is out of range".to_string())?;
        builder = builder.expires(datetime);
    }
    Ok(builder.build())
}

/// `webview.setZoom`'s bound. `RangeInclusive::contains` already rejects NaN
/// (every comparison with NaN is false) and infinities (outside the range),
/// so no separate finiteness check is needed.
fn is_valid_zoom_factor(factor: f64) -> bool {
    (0.25..=5.0).contains(&factor)
}

/// `window.setMaxSize`'s `{ width?, height? }` resolves to either "clamp to
/// this bound" or "clear the bound" (`None`) — never a partial pair. One axis
/// set and the other omitted/null has no coherent meaning (tao's constraint is
/// inherently two-dimensional), so it's rejected outright rather than
/// guessing a default for the unset axis.
fn resolve_max_size_bound(
    width: Option<f64>,
    height: Option<f64>,
) -> std::result::Result<Option<(f64, f64)>, String> {
    match (width, height) {
        (None, None) => Ok(None),
        (Some(width), Some(height)) => {
            if !width.is_finite() || !height.is_finite() || width < 1.0 || height < 1.0 {
                return Err("width and height must be positive finite numbers".to_string());
            }
            Ok(Some((width, height)))
        }
        _ => Err("setMaxSize requires both width and height, or neither".to_string()),
    }
}

/// Execute the stable renderer-facing native API synchronously on the UI
/// thread, then resolve the caller's Promise inside the webview. Keeping this
/// in Rust makes dev and packaged apps use the same implementation; it also
/// avoids Node/libuv being blocked by the native event loop in development.
fn handle_native_call(context: NativeCallContext<'_>, payload: NativeCallPayload) {
    let NativeCallContext {
        window_slot,
        webview_slot,
        tray_slot,
        default_tray_icon,
        capabilities,
        capability_policy,
        app_id,
        current_label,
        windows,
        wake,
    } = context;
    #[derive(serde::Deserialize)]
    struct TextArg {
        text: String,
    }
    #[derive(serde::Deserialize)]
    struct TargetArg {
        target: String,
    }
    #[derive(serde::Deserialize)]
    #[serde(deny_unknown_fields)]
    struct PathArg {
        path: String,
    }
    #[derive(serde::Deserialize)]
    struct TitleArg {
        title: String,
    }
    #[derive(serde::Deserialize)]
    struct SizeArg {
        width: f64,
        height: f64,
    }
    #[derive(serde::Deserialize)]
    struct EnabledArg {
        enabled: bool,
    }
    #[derive(serde::Deserialize)]
    struct LabelArg {
        label: String,
    }
    #[derive(serde::Deserialize)]
    struct PermissionArg {
        permission: String,
    }
    #[derive(serde::Deserialize)]
    #[serde(deny_unknown_fields)]
    struct SecureStorageKeyArg {
        key: String,
    }
    #[derive(serde::Deserialize)]
    #[serde(deny_unknown_fields)]
    struct SecureStorageSetArg {
        key: String,
        value: String,
    }
    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct TrayCreateArg {
        #[serde(default)]
        tooltip: Option<String>,
        #[serde(default)]
        icon: Option<String>,
        #[serde(default)]
        template: bool,
        #[serde(default)]
        menu: Option<Vec<MenuItemOptions>>,
        #[serde(default)]
        menu_on_left_click: Option<bool>,
        #[serde(default)]
        menu_on_right_click: Option<bool>,
    }
    #[derive(serde::Deserialize)]
    struct IconArg {
        icon: String,
    }
    #[derive(serde::Deserialize)]
    struct TrayMenuArg {
        items: Vec<MenuItemOptions>,
    }
    #[derive(serde::Deserialize)]
    #[serde(deny_unknown_fields)]
    struct GlobalShortcutRegisterArg {
        accelerator: String,
        #[serde(default)]
        id: Option<String>,
    }
    #[derive(serde::Deserialize)]
    #[serde(deny_unknown_fields)]
    struct GlobalShortcutIdArg {
        id: String,
    }
    #[derive(serde::Deserialize)]
    #[serde(deny_unknown_fields)]
    struct SetFullscreenArg {
        fullscreen: bool,
    }
    #[derive(serde::Deserialize)]
    #[serde(deny_unknown_fields)]
    struct SetMaxSizeArg {
        #[serde(default)]
        width: Option<f64>,
        #[serde(default)]
        height: Option<f64>,
    }
    #[derive(serde::Deserialize)]
    #[serde(deny_unknown_fields)]
    struct WebviewGetCookiesArg {
        #[serde(default)]
        url: Option<String>,
    }
    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct WebviewSetCookieArg {
        url: String,
        name: String,
        value: String,
        #[serde(default)]
        domain: Option<String>,
        #[serde(default)]
        path: Option<String>,
        #[serde(default)]
        secure: Option<bool>,
        #[serde(default)]
        http_only: Option<bool>,
        #[serde(default)]
        expires_at: Option<i64>,
    }
    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct WebviewDeleteCookieArg {
        url: String,
        name: String,
    }
    #[derive(serde::Deserialize)]
    #[serde(deny_unknown_fields)]
    struct WebviewSetZoomArg {
        factor: f64,
    }

    if !native_method_is_allowed(&payload.method, capabilities) {
        dispatch_native_response(
            webview_slot,
            &payload.request_id,
            native_error(format!(
                "native capability is not granted for {}",
                payload.method
            )),
        );
        return;
    }

    let method = payload.method.clone();
    let result: std::result::Result<serde_json::Value, String> = (|| match method.as_str() {
        "app.quit" => {
            QUIT_REQUESTED.store(true, std::sync::atomic::Ordering::SeqCst);
            wake();
            Ok(serde_json::Value::Null)
        }
        "dialog.openFile" => {
            let opts = serde_json::from_value(payload.args).map_err(|e| e.to_string())?;
            crate::dialog::open_file_dialog(Some(opts))
                .map(serde_json::Value::from)
                .map_err(|e| e.to_string())
        }
        "dialog.openDirectory" => {
            let opts = serde_json::from_value(payload.args).map_err(|e| e.to_string())?;
            crate::dialog::open_directory_dialog(Some(opts))
                .map(|value| serde_json::to_value(value).unwrap_or(serde_json::Value::Null))
                .map_err(|e| e.to_string())
        }
        "dialog.saveFile" => {
            let opts = serde_json::from_value(payload.args).map_err(|e| e.to_string())?;
            crate::dialog::save_file_dialog(Some(opts))
                .map(|value| serde_json::to_value(value).unwrap_or(serde_json::Value::Null))
                .map_err(|e| e.to_string())
        }
        "dialog.showMessage" => {
            let opts = serde_json::from_value(payload.args).map_err(|e| e.to_string())?;
            crate::dialog::show_message_dialog(opts)
                .map(serde_json::Value::from)
                .map_err(|e| e.to_string())
        }
        "clipboard.readText" => crate::clipboard::clipboard_read()
            .map(serde_json::Value::from)
            .map_err(|e| e.to_string()),
        "clipboard.writeText" => {
            let args: TextArg = serde_json::from_value(payload.args).map_err(|e| e.to_string())?;
            crate::clipboard::clipboard_write(args.text)
                .map(|_| serde_json::Value::Null)
                .map_err(|e| e.to_string())
        }
        "clipboard.readImage" => crate::clipboard::clipboard_read_image()
            .map(|image| serde_json::to_value(image).unwrap_or(serde_json::Value::Null))
            .map_err(|e| e.to_string()),
        "clipboard.writeImage" => {
            let opts = serde_json::from_value(payload.args).map_err(|e| e.to_string())?;
            crate::clipboard::clipboard_write_image(opts)
                .map(|_| serde_json::Value::Null)
                .map_err(|e| e.to_string())
        }
        "clipboard.writeHtml" => {
            let opts = serde_json::from_value(payload.args).map_err(|e| e.to_string())?;
            crate::clipboard::clipboard_write_html(opts)
                .map(|_| serde_json::Value::Null)
                .map_err(|e| e.to_string())
        }
        "notification.show" => {
            let args = serde_json::from_value(payload.args).map_err(|e| e.to_string())?;
            crate::notification::show_notification(args)
                .map(serde_json::Value::from)
                .map_err(|e| e.to_string())
        }
        "shell.openExternal" => {
            let args: TargetArg =
                serde_json::from_value(payload.args).map_err(|e| e.to_string())?;
            let parsed = url::Url::parse(&args.target)
                .map_err(|_| "target must be an absolute URL".to_string())?;
            if !matches!(parsed.scheme(), "http" | "https" | "mailto" | "tel")
                || !parsed.username().is_empty()
                || parsed.password().is_some()
            {
                return Err(
                    "only credential-free http, https, mailto, and tel URLs may be opened"
                        .to_string(),
                );
            }
            if !capability_policy.allows("shell:openExternal", CapabilityResource::Url(&parsed)) {
                return Err("shell.openExternal target is outside its capability scope".to_string());
            }
            crate::shell::shell_open_external(args.target)
                .map(|_| serde_json::Value::Null)
                .map_err(|e| e.to_string())
        }
        "shell.showItemInFolder" => {
            let args: TargetArg =
                serde_json::from_value(payload.args).map_err(|e| e.to_string())?;
            if !capability_policy.allows(
                "shell:showItemInFolder",
                CapabilityResource::Path(&args.target),
            ) {
                return Err(
                    "shell.showItemInFolder requires an allowed absolute non-traversing path"
                        .to_string(),
                );
            }
            crate::shell::shell_show_item_in_folder(args.target)
                .map(|_| serde_json::Value::Null)
                .map_err(|e| e.to_string())
        }
        "shell.trashItem" => {
            let args: PathArg = serde_json::from_value(payload.args).map_err(|e| e.to_string())?;
            if !capability_policy.allows("shell:trashItem", CapabilityResource::Path(&args.path)) {
                return Err(
                    "shell.trashItem requires an allowed absolute non-traversing path".to_string(),
                );
            }
            crate::shell::shell_trash_item(&args.path).map(|_| serde_json::Value::Null)
        }
        "shell.openPath" => {
            let args: PathArg = serde_json::from_value(payload.args).map_err(|e| e.to_string())?;
            if !capability_policy.allows("shell:openPath", CapabilityResource::Path(&args.path)) {
                return Err(
                    "shell.openPath requires an allowed absolute non-traversing path".to_string(),
                );
            }
            crate::shell::shell_open_path(&args.path).map(|_| serde_json::Value::Null)
        }
        "secureStorage.get" => {
            let args: SecureStorageKeyArg =
                serde_json::from_value(payload.args).map_err(|e| e.to_string())?;
            let app_id = app_id.ok_or_else(|| {
                "secure storage requires a non-empty config.appId namespace".to_string()
            })?;
            crate::secure_storage::get(app_id, &args.key)
                .map(|value| value.map_or(serde_json::Value::Null, serde_json::Value::String))
        }
        "secureStorage.set" => {
            let args: SecureStorageSetArg =
                serde_json::from_value(payload.args).map_err(|e| e.to_string())?;
            let app_id = app_id.ok_or_else(|| {
                "secure storage requires a non-empty config.appId namespace".to_string()
            })?;
            crate::secure_storage::set(app_id, &args.key, &args.value)
                .map(|_| serde_json::Value::Null)
        }
        "secureStorage.delete" => {
            let args: SecureStorageKeyArg =
                serde_json::from_value(payload.args).map_err(|e| e.to_string())?;
            let app_id = app_id.ok_or_else(|| {
                "secure storage requires a non-empty config.appId namespace".to_string()
            })?;
            crate::secure_storage::delete(app_id, &args.key).map(|_| serde_json::Value::Null)
        }
        "systemPermission.status" => {
            let args: PermissionArg =
                serde_json::from_value(payload.args).map_err(|e| e.to_string())?;
            if !capability_policy.allows(
                "systemPermission:status",
                CapabilityResource::Permission(&args.permission),
            ) {
                return Err(
                    "systemPermission.status name is outside its capability scope".to_string(),
                );
            }
            crate::system_permission::status(&args.permission).map(serde_json::Value::from)
        }
        "systemPermission.request" => {
            let args: PermissionArg =
                serde_json::from_value(payload.args).map_err(|e| e.to_string())?;
            if !capability_policy.allows(
                "systemPermission:request",
                CapabilityResource::Permission(&args.permission),
            ) {
                return Err(
                    "systemPermission.request name is outside its capability scope".to_string(),
                );
            }
            crate::system_permission::request(&args.permission).map(serde_json::Value::from)
        }
        "window.setTitle" => {
            let args: TitleArg = serde_json::from_value(payload.args).map_err(|e| e.to_string())?;
            if let Some(window) = window_slot.borrow().as_ref() {
                window.set_title(&args.title);
            }
            Ok(serde_json::Value::Null)
        }
        "window.setSize" => {
            let args: SizeArg = serde_json::from_value(payload.args).map_err(|e| e.to_string())?;
            if !args.width.is_finite()
                || !args.height.is_finite()
                || args.width < 1.0
                || args.height < 1.0
            {
                return Err("width and height must be positive finite numbers".to_string());
            }
            if let Some(window) = window_slot.borrow().as_ref() {
                window.set_inner_size(tao::dpi::LogicalSize::new(args.width, args.height));
            }
            Ok(serde_json::Value::Null)
        }
        "window.minimize" => {
            if let Some(window) = window_slot.borrow().as_ref() {
                window.set_minimized(true);
            }
            Ok(serde_json::Value::Null)
        }
        "window.toggleMaximize" => {
            if let Some(window) = window_slot.borrow().as_ref() {
                window.set_maximized(!window.is_maximized());
            }
            Ok(serde_json::Value::Null)
        }
        "window.show" => {
            if let Some(window) = window_slot.borrow().as_ref() {
                window.set_visible(true);
            }
            windows
                .borrow_mut()
                .record_lifecycle("shown", current_label);
            Ok(serde_json::Value::Null)
        }
        "window.hide" => {
            if let Some(window) = window_slot.borrow().as_ref() {
                window.set_visible(false);
            }
            windows
                .borrow_mut()
                .record_lifecycle("hidden", current_label);
            Ok(serde_json::Value::Null)
        }
        "window.focus" => {
            if let Some(window) = window_slot.borrow().as_ref() {
                window.set_focus();
            }
            Ok(serde_json::Value::Null)
        }
        "window.close" => {
            let primary = windows.borrow().is_primary(current_label);
            if primary {
                windows.borrow_mut().request_close(current_label)?;
                wake();
            } else {
                let target = windows.borrow().live_window(current_label)?;
                crate::window::set_window_visible(&target, false);
                windows
                    .borrow_mut()
                    .record_lifecycle("hidden", current_label);
            }
            Ok(serde_json::Value::Null)
        }
        "window.setAlwaysOnTop" => {
            let args: EnabledArg =
                serde_json::from_value(payload.args).map_err(|e| e.to_string())?;
            if let Some(window) = window_slot.borrow().as_ref() {
                window.set_always_on_top(args.enabled);
            }
            Ok(serde_json::Value::Null)
        }
        "window.isVisible" => Ok(window_slot
            .borrow()
            .as_ref()
            .map(|window| serde_json::Value::Bool(window.is_visible()))
            .unwrap_or(serde_json::Value::Bool(false))),
        "window.isFocused" => Ok(window_slot
            .borrow()
            .as_ref()
            .map(|window| serde_json::Value::Bool(window.is_focused()))
            .unwrap_or(serde_json::Value::Bool(false))),
        "window.isMaximized" => Ok(window_slot
            .borrow()
            .as_ref()
            .map(|window| serde_json::Value::Bool(window.is_maximized()))
            .unwrap_or(serde_json::Value::Bool(false))),
        "window.isMinimized" => Ok(window_slot
            .borrow()
            .as_ref()
            .map(|window| serde_json::Value::Bool(window.is_minimized()))
            .unwrap_or(serde_json::Value::Bool(false))),
        "window.getLabel" => Ok(serde_json::Value::String(current_label.to_string())),
        "window.open" => {
            let args: LabelArg = serde_json::from_value(payload.args).map_err(|e| e.to_string())?;
            if !capability_policy.allows("window:open", CapabilityResource::Window(&args.label)) {
                return Err("window.open label is outside its capability scope".to_string());
            }
            let target = windows.borrow().live_window(&args.label)?;
            crate::window::open_window(&target);
            windows.borrow_mut().record_lifecycle("shown", &args.label);
            Ok(serde_json::Value::Null)
        }
        "window.list" => {
            serde_json::to_value(WindowRegistry::list(windows)).map_err(|e| e.to_string())
        }
        "window.showOther" | "window.hideOther" | "window.focusOther" | "window.closeOther" => {
            let args: LabelArg = serde_json::from_value(payload.args).map_err(|e| e.to_string())?;
            if !capability_policy.allows("window:manage", CapabilityResource::Window(&args.label)) {
                return Err("window management label is outside its capability scope".to_string());
            }
            if args.label == current_label {
                return Err("other-window methods require a different target label".to_string());
            }
            match method.as_str() {
                "window.showOther" => {
                    let target = windows.borrow().live_window(&args.label)?;
                    crate::window::set_window_visible(&target, true);
                    windows.borrow_mut().record_lifecycle("shown", &args.label);
                }
                "window.hideOther" => {
                    let target = windows.borrow().live_window(&args.label)?;
                    crate::window::set_window_visible(&target, false);
                    windows.borrow_mut().record_lifecycle("hidden", &args.label);
                }
                "window.focusOther" => {
                    let target = windows.borrow().live_window(&args.label)?;
                    if let Ok(target) = target.try_borrow() {
                        if let Some(target) = target.as_ref() {
                            target.set_focus();
                        }
                    };
                }
                "window.closeOther" => {
                    windows.borrow_mut().request_close(&args.label)?;
                    wake();
                }
                _ => unreachable!(),
            }
            Ok(serde_json::Value::Null)
        }
        "window.startDragging" => {
            if let Some(window) = window_slot.borrow().as_ref() {
                // Legitimately fails outside an active mouse-down (for example
                // a synthetic/programmatic call); the TS wrapper swallows the
                // rejection rather than surfacing it as an app-facing error.
                window.drag_window().map_err(|e| e.to_string())?;
            }
            Ok(serde_json::Value::Null)
        }
        "window.setFullscreen" => {
            let args: SetFullscreenArg =
                serde_json::from_value(payload.args).map_err(|e| e.to_string())?;
            if let Some(window) = window_slot.borrow().as_ref() {
                window.set_fullscreen(if args.fullscreen {
                    // Borderless on the window's current monitor. Exclusive
                    // fullscreen (a dedicated video mode) is out of scope.
                    Some(tao::window::Fullscreen::Borderless(None))
                } else {
                    None
                });
            }
            Ok(serde_json::Value::Null)
        }
        "window.isFullscreen" => Ok(window_slot
            .borrow()
            .as_ref()
            .map(|window| serde_json::Value::Bool(window.fullscreen().is_some()))
            .unwrap_or(serde_json::Value::Bool(false))),
        "window.setMaxSize" => {
            let args: SetMaxSizeArg =
                serde_json::from_value(payload.args).map_err(|e| e.to_string())?;
            let bound = resolve_max_size_bound(args.width, args.height)?;
            if let Some(window) = window_slot.borrow().as_ref() {
                match bound {
                    Some((width, height)) => {
                        window.set_max_inner_size(Some(tao::dpi::LogicalSize::new(width, height)))
                    }
                    None => window.set_max_inner_size(None::<tao::dpi::LogicalSize<f64>>),
                }
            }
            Ok(serde_json::Value::Null)
        }
        "window.getMonitors" => {
            let monitors = window_slot
                .borrow()
                .as_ref()
                .map(crate::window::window_monitors)
                .unwrap_or_default();
            Ok(serde_json::json!({ "monitors": monitors }))
        }
        "globalShortcut.register" => {
            let args: GlobalShortcutRegisterArg =
                serde_json::from_value(payload.args).map_err(|e| e.to_string())?;
            let shortcuts = windows.borrow().global_shortcuts();
            let (id, accelerator) = shortcuts.borrow_mut().register(
                current_label,
                &args.accelerator,
                args.id.as_deref(),
            )?;
            Ok(serde_json::json!({ "id": id, "accelerator": accelerator }))
        }
        "globalShortcut.unregister" => {
            let args: GlobalShortcutIdArg =
                serde_json::from_value(payload.args).map_err(|e| e.to_string())?;
            let shortcuts = windows.borrow().global_shortcuts();
            shortcuts.borrow_mut().unregister(current_label, &args.id)?;
            Ok(serde_json::Value::Null)
        }
        "globalShortcut.unregisterAll" => {
            let shortcuts = windows.borrow().global_shortcuts();
            shortcuts.borrow_mut().unregister_owner(current_label)?;
            Ok(serde_json::Value::Null)
        }
        "tray.create" => {
            let args: TrayCreateArg =
                serde_json::from_value(payload.args).map_err(|e| e.to_string())?;
            let icon_path =
                args.icon.as_deref().or(default_tray_icon).ok_or_else(|| {
                    "tray.create requires an icon path or config.icon".to_string()
                })?;
            let icon = load_tray_icon(icon_path)?;
            let mut builder = TrayIconBuilder::new()
                .with_icon(icon)
                .with_icon_as_template(args.template);
            let (menu, menu_items) = match args.menu.as_deref() {
                Some(items) => {
                    let (menu, ids) = build_tray_menu(items, capabilities)?;
                    (Some(menu), ids)
                }
                None => (None, HashMap::new()),
            };
            if let Some(menu) = menu {
                builder = builder.with_menu(Box::new(menu));
            }
            if let Some(enabled) = args.menu_on_left_click {
                builder = builder.with_menu_on_left_click(enabled);
            }
            if let Some(enabled) = args.menu_on_right_click {
                builder = builder.with_menu_on_right_click(enabled);
            }
            if let Some(tooltip) = args.tooltip.as_deref() {
                builder = builder.with_tooltip(tooltip);
            }
            let tray = builder
                .build()
                .map_err(|e| format!("create tray icon: {e}"))?;
            let previous = {
                let mut state = tray_slot.borrow_mut();
                state.owner_label = Some(current_label.to_string());
                state.menu_items = menu_items;
                state.icon.replace(tray)
            };
            drop(previous);
            Ok(serde_json::Value::Null)
        }
        "tray.remove" => {
            let previous = {
                let mut state = tray_slot.borrow_mut();
                state.owner_label = None;
                state.menu_items.clear();
                state.icon.take()
            };
            drop(previous);
            Ok(serde_json::Value::Null)
        }
        "tray.setTooltip" => {
            let args: TextArg = serde_json::from_value(payload.args).map_err(|e| e.to_string())?;
            let tray = tray_slot
                .borrow_mut()
                .icon
                .take()
                .ok_or_else(|| "tray icon has not been created".to_string())?;
            let tooltip_result = tray
                .set_tooltip(Some(args.text))
                .map_err(|e| format!("set tray tooltip: {e}"));
            let replaced = {
                let mut state = tray_slot.borrow_mut();
                if state.icon.is_none() {
                    state.icon = Some(tray);
                    None
                } else {
                    Some(tray)
                }
            };
            drop(replaced);
            tooltip_result?;
            Ok(serde_json::Value::Null)
        }
        "tray.setIcon" => {
            let args: IconArg = serde_json::from_value(payload.args).map_err(|e| e.to_string())?;
            let icon = load_tray_icon(&args.icon)?;
            let state = tray_slot.borrow();
            let tray = state
                .icon
                .as_ref()
                .ok_or_else(|| "tray icon has not been created".to_string())?;
            tray.set_icon(Some(icon))
                .map_err(|e| format!("set tray icon: {e}"))?;
            Ok(serde_json::Value::Null)
        }
        "tray.setMenu" => {
            let args: TrayMenuArg =
                serde_json::from_value(payload.args).map_err(|e| e.to_string())?;
            let (menu, menu_items) = build_tray_menu(&args.items, capabilities)?;
            let mut state = tray_slot.borrow_mut();
            let tray = state
                .icon
                .as_ref()
                .ok_or_else(|| "tray icon has not been created".to_string())?;
            tray.set_menu(Some(Box::new(menu)));
            state.menu_items = menu_items;
            Ok(serde_json::Value::Null)
        }
        "webview.getCookies" => {
            let args: WebviewGetCookiesArg =
                serde_json::from_value(payload.args).map_err(|e| e.to_string())?;
            let url = args.url.as_deref().map(parse_cookie_url).transpose()?;
            let webview_ref = webview_slot.borrow();
            let webview = webview_ref
                .as_ref()
                .ok_or_else(|| "webview is unavailable".to_string())?;
            let cookies = match &url {
                Some(url) => webview.cookies_for_url(url.as_str()),
                None => webview.cookies(),
            }
            .map_err(|e| e.to_string())?;
            let cookies = cookies
                .iter()
                .filter(|cookie| !is_protected_cookie_name(cookie.name()))
                .take(MAX_COOKIES_RESULT)
                .map(cookie_to_json)
                .collect::<Vec<_>>();
            Ok(serde_json::json!({ "cookies": cookies }))
        }
        "webview.setCookie" => {
            let args: WebviewSetCookieArg =
                serde_json::from_value(payload.args).map_err(|e| e.to_string())?;
            if is_protected_cookie_name(&args.name) {
                return Err(
                    "cannot modify the reserved murasaki runtime session cookie".to_string()
                );
            }
            if !is_valid_cookie_name(&args.name) {
                return Err(
                    "cookie name contains characters outside the allowed token charset".to_string(),
                );
            }
            if !is_valid_cookie_value(&args.value) {
                return Err(format!(
                    "cookie value must be at most {MAX_COOKIE_VALUE_BYTES} bytes of printable ASCII without ';'"
                ));
            }
            let parsed_url = parse_cookie_url(&args.url)?;
            let domain = args
                .domain
                .clone()
                .or_else(|| parsed_url.host_str().map(str::to_string))
                .ok_or_else(|| "url must include a host".to_string())?;
            let path = args.path.clone().unwrap_or_else(|| "/".to_string());
            let cookie = build_writable_cookie(
                args.name,
                args.value,
                domain,
                path,
                args.secure.unwrap_or(false),
                args.http_only.unwrap_or(false),
                args.expires_at,
            )?;
            let webview_ref = webview_slot.borrow();
            let webview = webview_ref
                .as_ref()
                .ok_or_else(|| "webview is unavailable".to_string())?;
            webview.set_cookie(&cookie).map_err(|e| e.to_string())?;
            Ok(serde_json::Value::Null)
        }
        "webview.deleteCookie" => {
            let args: WebviewDeleteCookieArg =
                serde_json::from_value(payload.args).map_err(|e| e.to_string())?;
            if is_protected_cookie_name(&args.name) {
                return Err(
                    "cannot modify the reserved murasaki runtime session cookie".to_string()
                );
            }
            if !is_valid_cookie_name(&args.name) {
                return Err(
                    "cookie name contains characters outside the allowed token charset".to_string(),
                );
            }
            let parsed_url = parse_cookie_url(&args.url)?;
            let domain = parsed_url
                .host_str()
                .map(str::to_string)
                .ok_or_else(|| "url must include a host".to_string())?;
            // No domain/path overrides on delete (unlike setCookie) — matching
            // RFC 6265 default-path semantics keeps this addressable for the
            // common case; see `capabilities.json`'s documented limitation for
            // cookies set with a non-default path.
            let cookie = build_writable_cookie(
                args.name,
                String::new(),
                domain,
                "/".to_string(),
                false,
                false,
                None,
            )?;
            let webview_ref = webview_slot.borrow();
            let webview = webview_ref
                .as_ref()
                .ok_or_else(|| "webview is unavailable".to_string())?;
            webview.delete_cookie(&cookie).map_err(|e| e.to_string())?;
            Ok(serde_json::Value::Null)
        }
        "webview.setZoom" => {
            let args: WebviewSetZoomArg =
                serde_json::from_value(payload.args).map_err(|e| e.to_string())?;
            if !is_valid_zoom_factor(args.factor) {
                return Err("factor must be a finite number between 0.25 and 5.0".to_string());
            }
            let webview_ref = webview_slot.borrow();
            let webview = webview_ref
                .as_ref()
                .ok_or_else(|| "webview is unavailable".to_string())?;
            webview.zoom(args.factor).map_err(|e| e.to_string())?;
            Ok(serde_json::Value::Null)
        }
        "webview.print" => {
            let webview_ref = webview_slot.borrow();
            let webview = webview_ref
                .as_ref()
                .ok_or_else(|| "webview is unavailable".to_string())?;
            webview.print().map_err(|e| e.to_string())?;
            Ok(serde_json::Value::Null)
        }
        _ => Err(format!("unknown native method: {method}")),
    })();

    let response = match result {
        Ok(value) => serde_json::json!({ "ok": true, "value": value }),
        Err(error) => native_error(error),
    };
    dispatch_native_response(webview_slot, &payload.request_id, response);
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
        #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
        {
            let (x, y) = match position {
                Some(p) => (Some(p.x), Some(p.y)),
                None => (None, None),
            };
            let outcome = show_native_context_menu(&self._window, &self.webview, &menu.items, x, y);
            apply_menu_outcome(&self.label, &self.windows, self.wake.as_ref(), outcome);
        }
        #[cfg(all(
            unix,
            not(target_os = "macos"),
            not(target_os = "android"),
            not(target_os = "freebsd"),
            not(target_os = "linux")
        ))]
        {
            let _ = (menu, position);
            return Err(Error::new(
                Status::GenericFailure,
                "showContextMenu is unsupported on this platform",
            ));
        }

        Ok(())
    }

    #[napi]
    pub fn dispose(&self) -> Result<()> {
        let global_shortcuts = self.windows.borrow().global_shortcuts();
        let shortcut_error = global_shortcuts
            .borrow_mut()
            .unregister_owner(&self.label)
            .err();
        let tray = {
            let mut tray = self.tray.borrow_mut();
            if tray.owner_label.as_deref() == Some(&self.label) {
                tray.owner_label = None;
                tray.menu_items.clear();
                tray.icon.take()
            } else {
                None
            }
        };
        let webview = self.webview.borrow_mut().take();
        self.windows.borrow_mut().clear_webview(&self.label);
        drop(webview);
        drop(tray);
        match shortcut_error {
            Some(error) => Err(Error::new(Status::GenericFailure, error)),
            None => Ok(()),
        }
    }
}

/// Drain OS shortcut events and deliver each press to the renderer that owns
/// the registration. Release notifications are intentionally ignored so one
/// physical chord produces one renderer event.
pub(crate) fn poll_global_shortcut_events(windows: &SharedWindowRegistry) {
    let shortcuts = windows.borrow().global_shortcuts();
    let events = shortcuts.borrow().take_triggered();
    for event in events {
        let Some(webview_slot) = WindowRegistry::webview_for_label(windows, &event.owner_label)
        else {
            // A close should unregister first. If an OS event was already
            // queued, silently discard it rather than rerouting ownership.
            continue;
        };
        let detail = serde_json::json!({
            "id": event.id,
            "accelerator": event.accelerator,
        });
        let script = format!(
            "window.dispatchEvent(new CustomEvent('murasaki:globalshortcut',{{detail:{detail}}}))"
        );
        if let Some(webview) = webview_slot.borrow().as_ref() {
            let _ = webview.evaluate_script(&script);
        };
    }
}

fn load_tray_icon(path: &str) -> std::result::Result<TrayIconImage, String> {
    let file = std::fs::File::open(path).map_err(|e| format!("open tray icon {path}: {e}"))?;
    let decoder = png::Decoder::new(file);
    let mut reader = decoder
        .read_info()
        .map_err(|e| format!("decode tray icon {path}: {e}"))?;
    let mut buf = vec![0; reader.output_buffer_size()];
    let frame = reader
        .next_frame(&mut buf)
        .map_err(|e| format!("decode tray icon {path}: {e}"))?;
    buf.truncate(frame.buffer_size());
    let info = reader.info();
    let rgba = match (info.color_type, info.bit_depth) {
        (png::ColorType::Rgba, png::BitDepth::Eight) => buf,
        (png::ColorType::Rgb, png::BitDepth::Eight) => {
            let mut out = Vec::with_capacity(buf.len() / 3 * 4);
            for chunk in buf.chunks_exact(3) {
                out.extend_from_slice(chunk);
                out.push(255);
            }
            out
        }
        _ => return Err("tray icon must be an 8-bit RGB or RGBA PNG".to_string()),
    };
    TrayIconImage::from_rgba(rgba, info.width, info.height)
        .map_err(|e| format!("invalid tray icon {path}: {e}"))
}

/// Drain tray click events and deliver them to renderer listeners. The tao
/// loop polls this because tray-icon uses its own channel rather than tao
/// user events.
///
/// Linux note (verified by reading tray-icon 0.24's GTK/libappindicator
/// backend): the tray-menu-click half of this function (below, via muda's
/// shared `MenuEvent` channel) works identically to macOS/Windows — but the
/// `TrayIconEvent::receiver()` loop further down never yields anything on
/// Linux. tray-icon's GTK implementation never calls `TrayIconEvent::send`
/// at all (only its macOS/Windows backends do) — `AppIndicator`/
/// `KStatusNotifierItem` expose no left/right/double-click signal to the
/// app, only "show the attached menu". So `murasaki:trayclick` never fires
/// on Linux; `murasaki:traymenuclick` does.
#[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
fn tray_event_is_current(active_id: Option<&str>, event_id: &str) -> bool {
    active_id.is_some_and(|active_id| active_id == event_id)
}

#[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
pub(crate) fn poll_tray_events(webview_slot: &SharedWebview, tray_slot: &SharedProcessTray) {
    use tray_icon::{MouseButton, MouseButtonState};

    // muda exposes one global menu receiver for application, context, and tray
    // menus. The application-menu poll runs immediately before this function
    // and preserves our generation-scoped ids in the deferred queue. Also
    // drain the receiver in case a click arrives between the two polls; any
    // non-tray id is returned for the next application-menu tick.
    let menu_items = tray_slot.borrow().menu_items.clone();
    let mut queued =
        DEFERRED_APP_MENU_EVENTS.with(|pending| pending.borrow_mut().drain(..).collect::<Vec<_>>());
    while let Ok(event) = muda::MenuEvent::receiver().try_recv() {
        queued.push(event.id().as_ref().to_string());
    }
    let mut unrelated = Vec::new();
    for native_id in queued {
        if let Some(public_id) = menu_items.get(&native_id) {
            dispatch_tray_menu_click(webview_slot, public_id);
        } else if !native_id.starts_with(TRAY_MENU_ID_PREFIX) {
            unrelated.push(native_id);
        }
        // Unknown tray-prefixed ids belong to an older replaced menu and are
        // dropped instead of leaking a stale click into the new menu.
    }
    defer_menu_event_ids(unrelated);

    while let Ok(event) = TrayIconEvent::receiver().try_recv() {
        let active_id = tray_slot
            .borrow()
            .icon
            .as_ref()
            .map(|icon| icon.id().as_ref().to_string());
        let is_current_icon = tray_event_is_current(active_id.as_deref(), event.id().as_ref());
        if !is_current_icon {
            continue;
        }
        let detail = match event {
            TrayIconEvent::Click {
                button,
                button_state: MouseButtonState::Up,
                ..
            } => Some(serde_json::json!({
              "button": match button { MouseButton::Left => "left", MouseButton::Right => "right", MouseButton::Middle => "middle" },
              "double": false,
            })),
            TrayIconEvent::DoubleClick { button, .. } => Some(serde_json::json!({
              "button": match button { MouseButton::Left => "left", MouseButton::Right => "right", MouseButton::Middle => "middle" },
              "double": true,
            })),
            _ => None,
        };
        if let Some(detail) = detail {
            let script = format!(
                "window.dispatchEvent(new CustomEvent('murasaki:trayclick',{{detail:{detail}}}))"
            );
            if let Some(webview) = webview_slot.borrow().as_ref() {
                let _ = webview.evaluate_script(&script);
            }
        }
    }
}

#[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
fn dispatch_tray_menu_click(webview_slot: &SharedWebview, id: &str) {
    let script = format!(
        "window.dispatchEvent(new CustomEvent('murasaki:traymenuclick',{{detail:{}}}))",
        serde_json::to_string(id).unwrap_or_else(|_| "null".to_string())
    );
    if let Some(webview) = webview_slot.borrow().as_ref() {
        let _ = webview.evaluate_script(&script);
    }
}

#[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
fn collect_menu_item_ids(items: Vec<muda::MenuItemKind>, ids: &mut HashSet<String>) {
    for item in items {
        ids.insert(item.id().as_ref().to_string());
        if let Some(submenu) = item.as_submenu() {
            collect_menu_item_ids(submenu.items(), ids);
        }
    }
}

#[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
fn menu_owned_ids(menu: &muda::Menu) -> HashSet<String> {
    let mut ids = HashSet::new();
    collect_menu_item_ids(menu.items(), &mut ids);
    ids
}

#[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
fn defer_menu_event_ids(ids: impl IntoIterator<Item = String>) {
    DEFERRED_APP_MENU_EVENTS.with(|pending| pending.borrow_mut().extend(ids));
}

/// Move events that predate a context popup out of muda's shared receiver.
/// The popup can then claim only ids belonging to the `Menu` it just built.
#[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
fn defer_pending_app_menu_events() {
    let mut pending = Vec::new();
    while let Ok(event) = muda::MenuEvent::receiver().try_recv() {
        pending.push(event.id().as_ref().to_string());
    }
    defer_menu_event_ids(pending);
}

/// Select the first event owned by a modal context menu and preserve every
/// other id, in order, for the persistent application-menu poller.
#[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
fn split_first_owned_menu_event(
    queued: impl IntoIterator<Item = String>,
    owned_ids: &HashSet<String>,
) -> (Option<String>, Vec<String>) {
    let mut selected = None;
    let mut deferred = Vec::new();
    for id in queued {
        if selected.is_none() && owned_ids.contains(&id) {
            selected = Some(id);
        } else {
            deferred.push(id);
        }
    }
    (selected, deferred)
}

#[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
fn take_context_menu_event(owned_ids: &HashSet<String>) -> Option<String> {
    let mut queued = Vec::new();
    while let Ok(event) = muda::MenuEvent::receiver().try_recv() {
        queued.push(event.id().as_ref().to_string());
    }
    let (selected, deferred) = split_first_owned_menu_event(queued, owned_ids);
    defer_menu_event_ids(deferred);
    selected
}

#[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
fn retain_owned_menu_events(
    queued: impl IntoIterator<Item = String>,
    owned_ids: &HashSet<String>,
) -> Vec<String> {
    queued
        .into_iter()
        .filter(|id| owned_ids.contains(id))
        .collect()
}

#[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
fn take_app_menu_events(menu_slot: &SharedMenu) -> Vec<String> {
    let mut queued =
        DEFERRED_APP_MENU_EVENTS.with(|pending| pending.borrow_mut().drain(..).collect::<Vec<_>>());
    while let Ok(event) = muda::MenuEvent::receiver().try_recv() {
        queued.push(event.id().as_ref().to_string());
    }
    // The receiver is process-global and context popups may deliver their
    // selection after the synchronous show call has returned. Dispatch only
    // ids owned by the currently installed application menu; stale context
    // ids and events from a replaced app menu must never reach useAppMenu.
    let owned_ids = menu_slot
        .borrow()
        .as_ref()
        .map(menu_owned_ids)
        .unwrap_or_default();
    let owned = retain_owned_menu_events(queued.iter().cloned(), &owned_ids);
    // Tray menus and the persistent application menu share muda's one
    // process-global receiver. Preserve tray ids for `poll_tray_events`, which
    // runs later in the same event-loop tick. Stale context/app ids are
    // intentionally discarded here.
    let tray = queued
        .into_iter()
        .filter(|id| id.starts_with(TRAY_MENU_ID_PREFIX))
        .collect::<Vec<_>>();
    defer_menu_event_ids(tray);
    owned
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
) -> MenuPollOutcome {
    use muda::ContextMenu;
    use wry::WebViewExtMacOS;

    let menu = match build_menu(items) {
        Ok(m) => m,
        Err(_) => return MenuPollOutcome::default(),
    };
    let owned_ids = menu_owned_ids(&menu);
    defer_pending_app_menu_events();

    // Grab the NSView pointer and drop the RefCell borrow *before* calling
    // `show_context_menu_for_nsview` below — that call is modal (it pumps a
    // nested run loop) and re-entrant access to `webview_slot` while our
    // borrow was still live would panic with `BorrowError`.
    let ns_view_ptr: *const std::ffi::c_void = {
        let guard = webview_slot.borrow();
        match guard.as_ref() {
            Some(wv) => objc2::rc::Retained::as_ptr(&wv.webview()) as *const std::ffi::c_void,
            None => return MenuPollOutcome::default(),
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

    take_context_menu_event(&owned_ids)
        .map(|id| handle_native_menu_event(window_slot, webview_slot, &id))
        .unwrap_or_default()
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
) -> MenuPollOutcome {
    use muda::{
        dpi::{LogicalPosition, Position},
        ContextMenu,
    };
    use tao::platform::windows::WindowExtWindows;

    let menu = match build_menu(items) {
        Ok(m) => m,
        Err(_) => return MenuPollOutcome::default(),
    };
    let owned_ids = menu_owned_ids(&menu);
    defer_pending_app_menu_events();

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
            None => return MenuPollOutcome::default(),
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

    take_context_menu_event(&owned_ids)
        .map(|id| handle_native_menu_event(window_slot, webview_slot, &id))
        .unwrap_or_default()
}

/// Linux: same shape as the macOS/Windows versions above — build the muda
/// menu, pop it up synchronously via GTK, then report the clicked item back
/// into page JS. `x`/`y` behave like the Windows variant (relative to the
/// window's top-left, per `show_context_menu_for_gtk_window`'s own doc
/// comment) rather than always falling back to the cursor position like
/// macOS.
#[cfg(target_os = "linux")]
fn show_native_context_menu(
    window_slot: &SharedWindow,
    webview_slot: &Rc<RefCell<Option<WebView>>>,
    items: &[MenuItemOptions],
    x: Option<f64>,
    y: Option<f64>,
) -> MenuPollOutcome {
    use muda::{
        dpi::{LogicalPosition, Position},
        ContextMenu,
    };
    use tao::platform::unix::WindowExtUnix;

    let menu = match build_menu(items) {
        Ok(m) => m,
        Err(_) => return MenuPollOutcome::default(),
    };
    let owned_ids = menu_owned_ids(&menu);
    defer_pending_app_menu_events();

    let position = match (x, y) {
        (Some(x), Some(y)) => Some(Position::Logical(LogicalPosition::new(x, y))),
        _ => None,
    };

    // Clone the `gtk::ApplicationWindow` (a cheap GObject refcount bump, not
    // a deep copy) and drop the RefCell borrow *before* calling
    // `show_context_menu_for_gtk_window` below — like the macOS/Windows
    // calls above, it's modal (it pumps `gtk::main_iteration()` in a loop
    // until the popup is dismissed or an item is picked), and re-entrant
    // access to `window_slot` while our borrow was still live would panic
    // with `BorrowError` if a window event fires during that nested loop.
    let gtk_window: gtk::ApplicationWindow = {
        let guard = window_slot.borrow();
        match guard.as_ref() {
            Some(w) => w.gtk_window().clone(),
            None => return MenuPollOutcome::default(),
        }
    };
    // `show_context_menu_for_gtk_window` takes `&gtk::Window` specifically —
    // glib-rs wrapper types don't implement `std::ops::Deref` toward their
    // GObject superclass, so this needs an explicit (statically-checked,
    // zero-cost) upcast rather than relying on deref coercion.
    use gtk::glib::Cast;
    let gtk_window: &gtk::Window = gtk_window.upcast_ref();

    // Unconfirmed on real hardware (flagged for manual verification, same
    // caveat as the macOS variant above): `MenuEvent::receiver().try_recv()`
    // immediately after this call returns is assumed to already have the
    // click queued. This matches muda's GTK implementation as read from
    // source — `show_context_menu_for_gtk_window` pumps `gtk::main_iteration()`
    // until the popup's `selection-done` signal fires, and GTK delivers the
    // clicked item's `activate` signal (which is what triggers muda's
    // `MenuEvent::send`) before `selection-done` — but GTK's signal ordering
    // isn't a treated as a hard guarantee here the way Windows' is.
    let _ = menu.show_context_menu_for_gtk_window(gtk_window, position);

    take_context_menu_event(&owned_ids)
        .map(|id| handle_native_menu_event(window_slot, webview_slot, &id))
        .unwrap_or_default()
}

#[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
fn handle_native_menu_event(
    window_slot: &SharedWindow,
    webview_slot: &SharedWebview,
    id: &str,
) -> MenuPollOutcome {
    use crate::menu::native_menu_ids as ids;
    match id {
        ids::QUIT => MenuPollOutcome {
            quit: true,
            close: false,
        },
        ids::CLOSE => MenuPollOutcome {
            quit: false,
            close: true,
        },
        ids::MINIMIZE => {
            if let Some(window) = window_slot.borrow().as_ref() {
                window.set_minimized(true);
            }
            MenuPollOutcome::default()
        }
        ids::ZOOM => {
            if let Some(window) = window_slot.borrow().as_ref() {
                window.set_maximized(!window.is_maximized());
            }
            MenuPollOutcome::default()
        }
        _ => {
            dispatch_menu_click(webview_slot, id);
            MenuPollOutcome::default()
        }
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

/// Windows/Linux: polls muda's global menu-event channel for clicks on the
/// **native menu bar** built by `menu::build_menu_bar` and installed via
/// `menu::attach_menu_bar` (see `application.rs::create_window` and
/// `launcher.rs`'s `imp_win` — Linux dev-mode wiring lives entirely in
/// `application.rs`; the prod launcher's Linux support is a later phase).
/// Unlike the context-menu popup above — modal, so it reads its one expected
/// event synchronously right after `show_context_menu_for_hwnd`/
/// `show_context_menu_for_gtk_window` returns — the menu bar is persistent:
/// clicks arrive asynchronously, whenever the user picks an item, so this is
/// called once per tao event-loop tick instead (see both call sites'
/// `event_loop.run` closures).
///
/// Drains every pending event in case more than one queued up between two
/// ticks. Ids outside `menu_bar_ids`
/// are treated as a `useAppMenu` custom-item click (see
/// `menu::build_menu_bar_app_menu_from_spec`) and dispatched via
/// `dispatch_menu_click` to the primary renderer. Context popups share muda's
/// process-global receiver; `show_native_context_menu` separates their owned
/// ids and preserves unrelated queued app-menu ids for this poller.
///
/// Returns whether the Exit item was clicked — Minimize/Zoom, the Edit
/// items, and unrecognized (custom) ids are fully handled inside this
/// function (native window call / webview dispatch respectively), but Exit
/// needs process-shutdown semantics that differ between callers (kill the
/// spawned `node` child in the prod launcher vs. run the registered
/// `onQuit` JS callback in the dev path via `Application`), so it's left for
/// the caller to act on.
#[cfg(any(target_os = "windows", target_os = "linux"))]
pub(crate) fn poll_menu_bar_events(
    window_slot: &SharedWindow,
    focused_webview_slot: &SharedWebview,
    app_menu_webview_slot: &SharedWebview,
    app_menu_slot: &SharedMenu,
) -> MenuPollOutcome {
    use crate::menu::menu_bar_ids as ids;

    let mut outcome = MenuPollOutcome::default();

    for id in take_app_menu_events(app_menu_slot) {
        let id = id.as_str();
        if id == ids::EXIT {
            outcome.quit = true;
        } else if id == ids::CLOSE {
            outcome.close = true;
        } else if id == ids::MINIMIZE {
            if let Some(w) = window_slot.borrow().as_ref() {
                w.set_minimized(true);
            }
        } else if id == ids::ZOOM {
            if let Some(w) = window_slot.borrow().as_ref() {
                w.set_maximized(!w.is_maximized());
            }
        } else if id == ids::UNDO {
            run_menu_bar_edit_command(focused_webview_slot, "undo", ids::UNDO);
        } else if id == ids::REDO {
            run_menu_bar_edit_command(focused_webview_slot, "redo", ids::REDO);
        } else if id == ids::CUT {
            run_menu_bar_edit_command(focused_webview_slot, "cut", ids::CUT);
        } else if id == ids::COPY {
            run_menu_bar_edit_command(focused_webview_slot, "copy", ids::COPY);
        } else if id == ids::PASTE {
            run_menu_bar_edit_command(focused_webview_slot, "paste", ids::PASTE);
        } else if id == ids::SELECT_ALL {
            run_menu_bar_edit_command(focused_webview_slot, "selectAll", ids::SELECT_ALL);
        } else {
            dispatch_menu_click(app_menu_webview_slot, id);
        }
    }

    outcome
}

/// macOS only: polls muda's global menu-event channel for clicks on CUSTOM
/// (non-role) application-menu items declared via `useAppMenu` — see
/// `menu::build_macos_app_menu_from_spec`. macOS's role items (Undo/Redo/
/// Cut/Copy/Paste/Select All/Minimize/Zoom/Close/Quit) are real muda
/// `PredefinedMenuItem`s riding Cocoa's responder chain straight into the
/// focused `WKWebView` or the window manager — those never reach this
/// channel, so every event seen here is, by construction, a custom
/// `useAppMenu` item click that needs dispatching into the primary webview
/// where the handlers are registered. Called
/// once per tao event-loop tick from `Application::run` and `launcher.rs`'s
/// `imp_macos`, mirroring `poll_menu_bar_events`'s role on Windows in the
/// same two call sites. (Before `useAppMenu`, macOS never needed this: the
/// startup default menu was 100% predefined items, so nothing was ever
/// pushed to this channel — that's why this function is new while
/// `poll_menu_bar_events` already existed.)
#[cfg(target_os = "macos")]
pub(crate) fn poll_app_menu_events(
    window_slot: &SharedWindow,
    app_menu_webview_slot: &SharedWebview,
    app_menu_slot: &SharedMenu,
) -> MenuPollOutcome {
    let mut outcome = MenuPollOutcome::default();
    for id in take_app_menu_events(app_menu_slot) {
        let event_outcome = handle_native_menu_event(window_slot, app_menu_webview_slot, &id);
        outcome.quit |= event_outcome.quit;
        outcome.close |= event_outcome.close;
    }
    outcome
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
fn handle_app_menu_message(
    _window_slot: &SharedWindow,
    ctx: &AppMenuContext,
    menus: &[AppMenuSpec],
) {
    let about = ctx.about_info.as_ref();
    let menu = match crate::menu::build_macos_app_menu_from_spec(
        menus,
        &about,
        ctx.menu_labels.as_ref(),
    ) {
        Ok(m) => m,
        Err(_) => return,
    };

    let previous = ctx.menu_slot.borrow_mut().take();
    drop(previous);
    menu.init_for_nsapp();
    *ctx.menu_slot.borrow_mut() = Some(menu);
}

/// Windows/Linux counterpart of the macOS `handle_app_menu_message` above —
/// see that function's doc comment for the drop-before-install ordering
/// requirement, which is load-bearing here (unlike on macOS): dropping the
/// OLD `Menu` first is what detaches its previously-attached native menu bar
/// (Win32 `SetMenu(hwnd, null)` / GTK `GtkMenuBar::destroy` respectively —
/// see `menu::attach_menu_bar`'s doc comment) before the new one attaches.
#[cfg(any(target_os = "windows", target_os = "linux"))]
fn handle_app_menu_message(
    window_slot: &SharedWindow,
    ctx: &AppMenuContext,
    menus: &[AppMenuSpec],
) {
    let menu = match crate::menu::build_menu_bar_app_menu_from_spec(menus, ctx.menu_labels.as_ref())
    {
        Ok(m) => m,
        Err(_) => return,
    };

    // Drop the OLD menu first — see this function's doc comment.
    let previous = ctx.menu_slot.borrow_mut().take();
    drop(previous);
    if let Some(window) = window_slot.borrow().as_ref() {
        if let Err(e) = crate::menu::attach_menu_bar(&menu, window) {
            eprintln!("murasaki: failed to attach app menu: {e}");
        }
    }
    *ctx.menu_slot.borrow_mut() = Some(menu);
}

/// Runs `document.execCommand(command)` in the webview for a native menu-bar
/// Edit item — see `menu::build_menu_bar`'s doc comment for why these
/// are custom items dispatched this way instead of muda `PredefinedMenuItem`s.
///
/// Also fires the same `murasaki:menuclick` `CustomEvent` the context-menu
/// path above dispatches (with `id`, one of `menu_bar_ids`, as
/// `detail`), so an app can still observe or override these via the same
/// mechanism `useContextMenu` listens on — but doesn't *depend* on any
/// listener existing: the framework's own default-menu-action JS layer (from
/// an earlier custom-title-bar iteration, since reverted — see git history)
/// no longer ships, so `execCommand` runs unconditionally first, up front in
/// this same script, rather than only as an app-registered handler's effect.
#[cfg(any(target_os = "windows", target_os = "linux"))]
fn run_menu_bar_edit_command(webview_slot: &SharedWebview, command: &str, id: &str) {
    let js = format!(
    "document.execCommand('{command}');window.dispatchEvent(new CustomEvent('murasaki:menuclick',{{detail:{}}}))",
    serde_json::to_string(id).unwrap_or_else(|_| "null".to_string())
  );
    if let Some(wv) = webview_slot.borrow().as_ref() {
        let _ = wv.evaluate_script(&js);
    }
}

/// Other Unix (BSDs): not implemented — mirrors the (also unimplemented)
/// direct-call path in `Webview::show_context_menu`. macOS, Windows, and
/// Linux all have real implementations above.
#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
fn show_native_context_menu(
    _window_slot: &SharedWindow,
    _webview_slot: &Rc<RefCell<Option<WebView>>>,
    _items: &[MenuItemOptions],
    _x: Option<f64>,
    _y: Option<f64>,
) -> MenuPollOutcome {
    MenuPollOutcome::default()
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

#[cfg(test)]
mod tests {
    use super::{
        app_menu_is_allowed, context_menu_is_allowed, download_event_url_is_eventable,
        drag_drop_event_payload, ipc_body_is_allowed, ipc_origin_is_trusted,
        is_protected_cookie_name, is_valid_cookie_name, is_valid_cookie_value,
        is_valid_zoom_factor, max_native_call_body_bytes, native_call_body_is_allowed,
        native_method_is_allowed, navigation_policy, parse_cookie_url, prepare_tray_menu_items,
        resolve_max_size_bound, sanitize_profile_name, should_dispatch_dragover, truncate_utf8,
        valid_proxy_host, validate_app_menu_payload, validate_context_menu_payload,
        validate_webview_network, wry_proxy, AppMenuPayload, ContextMenuPayload, NavigationPolicy,
        ValidatedProxyProtocol, DEFAULT_MAX_METHOD_BODY_BYTES, MAX_CLIPBOARD_WRITE_HTML_BODY_BYTES,
        MAX_CLIPBOARD_WRITE_IMAGE_BODY_BYTES, MAX_IPC_PREPARSE_BODY_BYTES, TRAY_MENU_ID_PREFIX,
    };
    #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
    use super::{retain_owned_menu_events, split_first_owned_menu_event, tray_event_is_current};
    use crate::{
        menu::AppMenuSpec,
        types::{MenuItemOptions, WebviewOptions, WebviewProxyOptions},
    };
    use std::{
        collections::HashSet,
        path::PathBuf,
        time::{Duration, Instant},
    };
    use wry::DragDropEvent;

    #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
    #[test]
    fn context_menu_claims_only_owned_ids_and_preserves_app_menu_order() {
        let owned = ["context-open".to_string()].into_iter().collect();
        let (selected, deferred) = split_first_owned_menu_event(
            [
                "app-save".to_string(),
                "context-open".to_string(),
                "app-help".to_string(),
            ],
            &owned,
        );
        assert_eq!(selected.as_deref(), Some("context-open"));
        assert_eq!(deferred, ["app-save", "app-help"]);
    }

    #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
    #[test]
    fn application_menu_dispatch_drops_delayed_context_and_stale_menu_events() {
        let owned = ["app-save".to_string(), "app-help".to_string()]
            .into_iter()
            .collect();
        assert_eq!(
            retain_owned_menu_events(
                [
                    "context-open".to_string(),
                    "app-save".to_string(),
                    "old-app-item".to_string(),
                    "app-help".to_string(),
                ],
                &owned,
            ),
            ["app-save", "app-help"],
        );
    }

    #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
    #[test]
    fn stale_tray_icon_events_are_rejected_after_replacement() {
        assert!(tray_event_is_current(Some("new-icon"), "new-icon"));
        assert!(!tray_event_is_current(Some("new-icon"), "old-icon"));
        assert!(!tray_event_is_current(None, "old-icon"));
    }

    #[test]
    fn tray_menu_ids_are_required_unique_and_generation_scoped() {
        let items = vec![
            MenuItemOptions {
                id: Some("open".to_string()),
                label: Some("Open".to_string()),
                ..Default::default()
            },
            MenuItemOptions {
                id: Some("submenu-heading".to_string()),
                label: Some("More".to_string()),
                submenu: Some(vec![MenuItemOptions {
                    id: Some("settings".to_string()),
                    label: Some("Settings".to_string()),
                    ..Default::default()
                }]),
                ..Default::default()
            },
        ];
        let (first, first_ids) = prepare_tray_menu_items(&items, &[]).unwrap();
        let (_second, second_ids) = prepare_tray_menu_items(&items, &[]).unwrap();
        assert_eq!(
            first_ids.values().cloned().collect::<HashSet<_>>(),
            ["open".to_string(), "settings".to_string(),]
                .into_iter()
                .collect()
        );
        assert!(first_ids
            .keys()
            .all(|id| id.starts_with(TRAY_MENU_ID_PREFIX)));
        assert!(first_ids.keys().all(|id| !second_ids.contains_key(id)));
        assert_eq!(first[1].id, None);

        let duplicate = vec![
            MenuItemOptions {
                id: Some("same".to_string()),
                label: Some("A".to_string()),
                ..Default::default()
            },
            MenuItemOptions {
                id: Some("same".to_string()),
                label: Some("B".to_string()),
                ..Default::default()
            },
        ];
        assert!(prepare_tray_menu_items(&duplicate, &[]).is_err());
        assert!(prepare_tray_menu_items(
            &[MenuItemOptions {
                label: Some("Missing id".to_string()),
                ..Default::default()
            },],
            &[]
        )
        .is_err());
        assert!(prepare_tray_menu_items(
            &[MenuItemOptions {
                role: Some("quit".to_string()),
                ..Default::default()
            },],
            &["app:quit".to_string()]
        )
        .is_err());
    }

    #[test]
    fn native_commands_are_default_deny_and_exact_match() {
        assert!(!native_method_is_allowed("app.quit", &[]));
        assert!(native_method_is_allowed(
            "app.quit",
            &["app:quit".to_string()]
        ));
        assert!(!native_method_is_allowed("clipboard.readText", &[]));
        assert!(!native_method_is_allowed(
            "clipboard.writeText",
            &["clipboard:readText".to_string()]
        ));
        assert!(native_method_is_allowed(
            "clipboard.readText",
            &["clipboard:readText".to_string()]
        ));
        assert!(!native_method_is_allowed(
            "unknown.command",
            &["unknown:command".to_string()]
        ));
        assert!(native_method_is_allowed(
            "window.isVisible",
            &["window:isVisible".to_string()]
        ));
        assert!(!native_method_is_allowed(
            "window.isVisible",
            &["window:isFocused".to_string()]
        ));
        assert!(native_method_is_allowed(
            "window.getLabel",
            &["window:getLabel".to_string()]
        ));
        assert!(native_method_is_allowed(
            "window.open",
            &["window:open".to_string()]
        ));
        assert!(native_method_is_allowed(
            "window.list",
            &["window:list".to_string()]
        ));
        for (method, permission) in [
            ("secureStorage.get", "secureStorage:get"),
            ("secureStorage.set", "secureStorage:set"),
            ("secureStorage.delete", "secureStorage:delete"),
        ] {
            assert!(!native_method_is_allowed(method, &[]));
            assert!(native_method_is_allowed(method, &[permission.to_string()]));
            assert!(
                !native_method_is_allowed(method, &["secureStorage:get".to_string()])
                    || permission == "secureStorage:get"
            );
        }
        for method in [
            "window.showOther",
            "window.hideOther",
            "window.focusOther",
            "window.closeOther",
            "window.startDragging",
            "window.setFullscreen",
            "window.isFullscreen",
            "window.setMaxSize",
            "window.getMonitors",
        ] {
            assert!(native_method_is_allowed(
                method,
                &["window:manage".to_string()]
            ));
            assert!(!native_method_is_allowed(
                method,
                &["window:open".to_string()]
            ));
        }
        assert!(native_method_is_allowed(
            "globalShortcut.register",
            &["globalShortcut:register".to_string()]
        ));
        for method in ["globalShortcut.unregister", "globalShortcut.unregisterAll"] {
            assert!(native_method_is_allowed(
                method,
                &["globalShortcut:unregister".to_string()]
            ));
            assert!(!native_method_is_allowed(
                method,
                &["globalShortcut:register".to_string()]
            ));
        }
        for (method, permission) in [
            ("dialog.showMessage", "dialog:message"),
            ("clipboard.readImage", "clipboard:readImage"),
            ("clipboard.writeImage", "clipboard:writeImage"),
            ("clipboard.writeHtml", "clipboard:writeHtml"),
            ("shell.trashItem", "shell:trashItem"),
            ("shell.openPath", "shell:openPath"),
        ] {
            assert!(!native_method_is_allowed(method, &[]));
            assert!(native_method_is_allowed(method, &[permission.to_string()]));
        }
    }

    #[test]
    fn set_max_size_requires_both_axes_or_neither() {
        assert_eq!(resolve_max_size_bound(None, None), Ok(None));
        assert_eq!(
            resolve_max_size_bound(Some(800.0), Some(600.0)),
            Ok(Some((800.0, 600.0)))
        );
        assert!(resolve_max_size_bound(Some(800.0), None).is_err());
        assert!(resolve_max_size_bound(None, Some(600.0)).is_err());
        assert!(resolve_max_size_bound(Some(0.0), Some(600.0)).is_err());
        assert!(resolve_max_size_bound(Some(f64::NAN), Some(600.0)).is_err());
        assert!(resolve_max_size_bound(Some(f64::INFINITY), Some(600.0)).is_err());
    }

    #[test]
    fn raw_menu_ipc_is_default_deny_and_app_menu_is_primary_only() {
        assert!(!context_menu_is_allowed(&[]));
        assert!(context_menu_is_allowed(&["menu:context".to_string()]));
        assert!(!app_menu_is_allowed("main", &[]));
        assert!(app_menu_is_allowed(
            "main",
            &["menu:application".to_string()]
        ));
        assert!(!app_menu_is_allowed(
            "settings",
            &["menu:application".to_string()]
        ));
    }

    #[test]
    fn renderer_ipc_and_menu_complexity_are_bounded() {
        assert!(ipc_body_is_allowed(MAX_IPC_PREPARSE_BODY_BYTES));
        assert!(!ipc_body_is_allowed(MAX_IPC_PREPARSE_BODY_BYTES + 1));

        let mut nested = MenuItemOptions::default();
        for _ in 0..9 {
            nested = MenuItemOptions {
                submenu: Some(vec![nested]),
                ..Default::default()
            };
        }
        let deep = ContextMenuPayload {
            items: vec![nested],
            x: Some(1.0),
            y: Some(2.0),
        };
        assert!(validate_context_menu_payload(&deep, &["menu:context".to_string()]).is_err());

        let oversized = ContextMenuPayload {
            items: vec![MenuItemOptions {
                label: Some("x".repeat(1025)),
                ..Default::default()
            }],
            x: None,
            y: None,
        };
        assert!(validate_context_menu_payload(&oversized, &[]).is_err());

        let non_finite = ContextMenuPayload {
            items: vec![],
            x: Some(f64::NAN),
            y: None,
        };
        assert!(validate_context_menu_payload(&non_finite, &[]).is_err());

        let too_many = ContextMenuPayload {
            items: (0..257).map(|_| MenuItemOptions::default()).collect(),
            x: None,
            y: None,
        };
        assert!(validate_context_menu_payload(&too_many, &[]).is_err());
    }

    #[test]
    fn native_call_bodies_are_capped_per_method_after_the_coarse_preparse_gate() {
        // A normal method (no special entry in `max_native_call_body_bytes`)
        // stays capped at the original 256 KiB ceiling even though the
        // pre-parse gate above now allows up to 16 MiB through to be parsed.
        assert_eq!(
            max_native_call_body_bytes("clipboard.writeText"),
            DEFAULT_MAX_METHOD_BODY_BYTES
        );
        assert!(native_call_body_is_allowed(
            "clipboard.writeText",
            DEFAULT_MAX_METHOD_BODY_BYTES
        ));
        assert!(!native_call_body_is_allowed(
            "clipboard.writeText",
            DEFAULT_MAX_METHOD_BODY_BYTES + 1
        ));
        // An oversized body for a normal method is rejected well below the
        // raised 16 MiB pre-parse ceiling, not just above it.
        assert!(!native_call_body_is_allowed(
            "clipboard.writeText",
            MAX_IPC_PREPARSE_BODY_BYTES
        ));

        assert_eq!(
            max_native_call_body_bytes("clipboard.writeImage"),
            MAX_CLIPBOARD_WRITE_IMAGE_BODY_BYTES
        );
        assert!(native_call_body_is_allowed(
            "clipboard.writeImage",
            MAX_CLIPBOARD_WRITE_IMAGE_BODY_BYTES
        ));
        assert!(!native_call_body_is_allowed(
            "clipboard.writeImage",
            MAX_CLIPBOARD_WRITE_IMAGE_BODY_BYTES + 1
        ));

        assert_eq!(
            max_native_call_body_bytes("clipboard.writeHtml"),
            MAX_CLIPBOARD_WRITE_HTML_BODY_BYTES
        );
        assert!(native_call_body_is_allowed(
            "clipboard.writeHtml",
            MAX_CLIPBOARD_WRITE_HTML_BODY_BYTES
        ));
        assert!(!native_call_body_is_allowed(
            "clipboard.writeHtml",
            MAX_CLIPBOARD_WRITE_HTML_BODY_BYTES + 1
        ));
    }

    #[test]
    fn privileged_menu_roles_require_native_capabilities() {
        for (role, capability) in [
            ("quit", "app:quit"),
            ("close", "window:close"),
            ("minimize", "window:minimize"),
            ("zoom", "window:toggleMaximize"),
            ("toggleFullscreen", "window:toggleMaximize"),
            ("copy", "clipboard:writeText"),
            ("paste", "clipboard:readText"),
        ] {
            let payload = ContextMenuPayload {
                items: vec![MenuItemOptions {
                    role: Some(role.to_string()),
                    ..Default::default()
                }],
                x: None,
                y: None,
            };
            assert!(
                validate_context_menu_payload(&payload, &[]).is_err(),
                "role {role}"
            );
            assert!(
                validate_context_menu_payload(&payload, &[capability.to_string()]).is_ok(),
                "role {role}"
            );
        }

        let reserved = ContextMenuPayload {
            items: vec![MenuItemOptions {
                id: Some("murasaki-menu:quit".to_string()),
                ..Default::default()
            }],
            x: None,
            y: None,
        };
        assert!(validate_context_menu_payload(&reserved, &["app:quit".to_string()]).is_err());

        let app_menu_collision = ContextMenuPayload {
            items: vec![MenuItemOptions {
                id: Some("murasaki-app-menu-1-0".to_string()),
                ..Default::default()
            }],
            x: None,
            y: None,
        };
        assert!(validate_context_menu_payload(&app_menu_collision, &[]).is_err());

        for role in [
            "hide",
            "hideOthers",
            "showAll",
            "services",
            "reload",
            "unknown",
        ] {
            let unsupported = ContextMenuPayload {
                items: vec![MenuItemOptions {
                    role: Some(role.to_string()),
                    ..Default::default()
                }],
                x: None,
                y: None,
            };
            assert!(
                validate_context_menu_payload(
                    &unsupported,
                    &[
                        "app:quit".to_string(),
                        "window:close".to_string(),
                        "window:minimize".to_string(),
                        "window:toggleMaximize".to_string(),
                        "clipboard:readText".to_string(),
                        "clipboard:writeText".to_string(),
                    ],
                )
                .is_err(),
                "unsupported role {role} must stay denied on every platform",
            );
        }

        let app_menu = AppMenuPayload {
            menus: vec![AppMenuSpec {
                role: Some("editMenu".to_string()),
                ..Default::default()
            }],
        };
        assert!(validate_app_menu_payload(&app_menu, &[]).is_err());
        assert!(validate_app_menu_payload(
            &app_menu,
            &[
                "clipboard:readText".to_string(),
                "clipboard:writeText".to_string()
            ],
        )
        .is_ok());

        let reload_wire_shape = AppMenuPayload {
            menus: vec![AppMenuSpec {
                label: Some("View".to_string()),
                items: Some(vec![MenuItemOptions {
                    id: Some("reload-action".to_string()),
                    label: Some("Reload".to_string()),
                    role: None,
                    ..Default::default()
                }]),
                ..Default::default()
            }],
        };
        assert!(validate_app_menu_payload(&reload_wire_shape, &[]).is_ok());

        let unsupported_top_level = AppMenuPayload {
            menus: vec![AppMenuSpec {
                role: Some("services".to_string()),
                ..Default::default()
            }],
        };
        assert!(validate_app_menu_payload(&unsupported_top_level, &[]).is_err());
    }

    #[test]
    fn only_exact_runtime_origin_may_navigate_in_app() {
        let trusted = url::Url::parse("http://127.0.0.1:55123/").unwrap();
        assert_eq!(
            navigation_policy("http://127.0.0.1:55123/settings", Some(&trusted)),
            NavigationPolicy::Allow
        );
        assert_eq!(
            navigation_policy("http://127.0.0.1:55124/", Some(&trusted)),
            NavigationPolicy::OpenExternal
        );
        assert_eq!(
            navigation_policy("http://localhost:55123/", Some(&trusted)),
            NavigationPolicy::OpenExternal
        );
        assert_eq!(
            navigation_policy("https://example.com/", Some(&trusted)),
            NavigationPolicy::OpenExternal
        );
        assert_eq!(
            navigation_policy("blob:http://127.0.0.1:55123/01234567", Some(&trusted)),
            NavigationPolicy::Allow
        );
        assert_eq!(
            navigation_policy("blob:https://example.com/01234567", Some(&trusted)),
            NavigationPolicy::Deny
        );
    }

    #[test]
    fn privileged_ipc_requires_a_provable_exact_origin() {
        let trusted = url::Url::parse("http://127.0.0.1:55123/").unwrap();
        assert!(ipc_origin_is_trusted(
            "http://127.0.0.1:55123/settings",
            Some(&trusted),
        ));
        for target in [
            "http://127.0.0.1:55124/",
            "about:blank",
            "blob:http://127.0.0.1:55123/01234567",
            "data:text/html,owned",
        ] {
            assert!(!ipc_origin_is_trusted(target, Some(&trusted)), "{target}");
        }
    }

    #[test]
    fn unsafe_navigation_schemes_are_denied() {
        let trusted = url::Url::parse("http://127.0.0.1:55123/").unwrap();
        for target in [
            "file:///tmp/secret",
            "data:text/html,<script></script>",
            "javascript:alert(1)",
            "unknown://host/",
        ] {
            assert_eq!(
                navigation_policy(target, Some(&trusted)),
                NavigationPolicy::Deny
            );
        }
    }

    #[test]
    fn webview_profile_names_cannot_escape_their_directory() {
        let slash = sanitize_profile_name("com.example/app");
        let question = sanitize_profile_name("com.example?app");
        assert!(slash.starts_with("com.example_app-"));
        assert!(question.starts_with("com.example_app-"));
        assert_ne!(slash, question);
        assert!(!slash.contains('/'));
        assert!(!slash.contains('\\'));
        assert!(slash.len() <= 48 + 1 + 64);

        let traversal = sanitize_profile_name("../../other");
        assert!(traversal.starts_with(".._.._other-"));
        assert!(!traversal.contains('/'));
    }

    #[test]
    fn webview_network_options_are_bounded_and_parsed() {
        let options = WebviewOptions {
            user_agent: Some("Murasaki/1.0 (Desktop)".to_string()),
            incognito: Some(true),
            proxy: Some(WebviewProxyOptions {
                protocol: "socks5".to_string(),
                host: "[2001:db8::1]".to_string(),
                port: 1080,
            }),
            ..Default::default()
        };
        let parsed = validate_webview_network(&options).unwrap();
        assert_eq!(parsed.user_agent.as_deref(), Some("Murasaki/1.0 (Desktop)"));
        assert!(parsed.incognito);
        let proxy = parsed.proxy.unwrap();
        assert_eq!(proxy.protocol, ValidatedProxyProtocol::Socks5);
        assert_eq!(proxy.host, "[2001:db8::1]");
        assert_eq!(proxy.port, 1080);
        match wry_proxy(proxy) {
            wry::ProxyConfig::Socks5(endpoint) => {
                assert_eq!(endpoint.host, "[2001:db8::1]");
                assert_eq!(endpoint.port, "1080");
            }
            _ => panic!("expected SOCKSv5 builder configuration"),
        }

        assert!(valid_proxy_host("proxy.example.com"));
        assert!(valid_proxy_host("127.0.0.1"));
        for invalid in [
            "https://proxy.example.com",
            "user@proxy.example.com",
            "proxy.example.com/path",
            "bad_name.example",
            "2001:db8::1",
        ] {
            assert!(!valid_proxy_host(invalid), "{invalid}");
        }
    }

    #[test]
    fn webview_network_options_reject_header_and_proxy_injection() {
        for user_agent in ["", " padded", "Murasaki\r\nX-Injected: yes"] {
            assert!(validate_webview_network(&WebviewOptions {
                user_agent: Some(user_agent.to_string()),
                ..Default::default()
            })
            .is_err());
        }
        for proxy in [
            WebviewProxyOptions {
                protocol: "https".to_string(),
                host: "proxy.example.com".to_string(),
                port: 443,
            },
            WebviewProxyOptions {
                protocol: "http".to_string(),
                host: "user:pass@proxy.example.com".to_string(),
                port: 8080,
            },
            WebviewProxyOptions {
                protocol: "http".to_string(),
                host: "proxy.example.com".to_string(),
                port: 0,
            },
            WebviewProxyOptions {
                protocol: "socks5".to_string(),
                host: "proxy.example.com".to_string(),
                port: 65_536,
            },
        ] {
            assert!(validate_webview_network(&WebviewOptions {
                proxy: Some(proxy),
                ..Default::default()
            })
            .is_err());
        }
    }

    #[test]
    fn zoom_factor_is_bounded_and_rejects_non_finite_values() {
        assert!(is_valid_zoom_factor(0.25));
        assert!(is_valid_zoom_factor(1.0));
        assert!(is_valid_zoom_factor(5.0));
        assert!(!is_valid_zoom_factor(0.24));
        assert!(!is_valid_zoom_factor(5.01));
        assert!(!is_valid_zoom_factor(f64::NAN));
        assert!(!is_valid_zoom_factor(f64::INFINITY));
        assert!(!is_valid_zoom_factor(f64::NEG_INFINITY));
    }

    #[test]
    fn drag_drop_events_map_to_their_documented_custom_events() {
        let enter = DragDropEvent::Enter {
            paths: vec![PathBuf::from("/tmp/a.txt"), PathBuf::from("/tmp/b.txt")],
            position: (10, 20),
        };
        let (name, detail) = drag_drop_event_payload(&enter);
        assert_eq!(name, "murasaki:dragenter");
        assert_eq!(
            detail,
            serde_json::json!({ "paths": ["/tmp/a.txt", "/tmp/b.txt"], "x": 10, "y": 20 })
        );

        let over = DragDropEvent::Over { position: (1, 2) };
        let (name, detail) = drag_drop_event_payload(&over);
        assert_eq!(name, "murasaki:dragover");
        assert_eq!(detail, serde_json::json!({ "x": 1, "y": 2 }));

        let drop = DragDropEvent::Drop {
            paths: vec![PathBuf::from("/tmp/c.txt")],
            position: (3, 4),
        };
        let (name, detail) = drag_drop_event_payload(&drop);
        assert_eq!(name, "murasaki:dragdrop");
        assert_eq!(
            detail,
            serde_json::json!({ "paths": ["/tmp/c.txt"], "x": 3, "y": 4 })
        );

        let leave = DragDropEvent::Leave;
        let (name, detail) = drag_drop_event_payload(&leave);
        assert_eq!(name, "murasaki:dragleave");
        assert_eq!(detail, serde_json::json!({}));
    }

    #[test]
    fn dragover_dispatch_is_throttled_to_20_per_second() {
        let t0 = Instant::now();
        assert!(should_dispatch_dragover(None, t0));
        let t1 = t0 + Duration::from_millis(10);
        assert!(!should_dispatch_dragover(Some(t0), t1));
        let t2 = t0 + Duration::from_millis(49);
        assert!(!should_dispatch_dragover(Some(t0), t2));
        let t3 = t0 + Duration::from_millis(50);
        assert!(should_dispatch_dragover(Some(t0), t3));
    }

    #[test]
    fn data_url_download_events_are_bounded_but_the_download_itself_is_not() {
        assert!(download_event_url_is_eventable(
            "https://example.com/file.zip"
        ));
        assert!(download_event_url_is_eventable(&format!(
            "data:text/plain,{}",
            "x".repeat(1000)
        )));
        assert!(!download_event_url_is_eventable(&format!(
            "data:text/plain,{}",
            "x".repeat(5000)
        )));
    }

    #[test]
    fn cookie_names_and_values_are_strictly_validated() {
        assert!(is_valid_cookie_name("session_id"));
        assert!(is_valid_cookie_name("X-Custom.Name"));
        assert!(!is_valid_cookie_name(""));
        assert!(!is_valid_cookie_name("has space"));
        assert!(!is_valid_cookie_name("semi;colon"));
        assert!(!is_valid_cookie_name("a".repeat(257).as_str()));

        assert!(is_valid_cookie_value("normal-value_123"));
        assert!(!is_valid_cookie_value("has;semicolon"));
        assert!(!is_valid_cookie_value("has control\u{0}char"));
        assert!(!is_valid_cookie_value(&"x".repeat(4097)));
        assert!(is_valid_cookie_value(&"x".repeat(4096)));
    }

    #[test]
    fn the_murasaki_runtime_session_cookie_is_protected_case_insensitively() {
        assert!(is_protected_cookie_name("murasaki_runtime"));
        assert!(is_protected_cookie_name("MURASAKI_RUNTIME"));
        assert!(is_protected_cookie_name("Murasaki_Runtime"));
        assert!(!is_protected_cookie_name("murasaki_runtime2"));
        assert!(!is_protected_cookie_name("session_id"));
    }

    #[test]
    fn cookie_urls_are_restricted_to_http_and_https() {
        assert!(parse_cookie_url("https://example.com/").is_ok());
        assert!(parse_cookie_url("http://example.com/").is_ok());
        assert!(parse_cookie_url("ftp://example.com/").is_err());
        assert!(parse_cookie_url("not a url").is_err());
        assert!(parse_cookie_url("javascript:alert(1)").is_err());
    }

    #[test]
    fn cookie_values_are_truncated_at_a_utf8_char_boundary() {
        assert_eq!(truncate_utf8("hello", 10), "hello");
        assert_eq!(truncate_utf8("hello world", 5), "hello");
        // A 3-byte UTF-8 character sitting right at the boundary must not be
        // split in the middle of its encoding.
        let value = format!("{}\u{3042}", "x".repeat(4)); // 4 ASCII + 'あ' (3 bytes)
        assert_eq!(truncate_utf8(&value, 5), "xxxx");
        assert_eq!(truncate_utf8(&value, 6), "xxxx");
        assert_eq!(truncate_utf8(&value, 7), value);
    }
}
