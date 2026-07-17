//! Serde-shaped types that cross the JS ↔ Rust boundary.
//! Napi-derive maps these to TypeScript object shapes.

use napi_derive::napi;

#[napi(object)]
#[derive(Clone)]
pub struct WindowOptions {
    /// Stable label used by cross-window APIs. `main` is reserved for the
    /// primary window.
    pub label: Option<String>,
    /// Whether this is the primary application window. Defaults to true only
    /// for the reserved `main` label.
    pub primary: Option<bool>,
    /// Initial visibility. Defaults to true.
    pub visible: Option<bool>,
    pub title: Option<String>,
    pub width: Option<i32>,
    pub height: Option<i32>,
    pub min_width: Option<i32>,
    pub min_height: Option<i32>,
    pub resizable: Option<bool>,
    pub transparent: Option<bool>,
    /// macOS only. Values: 'hud' | 'sidebar' | 'popover' | 'window-background' | null
    pub vibrancy: Option<String>,
    /// macOS only. Resolved path to a PNG icon used for the standard "About
    /// <app>" panel (`NSAboutPanelOptionApplicationIcon`). Does not affect the
    /// Dock icon — see `Application::setIconPath` for that.
    pub icon: Option<String>,
    /// Populates the "Version" field of the native "About <app>" panel.
    pub version: Option<String>,
    /// Populates the description field of the native "About <app>" panel.
    pub description: Option<String>,
    /// Populates the copyright field of the native "About <app>" panel.
    pub copyright: Option<String>,
    /// Populates the homepage/website field of the native "About <app>" panel.
    pub homepage: Option<String>,
    /// Populates the authors field of the native "About <app>" panel.
    pub authors: Option<Vec<String>>,
    /// Localized labels for the standard menu bar — macOS's App/Edit/Window
    /// (see `crate::menu::build_default_app_menu`) and Windows's File/Edit/Window
    /// (see `crate::menu::build_windows_menu_bar`). Falls back to English when
    /// absent. Unused on Linux (no default menu bar there yet).
    pub menu_labels: Option<MenuLabels>,
    /// Whether the OS window chrome (titlebar + borders) is shown. Defaults
    /// to true; `false` produces a frameless window on every platform.
    pub decorations: Option<bool>,
    /// macOS only. `'hidden'` keeps the traffic-light buttons but hides the
    /// title text and extends the WebView under the titlebar (transparent
    /// titlebar + full-size content view). Windows/Linux accept and ignore
    /// this field. Values: 'default' | 'hidden'.
    pub title_bar_style: Option<String>,
    /// Maximum inner width/height in logical pixels. Both must be present
    /// together (see `window::RuntimeWindowManager::create_known`); a
    /// solitary axis is rejected before it reaches the native host — see
    /// `resolveWindowDeclarations` in `config.ts`.
    pub max_width: Option<i32>,
    pub max_height: Option<i32>,
    /// Initial borderless-fullscreen state
    /// (`tao::window::Fullscreen::Borderless(None)`). Exclusive fullscreen is
    /// not supported.
    pub fullscreen: Option<bool>,
}

/// Immutable native window template configured before the event loop starts.
/// Runtime create/destroy commands may reference only these labels.
#[napi(object)]
#[derive(Clone)]
pub struct RuntimeWindowTemplate {
    pub window: WindowOptions,
    pub webview: WebviewOptions,
    pub create_on_launch: bool,
}

/// Localized labels for the standard menu bar's items — macOS's
/// `PredefinedMenuItem`s hardcode English, and Windows's custom `MenuItem`s
/// have no localization of their own either, so murasaki resolves per-locale
/// labels in JS (or, for the production launcher, in Rust — see
/// `launcher.rs`'s `shared::resolve_menu_labels`) and passes them through
/// here. Any field left `None` falls back to the English literal.
#[napi(object)]
#[derive(Clone)]
pub struct MenuLabels {
    pub about: Option<String>,
    pub services: Option<String>,
    pub hide_others: Option<String>,
    pub hide: Option<String>,
    pub show_all: Option<String>,
    pub quit: Option<String>,
    pub edit: Option<String>,
    pub undo: Option<String>,
    pub redo: Option<String>,
    pub cut: Option<String>,
    pub copy: Option<String>,
    pub paste: Option<String>,
    pub select_all: Option<String>,
    pub window: Option<String>,
    pub minimize: Option<String>,
    pub zoom: Option<String>,
}

