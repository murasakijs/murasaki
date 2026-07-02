//! Serde-shaped types that cross the JS ↔ Rust boundary.
//! Napi-derive maps these to TypeScript object shapes.

use napi_derive::napi;

#[napi(object)]
#[derive(Clone)]
pub struct WindowOptions {
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
}

#[napi(object)]
#[derive(Clone)]
pub struct WebviewOptions {
  pub url: Option<String>,
  pub html: Option<String>,
  pub devtools: Option<bool>,
  pub transparent: Option<bool>,
  /// When set, static files under this directory are served via wry's custom
  /// protocol (`murasaki://localhost/…`) instead of `url`/`html` — used in
  /// production, where an in-process HTTP server can't work because
  /// `Application::run()` blocks Node's event loop. Takes priority over
  /// `url`/`html` when set.
  pub serve_dir: Option<String>,
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
#[derive(Clone)]
pub struct DialogFilter {
  pub name: String,
  pub extensions: Vec<String>,
}

#[napi(object)]
#[derive(Clone)]
pub struct OpenFileOptions {
  pub title: Option<String>,
  pub default_path: Option<String>,
  pub filters: Option<Vec<DialogFilter>>,
  pub multiple: Option<bool>,
}

#[napi(object)]
#[derive(Clone)]
pub struct SaveFileOptions {
  pub title: Option<String>,
  pub default_path: Option<String>,
  pub default_name: Option<String>,
  pub filters: Option<Vec<DialogFilter>>,
}

#[napi(object)]
#[derive(Clone)]
pub struct NotificationOptions {
  pub title: String,
  pub body: Option<String>,
  pub icon: Option<String>,
  pub sound: Option<bool>,
}
