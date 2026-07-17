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
    #[cfg_attr(not(target_os = "windows"), allow(dead_code))]
    no_self_copy: bool,
}

struct RecoveryArgs {
    wait_pid: u32,
    attempt_pid: u32,
    target: PathBuf,
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

/// Headless recovery mode used when the first launch of a newly installed
/// version never reached the launcher's health checkpoint. The normal
/// launcher copies itself outside the install target before spawning this
/// mode, so Windows can replace its install directory and macOS can replace
/// the running `.app` bundle after the failed launcher exits.
pub(crate) fn maybe_recover_update() -> Option<i32> {
    let raw_args: Vec<String> = std::env::args().collect();
    if !raw_args.iter().any(|a| a == "--recover-update") {
        return None;
    }

    log!("starting recovery (pid {})", std::process::id());
    Some(run_recovery(&raw_args))
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
        Ok(Outcome::Applied(mut transaction)) => {
            match relaunch(&args.relaunch) {
                Ok(()) => {
                    // The new launcher owns the health acknowledgement. Keep the backup
                    // and journal until Node startup plus all create-on-launch
                    // windows/webviews have initialized successfully.
                    transaction.retain_for_health_ack();
                    log!(
                        "relaunched {}; awaiting startup health acknowledgement",
                        args.relaunch.display()
                    );
                    0
                }
                Err(e) => {
                    match transaction.rollback() {
            Ok(()) => log!("relaunch failed ({e}); restored the previous install"),
            Err(restore_err) => log!(
              "CRITICAL: relaunch failed ({e}) and restoring the previous install failed: {restore_err}"
            ),
          }
                    1
                }
            }
        }
        Err(e) => {
            log!("apply failed: {e}");
            1
        }
    }
}

fn parse_recovery_args(args: &[String]) -> Result<RecoveryArgs, String> {
    let mut wait_pid = None;
    let mut attempt_pid = None;
    let mut target = None;
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--wait-pid" => {
                i += 1;
                wait_pid = args.get(i).and_then(|value| value.parse::<u32>().ok());
            }
            "--target" => {
                i += 1;
                target = args.get(i).cloned();
            }
            "--attempt-pid" => {
                i += 1;
                attempt_pid = args.get(i).and_then(|value| value.parse::<u32>().ok());
            }
            _ => {}
        }
        i += 1;
    }
    let target = PathBuf::from(target.ok_or("missing --target")?);
    if !target.is_absolute() {
        return Err("--target must be absolute".to_string());
    }
    Ok(RecoveryArgs {
        wait_pid: wait_pid
            .filter(|pid| *pid != 0)
            .ok_or("missing or non-numeric --wait-pid")?,
        attempt_pid: attempt_pid
            .filter(|pid| *pid != 0)
            .ok_or("missing or non-numeric --attempt-pid")?,
        target,
    })
}