#[napi(object)]
#[derive(Clone, Default)]
pub struct WebviewOptions {
    pub url: Option<String>,
    pub html: Option<String>,
    pub devtools: Option<bool>,
    pub transparent: Option<bool>,
    /// Stable application identifier used to isolate WebView runtime data
    /// (notably WebView2 profiles on Windows) between Murasaki applications.
    pub app_id: Option<String>,
    /// Complete custom User-Agent value for this WebView.
    pub user_agent: Option<String>,
    /// Use a non-persistent private browsing session. The WebContext profile
    /// is ignored by Wry when enabled.
    pub incognito: Option<bool>,
    /// Unauthenticated HTTP CONNECT or SOCKSv5 proxy.
    pub proxy: Option<WebviewProxyOptions>,
    /// Exact renderer-native command permissions. Missing/empty is deny-all.
    pub capabilities: Option<Vec<String>>,
    /// Versioned JSON policy carrying value-level allow/deny scopes. Omitted
    /// metadata keeps the legacy permission-name behavior for compatibility.
    pub capability_policy: Option<String>,
    /// Default packaged/development PNG used when creating a tray icon.
    pub tray_icon: Option<String>,
    /// When set, static files under this directory are served via wry's custom
    /// protocol (`murasaki://localhost/…`) instead of `url`/`html` — used in
    /// production, where an in-process HTTP server can't work because
    /// `Application::run()` blocks Node's event loop. Takes priority over
    /// `url`/`html` when set.
    pub serve_dir: Option<String>,
    /// Confines `webview:download`-granted downloads to this directory.
    /// Omitted/absent `directory` resolves to the OS user Downloads folder.
    pub downloads: Option<WebviewDownloadsOptions>,
    /// Trusted, project-authored JavaScript injected before every page load
    /// (`with_initialization_script_for_main_only`), in declaration order.
    /// Content, not paths — resolved from `config.webview.initScripts` at
    /// dev/bundle time. Not capability-gated: this is config-owned, not
    /// renderer-triggerable.
    pub init_scripts: Option<Vec<String>>,
    /// Whether OS zoom hotkeys/gestures are enabled. Effective on Windows
    /// only (WebView2); no-op elsewhere. Not capability-gated — config-owned.
    pub hotkeys_zoom: Option<bool>,
}

#[napi(object)]
#[derive(Clone, Debug, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WebviewProxyOptions {
    pub protocol: String,
    pub host: String,
    pub port: u32,
}

/// `webview:download`'s confinement directory — see `config.ts`'s
/// `WebviewConfig.downloads` and `crate::download`.
#[napi(object)]
#[derive(Clone, Default, Debug, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields, default)]
pub struct WebviewDownloadsOptions {
    pub directory: Option<String>,
}

/// Also parsed straight out of the IPC JSON payload (`kind: "contextMenu"`)
/// by `webview::handle_ipc_message` — hence the `serde::Deserialize` derive
/// alongside the usual `#[napi(object)]` one. `submenu` is self-recursive
/// and serde handles that automatically.
#[napi(object)]
#[derive(Clone, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct MenuItemOptions {
    pub id: Option<String>,
    pub label: Option<String>,
    pub enabled: Option<bool>,
    pub accelerator: Option<String>,
    pub icon: Option<String>,
    pub separator: Option<bool>,
    pub submenu: Option<Vec<MenuItemOptions>>,
    /// Predefined role: 'copy' | 'cut' | 'paste' | 'selectAll' | 'quit' |
    /// 'reload' | 'about' | 'toggleFullscreen' | 'services' | 'hide' | ...
    pub role: Option<String>,
}

#[napi(object)]
#[derive(Clone)]
pub struct MenuOptions {
    pub items: Vec<MenuItemOptions>,
}

#[napi(object)]
#[derive(Clone)]
pub struct Position {
    pub x: f64,
    pub y: f64,
}

#[napi(object)]
#[derive(Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DialogFilter {
    pub name: String,
    pub extensions: Vec<String>,
}

#[napi(object)]
#[derive(Clone, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct OpenFileOptions {
    pub title: Option<String>,
    pub default_path: Option<String>,
    pub filters: Option<Vec<DialogFilter>>,
    pub multiple: Option<bool>,
}

#[napi(object)]
#[derive(Clone, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SaveFileOptions {
    pub title: Option<String>,
    pub default_path: Option<String>,
    pub default_name: Option<String>,
    pub filters: Option<Vec<DialogFilter>>,
}

#[napi(object)]
#[derive(Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationOptions {
    pub title: String,
    pub body: Option<String>,
    pub icon: Option<String>,
    pub sound: Option<bool>,
}

/// `dialog.showMessage` options. `level` and `buttons` are validated and
/// defaulted (`'info'`/`'ok'`) in `dialog::show_message_dialog` rather than
/// here, so invalid values surface as a normal rejected Promise instead of an
/// N-API argument-conversion panic.
#[napi(object)]
#[derive(Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MessageDialogOptions {
    pub title: Option<String>,
    pub message: String,
    pub level: Option<String>,
    pub buttons: Option<String>,
}

/// `clipboard.readImage`'s result shape — decoded clipboard pixels
/// re-encoded as a PNG and base64-wrapped for the wire (see
/// `clipboard::clipboard_read_image`). Serialize-only: this never crosses the
/// JS -> Rust direction.
#[napi(object)]
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardImageData {
    pub width: i32,
    pub height: i32,
    pub png_base64: String,
}

#[napi(object)]
#[derive(Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ClipboardWriteImageOptions {
    pub png_base64: String,
}

#[napi(object)]
#[derive(Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ClipboardWriteHtmlOptions {
    pub html: String,
    pub alt_text: Option<String>,
}
