# Vendored patch: wry 0.55.1

This is a vendored copy of [wry](https://github.com/tauri-apps/wry) 0.55.1
(unmodified except for the single change below) pulled in via
`[patch.crates-io]` in `crates/native/Cargo.toml`. It exists to fix exactly
one bug; it is not a general-purpose fork and should be dropped once the fix
lands upstream and a new wry release is cut.

## The bug

`src/webkitgtk/mod.rs`'s `impl Drop for X11Data` unconditionally runs:

```rust
impl Drop for X11Data {
  fn drop(&mut self) {
    unsafe { (self.xlib.XDestroyWindow)(self.x11_display as _, self.x11_window) };
    self.gtk_window.close();
  }
}
```

`X11Data` is created for every webview on the X11 backend, both when wry
builds its own child container window (`is_child == true`) and when it embeds
into a caller-supplied window (`is_child == false`, i.e.
`WebViewBuilder::build(&existing_window)` — the only path Murasaki uses).

In the non-child path, `x11_window`/`gtk_window` are not wry's own window —
they alias the **parent** window that the caller (tao, in Murasaki's case)
owns. So when the webview drops, `Drop for X11Data` raw-destroys the parent
window's X11 resource via Xlib (`XDestroyWindow`) and closes the GTK window,
out from under its actual owner. Shortly after, tao's own `Window::drop` tries
to destroy that same (already-destroyed) window through GDK, GDK gets an X11
`BadWindow` error, and GDK's default X error handler calls `_exit(1)` —
below Rust's panic hook, so there is no panic, no backtrace, no crash report,
just an immediate process exit. This reproduced reliably as a crash on
opening/closing a second window (multi-window / native-window features) and
was confirmed via `gdb` in the Linux Docker build.

Every other method on `X11Data`/`InnerWebView` in this file already guards on
`if x11_data.is_child` before touching `x11_window`/`gtk_window` — `Drop` was
the sole exception.

This is still present on wry's `dev` branch, and 0.55.1 is the latest
published release, so upgrading is not an option; the fix has to be vendored.

## The fix

Guard the `Drop for X11Data` body on `is_child`, exactly like every other
method in the file:

```rust
impl Drop for X11Data {
  fn drop(&mut self) {
    if self.is_child {
      unsafe { (self.xlib.XDestroyWindow)(self.x11_display as _, self.x11_window) };
      self.gtk_window.close();
    }
  }
}
```

When `is_child` is `false`, the parent window is left alone for its actual
owner (tao) to tear down.

## Scope

This vendored copy is otherwise identical to the published `wry` 0.55.1
crate. `examples/`, `renovate.json`, `rustfmt.toml`, `SECURITY.md`,
`MOBILE.md`, `Cargo.lock`, and `Cargo.toml.orig` were dropped to keep the
vendored tree minimal; none of them affect the build. `Cargo.toml`'s
`version` field is intentionally left at `0.55.1` so `[patch.crates-io]`
resolves against it.

## Upstreaming

This bug is present on wry's `dev` branch too (0.55.1 is the latest published
release), so the fix should be sent upstream and this vendored copy dropped
once a fixed wry release ships. A ready-to-file PR — "fix(webkitgtk): only
destroy the X11 window in `Drop for X11Data` when `is_child`" — describes the
same root cause, a `GDK_SYNCHRONIZE=1` repro, and this one-block change.

Upstream PR: (to file — tauri-apps/wry)
