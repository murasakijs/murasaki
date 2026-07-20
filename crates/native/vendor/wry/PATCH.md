# Vendored patch: wry 0.55.1

This is a vendored copy of [wry](https://github.com/tauri-apps/wry) 0.55.1
(unmodified except for the two changes documented below) pulled in via
`[patch.crates-io]` in `crates/native/Cargo.toml`. It exists to fix exactly
those two bugs; it is not a general-purpose fork and should be dropped once
both fixes land upstream and a new wry release is cut.

## Patch 1: `Drop for X11Data` destroys the caller's window, not wry's

### The bug

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

### The fix

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

### Upstreaming

This bug is present on wry's `dev` branch too (0.55.1 is the latest published
release), so the fix should be sent upstream and this vendored copy dropped
once a fixed wry release ships. A ready-to-file PR — "fix(webkitgtk): only
destroy the X11 window in `Drop for X11Data` when `is_child`" — describes the
same root cause, a `GDK_SYNCHRONIZE=1` repro, and this one-block change.

Upstream PR: (to file — tauri-apps/wry)

## Patch 2: `delete_cookie` silently no-ops because it matches by value

### The bug

`src/webkitgtk/mod.rs`'s `InnerWebView::delete_cookie` builds a `soup::Cookie`
straight from the caller-supplied `cookie::Cookie` and hands it to
`WebKitCookieManager::delete_cookie`:

```rust
pub fn delete_cookie(&self, cookie: &cookie::Cookie<'_>) -> Result<()> {
  let (tx, rx) = std::sync::mpsc::channel();
  if let Some(cookies_manager) = self
    .webview
    .website_data_manager()
    .and_then(|manager| manager.cookie_manager())
  {
    let mut soup_cookie = Self::cookie_into_soup_cookie(cookie);
    cookies_manager.delete_cookie(&mut soup_cookie, None::<&Cancellable>, move |ret| {
      let _ = tx.send(ret);
    });
  }
  // ...blocks on `rx` via `gtk::main_iteration()`, returns `ret.map_err(Into::into)`
}
```

`webkit_cookie_manager_delete_cookie()` matches the cookie to remove by full
`SoupCookie` equality — **including `value`** — not by the RFC 6265 identity
triple `(name, domain, path)` that a "delete this cookie" API is expected to
use, and that every other wry backend actually does use: WKHTTPCookieStore on
macOS and WebView2 on Windows both delete by `(name, domain, path)`,
independent of whatever `value` happens to be on the `cookie::Cookie` object
passed in. On webkitgtk, if the `value` on the passed-in cookie doesn't
byte-for-byte match the value of the cookie currently in the store, WebKit's
async completion still reports **success** (`Ok(())` — the *operation*
completed, it just matched nothing) and the real cookie is left untouched.

This is easy to hit because the overwhelmingly common shape of a "delete
cookie" call site only has the identity (name/domain/path) of the cookie it
wants gone, not its current value — Murasaki's own `webview.deleteCookie`
native handler (`crates/native/src/webview.rs`) is exactly this shape: its
wire arguments carry no `value` field, so it builds the cookie to delete with
an empty placeholder value. Confirmed with a minimal reproduction directly
against this vendored crate (bypassing Murasaki's IPC layer entirely): calling
`delete_cookie` with the *same* value used at `set_cookie` time deletes
immediately; calling it with any other value (empty or otherwise) returns
`Ok(())` and leaves the cookie in place — `cookies()`/`cookies_for_url()` keep
reflecting it indefinitely (reproduced with the caller polling for 5s+). This
is not a cache-invalidation timing issue and not affected by which
`CookiePersistentStorage` (`Text` vs `Sqlite`) is configured — both were
verified to reproduce identically.

### The fix

Before calling `WebKitCookieManager::delete_cookie`, look up the currently
stored cookie with the same `(name, domain, path)` identity (via the
already-existing `cookies()` method) and, if one is found, delete *that*
cookie object — value, attributes and all — instead of the caller-supplied
stand-in:

```rust
pub fn delete_cookie(&self, cookie: &cookie::Cookie<'_>) -> Result<()> {
  let identity_match = self.cookies().ok().and_then(|cookies| {
    cookies.into_iter().find(|stored| {
      stored.name() == cookie.name()
        && stored.domain() == cookie.domain()
        && stored.path() == cookie.path()
    })
  });
  let cookie = identity_match.as_ref().unwrap_or(cookie);
  // ...unchanged from here: build the soup::Cookie from `cookie` and call
  // WebKitCookieManager::delete_cookie as before.
}
```

If no cookie with that identity is currently stored, this falls back to the
caller-supplied cookie unchanged (matching prior behavior — a delete of an
already-absent cookie stays a harmless no-op). If one *is* stored, its value
came straight out of WebKit's own store, so it necessarily matches whatever
WebKit's equality check requires — this doesn't depend on knowing exactly
which fields that check inspects. The extra lookup is one more use of the
same blocking `gtk::main_iteration()`-pump pattern every other method in this
file already uses, so it doesn't introduce a new synchronization primitive.

### Upstreaming

Not webkitgtk-version-specific (reproduced on WebKitGTK 2.52.3 / libsoup3);
this is `webkit_cookie_manager_delete_cookie`'s documented-by-behavior
matching semantics, so the fix belongs in wry's webkitgtk backend for any
consumer, not just Murasaki. A ready-to-file PR — "fix(webkitgtk):
`delete_cookie` silently no-ops when the caller doesn't already know the
cookie's current value" — describes the same root cause, the minimal
repro, and this change.

Upstream PR: (to file — tauri-apps/wry)

## Scope

This vendored copy is otherwise identical to the published `wry` 0.55.1
crate. `examples/`, `renovate.json`, `rustfmt.toml`, `SECURITY.md`,
`MOBILE.md`, `Cargo.lock`, and `Cargo.toml.orig` were dropped to keep the
vendored tree minimal; none of them affect the build. `Cargo.toml`'s
`version` field is intentionally left at `0.55.1` so `[patch.crates-io]`
resolves against it.
