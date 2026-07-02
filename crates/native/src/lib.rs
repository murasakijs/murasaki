//! murasaki-native — Rust binding for murasaki.
//!
//! Exposes tao (window), wry (webview), muda (native menu — including
//! **context menu popup**), rfd (dialog), arboard (clipboard),
//! notify-rust (notification), tray-icon (tray), and `open` (shell
//! openExternal) through napi-rs.

#![deny(clippy::all)]

use napi_derive::napi;

mod types;

#[cfg(not(any(target_os = "freebsd", target_os = "android")))]
mod application;
#[cfg(not(any(target_os = "freebsd", target_os = "android")))]
mod window;
#[cfg(not(any(target_os = "freebsd", target_os = "android")))]
mod webview;
#[cfg(not(any(target_os = "freebsd", target_os = "android")))]
mod menu;
#[cfg(not(any(target_os = "freebsd", target_os = "android")))]
mod dialog;
#[cfg(not(any(target_os = "freebsd", target_os = "android")))]
mod clipboard;
#[cfg(not(any(target_os = "freebsd", target_os = "android")))]
mod notification;
#[cfg(not(any(target_os = "freebsd", target_os = "android")))]
mod shell;

pub use types::*;

#[cfg(not(any(target_os = "freebsd", target_os = "android")))]
pub use application::Application;
#[cfg(not(any(target_os = "freebsd", target_os = "android")))]
pub use window::BrowserWindow;
#[cfg(not(any(target_os = "freebsd", target_os = "android")))]
pub use webview::Webview;

#[napi]
pub fn version() -> String {
  env!("CARGO_PKG_VERSION").to_string()
}
