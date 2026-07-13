//! `--apply-update` launcher mode — the Rust-side, "outlives the app
//! process" half of the auto-updater handshake (see the frozen contract,
//! §7/§8, for the design this implements).
//!
//! Node spawns this launcher binary, detached and unref'd, with
//! `--apply-update` and the argv contract below right after
//! `POST /__murasaki/update/install`. `run_launcher()` in `launcher.rs`
//! checks for this mode *before* creating any window/webview/event-loop —
//! this whole mode is headless: no window, no webview, stderr-only
//! diagnostics (see the `log!` macro below), because by the time this code
//! runs, the app that could have shown a UI has already quit.
//!
//! ```text
//! <launcher> --apply-update
//!            --payload   <abs path to the staged .app.zip or setup.exe>
//!            --sha256    <hex digest of the payload>
//!            --wait-pid  <pid of the launcher that is quitting>
//!            --target    <abs path: the .app bundle (macOS) | the install dir (Windows)>
//!            --relaunch  <abs path of the executable to launch when done>
//! ```
//!
//! Platform coverage matches the rest of the packaging story: macOS +
//! Windows only. Linux packaging doesn't exist in this repo (see
//! `bundle.ts` / `installer.ts`), so `--apply-update` there — and on any
//! other target — just logs an error and exits non-zero rather than
//! pretending to apply anything.

use std::{
  fs,
  io::{Read, Write},
  path::{Path, PathBuf},
  process::Command,
  time::Duration,
};

#[cfg(any(target_os = "macos", target_os = "windows"))]
use std::time::Instant;

/// Every diagnostic line this module prints is prefixed this way. This mode
/// runs headless (spawned detached by Node, no window/webview/console
/// necessarily attached), so stderr is the only channel a user — or a bug
/// report — will ever see for it.
macro_rules! log {
  ($($arg:tt)*) => {{
    let _ = writeln!(std::io::stderr(), "murasaki-apply: {}", format!($($arg)*));
  }};
}

/// Parsed form of the argv contract above.
struct ApplyArgs {
  payload: PathBuf,
  sha256: String,
  wait_pid: u32,
  target: PathBuf,
  relaunch: PathBuf,
  /// Windows-only re-exec guard — see `apply_windows`'s doc comment. Parsed
  /// unconditionally (harmless everywhere else) so argv parsing itself needs
  /// no `#[cfg]`.
  no_self_copy: bool,
}

/// Entry point called from `run_launcher()`, before any window/webview/event
/// loop is created. Returns `None` if `--apply-update` isn't present in
/// argv — the caller should proceed with the normal launch. Returns
/// `Some(exit_code)` if it is: the caller must exit with that code
/// immediately and must not fall through to the normal launch.
pub(crate) fn maybe_apply_update() -> Option<i32> {
  let raw_args: Vec<String> = std::env::args().collect();
  if !raw_args.iter().any(|a| a == "--apply-update") {
    return None;
  }

  log!("starting (pid {})", std::process::id());
  Some(run(&raw_args))
}

fn run(raw_args: &[String]) -> i32 {
  let args = match parse_args(raw_args) {
    Ok(a) => a,
    Err(e) => {
      log!("invalid arguments: {e}");
      return 1;
    }
  };

  match apply(&args, raw_args) {
    Ok(Outcome::ReExeced) => {
      // The re-exec'd copy (see `apply_windows`) runs this exact same
      // sequence again from the top and owns the relaunch step — nothing
      // left to do in *this* process.
      log!("handed off to a re-exec'd copy outside the target directory");
      0
    }
    Ok(Outcome::Applied) => match relaunch(&args.relaunch) {
      Ok(()) => {
        log!("relaunched {}, exiting", args.relaunch.display());
        0
      }
      Err(e) => {
        log!("update applied, but relaunch failed: {e}");
        1
      }
    },
    Err(e) => {
      log!("apply failed: {e}");
      1
    }
  }
}

