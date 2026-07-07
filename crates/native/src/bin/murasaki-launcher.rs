//! Entry point for the packaged app's `CFBundleExecutable` (macOS) /
//! `<productName>.exe` (Windows) — see `murasaki_native::launcher` for the
//! actual implementation.

// Windows only: builds this as a GUI-subsystem executable so launching it
// doesn't flash a console window behind the app (Cargo defaults binaries to
// the "console" subsystem otherwise). The `windows_subsystem` attribute is a
// no-op on non-Windows targets, so this doesn't need a `#[cfg]` guard.
#![windows_subsystem = "windows"]

fn main() {
  murasaki_native::run_launcher();
}