fn run_recovery(raw_args: &[String]) -> i32 {
    let args = match parse_recovery_args(raw_args) {
        Ok(args) => args,
        Err(error) => {
            log!("invalid recovery arguments: {error}");
            return 1;
        }
    };

    #[cfg(any(target_os = "macos", target_os = "windows"))]
    {
        if !wait_for_pid_exit(args.wait_pid, Duration::from_secs(30)) {
            log!(
                "failed launcher pid {} did not exit within 30s",
                args.wait_pid
            );
            return 1;
        }
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = &args;
        log!("update recovery is only supported on macOS and Windows");
        return 1;
    }

    match restore_attempted_update(&args.target, args.attempt_pid) {
        Ok(relaunch_path) => match relaunch(&relaunch_path) {
            Ok(()) => {
                log!("restored and relaunched {}", relaunch_path.display());
                0
            }
            Err(error) => {
                log!("previous install was restored, but relaunch failed: {error}");
                1
            }
        },
        Err(error) => {
            log!("recovery failed: {error}");
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
    Applied(InstallTransaction),
    #[cfg_attr(not(target_os = "windows"), allow(dead_code))]
    ReExeced,
}

/// Filesystem transaction shared by macOS `.app` replacement and Windows
/// install-directory replacement. The verified payload is installed only
/// after the current target has been renamed to a same-volume sibling.
/// Until the relaunched app acknowledges its startup health checkpoint,
/// every error path can remove a partial target and atomically rename the
/// backup back into place.
struct InstallTransaction {
    target: PathBuf,
    backup: PathBuf,
    active: bool,
}

const UPDATE_JOURNAL_VERSION: u8 = 1;

#[derive(Clone, Debug, serde::Deserialize, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct UpdateJournal {
    version: u8,
    state: UpdateJournalState,
    backup_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    relaunch_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    helper_pid: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    attempt_pid: Option<u32>,
}

#[derive(Clone, Copy, Debug, serde::Deserialize, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
enum UpdateJournalState {
    Installing,
    AwaitingHealth,
    Attempted,
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum StartupUpdateAction {
    None,
    ExitForUpdateInProgress,
    ContinueHealthAttempt,
    RecoveryRequired { relaunch: PathBuf, failed_pid: u32 },
}

impl InstallTransaction {
    fn begin(target: &Path, relaunch: &Path) -> Result<Self, String> {
        if !target.exists() {
            return Err(format!(
                "current install does not exist: {}",
                target.display()
            ));
        }
        let backup = available_backup_path(target)?;
        let mut transaction = Self {
            target: target.to_path_buf(),
            backup,
            active: false,
        };
        // Persist the rollback coordinates before the first destructive rename.
        // If this helper dies after the swap, the next launcher can still locate
        // the old install instead of accepting an unacknowledged update.
        if let Err(error) = transaction.write_installing_journal(relaunch) {
            if let Ok(path) = journal_lock_path_for(target) {
                let _ = remove_path_if_exists(&path);
            }
            return Err(error);
        }
        if let Err(error) = fs::rename(target, &transaction.backup) {
            if let Ok(path) = journal_path_for(target) {
                let _ = remove_path_if_exists(&path);
            }
            if let Ok(path) = journal_lock_path_for(target) {
                let _ = remove_path_if_exists(&path);
            }
            return Err(format!(
                "backup rename {} -> {}: {error}",
                target.display(),
                transaction.backup.display()
            ));
        }
        transaction.active = true;
        Ok(transaction)
    }

    fn install_from(&mut self, replacement: &Path) -> Result<(), String> {
        if let Err(error) = fs::rename(replacement, &self.target) {
            let install_error = format!(
                "install rename {} -> {}: {error}",
                replacement.display(),
                self.target.display(),
            );
            return match self.rollback() {
                Ok(()) => Err(install_error),
                Err(restore_error) => {
                    Err(format!("{install_error}; restore failed: {restore_error}"))
                }
            };
        }
        Ok(())
    }

    fn rollback(&mut self) -> Result<(), String> {
        if !self.active {
            return Ok(());
        }
        remove_path_if_exists(&self.target)?;
        fs::rename(&self.backup, &self.target).map_err(|e| {
            format!(
                "restore rename {} -> {}: {e}",
                self.backup.display(),
                self.target.display(),
            )
        })?;
        // Disarm immediately after the old install is back in place. Cleanup of
        // sibling metadata must never make Drop retry by deleting that restored
        // target when the backup has already been consumed.
        self.active = false;
        if let Ok(path) = journal_path_for(&self.target) {
            let _ = remove_path_if_exists(&path);
        }
        if let Ok(path) = journal_lock_path_for(&self.target) {
            let _ = remove_path_if_exists(&path);
        }
        Ok(())
    }

    fn write_installing_journal(&self, relaunch: &Path) -> Result<(), String> {
        let _lock = acquire_journal_lock(&self.target)?;
        let backup_name = self
            .backup
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(|| "backup path has no UTF-8 file name".to_string())?;
        let relaunch_name = if relaunch == self.target {
            None
        } else {
            let relative = relaunch
                .strip_prefix(&self.target)
                .map_err(|_| "relaunch path must be the target or its direct child".to_string())?;
            Some(single_component(relative, "relaunch path")?.to_string())
        };
        let journal = UpdateJournal {
            version: UPDATE_JOURNAL_VERSION,
            state: UpdateJournalState::Installing,
            backup_name: backup_name.to_string(),
            relaunch_name,
            helper_pid: Some(std::process::id()),
            attempt_pid: None,
        };
        write_journal(&self.target, &journal)
    }

    fn mark_awaiting_health(&self) -> Result<(), String> {
        let _lock = acquire_journal_lock(&self.target)?;
        let mut journal = read_journal(&self.target)?
            .ok_or_else(|| "install journal disappeared before relaunch".to_string())?;
        if journal.state != UpdateJournalState::Installing
            || journal.helper_pid != Some(std::process::id())
        {
            return Err("install journal is not owned by this update helper".to_string());
        }
        journal.state = UpdateJournalState::AwaitingHealth;
        journal.helper_pid = None;
        write_journal(&self.target, &journal)
    }

    fn retain_for_health_ack(&mut self) {
        self.active = false;
    }
}

impl Drop for InstallTransaction {
    fn drop(&mut self) {
        if self.active {
            if let Err(error) = self.rollback() {
                log!(
          "CRITICAL: automatic update rollback failed: {error}; previous install may remain at {}",
          self.backup.display(),
        );
            }
        }
    }
}

fn available_backup_path(target: &Path) -> Result<PathBuf, String> {
    let parent = target
        .parent()
        .ok_or_else(|| "--target has no parent directory".to_string())?;
    let name = target
        .file_name()
        .ok_or_else(|| "--target has no file name".to_string())?;
    let name = name.to_string_lossy();
    for attempt in 0..1_000u16 {
        let suffix = if attempt == 0 {
            String::new()
        } else {
            format!("-{attempt}")
        };
        let candidate = parent.join(format!(
            ".{name}.murasaki-backup-{}{suffix}",
            std::process::id(),
        ));
        if !candidate.exists() {
            return Ok(candidate);
        }
    }
    Err(format!(
        "could not allocate a backup path next to {}",
        target.display()
    ))
}

fn remove_path_if_exists(path: &Path) -> Result<(), String> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(format!("inspect {}: {error}", path.display())),
    };
    if metadata.is_dir() && !metadata.file_type().is_symlink() {
        fs::remove_dir_all(path).map_err(|e| format!("remove directory {}: {e}", path.display()))
    } else {
        fs::remove_file(path).map_err(|e| format!("remove file {}: {e}", path.display()))
    }
}