fn parse_args(args: &[String]) -> Result<ApplyArgs, String> {
  let mut payload = None;
  let mut sha256 = None;
  let mut wait_pid = None;
  let mut target = None;
  let mut relaunch = None;
  let mut no_self_copy = false;

  let mut i = 0;
  while i < args.len() {
    match args[i].as_str() {
      "--payload" => {
        i += 1;
        payload = args.get(i).cloned();
      }
      "--sha256" => {
        i += 1;
        sha256 = args.get(i).cloned();
      }
      "--wait-pid" => {
        i += 1;
        wait_pid = args.get(i).and_then(|s| s.parse::<u32>().ok());
      }
      "--target" => {
        i += 1;
        target = args.get(i).cloned();
      }
      "--relaunch" => {
        i += 1;
        relaunch = args.get(i).cloned();
      }
      "--no-self-copy" => no_self_copy = true,
      _ => {}
    }
    i += 1;
  }

  Ok(ApplyArgs {
    payload: PathBuf::from(payload.ok_or("missing --payload")?),
    sha256: sha256.ok_or("missing --sha256")?,
    wait_pid: wait_pid.ok_or("missing or non-numeric --wait-pid")?,
    target: PathBuf::from(target.ok_or("missing --target")?),
    relaunch: PathBuf::from(relaunch.ok_or("missing --relaunch")?),
    no_self_copy,
  })
}

/// What `apply()` did — whether `run()` still owns the relaunch step, or
/// handed the rest of the sequence off to a re-exec'd copy of itself. See
/// `apply_windows`'s doc comment for why `ReExeced` exists; macOS's `apply`
/// always produces `Applied`.
enum Outcome {
  Applied,
  ReExeced,
}

/// Shared prelude for both real platforms: re-verify the hash, then wait for
/// the quitting launcher to actually exit — both *before* anything about the
/// install is touched. Contract §8.1/§8.2.
#[cfg(any(target_os = "macos", target_os = "windows"))]
fn verify_and_wait(args: &ApplyArgs) -> Result<(), String> {
  log!("verifying payload sha256: {}", args.payload.display());
  verify_sha256(&args.payload, &args.sha256)?;
  log!("sha256 verified");

  log!("waiting for pid {} to exit", args.wait_pid);
  if !wait_for_pid_exit(args.wait_pid, Duration::from_secs(30)) {
    return Err(format!("pid {} did not exit within 30s", args.wait_pid));
  }
  log!("pid {} has exited", args.wait_pid);

  Ok(())
}

#[cfg(target_os = "macos")]
fn apply(args: &ApplyArgs, _raw_args: &[String]) -> Result<Outcome, String> {
  verify_and_wait(args)?;
  apply_macos(args)?;
  Ok(Outcome::Applied)
}

