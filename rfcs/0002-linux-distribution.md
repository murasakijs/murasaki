# RFC 0002 — Linux Distribution Plan

- Status: Draft (authored 2026-07-17)
- Depends on: none for L1; B1 updater-hardening merge for L2 (installer.ts overlap)
- Target: begins in 0.x, ships as `linux-distribution` feature; never blocks 1.0 (RFC 0001)

## Phasing

### L1 — Native runtime parity (crates/native)

All chosen upstream crates already support Linux; the gaps are murasaki's own
`cfg` gates and missing wiring.

| Gap | Implementation | Notes |
| --- | --- | --- |
| Context menu | `muda::ContextMenu::show_context_menu_for_gtk_window` via `tao::platform::unix::WindowExtUnix::gtk_window()` | replaces the explicit "not yet implemented" error in `webview.rs` |
| App menu bar | `muda` `init_for_gtk_window` with tao's `default_vbox()` | adds the missing Linux branch beside `application.rs`'s macos/windows ones |
| Tray click/menu events | extend `poll_tray_events` cfg to Linux | tray-icon uses libappindicator; document appindicator extension requirement on GNOME |
| Global shortcuts | lift the macOS/Windows-only guard in `global_shortcut.rs` | global-hotkey is X11-only — return a structured `unsupported` error under Wayland (detect `WAYLAND_DISPLAY` w/o XWayland) and document |
| Secure storage | new backend via `secret-service` (zbus, pure Rust) | keep the invariant: if DBus/secret service is absent → error, **never plaintext**; same hashed service/account namespacing |
| system-permissions | stays `unsupported` returns | matches platform reality |

Build/test in Docker (`ubuntu:22.04` + `libwebkit2gtk-4.1-dev libgtk-3-dev
libappindicator3-dev squashfs-tools xvfb`); `cargo test` for logic, `xvfb-run`
for a launch smoke.

### L2 — Launcher + packaging

1. **`launcher.rs` `imp_linux`** mirroring `imp_macos` structure: file-lock
   single instance + loopback activation, prod-server spawn, graceful
   shutdown, `Event::Opened` synthesis from argv (`%u`/`%f` from .desktop).
2. **`bundle.ts` linux target** → AppDir layout (`usr/bin/<launcher>`,
   `usr/lib/<app>/resources`, hicolor icons, generated `.desktop` with
   `MimeType=` entries for declared protocols/file associations) →
   **AppImage** assembled with `mksquashfs` + prepended AppImage runtime
   (the pre-rewrite `appimage.ts` in PROTECTED.md §4 is the reference —
   re-home, don't rewrite).
3. **`installer.ts` linux target** → **.deb** constructed with a pure-Node
   ar/tar writer (no dpkg-deb dependency; deterministic, cross-buildable from
   macOS/CI). Control fields from murasaki.config; postinst/postrm update
   desktop + icon caches. `rpm` explicitly deferred.
4. **Updates:** AppImage builds self-update via the existing journaled
   swap engine (payload = new .AppImage; detect via `$APPIMAGE`). .deb
   installs are package-manager-owned → updater disabled with a structured
   reason. `release.ts` manifest gains `linux-x64` / `linux-arm64` AppImage
   payload keys.
5. **CI:** extend `ci.yml` linux job with a bundle smoke; new
   `app-package-linux.yml` running install → xvfb launch → update → uninstall,
   ubuntu-22.04 + ubuntu-22.04-arm.

### L3 — Manifest + docs

`capabilities.json`: flip per-feature `linux` values as each lands
(`development-only` → `supported`/`partial`); `linux-distribution` feature
`planned` → `partial` at AppImage, → `supported` at AppImage+deb+updates.
Docs: distribution guide gains a Linux section (en/ja); README platform table
updated. No overclaiming: GNOME tray caveat, Wayland shortcut caveat, deb
no-self-update are limitations text, not footnotes.

## Sequencing constraints

- L1 runs on the `feat/native-expansion` branch **after** A3/A2/A1 merge
  (same-file: webview.rs, application.rs).
- L2's installer.ts edits conflict with B1's NSIS renaming — L2 starts after
  Wave 1 integration.
- Docker is the local verification loop; GitHub Actions ubuntu runners are the
  source of truth.