fn single_component<'a>(path: &'a Path, description: &str) -> Result<&'a str, String> {
    let mut components = path.components();
    let Some(std::path::Component::Normal(component)) = components.next() else {
        return Err(format!(
            "{description} must contain exactly one normal path component"
        ));
    };
    if components.next().is_some() {
        return Err(format!(
            "{description} must contain exactly one normal path component"
        ));
    }
    component
        .to_str()
        .ok_or_else(|| format!("{description} must be valid UTF-8"))
}

fn journal_path_for(target: &Path) -> Result<PathBuf, String> {
    let parent = target
        .parent()
        .ok_or_else(|| "update target has no parent directory".to_string())?;
    let name = target
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "update target has no UTF-8 file name".to_string())?;
    Ok(parent.join(format!(".{name}.murasaki-update.json")))
}

fn journal_lock_path_for(target: &Path) -> Result<PathBuf, String> {
    let parent = target
        .parent()
        .ok_or_else(|| "update target has no parent directory".to_string())?;
    let name = target
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "update target has no UTF-8 file name".to_string())?;
    Ok(parent.join(format!(".{name}.murasaki-update.lock")))
}

fn acquire_journal_lock(target: &Path) -> Result<fs::File, String> {
    use fs2::FileExt;
    let path = journal_lock_path_for(target)?;
    let mut options = fs::OpenOptions::new();
    options.create(true).read(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let file = options
        .open(&path)
        .map_err(|error| format!("open update journal lock {}: {error}", path.display()))?;
    file.lock_exclusive()
        .map_err(|error| format!("lock update journal {}: {error}", path.display()))?;
    Ok(file)
}

fn validate_journal(target: &Path, journal: &UpdateJournal) -> Result<(PathBuf, PathBuf), String> {
    if journal.version != UPDATE_JOURNAL_VERSION {
        return Err(format!(
            "unsupported update journal version {}",
            journal.version
        ));
    }
    match journal.state {
        UpdateJournalState::Installing
            if matches!(journal.helper_pid, None | Some(0)) || journal.attempt_pid.is_some() =>
        {
            return Err("installing journal requires helperPid and no attemptPid".to_string());
        }
        UpdateJournalState::AwaitingHealth
            if journal.helper_pid.is_some() || journal.attempt_pid.is_some() =>
        {
            return Err("awaiting-health journal must not contain a process id".to_string());
        }
        UpdateJournalState::Attempted
            if journal.helper_pid.is_some() || matches!(journal.attempt_pid, None | Some(0)) =>
        {
            return Err("attempted journal requires attemptPid and no helperPid".to_string());
        }
        _ => {}
    }

    let backup_name = single_component(Path::new(&journal.backup_name), "backupName")?;
    let target_name = target
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "update target has no UTF-8 file name".to_string())?;
    let expected_prefix = format!(".{target_name}.murasaki-backup-");
    if !backup_name.starts_with(&expected_prefix) {
        return Err("backupName is outside this app's update namespace".to_string());
    }
    let parent = target
        .parent()
        .ok_or_else(|| "update target has no parent directory".to_string())?;
    let backup = parent.join(backup_name);
    let relaunch = match journal.relaunch_name.as_deref() {
        None => target.to_path_buf(),
        Some(name) => target.join(single_component(Path::new(name), "relaunchName")?),
    };
    Ok((backup, relaunch))
}