#[cfg(target_os = "windows")]
fn apply(args: &ApplyArgs, raw_args: &[String]) -> Result<Outcome, String> {
  verify_and_wait(args)?;
  apply_windows(args, raw_args)
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn apply(_args: &ApplyArgs, _raw_args: &[String]) -> Result<Outcome, String> {
  Err(
    "apply-update is only supported on macOS and Windows — this platform \
     (Linux packaging does not exist in murasaki yet) is not supported"
      .to_string(),
  )
}

/// Re-verifies `payload`'s SHA-256 against `expected_hex` — the download was
/// already hashed once in Node, but this process is the one about to
/// overwrite the user's install, so it re-checks independently rather than
/// trusting the caller. Streams the file in chunks rather than reading it
/// whole, since payloads (a `.app.zip` or NSIS installer) can be sizeable.
#[cfg(any(target_os = "macos", target_os = "windows"))]
fn verify_sha256(payload: &Path, expected_hex: &str) -> Result<(), String> {
  use sha2::{Digest, Sha256};

  let mut file = fs::File::open(payload).map_err(|e| format!("open payload {}: {e}", payload.display()))?;
  let mut hasher = Sha256::new();
  let mut buf = [0u8; 64 * 1024];
  loop {
    let n = file
      .read(&mut buf)
      .map_err(|e| format!("read payload {}: {e}", payload.display()))?;
    if n == 0 {
      break;
    }
    hasher.update(&buf[..n]);
  }
  let actual: String = hasher.finalize().iter().map(|b| format!("{b:02x}")).collect();

  if !actual.eq_ignore_ascii_case(expected_hex) {
    return Err(format!(
      "sha256 mismatch for {}: expected {expected_hex}, got {actual}",
      payload.display()
    ));
  }
  Ok(())
}

/// Polls `pid_alive` until it reports the pid gone, or `timeout` elapses.
#[cfg(any(target_os = "macos", target_os = "windows"))]
fn wait_for_pid_exit(pid: u32, timeout: Duration) -> bool {
  let start = Instant::now();
  loop {
    if !pid_alive(pid) {
      return true;
    }
    if start.elapsed() >= timeout {
      return false;
    }
    std::thread::sleep(Duration::from_millis(200));
  }
}

/// `libc::kill(pid, 0)` sends no actual signal — it only asks the kernel
/// whether `pid` exists and is signalable, which is exactly a liveness
/// check. `ESRCH` ("no such process") means it's gone; any other outcome
/// (success, or an error like `EPERM` — exists but we lack permission to
/// signal it) means it's still alive.
#[cfg(target_os = "macos")]
fn pid_alive(pid: u32) -> bool {
  let ret = unsafe { libc::kill(pid as libc::pid_t, 0) };
  if ret == 0 {
    return true;
  }
  std::io::Error::last_os_error().raw_os_error() != Some(libc::ESRCH)
}

/// `OpenProcess` + `GetExitCodeProcess`: alive iff the handle opens AND its
/// exit code still reads `STILL_ACTIVE`. `PROCESS_QUERY_LIMITED_INFORMATION`
/// is the minimal access right `GetExitCodeProcess` needs.
#[cfg(target_os = "windows")]
fn pid_alive(pid: u32) -> bool {
  use windows::Win32::Foundation::{CloseHandle, STILL_ACTIVE};
  use windows::Win32::System::Threading::{GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};

  let Ok(handle) = (unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) }) else {
    // No such process (or no permission to even query it, which in practice
    // means it's gone — this pid is our own quitting launcher, same user).
    return false;
  };

  let mut exit_code: u32 = 0;
  let alive =
    unsafe { GetExitCodeProcess(handle, &mut exit_code) }.is_ok() && exit_code == STILL_ACTIVE.0 as u32;
  let _ = unsafe { CloseHandle(handle) };
  alive
}

/// macOS apply: `ditto -x -k <payload> <tmpdir>` → `mv <target> <target>.old`
/// → `mv <tmpdir>/<Name>.app <target>` → on success `rm -rf <target>.old`.
/// On any failure *after* the first `mv`, moves `.old` back before
/// returning — a failed update must never leave the user without an
/// installed app. Contract §8.3 (macOS).
/// Removes its directory when it goes out of scope, on every path out of
/// `apply_macos` — including the early `return Err(...)`s. Because staging now
/// happens inside the target's own directory (see below) rather than in
/// `$TMPDIR`, a leaked staging dir would be litter sitting in the user's
/// `/Applications` forever, with no OS-level tmp reaper to collect it.
#[cfg(target_os = "macos")]
struct StagingDir(PathBuf);

#[cfg(target_os = "macos")]
impl Drop for StagingDir {
  fn drop(&mut self) {
    let _ = fs::remove_dir_all(&self.0);
  }
}

