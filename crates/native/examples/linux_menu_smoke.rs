//! Linux windowed smoke test (RFC 0002 phase L1 verification).
//!
//! Creates a native window with the GTK menu bar attached
//! (`menu::attach_menu_bar`/`menu::build_menu_bar`) and a wry `WebView`
//! inside it, exercising the tao + wry + webkit2gtk + muda/GTK stack
//! end-to-end under a headless X server (Xvfb). Not part of `cargo test` —
//! run manually:
//!
//! ```sh
//! xvfb-run -a cargo run --example linux_menu_smoke
//! ```
//!
//! Deliberately does **not** call `showContextMenu`/`Webview::show_context_menu`:
//! `show_context_menu_for_gtk_window` pumps a modal `gtk::main_iteration()`
//! loop that only exits once a real user picks an item or dismisses the
//! popup, which would hang forever with no user present. That path is
//! covered by reading muda's GTK source (see `webview.rs`'s Linux
//! `show_native_context_menu` doc comment) rather than by this smoke test.

fn main() {
    let app = murasaki_native::Application::new().expect("create Application");
    let window = app
        .create_window(None)
        .expect("create window and attach the native GTK menu bar");
    let webview = window
        .create_webview(murasaki_native::WebviewOptions {
            html: Some("<!doctype html><title>murasaki linux smoke</title>".to_string()),
            ..Default::default()
        })
        .expect("create wry WebView on GTK/webkit2gtk");
    drop(webview);
    drop(window);
    drop(app);
    println!(
        "linux_menu_smoke: window + native GTK menu bar + WebView created and dropped cleanly"
    );
}
