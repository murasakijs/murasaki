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
mod capability_policy;
#[cfg(not(any(target_os = "freebsd", target_os = "android")))]
mod clipboard;
#[cfg(not(any(target_os = "freebsd", target_os = "android")))]
mod dialog;
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

// Fuzzing-only re-exports (see the `fuzzing` feature in Cargo.toml and
// crates/native/fuzz). Never enabled in the published crate.
#[cfg(all(feature = "fuzzing", not(any(target_os = "freebsd", target_os = "android"))))]
pub use capability_policy::fuzz_parse_capability_policy;
#[cfg(feature = "fuzzing")]
pub use updater::fuzz_parse_update_journal;

#[napi]
pub fn version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}