#[cfg(target_os = "macos")]
fn apply_macos(args: &ApplyArgs) -> Result<(), String> {
  // Stage *next to* the target, not in $TMPDIR: `fs::rename` is a same-volume
  // operation and fails with EXDEV across volumes. $TMPDIR happens to share the
  // Data volume with /Applications on a stock macOS, but nothing guarantees it
  // (a target on an external disk, a relocated /Applications, a $TMPDIR
  // override). Staging in the target's own directory makes the swap rename
  // unconditionally same-volume.
  let staging_root = args
    .target
    .parent()
    .ok_or_else(|| "--target has no parent directory".to_string())?;
  let tmpdir = staging_root.join(format!(".murasaki-apply-{}", std::process::id()));
  // Best-effort: clear out a stale dir from a previous aborted attempt with
  // the same pid (unlikely, but pids do get reused) before extracting into it.
  let _ = fs::remove_dir_all(&tmpdir);
  fs::create_dir_all(&tmpdir).map_err(|e| format!("create staging dir {}: {e}", tmpdir.display()))?;
  let tmpdir = StagingDir(tmpdir);
  let tmpdir = &tmpdir.0;

  log!(
    "extracting payload: ditto -x -k {} {}",
    args.payload.display(),
    tmpdir.display()
  );
  let status = Command::new("ditto")
    .arg("-x")
    .arg("-k")
    .arg(&args.payload)
    .arg(&tmpdir)
    .status()
    .map_err(|e| format!("spawn ditto: {e}"))?;
  if !status.success() {
    return Err(format!("ditto extract failed with status {status}"));
  }

  let app_name = args
    .target
    .file_name()
    .ok_or_else(|| "--target has no file name".to_string())?;
  let extracted_app = tmpdir.join(app_name);
  if !extracted_app.exists() {
    return Err(format!(
      "extracted payload does not contain {} (looked for {})",
      app_name.to_string_lossy(),
      extracted_app.display()
    ));
  }

  let mut backup_os = args.target.as_os_str().to_os_string();
  backup_os.push(".old");
  let backup = PathBuf::from(backup_os);

  // Best-effort: clear out a stale backup left behind by a previous
  // failed/aborted update before this path is needed for the real one below.
  if backup.exists() {
    let _ = fs::remove_dir_all(&backup);
  }

  log!(
    "backing up current install: {} -> {}",
    args.target.display(),
    backup.display()
  );
  fs::rename(&args.target, &backup)
    .map_err(|e| format!("backup rename {} -> {}: {e}", args.target.display(), backup.display()))?;

  log!(
    "installing new version: {} -> {}",
    extracted_app.display(),
    args.target.display()
  );
  if let Err(e) = fs::rename(&extracted_app, &args.target) {
    log!("install failed ({e}); restoring backup from {}", backup.display());
    if let Err(restore_err) = fs::rename(&backup, &args.target) {
      // The one outcome this whole dance exists to avoid — surface it as
      // loudly as this headless process can. The user is left with neither
      // a working `target` nor an intact `backup` at its expected path, but
      // the backup's *contents* should still be sitting at `backup`.
      log!(
        "CRITICAL: failed to restore backup after a failed install: {restore_err} \
         — the previous install may still be recoverable at {}",
        backup.display()
      );
    }
    return Err(format!(
      "install rename {} -> {}: {e}",
      extracted_app.display(),
      args.target.display()
    ));
  }

  log!("install succeeded, removing backup: {}", backup.display());
  let _ = fs::remove_dir_all(&backup);
  let _ = fs::remove_dir_all(&tmpdir);

  Ok(())
}