fn read_journal(target: &Path) -> Result<Option<UpdateJournal>, String> {
    let path = journal_path_for(target)?;
    let raw = match fs::read_to_string(&path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("read update journal {}: {error}", path.display())),
    };
    let journal: UpdateJournal = serde_json::from_str(&raw)
        .map_err(|error| format!("parse update journal {}: {error}", path.display()))?;
    validate_journal(target, &journal)?;
    Ok(Some(journal))
}

fn write_journal(target: &Path, journal: &UpdateJournal) -> Result<(), String> {
    validate_journal(target, journal)?;
    let path = journal_path_for(target)?;
    let temp = path.with_extension(format!("tmp-{}", std::process::id()));
    let bytes = serde_json::to_vec(journal)
        .map_err(|error| format!("serialize update journal: {error}"))?;
    let _ = remove_path_if_exists(&temp);

    let mut options = fs::OpenOptions::new();
    options.create_new(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(&temp)
        .map_err(|error| format!("create update journal {}: {error}", temp.display()))?;
    if let Err(error) = file.write_all(&bytes).and_then(|_| file.sync_all()) {
        let _ = fs::remove_file(&temp);
        return Err(format!("write update journal {}: {error}", temp.display()));
    }
    atomic_replace_file(&temp, &path).map_err(|error| {
        let _ = fs::remove_file(&temp);
        format!("publish update journal {}: {error}", path.display())
    })
}

#[cfg(not(target_os = "windows"))]
fn atomic_replace_file(source: &Path, destination: &Path) -> std::io::Result<()> {
    fs::rename(source, destination)
}

#[cfg(target_os = "windows")]
fn atomic_replace_file(source: &Path, destination: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    const MOVEFILE_REPLACE_EXISTING: u32 = 0x1;
    const MOVEFILE_WRITE_THROUGH: u32 = 0x8;
    #[link(name = "Kernel32")]
    unsafe extern "system" {
        fn MoveFileExW(existing: *const u16, new_name: *const u16, flags: u32) -> i32;
    }
    let existing: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
    let new_name: Vec<u16> = destination
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect();
    // SAFETY: both pointers reference live, NUL-terminated UTF-16 buffers for
    // the duration of the call. The destination is an app-scoped journal path.
    let replaced = unsafe {
        MoveFileExW(
            existing.as_ptr(),
            new_name.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if replaced == 0 {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}

fn restore_attempted_update(target: &Path, expected_pid: u32) -> Result<PathBuf, String> {
    let lock = acquire_journal_lock(target)?;
    let journal = read_journal(target)?
        .ok_or_else(|| "update journal disappeared before recovery".to_string())?;
    let recorded_pid = match journal.state {
        UpdateJournalState::Installing => journal.helper_pid,
        UpdateJournalState::Attempted => journal.attempt_pid,
        UpdateJournalState::AwaitingHealth => None,
    };
    if recorded_pid != Some(expected_pid) {
        return Err("update journal no longer belongs to the failed launcher".to_string());
    }
    let (backup, relaunch) = validate_journal(target, &journal)?;
    if !backup.exists() {
        return Err(format!("update backup is missing: {}", backup.display()));
    }

    remove_path_if_exists(target)?;
    fs::rename(&backup, target).map_err(|error| {
        format!(
            "restore rename {} -> {}: {error}",
            backup.display(),
            target.display()
        )
    })?;
    remove_path_if_exists(&journal_path_for(target)?)?;
    drop(lock);
    let _ = remove_path_if_exists(&journal_lock_path_for(target)?);
    Ok(relaunch)
}

/// Starts a recovery executable outside the install target. The caller must
/// exit immediately after this succeeds so the helper can restore the old
/// directory/bundle without replacing files that are still in use.
pub(crate) fn spawn_recovery_helper(target: &Path, failed_pid: u32) -> Result<(), String> {
    if !target.is_absolute() {
        return Err("update recovery target must be absolute".to_string());
    }
    let current_exe = std::env::current_exe().map_err(|error| format!("current_exe: {error}"))?;
    let extension = if cfg!(target_os = "windows") {
        ".exe"
    } else {
        ""
    };
    let temp_copy = std::env::temp_dir().join(format!(
        "murasaki-recover-{failed_pid}-{}{}",
        std::process::id(),
        extension,
    ));
    let _ = remove_path_if_exists(&temp_copy);
    fs::copy(&current_exe, &temp_copy)
        .map_err(|error| format!("copy recovery helper to {}: {error}", temp_copy.display()))?;
    Command::new(&temp_copy)
        .arg("--recover-update")
        .arg("--target")
        .arg(target)
        .arg("--wait-pid")
        .arg(std::process::id().to_string())
        .arg("--attempt-pid")
        .arg(failed_pid.to_string())
        .spawn()
        .map_err(|error| format!("spawn recovery helper {}: {error}", temp_copy.display()))?;
    Ok(())
}

pub(crate) fn prepare_startup_update(target: &Path) -> Result<StartupUpdateAction, String> {
    if !journal_path_for(target)?.exists() {
        return Ok(StartupUpdateAction::None);
    }
    let _lock = acquire_journal_lock(target)?;
    let Some(mut journal) = read_journal(target)? else {
        return Ok(StartupUpdateAction::None);
    };
    let (backup, relaunch) = validate_journal(target, &journal)?;
    if journal.state != UpdateJournalState::Installing && !backup.exists() {
        return Err(format!("update backup is missing: {}", backup.display()));
    }

    match journal.state {
        UpdateJournalState::Installing => {
            let pid = journal.helper_pid.expect("validated helper pid");
            if pid_alive_for_journal(pid) {
                return Ok(StartupUpdateAction::ExitForUpdateInProgress);
            }
            if backup.exists() {
                Ok(StartupUpdateAction::RecoveryRequired {
                    relaunch,
                    failed_pid: pid,
                })
            } else {
                // The helper died before the first rename, so the target is still the
                // old, known-good install. Clear the preflight journal and continue.
                remove_path_if_exists(&journal_path_for(target)?)?;
                Ok(StartupUpdateAction::None)
            }
        }
        UpdateJournalState::AwaitingHealth => {
            journal.state = UpdateJournalState::Attempted;
            journal.attempt_pid = Some(std::process::id());
            write_journal(target, &journal)?;
            Ok(StartupUpdateAction::ContinueHealthAttempt)
        }
        UpdateJournalState::Attempted => {
            let pid = journal.attempt_pid.expect("validated attempt pid");
            if pid == std::process::id() {
                Ok(StartupUpdateAction::ContinueHealthAttempt)
            } else if wait_for_attempt_exit(pid) {
                Ok(StartupUpdateAction::RecoveryRequired {
                    relaunch,
                    failed_pid: pid,
                })
            } else {
                // A second launch can race the failed launcher's final process
                // teardown (notably when LaunchServices is reaping it on
                // macOS). It must not continue as another health attempt or
                // enter single-instance activation with stale loopback state.
                Ok(StartupUpdateAction::ExitForUpdateInProgress)
            }
        }
    }
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn wait_for_attempt_exit(pid: u32) -> bool {
    wait_for_pid_exit(pid, Duration::from_secs(2))
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn wait_for_attempt_exit(pid: u32) -> bool {
    !pid_alive_for_journal(pid)
}

pub(crate) fn acknowledge_update_health(target: &Path) -> Result<(), String> {
    if !journal_path_for(target)?.exists() {
        return Ok(());
    }
    let lock = acquire_journal_lock(target)?;
    let Some(journal) = read_journal(target)? else {
        return Ok(());
    };
    if journal.state != UpdateJournalState::Attempted
        || journal.attempt_pid != Some(std::process::id())
    {
        return Ok(());
    }
    let (backup, _) = validate_journal(target, &journal)?;
    // Journal first: after this point a cleanup failure leaves only an inert
    // sibling backup and can never roll a healthy app back on a later launch.
    remove_path_if_exists(&journal_path_for(target)?)?;
    remove_path_if_exists(&backup)
        .map_err(|error| format!("health acknowledged but backup cleanup failed: {error}"))?;
    drop(lock);
    let _ = remove_path_if_exists(&journal_lock_path_for(target)?);
    Ok(())
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn pid_alive_for_journal(pid: u32) -> bool {
    pid_alive(pid)
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn pid_alive_for_journal(_pid: u32) -> bool {
    false
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
    apply_macos(args).map(Outcome::Applied)
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

    let mut file =
        fs::File::open(payload).map_err(|e| format!("open payload {}: {e}", payload.display()))?;
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
    let actual: String = hasher
        .finalize()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();

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
    let Ok(pid) = libc::pid_t::try_from(pid) else {
        return false;
    };
    let ret = unsafe { libc::kill(pid, 0) };
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
    use windows::Win32::System::Threading::{
        GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
    };

    let Ok(handle) = (unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) }) else {
        // No such process (or no permission to even query it, which in practice
        // means it's gone — this pid is our own quitting launcher, same user).
        return false;
    };

    let mut exit_code: u32 = 0;
    let alive = unsafe { GetExitCodeProcess(handle, &mut exit_code) }.is_ok()
        && exit_code == STILL_ACTIVE.0 as u32;
    let _ = unsafe { CloseHandle(handle) };
    alive
}

/// macOS apply: `ditto -x -k <payload> <tmpdir>` → rename the current target
/// to a unique same-volume backup → rename the staged app into place. The
/// backup stays live until the new launcher acknowledges Node + window/WebView
/// startup; install, relaunch, or first-start failure restores it. Contract
/// §8.3/§8.4.
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
fn apply_macos(args: &ApplyArgs) -> Result<InstallTransaction, String> {
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
    fs::create_dir_all(&tmpdir)
        .map_err(|e| format!("create staging dir {}: {e}", tmpdir.display()))?;
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
        .arg(tmpdir)
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

    let mut transaction = InstallTransaction::begin(&args.target, &args.relaunch)?;
    log!(
        "backed up current install to {}",
        transaction.backup.display()
    );

    log!(
        "installing new version: {} -> {}",
        extracted_app.display(),
        args.target.display()
    );
    transaction.install_from(&extracted_app)?;
    transaction.mark_awaiting_health()?;
    log!(
        "install succeeded; retaining backup until startup health acknowledgement: {}",
        transaction.backup.display(),
    );

    Ok(transaction)
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
/// Once outside the target, the whole install directory is renamed to a
/// same-volume backup before NSIS runs. Installer, relaunch, or first-start
/// failure removes the partial new directory and restores that backup.
#[cfg(target_os = "windows")]
fn apply_windows(args: &ApplyArgs, raw_args: &[String]) -> Result<Outcome, String> {
    // For `/D=` below: NSIS requires it unquoted, which `arg()` won't do.
    use std::os::windows::process::CommandExt;

    let current_exe = std::env::current_exe().map_err(|e| format!("current_exe: {e}"))?;

    if !args.no_self_copy && current_exe.starts_with(&args.target) {
        let temp_copy =
            std::env::temp_dir().join(format!("murasaki-apply-{}.exe", std::process::id()));
        log!(
            "self ({}) is inside target dir; copying to {}",
            current_exe.display(),
            temp_copy.display()
        );
        fs::copy(&current_exe, &temp_copy)
            .map_err(|e| format!("copy self to {}: {e}", temp_copy.display()))?;

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
    let mut transaction = InstallTransaction::begin(&args.target, &args.relaunch)?;
    log!(
        "backed up current install to {}",
        transaction.backup.display()
    );

    let status = match Command::new(&args.payload)
        .arg("/S")
        .raw_arg(format!("/D={target}"))
        .status()
    {
        Ok(status) => status,
        Err(error) => {
            let install_error = format!("spawn installer {}: {error}", args.payload.display());
            return match transaction.rollback() {
                Ok(()) => Err(install_error),
                Err(restore_error) => {
                    Err(format!("{install_error}; restore failed: {restore_error}"))
                }
            };
        }
    };
    if !status.success() {
        let install_error = format!(
            "installer {} exited with status {status}",
            args.payload.display()
        );
        return match transaction.rollback() {
            Ok(()) => Err(install_error),
            Err(restore_error) => Err(format!("{install_error}; restore failed: {restore_error}")),
        };
    }

    transaction.mark_awaiting_health()?;

    Ok(Outcome::Applied(transaction))
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
        return Err(format!(
            "`open -a {}` exited with status {status}",
            target.display()
        ));
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

#[cfg(test)]
mod tests {
    use super::{
        acknowledge_update_health, journal_path_for, prepare_startup_update, read_journal,
        restore_attempted_update, validate_journal, write_journal, InstallTransaction,
        StartupUpdateAction, UpdateJournal, UpdateJournalState, UPDATE_JOURNAL_VERSION,
    };
    use std::{
        fs,
        path::{Path, PathBuf},
        sync::atomic::{AtomicU64, Ordering},
    };

    static NEXT_TEST_DIR: AtomicU64 = AtomicU64::new(1);

    struct TestDir(PathBuf);

    impl TestDir {
        fn new() -> Self {
            let id = NEXT_TEST_DIR.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir().join(format!(
                "murasaki-updater-transaction-{}-{id}",
                std::process::id(),
            ));
            let _ = fs::remove_dir_all(&path);
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn create_install(root: &Path, name: &str, marker: &str) -> PathBuf {
        let path = root.join(name);
        fs::create_dir_all(&path).unwrap();
        fs::write(path.join("version.txt"), marker).unwrap();
        path
    }

    #[test]
    fn relaunch_failure_rolls_back_the_replaced_install() {
        let root = TestDir::new();
        let target = create_install(root.path(), "App", "old");
        let replacement = create_install(root.path(), "Replacement", "new");
        let mut transaction = InstallTransaction::begin(&target, &target).unwrap();
        let backup = transaction.backup.clone();
        transaction.install_from(&replacement).unwrap();
        assert_eq!(
            fs::read_to_string(target.join("version.txt")).unwrap(),
            "new"
        );

        // This is the exact branch `run()` takes after a relaunch spawn error.
        transaction.rollback().unwrap();
        assert_eq!(
            fs::read_to_string(target.join("version.txt")).unwrap(),
            "old"
        );
        assert!(!backup.exists());
    }

    #[test]
    fn failed_install_swap_restores_the_previous_install_immediately() {
        let root = TestDir::new();
        let target = create_install(root.path(), "App", "old");
        let missing_replacement = root.path().join("missing");
        let mut transaction = InstallTransaction::begin(&target, &target).unwrap();
        assert!(transaction.install_from(&missing_replacement).is_err());

        assert_eq!(
            fs::read_to_string(target.join("version.txt")).unwrap(),
            "old"
        );
        assert!(!transaction.backup.exists());
    }

    #[test]
    fn journal_rejects_paths_outside_the_app_update_namespace() {
        let root = TestDir::new();
        let target = create_install(root.path(), "App", "new");
        let traversal = UpdateJournal {
            version: UPDATE_JOURNAL_VERSION,
            state: UpdateJournalState::AwaitingHealth,
            backup_name: "../unrelated".to_string(),
            relaunch_name: None,
            helper_pid: None,
            attempt_pid: None,
        };
        assert!(validate_journal(&target, &traversal).is_err());

        let escaped_relaunch = UpdateJournal {
            backup_name: ".App.murasaki-backup-1".to_string(),
            relaunch_name: Some("../Other.exe".to_string()),
            ..traversal
        };
        assert!(validate_journal(&target, &escaped_relaunch).is_err());
    }

    #[test]
    fn install_swap_is_journaled_before_health_tracking_begins() {
        let root = TestDir::new();
        let target = create_install(root.path(), "App", "old");
        let mut transaction = InstallTransaction::begin(&target, &target).unwrap();
        let journal = read_journal(&target).unwrap().unwrap();

        assert_eq!(journal.state, UpdateJournalState::Installing);
        assert_eq!(journal.helper_pid, Some(std::process::id()));
        assert_eq!(journal.attempt_pid, None);
        assert!(transaction.backup.exists());
        transaction.rollback().unwrap();
    }

    #[test]
    fn first_launch_atomically_marks_the_health_attempt() {
        let root = TestDir::new();
        let target = create_install(root.path(), "App", "old");
        let replacement = create_install(root.path(), "Replacement", "new");
        let mut transaction = InstallTransaction::begin(&target, &target).unwrap();
        transaction.install_from(&replacement).unwrap();
        transaction.mark_awaiting_health().unwrap();
        transaction.retain_for_health_ack();

        assert_eq!(
            prepare_startup_update(&target).unwrap(),
            StartupUpdateAction::ContinueHealthAttempt
        );
        let journal = read_journal(&target).unwrap().unwrap();
        assert_eq!(journal.state, UpdateJournalState::Attempted);
        assert_eq!(journal.attempt_pid, Some(std::process::id()));
    }

    #[test]
    fn health_acknowledgement_keeps_new_install_and_removes_recovery_state() {
        let root = TestDir::new();
        let target = create_install(root.path(), "App", "old");
        let replacement = create_install(root.path(), "Replacement", "new");
        let mut transaction = InstallTransaction::begin(&target, &target).unwrap();
        let backup = transaction.backup.clone();
        transaction.install_from(&replacement).unwrap();
        transaction.mark_awaiting_health().unwrap();
        transaction.retain_for_health_ack();
        prepare_startup_update(&target).unwrap();

        acknowledge_update_health(&target).unwrap();
        assert_eq!(
            fs::read_to_string(target.join("version.txt")).unwrap(),
            "new"
        );
        assert!(!backup.exists());
        assert!(!journal_path_for(&target).unwrap().exists());
    }

    #[test]
    fn recovery_restores_backup_only_for_the_recorded_failed_attempt() {
        let root = TestDir::new();
        let target = create_install(root.path(), "App", "old");
        let replacement = create_install(root.path(), "Replacement", "new");
        let mut transaction = InstallTransaction::begin(&target, &target).unwrap();
        let backup = transaction.backup.clone();
        transaction.install_from(&replacement).unwrap();
        let failed_pid = 424_242;
        write_journal(
            &target,
            &UpdateJournal {
                version: UPDATE_JOURNAL_VERSION,
                state: UpdateJournalState::Attempted,
                backup_name: backup.file_name().unwrap().to_str().unwrap().to_string(),
                relaunch_name: Some("App.exe".to_string()),
                helper_pid: None,
                attempt_pid: Some(failed_pid),
            },
        )
        .unwrap();
        transaction.retain_for_health_ack();

        assert!(restore_attempted_update(&target, failed_pid + 1).is_err());
        assert_eq!(
            fs::read_to_string(target.join("version.txt")).unwrap(),
            "new"
        );

        let relaunch = restore_attempted_update(&target, failed_pid).unwrap();
        assert_eq!(relaunch, target.join("App.exe"));
        assert_eq!(
            fs::read_to_string(target.join("version.txt")).unwrap(),
            "old"
        );
        assert!(!backup.exists());
        assert!(!journal_path_for(&target).unwrap().exists());
    }
}
