//! murasaki-native — Rust binding for murasaki.
//!
//! Exposes tao (window), wry (webview), muda (native menu — including
//! **context menu popup**), rfd (dialog, including the native message box),
//! arboard (clipboard, including PNG image and HTML support via `png` and
//! `base64`), notify-rust (notification), tray-icon (tray), `open` (shell
//! openExternal/openPath), and `trash` (shell trashItem) through napi-rs.

#![deny(clippy::all)]

use napi_derive::napi;

mod types;

#[cfg(not(any(target_os = "freebsd", target_os = "android")))]
mod application;
#[cfg(not(any(target_os = "freebsd", target_os = "android")))]
mod capability_policy;
#[cfg(not(any(target_os = "freebsd", target_os = "android")))]
mod clipboard;
#[cfg(not(any(target_os = "freebsd", target_os = "android")))]
mod dialog;
#[cfg(not(any(target_os = "freebsd", target_os = "android")))]
mod download;
#[cfg(not(any(target_os = "freebsd", target_os = "android")))]
mod global_shortcut;
mod launcher;
#[cfg(not(any(target_os = "freebsd", target_os = "android")))]
mod menu;
#[cfg(not(any(target_os = "freebsd", target_os = "android")))]
mod notification;
#[cfg(not(any(target_os = "freebsd", target_os = "android")))]
mod secure_storage;
#[cfg(not(any(target_os = "freebsd", target_os = "android")))]
mod shell;
#[cfg(not(any(target_os = "freebsd", target_os = "android")))]
mod system_permission;
mod updater;
#[cfg(not(any(target_os = "freebsd", target_os = "android")))]
mod webview;
#[cfg(not(any(target_os = "freebsd", target_os = "android")))]
mod window;

pub use types::*;

#[cfg(not(any(target_os = "freebsd", target_os = "android")))]
pub use application::Application;
pub use launcher::run_launcher;
#[cfg(not(any(target_os = "freebsd", target_os = "android")))]
pub use webview::Webview;
#[cfg(not(any(target_os = "freebsd", target_os = "android")))]
pub use window::BrowserWindow;

#[napi]
pub fn version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}