/// Windows apply. Contract §8.3 (Windows):
///
/// A running `.exe` can't be overwritten on Windows, and the NSIS installer
/// (`<payload> /S` below) will try to overwrite exactly this file if it's
/// still executing out of the install directory — so when `current_exe()`
/// lives inside `--target`, this copies itself out to
/// `%TEMP%\murasaki-apply-<pid>.exe`, re-execs there with the same argv plus
/// `--no-self-copy`, and returns `Outcome::ReExeced` immediately without
/// waiting for that copy (per §8: "exit immediately"). The re-exec'd copy
/// runs this entire module from the top again — re-verifying the hash and
/// re-checking `--wait-pid` is redundant there (the original launcher is
/// already gone) but harmless, and keeps this one code path serving both the
/// "already outside target" and "hopped outside target" cases identically.
/// `--no-self-copy` guarantees that second run doesn't try to hop out again.
#[cfg(target_os = "windows")]
fn apply_windows(args: &ApplyArgs, raw_args: &[String]) -> Result<Outcome, String> {
  // For `/D=` below: NSIS requires it unquoted, which `arg()` won't do.
  use std::os::windows::process::CommandExt;

  let current_exe = std::env::current_exe().map_err(|e| format!("current_exe: {e}"))?;

  if !args.no_self_copy && current_exe.starts_with(&args.target) {
    let temp_copy = std::env::temp_dir().join(format!("murasaki-apply-{}.exe", std::process::id()));
    log!(
      "self ({}) is inside target dir; copying to {}",
      current_exe.display(),
      temp_copy.display()
    );
    fs::copy(&current_exe, &temp_copy).map_err(|e| format!("copy self to {}: {e}", temp_copy.display()))?;

    // Same argv this process was given (minus argv[0]), plus `--no-self-copy`.
    let mut next_args: Vec<String> = raw_args.iter().skip(1).cloned().collect();
    next_args.push("--no-self-copy".to_string());

    log!("re-exec'ing {} {:?}", temp_copy.display(), next_args);
    Command::new(&temp_copy)
      .args(&next_args)
      .spawn()
      .map_err(|e| format!("spawn {}: {e}", temp_copy.display()))?;

    return Ok(Outcome::ReExeced);
  }

  // `/S` alone would install to the *script's* InstallDir — `$LOCALAPPDATA\
  // Programs\<name>` — no matter where this copy actually lives. Our installer
  // offers a directory page, so anyone who changed it would have the update
  // land in the default location while `--relaunch` restarted the old,
  // untouched exe still sitting in their chosen directory: an update that
  // silently didn't happen, plus a second install. `/D=` pins the silent
  // install to where we're actually running from.
  //
  // NSIS parses `/D=` itself, and it is picky: it must be the LAST parameter
  // and it must NOT be quoted, even when the path contains spaces. `arg()`
  // would quote it, so this goes through `raw_arg` verbatim.
  let target = args.target.display().to_string();
  log!(
    "running installer silently: {} /S /D={}",
    args.payload.display(),
    target
  );
  let status = Command::new(&args.payload)
    .arg("/S")
    .raw_arg(format!("/D={target}"))
    .status()
    .map_err(|e| format!("spawn installer {}: {e}", args.payload.display()))?;
  if !status.success() {
    return Err(format!(
      "installer {} exited with status {status}",
      args.payload.display()
    ));
  }

  Ok(Outcome::Applied)
}

/// Relaunches the freshly-installed app. Contract §8.4: macOS uses
/// `open -a <relaunch>` (the app was just replaced in place, so `open`
/// resolves it directly); Windows spawns the exe, which — like every
/// `std::process::Command` child — already outlives this short-lived apply
/// process without any extra detachment flag.
#[cfg(target_os = "macos")]
fn relaunch(target: &Path) -> Result<(), String> {
  log!("relaunching: open -a {}", target.display());
  let status = Command::new("open")
    .arg("-a")
    .arg(target)
    .status()
    .map_err(|e| format!("spawn `open -a {}`: {e}", target.display()))?;
  if !status.success() {
    return Err(format!("`open -a {}` exited with status {status}", target.display()));
  }
  Ok(())
}

#[cfg(target_os = "windows")]
fn relaunch(target: &Path) -> Result<(), String> {
  log!("relaunching: {}", target.display());
  Command::new(target)
    .spawn()
    .map_err(|e| format!("spawn {}: {e}", target.display()))?;
  Ok(())
}

/// Unreachable in practice — `apply()` on this platform always returns
/// `Err` before `run()` would ever call this — kept only so `run()` doesn't
/// need its own per-platform `#[cfg]` around the relaunch step.
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn relaunch(_target: &Path) -> Result<(), String> {
  Err("relaunch is only supported on macOS and Windows".to_string())
}
