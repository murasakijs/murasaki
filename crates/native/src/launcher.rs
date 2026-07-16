//! Production launcher — the Rust binary that becomes the packaged app's
//! `CFBundleExecutable` on macOS or `<productName>.exe` on Windows (see
//! `src/bin/murasaki-launcher.rs`), replacing the bash-script + `node` prod
//! launcher. Being a *real* executable (rather than a renamed copy of
//! `node`) is what lets macOS show the product name and icon for the running
//! process — see `Application::set_icon_path`'s doc comment for why the
//! previous approach couldn't do that reliably. On Windows it's what makes
//! the taskbar/Alt-Tab title read the product name instead of `node.exe`.
//!
//! Mirrors `packages/murasaki/assets/prod-launcher.mjs` closely: spawns
//! `prod-server.mjs` as a child process, reads the assigned port off a
//! `MURASAKI_PORT=<n>` stdout line, then opens a webview pointed at
//! `http://127.0.0.1:<port>/`. macOS and Windows share that
//! resources-dir → spawn-node → read-port sequence (the `shared` module
//! below, identical pure `std::process`/IO on both); everything past that —
//! building the window/webview and any native chrome (Dock, app menu, About
//! panel) — is per-OS in `imp_macos`/`imp_win`, since only macOS currently
//! wires up a native menu bar / About panel. (The right-click context menu is
//! a separate story — `webview::show_context_menu` — and is implemented on
//! both macOS and Windows; both `imp_macos`/`imp_win` build their webview via
//! the same `crate::webview::Webview::new`, so this launcher gets it for
//! free.) The default-menu locale resolution mirrors
//! `packages/murasaki/src/menu-i18n.ts` — also macOS-only for now, see
//! `imp_win`'s doc comment for what's deferred.
//!
//! Linux packaging is Phase 3; `run_launcher` is a no-op stub there (and
//! everywhere else) so the crate still builds wherever the GUI stack does.

/// Cross-platform core shared by `imp_macos` and `imp_win`: reading
/// `murasaki-meta.json` and spawning `prod-server.mjs`. Pure
/// `std::process`/IO with no OS-specific API calls, so unlike the window/menu
/// code below it needs no per-OS duplicate — only the resources-dir
/// resolution and the node binary's filename (`"node"` vs `"node.exe"`)
/// differ, and callers pass those in.
#[cfg(any(target_os = "macos", target_os = "windows"))]
mod shared {
  use std::{
    collections::HashMap,
    fs::{self, File, OpenOptions},
    io::{BufRead, BufReader, Read, Seek, SeekFrom, Write},
    net::TcpStream,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::mpsc,
    thread,
    time::Duration,
  };

  use serde::{Deserialize, Serialize};
  use fs2::FileExt;

  use crate::types::MenuLabels;

  /// Subset of the packaged resources dir's `murasaki-meta.json` (written by
  /// `cli/bundle.ts`; `Contents/Resources/` on macOS, `resources/` on
  /// Windows) this launcher needs. Fields the packager may omit
  /// (`config.window` / `config.description` etc. are all optional in
  /// `MurasakiConfig`) are `#[serde(default)]` so a missing JSON key becomes
  /// `None` instead of a parse error.
  #[derive(Deserialize)]
  #[serde(rename_all = "camelCase")]
  pub(super) struct Meta {
    #[serde(default)]
    pub(super) app_id: Option<String>,
    #[serde(default)]
    pub(super) capabilities: Option<Vec<String>>,
    pub(super) product_name: String,
    #[serde(default)]
    pub(super) version: Option<String>,
    #[serde(default)]
    pub(super) description: Option<String>,
    #[serde(default)]
    pub(super) copyright: Option<String>,
    #[serde(default)]
    pub(super) homepage: Option<String>,
    #[serde(default)]
    pub(super) authors: Option<Vec<String>>,
    #[serde(default)]
    pub(super) locales: Option<Vec<String>>,
    #[serde(default)]
    pub(super) width: Option<i32>,
    #[serde(default)]
    pub(super) height: Option<i32>,
    #[serde(default)]
    pub(super) min_width: Option<i32>,
    #[serde(default)]
    pub(super) min_height: Option<i32>,
    #[serde(default)]
    pub(super) resizable: Option<bool>,
    #[serde(default)]
    pub(super) transparent: Option<bool>,
    #[serde(default)]
    pub(super) vibrancy: Option<String>,
    #[serde(default)]
    pub(super) icon: Option<String>,
    /// Windows only — show the backend `node.exe` console window instead of
    /// hiding it (see `spawn_prod_server`'s `CREATE_NO_WINDOW` handling
    /// below). Missing key ⇒ `false` (the default: no console), matching
    /// `WindowConfig.console` in `packages/murasaki/src/config.ts`. Ignored
    /// on macOS, where the spawned `node` was never given a console to begin
    /// with.
    #[serde(default)]
    pub(super) console: bool,
    #[serde(default)]
    pub(super) protocols: Vec<ProtocolMeta>,
    #[serde(default)]
    pub(super) file_associations: Vec<FileAssociationMeta>,
  }

  #[derive(Deserialize)]
  pub(super) struct ProtocolMeta {
    pub(super) scheme: String,
    #[serde(default)]
    pub(super) name: Option<String>,
  }

  #[derive(Deserialize)]
  pub(super) struct FileAssociationMeta {
    #[serde(default)]
    pub(super) extensions: Vec<String>,
  }

  #[derive(Clone, Debug, PartialEq, Serialize)]
  #[serde(tag = "kind", rename_all = "lowercase")]
  pub(super) enum OpenTarget {
    Url { url: String, scheme: String },
    File { path: String },
  }

  pub(super) fn open_targets_from_args(
    meta: &Meta,
    argv: &[String],
    cwd: &Path,
  ) -> Vec<OpenTarget> {
    let schemes = meta.protocols.iter().map(|item| item.scheme.as_str()).collect::<Vec<_>>();
    let extensions = meta.file_associations.iter()
      .flat_map(|item| item.extensions.iter().map(String::as_str))
      .collect::<Vec<_>>();
    let mut targets = Vec::new();
    for raw in argv.iter().take(32) {
      if raw.starts_with('-') || raw.len() > 32_768 { continue; }
      if let Ok(parsed) = url::Url::parse(raw) {
        let scheme = parsed.scheme().to_ascii_lowercase();
        if scheme != "file" && schemes.iter().any(|allowed| allowed.eq_ignore_ascii_case(&scheme)) {
          targets.push(OpenTarget::Url { url: parsed.to_string(), scheme });
          continue;
        }
        if scheme == "file" {
          if let Ok(path) = parsed.to_file_path() {
            push_registered_file(&mut targets, path, &extensions);
          }
          continue;
        }
      }
      let path = PathBuf::from(raw);
      let absolute = if path.is_absolute() { path } else { cwd.join(path) };
      push_registered_file(&mut targets, absolute, &extensions);
    }
    targets
  }

  pub(super) fn open_targets_from_urls(meta: &Meta, urls: &[url::Url]) -> Vec<OpenTarget> {
    let schemes = meta.protocols.iter().map(|item| item.scheme.as_str()).collect::<Vec<_>>();
    let extensions = meta.file_associations.iter()
      .flat_map(|item| item.extensions.iter().map(String::as_str))
      .collect::<Vec<_>>();
    let mut targets = Vec::new();
    for parsed in urls.iter().take(32) {
      let scheme = parsed.scheme().to_ascii_lowercase();
      if scheme == "file" {
        if let Ok(path) = parsed.to_file_path() {
          push_registered_file(&mut targets, path, &extensions);
        }
      } else if schemes.iter().any(|allowed| allowed.eq_ignore_ascii_case(&scheme)) {
        targets.push(OpenTarget::Url { url: parsed.to_string(), scheme });
      }
    }
    targets
  }

  fn push_registered_file(targets: &mut Vec<OpenTarget>, path: PathBuf, extensions: &[&str]) {
    let Some(extension) = path.extension().and_then(|value| value.to_str()) else { return; };
    if !extensions.iter().any(|allowed| allowed.eq_ignore_ascii_case(extension)) { return; }
    let normalized = fs::canonicalize(&path).unwrap_or(path);
    targets.push(OpenTarget::File { path: normalized.to_string_lossy().into_owned() });
  }

  /// Reads and parses `<resources_dir>/murasaki-meta.json`.
  pub(super) fn read_meta(resources_dir: &Path) -> Result<Meta, String> {
    let meta_path = resources_dir.join("murasaki-meta.json");
    let meta_raw = fs::read_to_string(&meta_path)
      .map_err(|e| format!("read {}: {e}", meta_path.display()))?;
    serde_json::from_str(&meta_raw).map_err(|e| format!("parse {}: {e}", meta_path.display()))
  }

  /// Spawns `<resources_dir>/<node_binary_name> prod-server.mjs` the same way
  /// `prod-launcher.mjs` did (see that file's header comment for why
  /// `--port 0` + reading back the assigned port is needed instead of picking
  /// one ourselves), and blocks until it reports its port or 15s elapses —
  /// killing the child and returning an error on timeout/failure.
  /// `node_binary_name` (`"node"` on macOS, `"node.exe"` on Windows) is the
  /// only per-OS difference in the command line; `console` (Windows-only,
  /// see the `CREATE_NO_WINDOW` block below) is the only other per-OS
  /// difference in this whole sequence.
  pub(super) fn spawn_prod_server(
    resources_dir: &Path,
    node_binary_name: &str,
    console: bool,
    port: u16,
    runtime_token: &str,
  ) -> Result<(Child, u16), String> {
    let node_path = resources_dir.join(node_binary_name);
    let mut cmd = Command::new(&node_path);
    cmd
      .arg("prod-server.mjs")
      .arg("--client")
      .arg(resources_dir.join("client"))
      .arg("--registry")
      .arg(resources_dir.join("server").join("actions.mjs"))
      .arg("--main-registry")
      .arg(resources_dir.join("server").join("main-actions.mjs"))
      .arg("--routes")
      .arg(resources_dir.join("server").join("routes.mjs"))
      .arg("--main")
      .arg(resources_dir.join("server").join("main.mjs"))
      .arg("--port")
      .arg(port.to_string())
      .env("MURASAKI_RUNTIME_TOKEN", runtime_token)
      .current_dir(resources_dir)
      .stdin(Stdio::null())
      .stdout(Stdio::piped());

    // Windows only: `node.exe` is a console-subsystem binary, so with no
    // creation flag Windows allocates a console window for it as soon as
    // it's spawned — even though this launcher itself is windowless
    // (`#![windows_subsystem = "windows"]`, see bin/murasaki-launcher.rs).
    // `CREATE_NO_WINDOW` suppresses that. stdout is still piped either way
    // (see above) for the `MURASAKI_PORT` handshake, so hiding the console
    // loses nothing — unless the app opts in via `window.console: true` in
    // murasaki.config.ts (e.g. to see CLI/debug logs), in which case we
    // leave the default (visible) console behavior alone.
    #[cfg(target_os = "windows")]
    if !console {
      use std::os::windows::process::CommandExt;
      const CREATE_NO_WINDOW: u32 = 0x0800_0000;
      cmd.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(not(target_os = "windows"))]
    let _ = console;

    let mut child = cmd
      .spawn()
      .map_err(|e| format!("spawn {}: {e}", node_path.display()))?;

    match wait_for_port(&mut child, Duration::from_secs(15)) {
      Ok(port) => Ok((child, port)),
      Err(err) => {
        let _ = child.kill();
        Err(err)
      }
    }
  }

  /// Stable, app-scoped HTTP origin. Web Storage keys include the port, so
  /// using port 0 made localStorage/IndexedDB/Cookies appear empty after every
  /// relaunch. FNV-1a keeps this deterministic across Rust/Node versions and
  /// maps into IANA's dynamic/private port range. A future second launch must
  /// activate the first instance instead of silently selecting another port.
  pub(super) fn app_origin_port(app_id: &str) -> u16 {
    let mut hash = 0x811c_9dc5_u32;
    for byte in app_id.as_bytes() {
      hash ^= u32::from(*byte);
      hash = hash.wrapping_mul(0x0100_0193);
    }
    49_152 + (hash % 16_384) as u16
  }

  /// Per-launch 256-bit secret used by the loopback server's HttpOnly
  /// session cookie. This prevents an unrelated web origin from invoking
  /// action/API/updater endpoints by scanning localhost ports.
  pub(super) fn runtime_token() -> Result<String, String> {
    let mut bytes = [0_u8; 32];
    getrandom::fill(&mut bytes).map_err(|e| format!("generate runtime token: {e}"))?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
  }

  #[derive(serde::Serialize, Deserialize)]
  struct InstanceState {
    port: u16,
    runtime_token: String,
  }

  pub(super) struct PrimaryInstance {
    file: File,
    pub(super) activation_path: PathBuf,
  }

  pub(super) struct SecondaryInstance {
    state_path: PathBuf,
    activation_path: PathBuf,
  }

  pub(super) enum InstanceRole {
    Primary(PrimaryInstance),
    Secondary(SecondaryInstance),
  }

  fn instance_paths(app_id: &str) -> Result<(PathBuf, PathBuf), String> {
    let dir = std::env::temp_dir().join("murasaki-instances");
    fs::create_dir_all(&dir).map_err(|e| format!("create instance directory: {e}"))?;
    #[cfg(unix)]
    {
      use std::os::unix::fs::PermissionsExt;
      let _ = fs::set_permissions(&dir, fs::Permissions::from_mode(0o700));
    }
    let id = app_origin_port(app_id);
    Ok((dir.join(format!("{id}.lock")), dir.join(format!("{id}.activate"))))
  }

  /// Acquire the per-user, app-scoped single-instance lock. The file remains
  /// locked for the primary launcher's entire lifetime; a secondary launch
  /// reads the authenticated loopback coordinates written into the same file.
  pub(super) fn acquire_instance(app_id: &str) -> Result<InstanceRole, String> {
    let (state_path, activation_path) = instance_paths(app_id)?;
    let file = OpenOptions::new()
      .create(true)
      .read(true)
      .write(true)
      .open(&state_path)
      .map_err(|e| format!("open instance lock: {e}"))?;
    #[cfg(unix)]
    {
      use std::os::unix::fs::PermissionsExt;
      let _ = file.set_permissions(fs::Permissions::from_mode(0o600));
    }
    match file.try_lock_exclusive() {
      Ok(()) => Ok(InstanceRole::Primary(PrimaryInstance { file, activation_path })),
      Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
        Ok(InstanceRole::Secondary(SecondaryInstance { state_path, activation_path }))
      }
      Err(error) => Err(format!("lock primary instance: {error}")),
    }
  }

  impl PrimaryInstance {
    pub(super) fn publish(&mut self, port: u16, runtime_token: &str) -> Result<(), String> {
      self.file.set_len(0).map_err(|e| format!("truncate instance state: {e}"))?;
      self.file.seek(SeekFrom::Start(0)).map_err(|e| format!("seek instance state: {e}"))?;
      serde_json::to_writer(&mut self.file, &InstanceState {
        port,
        runtime_token: runtime_token.to_string(),
      })
      .map_err(|e| format!("write instance state: {e}"))?;
      self.file.sync_data().map_err(|e| format!("sync instance state: {e}"))
    }

    pub(super) fn take_activation(&self) -> bool {
      fs::remove_file(&self.activation_path).is_ok()
    }
  }

  impl SecondaryInstance {
    pub(super) fn activate_primary(&self, meta: &Meta) -> Result<(), String> {
      // The primary owns the lock before Node has finished listening. Retry
      // briefly until it publishes the token/port rather than racing startup.
      let state = (0..60).find_map(|_| {
        let parsed = fs::read_to_string(&self.state_path)
          .ok()
          .and_then(|raw| serde_json::from_str::<InstanceState>(&raw).ok());
        if parsed.is_none() { thread::sleep(Duration::from_millis(50)); }
        parsed
      }).ok_or_else(|| "primary instance did not publish activation state".to_string())?;

      fs::write(&self.activation_path, b"activate")
        .map_err(|e| format!("signal primary window activation: {e}"))?;
      let argv: Vec<String> = std::env::args().skip(1).collect();
      let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
      let targets = open_targets_from_args(meta, &argv, &cwd);
      if !targets.is_empty() {
        request_main_open(
          state.port,
          &state.runtime_token,
          "second-instance",
          "argv",
          targets,
          Some(cwd.clone()),
        )?;
      }
      request_main_second_instance(
        state.port,
        &state.runtime_token,
        argv,
        cwd,
      )?;
      Ok(())
    }
  }

  fn request_main_second_instance(
    port: u16,
    runtime_token: &str,
    argv: Vec<String>,
    cwd: PathBuf,
  ) -> Result<(), String> {
    let timeout = Duration::from_secs(5);
    let mut stream = TcpStream::connect_timeout(
      &format!("127.0.0.1:{port}").parse().map_err(|e| format!("parse activation address: {e}"))?,
      timeout,
    ).map_err(|e| format!("connect primary instance: {e}"))?;
    stream.set_read_timeout(Some(timeout)).ok();
    stream.set_write_timeout(Some(timeout)).ok();
    let body = serde_json::json!({ "argv": argv, "cwd": cwd.to_string_lossy() }).to_string();
    let request = format!(
      "POST /__murasaki/main/second-instance HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nCookie: murasaki_runtime={runtime_token}\r\nX-Murasaki-Native-Token: {runtime_token}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
      body.len()
    );
    stream.write_all(request.as_bytes()).map_err(|e| format!("write activation: {e}"))?;
    let mut response = String::new();
    stream.read_to_string(&mut response).map_err(|e| format!("read activation: {e}"))?;
    if !response.starts_with("HTTP/1.1 204") {
      return Err(format!("primary activation returned {}", response.lines().next().unwrap_or("an invalid response")));
    }
    Ok(())
  }

  pub(super) fn request_main_open(
    port: u16,
    runtime_token: &str,
    activation: &str,
    transport: &str,
    targets: Vec<OpenTarget>,
    cwd: Option<PathBuf>,
  ) -> Result<(), String> {
    let timeout = Duration::from_secs(5);
    let mut stream = TcpStream::connect_timeout(
      &format!("127.0.0.1:{port}").parse().map_err(|e| format!("parse open-request address: {e}"))?,
      timeout,
    ).map_err(|e| format!("connect main open request: {e}"))?;
    stream.set_read_timeout(Some(timeout)).ok();
    stream.set_write_timeout(Some(timeout)).ok();
    let body = serde_json::json!({
      "activation": activation,
      "transport": transport,
      "targets": targets,
      "cwd": cwd.map(|value| value.to_string_lossy().into_owned()),
    }).to_string();
    let request = format!(
      "POST /__murasaki/main/open-request HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nCookie: murasaki_runtime={runtime_token}\r\nX-Murasaki-Native-Token: {runtime_token}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
      body.len()
    );
    stream.write_all(request.as_bytes()).map_err(|e| format!("write main open request: {e}"))?;
    let mut response = String::new();
    stream.read_to_string(&mut response).map_err(|e| format!("read main open request: {e}"))?;
    if !response.starts_with("HTTP/1.1 204") {
      return Err(format!("main open request returned {}", response.lines().next().unwrap_or("an invalid response")));
    }
    Ok(())
  }

  #[derive(Deserialize)]
  struct ShutdownResponse {
    #[serde(default)]
    cancelled: bool,
  }

  /// Ask the Node main process to run `beforeQuit`/`shutdown` before the
  /// native host terminates it. Returns true when `beforeQuit` cancelled the
  /// request. A transport failure is surfaced to the caller, which may still
  /// force termination rather than trapping the user in a broken app.
  pub(super) fn request_main_shutdown(
    port: u16,
    runtime_token: &str,
    reason: &str,
    force: bool,
  ) -> Result<bool, String> {
    let timeout = Duration::from_secs(15);
    let mut stream = TcpStream::connect_timeout(
      &format!("127.0.0.1:{port}")
        .parse()
        .map_err(|e| format!("parse main address: {e}"))?,
      timeout,
    )
    .map_err(|e| format!("connect main shutdown: {e}"))?;
    stream.set_read_timeout(Some(timeout)).ok();
    stream.set_write_timeout(Some(timeout)).ok();

    let body = serde_json::json!({ "reason": reason, "force": force }).to_string();
    let request = format!(
      "POST /__murasaki/main/shutdown HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nCookie: murasaki_runtime={runtime_token}\r\nX-Murasaki-Native-Token: {runtime_token}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
      body.len()
    );
    stream
      .write_all(request.as_bytes())
      .map_err(|e| format!("write main shutdown: {e}"))?;
    let mut response = String::new();
    stream
      .read_to_string(&mut response)
      .map_err(|e| format!("read main shutdown: {e}"))?;
    if !response.starts_with("HTTP/1.1 200") {
      return Err(format!(
        "main shutdown returned {}",
        response.lines().next().unwrap_or("an invalid response")
      ));
    }
    let payload = response
      .split_once("\r\n\r\n")
      .map(|(_, body)| body)
      .ok_or_else(|| "main shutdown response had no body".to_string())?;
    let parsed: ShutdownResponse =
      serde_json::from_str(payload).map_err(|e| format!("parse main shutdown: {e}"))?;
    Ok(parsed.cancelled)
  }

  /// Reads `prod-server.mjs`'s stdout line-by-line looking for
  /// `MURASAKI_PORT=<n>` (see that file's `server.listen` callback), on a
  /// background thread so the child's pipe never fills up and blocks it.
  /// Forwards every line to our own stdout as it goes (line-buffered, so
  /// exact byte-for-byte interleaving with our own output isn't guaranteed —
  /// good enough for what is essentially debug output).
  fn wait_for_port(child: &mut Child, timeout: Duration) -> Result<u16, String> {
    let stdout = child
      .stdout
      .take()
      .ok_or_else(|| "prod-server: missing stdout pipe".to_string())?;
    let (tx, rx) = mpsc::channel::<u16>();

    thread::spawn(move || {
      let reader = BufReader::new(stdout);
      let mut found = false;
      for line in reader.lines() {
        let Ok(line) = line else { break };
        if !found {
          if let Some(port) = line
            .strip_prefix("MURASAKI_PORT=")
            .and_then(|p| p.trim().parse::<u16>().ok())
          {
            found = true;
            let _ = tx.send(port);
          }
        }
        // `println!` panics if the write fails — which it does on Windows
        // when the launcher is built with `windows_subsystem = "windows"`
        // (see bin/murasaki-launcher.rs) and launched without an attached
        // console (e.g. double-clicked from Explorer): there's no valid
        // stdout handle in that case. This forwarding is debug-output-only,
        // so best-effort-and-ignore is correct here, unlike a real error.
        let _ = writeln!(std::io::stdout(), "{line}");
      }
    });

    rx.recv_timeout(timeout)
      .map_err(|_| "prod server did not report a port in time".to_string())
  }

  /// Payload of `<resources_dir>/.murasaki-apply.json` — the entire handoff
  /// Node's `install()` (`packages/murasaki/src/runtime/updater.ts`) leaves
  /// for this launcher, per the frozen updater contract's §7 REVISED. This
  /// is deliberately the ONLY thing Node hands over: `--target`/`--relaunch`/
  /// `--wait-pid` are derived by `maybe_spawn_apply_helper` below, not
  /// trusted from Node.
  #[derive(Deserialize)]
  struct ApplyHandoff {
    payload: String,
    sha256: String,
  }

  /// Checked on every clean exit path — `{ kind: "appQuit" }` and
  /// `WindowEvent::CloseRequested`, on both macOS and Windows — right before
  /// the launcher process exits (contract §7 REVISED step 6). If
  /// `<resources_dir>/.murasaki-apply.json` is present, this reads it,
  /// deletes it immediately (so a crash partway through applying can't leave
  /// a poisoned pending apply that re-triggers on a future launch), and
  /// spawns `current_exe() --apply-update …` (argv contract §8) detached,
  /// passing `target`/`relaunch` (the caller's own already-resolved install
  /// location — see `imp_macos`/`imp_win`'s `run_inner`) and this process's
  /// own pid as `--wait-pid`.
  ///
  /// This is *why* the launcher — not Node — must be the one to spawn the
  /// apply-helper (contract §7 REVISED): this launcher process was never
  /// itself assigned to the `KILL_ON_JOB_CLOSE` Job Object (only the spawned
  /// `node.exe` child was, see `win_job`), so anything it spawns here is
  /// outside that job by construction and survives past this process's own
  /// exit on Windows — unlike a helper Node itself would have spawned, which
  /// inherits into the same job and gets killed the instant this launcher's
  /// job handle closes.
  ///
  /// Best-effort throughout: a missing handoff file is the common case (no
  /// pending update) and is silently a no-op; a malformed handoff file or a
  /// failed spawn is logged to stderr and swallowed — either way, a broken
  /// handoff must never prevent the launcher from exiting normally.
  pub(super) fn maybe_spawn_apply_helper(resources_dir: &Path, target: &Path, relaunch: &Path) {
    let handoff_path = resources_dir.join(".murasaki-apply.json");
    let Ok(raw) = fs::read_to_string(&handoff_path) else {
      return;
    };
    // Delete before acting on it, not after — see the doc comment above.
    let _ = fs::remove_file(&handoff_path);

    let handoff: ApplyHandoff = match serde_json::from_str(&raw) {
      Ok(h) => h,
      Err(e) => {
        let _ = writeln!(
          std::io::stderr(),
          "murasaki-launcher: malformed {}: {e}",
          handoff_path.display()
        );
        return;
      }
    };

    let exe = match std::env::current_exe() {
      Ok(e) => e,
      Err(e) => {
        let _ = writeln!(std::io::stderr(), "murasaki-launcher: current_exe: {e}");
        return;
      }
    };

    let spawned = Command::new(&exe)
      .arg("--apply-update")
      .arg("--payload")
      .arg(&handoff.payload)
      .arg("--sha256")
      .arg(&handoff.sha256)
      .arg("--wait-pid")
      .arg(std::process::id().to_string())
      .arg("--target")
      .arg(target)
      .arg("--relaunch")
      .arg(relaunch)
      // `stdin` closed (the helper never reads it); `stdout`/`stderr`
      // inherited (the default) rather than nulled, so the `murasaki-apply:`
      // diagnostics `updater.rs` writes (see that module's `log!` macro) land
      // wherever this launcher's own stderr does — the only channel this
      // headless, post-quit process has.
      .stdin(Stdio::null())
      .spawn();

    if let Err(e) = spawned {
      let _ = writeln!(std::io::stderr(), "murasaki-launcher: failed to spawn apply-helper: {e}");
    }
  }

  /// One locale's worth of default-menu labels — mirrors `MenuLabels` in
  /// `packages/murasaki/src/menu-i18n.ts`, deserialized straight out of
  /// `menu-locales.json` (`Contents/Resources/` on macOS, `resources/` on
  /// Windows). Shared by both launchers: only the raw "read the OS UI
  /// language" step differs between them (`imp_macos::macos_ui_language` vs
  /// `imp_win::windows_ui_language`) — everything below is plain string/table
  /// logic with nothing macOS- or Windows-specific about it.
  #[derive(Deserialize, Clone)]
  #[serde(rename_all = "camelCase")]
  pub(super) struct LocaleLabels {
    pub(super) about: String,
    pub(super) services: String,
    pub(super) hide: String,
    pub(super) hide_others: String,
    pub(super) show_all: String,
    pub(super) quit: String,
    pub(super) edit: String,
    pub(super) undo: String,
    pub(super) redo: String,
    pub(super) cut: String,
    pub(super) copy: String,
    pub(super) paste: String,
    pub(super) select_all: String,
    pub(super) window: String,
    pub(super) minimize: String,
    pub(super) zoom: String,
  }

  /// Reads `<resources_dir>/menu-locales.json`. Missing or unparsable ⇒ empty
  /// map, which makes `resolve_menu_labels` fall through to muda's English
  /// defaults (see `MenuLabels`'s doc comment in types.rs).
  pub(super) fn load_menu_locales(resources_dir: &Path) -> HashMap<String, LocaleLabels> {
    let path = resources_dir.join("menu-locales.json");
    fs::read_to_string(&path)
      .ok()
      .and_then(|raw| serde_json::from_str(&raw).ok())
      .unwrap_or_default()
  }

  /// Mirrors `menu-i18n.ts`'s `normalizeLocale()`.
  pub(super) fn normalize_locale(raw: &str) -> String {
    let lc = raw.to_lowercase().replace('_', "-");
    if lc.starts_with("ja") {
      "ja".to_string()
    } else if lc.starts_with("zh") {
      "zh-CN".to_string()
    } else if lc.starts_with("ko") {
      "ko".to_string()
    } else if lc.starts_with("es") {
      "es".to_string()
    } else if lc.starts_with("fr") {
      "fr".to_string()
    } else if lc.starts_with("de") {
      "de".to_string()
    } else {
      "en".to_string()
    }
  }

  /// Mirrors `menu-i18n.ts`'s `resolveMenuLabels()`: resolves the default-menu
  /// labels for `locale`, constrained to `allowed` (the app's configured
  /// `locales`) when given, falling back to `allowed[0]` (normalized) if the
  /// detected locale isn't one of them, and to muda's English defaults
  /// (`None` fields) if the locale table has neither key nor `"en"`.
  pub(super) fn resolve_menu_labels(
    product_name: &str,
    locale: &str,
    allowed: Option<&[String]>,
    table: &HashMap<String, LocaleLabels>,
  ) -> MenuLabels {
    let mut key = locale.to_string();
    if let Some(allowed) = allowed {
      if !allowed.is_empty() {
        let normalized_allowed: Vec<String> = allowed.iter().map(|a| normalize_locale(a)).collect();
        if !normalized_allowed.iter().any(|a| a == &key) {
          key = normalize_locale(&allowed[0]);
        }
      }
    }

    let Some(t) = table.get(&key).or_else(|| table.get("en")) else {
      return MenuLabels {
        about: None,
        services: None,
        hide: None,
        hide_others: None,
        show_all: None,
        quit: None,
        edit: None,
        undo: None,
        redo: None,
        cut: None,
        copy: None,
        paste: None,
        select_all: None,
        window: None,
        minimize: None,
        zoom: None,
      };
    };

    let fill = |s: &str| s.replace("{app}", product_name);
    MenuLabels {
      about: Some(fill(&t.about)),
      services: Some(t.services.clone()),
      hide: Some(fill(&t.hide)),
      hide_others: Some(t.hide_others.clone()),
      show_all: Some(t.show_all.clone()),
      quit: Some(fill(&t.quit)),
      edit: Some(t.edit.clone()),
      undo: Some(t.undo.clone()),
      redo: Some(t.redo.clone()),
      cut: Some(t.cut.clone()),
      copy: Some(t.copy.clone()),
      paste: Some(t.paste.clone()),
      select_all: Some(t.select_all.clone()),
      window: Some(t.window.clone()),
      minimize: Some(t.minimize.clone()),
      zoom: Some(t.zoom.clone()),
    }
  }

  #[cfg(test)]
  mod tests {
    use std::{fs, io::{Read, Write}, net::TcpListener, thread};

    use super::{app_origin_port, open_targets_from_args, request_main_shutdown, runtime_token, Meta, OpenTarget};

    #[test]
    fn app_origin_is_stable_and_private() {
      let first = app_origin_port("com.example.notes");
      assert_eq!(first, app_origin_port("com.example.notes"));
      assert!((49_152..=65_535).contains(&first));
      assert_ne!(first, app_origin_port("com.example.chat"));
    }

    #[test]
    fn runtime_tokens_are_random_256_bit_hex() {
      let first = runtime_token().expect("token");
      let second = runtime_token().expect("token");
      assert_eq!(first.len(), 64);
      assert!(first.chars().all(|ch| ch.is_ascii_hexdigit()));
      assert_ne!(first, second);
    }

    #[test]
    fn native_host_requests_graceful_main_shutdown() {
      let listener = TcpListener::bind("127.0.0.1:0").unwrap();
      let port = listener.local_addr().unwrap().port();
      let server = thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut bytes = [0_u8; 4096];
        let read = stream.read(&mut bytes).unwrap();
        let request = String::from_utf8_lossy(&bytes[..read]);
        assert!(request.starts_with("POST /__murasaki/main/shutdown HTTP/1.1"));
        assert!(request.contains("Cookie: murasaki_runtime=secret"));
        assert!(request.contains("X-Murasaki-Native-Token: secret"));
        assert!(request.contains("\"reason\":\"window-close\""));
        let body = r#"{"cancelled":true,"timedOut":false}"#;
        write!(
          stream,
          "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
          body.len(),
          body
        )
        .unwrap();
      });

      assert!(request_main_shutdown(port, "secret", "window-close", false).unwrap());
      server.join().unwrap();
    }

    #[test]
    fn normalizes_only_registered_open_arguments() {
      let meta: Meta = serde_json::from_value(serde_json::json!({
        "productName": "Violet",
        "protocols": [{ "scheme": "violet" }],
        "fileAssociations": [{ "extensions": ["vnote"] }]
      })).unwrap();
      let root = std::env::temp_dir().join(format!("murasaki-open-test-{}", std::process::id()));
      fs::create_dir_all(&root).unwrap();
      fs::write(root.join("hello.vnote"), b"hello").unwrap();
      fs::write(root.join("ignored.txt"), b"ignored").unwrap();
      let argv = vec![
        "violet://open/42".to_string(),
        "https://example.com".to_string(),
        "hello.vnote".to_string(),
        "ignored.txt".to_string(),
        "--apply-update".to_string(),
      ];
      let targets = open_targets_from_args(&meta, &argv, &root);
      assert_eq!(targets.len(), 2);
      assert_eq!(targets[0], OpenTarget::Url {
        url: "violet://open/42".to_string(),
        scheme: "violet".to_string(),
      });
      assert_eq!(targets[1], OpenTarget::File {
        path: fs::canonicalize(root.join("hello.vnote")).unwrap().to_string_lossy().into_owned(),
      });
      let _ = fs::remove_dir_all(root);
    }
  }
}

#[cfg(target_os = "macos")]
mod imp_macos {
  use std::{cell::RefCell, path::Path, process::Command, rc::Rc, time::{Duration, Instant}};

  use tao::{
    dpi::LogicalSize,
    event::{Event, WindowEvent},
    event_loop::{ControlFlow, EventLoop},
    window::WindowBuilder,
  };

  use crate::{
    menu::{build_default_app_menu, AboutInfo, AboutInfoOwned, SharedMenu},
    types::WebviewOptions,
    webview::{AppMenuContext, Webview},
    window::{center_on_primary_monitor, SharedWindow},
  };

  use super::shared::{
    acquire_instance, app_origin_port, load_menu_locales, maybe_spawn_apply_helper, normalize_locale,
    open_targets_from_args, open_targets_from_urls, read_meta, request_main_open, request_main_shutdown,
    resolve_menu_labels, runtime_token, spawn_prod_server, InstanceRole,
  };

  pub fn run() {
    if let Err(err) = run_inner() {
      eprintln!("murasaki-launcher: {err}");
      std::process::exit(1);
    }
  }

  fn run_inner() -> Result<(), String> {
    // The bundle layout is `<App>.app/Contents/MacOS/<exe>` +
    // `Contents/Resources/…` (see cli/bundle.ts) — resolve the latter from
    // our own binary's location rather than the current directory, since the
    // packaged executable can be launched from anywhere (Finder, Dock, …).
    let exe = std::env::current_exe().map_err(|e| format!("current_exe: {e}"))?;
    let macos_dir = exe
      .parent()
      .ok_or_else(|| "murasaki-launcher: executable has no parent directory".to_string())?;
    let resources_dir = macos_dir
      .join("..")
      .join("Resources")
      .canonicalize()
      .map_err(|e| format!("resolve Resources dir: {e}"))?;

    // The `.app` bundle path — contract §8's `--target` AND `--relaunch` for
    // macOS (both the same path; see `maybe_spawn_apply_helper`'s call sites
    // below and this module's own doc comment on why that differs from
    // Windows). Two hops up from `Contents/Resources`: `Contents`, then the
    // `.app` bundle itself.
    let app_bundle = resources_dir
      .parent()
      .and_then(Path::parent)
      .map(Path::to_path_buf)
      .ok_or_else(|| "murasaki-launcher: could not resolve .app bundle path from Resources dir".to_string())?;

    let meta = read_meta(&resources_dir)?;
    let app_id = meta.app_id.as_deref().unwrap_or(&meta.product_name);
    let mut primary_instance = match acquire_instance(app_id)? {
      InstanceRole::Primary(primary) => primary,
      InstanceRole::Secondary(secondary) => {
        secondary.activate_primary(&meta)?;
        return Ok(());
      }
    };
    let runtime_token = runtime_token()?;
    let origin_port = app_origin_port(app_id);
    // `meta.console` is Windows-only (see that field's doc comment) — ignored
    // here, `spawn_prod_server` only acts on it under `#[cfg(target_os =
    // "windows")]`.
    let (mut child, port) = spawn_prod_server(
      &resources_dir,
      "node",
      meta.console,
      origin_port,
      &runtime_token,
    )?;
    primary_instance.publish(port, &runtime_token)?;
    let startup_argv: Vec<String> = std::env::args().skip(1).collect();
    let startup_cwd = std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("."));
    let startup_targets = open_targets_from_args(&meta, &startup_argv, &startup_cwd);
    if !startup_targets.is_empty() {
      request_main_open(port, &runtime_token, "cold-start", "argv", startup_targets, Some(startup_cwd))?;
    }

    set_activation_policy_regular();

    let event_loop = EventLoop::<()>::new();
    // Lets the IPC handler (`appQuit`, from `quit()`) wake this event loop —
    // see `webview::Webview::new`'s `wake` parameter doc comment. Without
    // this, a JS-posted IPC message generates no OS event, so a
    // `ControlFlow::Wait` loop never re-polls `quit_requested()` until the
    // next mouse/keyboard event.
    let quit_proxy = event_loop.create_proxy();

    // Matches prod-launcher.mjs's `meta.width ?? 1000` / `meta.height ?? 700`
    // (not Application::createWindow's 1280x800 default, which is for
    // `murasaki dev`'s window created with no explicit size).
    let width = meta.width.unwrap_or(1000);
    let height = meta.height.unwrap_or(700);
    // Vibrancy isn't wired up on the native side yet — accepted here for
    // murasaki-meta.json parity but currently a no-op, same as
    // `BrowserWindow::from_window` (see window.rs).
    let _ = &meta.vibrancy;

    let mut window_builder = WindowBuilder::new()
      .with_title(&meta.product_name)
      .with_inner_size(LogicalSize::new(width as f64, height as f64))
      .with_resizable(meta.resizable.unwrap_or(true))
      .with_transparent(meta.transparent.unwrap_or(false));
    if let (Some(min_width), Some(min_height)) = (meta.min_width, meta.min_height) {
      window_builder = window_builder
        .with_min_inner_size(LogicalSize::new(min_width as f64, min_height as f64));
    }
    let window = window_builder
      .build(&event_loop)
      .map_err(|e| format!("build window: {e}"))?;
    center_on_primary_monitor(&window);

    let shared_window: SharedWindow = Rc::new(RefCell::new(Some(window)));

    let icon_path = meta.icon.as_ref().map(|icon| resources_dir.join(icon));

    let locale_table = load_menu_locales(&resources_dir);
    let locale = detect_locale();
    let menu_labels = resolve_menu_labels(
      &meta.product_name,
      &locale,
      meta.locales.as_deref(),
      &locale_table,
    );

    let about = AboutInfo {
      name: &meta.product_name,
      icon_path: icon_path.as_ref().and_then(|p| p.to_str()),
      version: meta.version.as_deref(),
      description: meta.description.as_deref(),
      copyright: meta.copyright.as_deref(),
      homepage: meta.homepage.as_deref(),
      authors: meta.authors.as_deref(),
    };
    let menu = build_default_app_menu(&about, Some(&menu_labels))
      .map_err(|e| format!("build menu: {e}"))?;
    menu.init_for_nsapp();
    // Retained so a later `{ kind: "appMenu" }` IPC message (`useAppMenu`)
    // can replace it — see `AppMenuContext`'s doc comment in webview.rs.
    let app_menu_slot: SharedMenu = Rc::new(RefCell::new(Some(menu)));

    let about_owned = AboutInfoOwned {
      name: meta.product_name.clone(),
      icon_path: icon_path.as_ref().and_then(|p| p.to_str()).map(String::from),
      version: meta.version.clone(),
      description: meta.description.clone(),
      copyright: meta.copyright.clone(),
      homepage: meta.homepage.clone(),
      authors: meta.authors.clone(),
    };
    let app_menu_context = AppMenuContext {
      menu_slot: app_menu_slot.clone(),
      menu_labels: Some(menu_labels.clone()),
      about_info: about_owned,
    };

    let url = format!("http://127.0.0.1:{port}/");
    // `Webview::new` gives us the external-link navigation handler for free
    // (see webview.rs) — kept alive for the app's lifetime, see the comment
    // on `event_loop.run` below for why it's fine that it's never touched
    // again after this.
    let webview = Webview::new(
      shared_window.clone(),
      WebviewOptions {
        url: Some(url),
        html: None,
        devtools: Some(false),
        transparent: meta.transparent,
        app_id: meta.app_id.clone(),
        capabilities: meta.capabilities.clone(),
        tray_icon: icon_path.as_ref().and_then(|path| path.to_str()).map(String::from),
        serve_dir: None,
      },
      app_menu_context,
      Box::new(move || {
        let _ = quit_proxy.send_event(());
      }),
    )
    .map_err(|e| format!("build webview: {e}"))?;
    // Handle the app-menu poll below dispatches clicks into — see
    // `poll_app_menu_events`'s doc comment in webview.rs.
    let webview_handle = webview.handle();

    // Dock/About-panel icon — mirrors Application::set_icon_path. As the real
    // CFBundleExecutable, CFBundleIconFile (see cli/bundle.ts's Info.plist)
    // already covers the Dock/Finder icon; this additionally covers the
    // About panel, which doesn't reliably pick up CFBundleIconFile.
    if let Some(path) = &icon_path {
      set_app_icon(path);
    }

    // tao's `EventLoop::run` never returns (`-> !`) and explicitly documents
    // that "values not passed to this function will *not* be dropped" — so
    // `webview`/`app_menu_slot`/`shared_window`, though never referenced
    // again after this point, simply stay alive on this stack frame for as
    // long as the app runs. `webview_handle`, `child`, `resources_dir`, and
    // `app_bundle` move into the closure below — the first two so the
    // app-menu poll can reach the webview every tick and `child` can be
    // killed on window close, the latter two so both clean-exit paths can
    // check for a pending `.murasaki-apply.json` handoff (contract §7
    // REVISED step 6) on the way out.
    let mut completed_initial_event_cycle = false;
    let mut received_open_event = false;
    event_loop.run(move |event, _target, control_flow| {
      *control_flow = ControlFlow::WaitUntil(Instant::now() + Duration::from_millis(250));

      if primary_instance.take_activation() {
        if let Some(window) = shared_window.borrow().as_ref() {
          window.set_visible(true);
          window.set_minimized(false);
          window.set_focus();
        }
        set_activation_policy_regular();
      }

      if let Event::Opened { urls } = &event {
        let targets = open_targets_from_urls(&meta, urls);
        if !targets.is_empty() {
          let activation = if !received_open_event && !completed_initial_event_cycle {
            "cold-start"
          } else {
            "os-event"
          };
          let transport = if targets.iter().any(|target| matches!(target, super::shared::OpenTarget::Url { .. })) {
            "open-url"
          } else {
            "open-file"
          };
          let _ = request_main_open(port, &runtime_token, activation, transport, targets, None);
          received_open_event = true;
          if let Some(window) = shared_window.borrow().as_ref() {
            window.set_visible(true);
            window.set_minimized(false);
            window.set_focus();
          }
        }
      }
      if matches!(event, Event::MainEventsCleared) {
        completed_initial_event_cycle = true;
      }

      // Drain clicks on `useAppMenu`'s custom (non-role) items every tick —
      // see `poll_app_menu_events`'s doc comment in webview.rs.
      crate::webview::poll_app_menu_events(&webview_handle);
      crate::webview::poll_tray_events(&webview_handle);

      // `quit()` (`{ kind: "appQuit" }`) — see `webview::quit_requested`'s
      // doc comment. Same clean-shutdown as the window's own close button
      // just below: best-effort kill the spawned `node` child, hand off to
      // the apply-helper if one is pending, then exit.
      if crate::webview::quit_requested() {
        if request_main_shutdown(port, &runtime_token, "app-quit", false).unwrap_or(false) {
          return;
        }
        *control_flow = ControlFlow::Exit;
        // Drop the wry WebView so WebView2 shuts its browser processes down —
        // `std::process::exit` below skips destructors, which orphaned them.
        let _ = webview_handle.borrow_mut().take();
        let _ = child.kill();
        maybe_spawn_apply_helper(&resources_dir, &app_bundle, &app_bundle);
        std::process::exit(0);
      }

      if let Event::WindowEvent {
        event: WindowEvent::CloseRequested,
        ..
      } = event
      {
        if request_main_shutdown(port, &runtime_token, "window-close", false).unwrap_or(false) {
          return;
        }
        *control_flow = ControlFlow::Exit;
        // Drop the wry WebView so WebView2 shuts its browser processes down —
        // `std::process::exit` below skips destructors, which orphaned them.
        let _ = webview_handle.borrow_mut().take();
        // Best-effort: if we get killed before this runs (force-quit, crash),
        // prod-server.mjs's own orphan check (`ppid === 1`) reaps it within ~2s.
        let _ = child.kill();
        maybe_spawn_apply_helper(&resources_dir, &app_bundle, &app_bundle);
        std::process::exit(0);
      }
    });
  }

  /// Best-effort system UI language, normalized to a shipped locale key.
  /// Mirrors `menu-i18n.ts`'s `detectLocale()` — macOS only, so unlike the JS
  /// version there's no `Intl`/env-var fallback chain, just `AppleLanguages`.
  fn detect_locale() -> String {
    let raw = macos_ui_language().unwrap_or_else(|| "en".to_string());
    normalize_locale(&raw)
  }

  /// The user's macOS UI language (first entry of the `AppleLanguages`
  /// preference list, e.g. "ja-JP"), or `None` if the lookup fails.
  fn macos_ui_language() -> Option<String> {
    let output = Command::new("defaults")
      .args(["read", "-g", "AppleLanguages"])
      .output()
      .ok()?;
    if !output.status.success() {
      return None;
    }
    first_locale_tag(&String::from_utf8_lossy(&output.stdout))
  }

  /// First BCP-47-ish locale tag in `s` — a hand-rolled equivalent of the JS
  /// regex `/[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]+)*/` used by `menu-i18n.ts`'s
  /// `macosUiLanguage()` against `defaults read -g AppleLanguages` output
  /// (e.g. `(\n    "ja-JP",\n    "en-US"\n)` → `"ja-JP"`).
  fn first_locale_tag(s: &str) -> Option<String> {
    let chars: Vec<char> = s.chars().collect();
    let n = chars.len();
    let mut i = 0;
    while i < n {
      if !chars[i].is_ascii_alphabetic() {
        i += 1;
        continue;
      }
      let mut j = i;
      while j < n && chars[j].is_ascii_alphabetic() {
        j += 1;
      }
      let base_len = (j - i).min(3);
      if base_len < 2 {
        i = j.max(i + 1);
        continue;
      }
      let mut tag: String = chars[i..i + base_len].iter().collect();
      let mut k = i + base_len;
      while k < n && chars[k] == '-' {
        let seg_start = k + 1;
        let mut m = seg_start;
        while m < n && chars[m].is_ascii_alphanumeric() {
          m += 1;
        }
        if m == seg_start {
          break;
        }
        tag.push('-');
        tag.extend(&chars[seg_start..m]);
        k = m;
      }
      return Some(tag);
    }
    None
  }

  /// Sets `NSApp.applicationIconImage` — mirrors `Application::set_icon_path`
  /// exactly (see that method's doc comment for why this is needed alongside
  /// `CFBundleIconFile`). No-op if `path` doesn't point at a readable image.
  fn set_app_icon(path: &Path) {
    use objc2::{AllocAnyThread, MainThreadMarker};
    use objc2_app_kit::{NSApplication, NSImage};
    use objc2_foundation::NSString;

    let Some(mtm) = MainThreadMarker::new() else { return };
    let ns_app = NSApplication::sharedApplication(mtm);
    let ns_path = NSString::from_str(&path.to_string_lossy());
    if let Some(image) = NSImage::initWithContentsOfFile(NSImage::alloc(), &ns_path) {
      unsafe { ns_app.setApplicationIconImage(Some(&image)) };
    }
  }

  /// Ensures this CLI-launched process is a Regular (Dock-visible, focusable)
  /// app — mirrors `Application::new`'s doc comment on why this is set up
  /// front rather than relying on tao's default handling during
  /// `applicationDidFinishLaunching`.
  fn set_activation_policy_regular() {
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSApplication, NSApplicationActivationPolicy};

    if let Some(mtm) = MainThreadMarker::new() {
      let ns_app = NSApplication::sharedApplication(mtm);
      ns_app.setActivationPolicy(NSApplicationActivationPolicy::Regular);
      #[allow(deprecated)]
      ns_app.activateIgnoringOtherApps(true);
    }
  }
}

/// Windows Job Object wrapping the spawned `node.exe` child so the OS kills
/// it as soon as this launcher process's handle to the job closes — which
/// happens automatically on process exit, *any* way it exits (clean
/// shutdown, force-kill from Task Manager, or a crash). Unlike macOS/Linux,
/// Windows doesn't reparent an orphaned child to a pid the child could
/// detect (`prod-server.mjs`'s `ppid === 1` check — see its comment — is a
/// no-op there), so without this a killed/crashed launcher would leave
/// `node.exe` running indefinitely. Kept as its own small module so the
/// win32-specific Win32 API calls stay out of `imp_win::run_inner`.
#[cfg(target_os = "windows")]
mod win_job {
  use windows::{
    core::PCWSTR,
    Win32::{
      Foundation::{CloseHandle, HANDLE},
      System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
      },
    },
  };

  pub(super) struct KillOnCloseJob(HANDLE);

  impl KillOnCloseJob {
    /// Creates the job object and sets `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`
    /// on it. Best-effort: returns `None` on any failure rather than
    /// erroring the launcher out — the app still runs, just without this
    /// orphan-kill safety net.
    pub(super) fn new() -> Option<Self> {
      let job = unsafe { CreateJobObjectW(None, PCWSTR::null()) }.ok()?;

      let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
      info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
      let configured = unsafe {
        SetInformationJobObject(
          job,
          JobObjectExtendedLimitInformation,
          &info as *const _ as *const core::ffi::c_void,
          std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        )
      };
      if configured.is_err() {
        let _ = unsafe { CloseHandle(job) };
        return None;
      }
      Some(Self(job))
    }

    /// Assigns `child` to this job — from this point on, Windows kills it
    /// (and anything it spawns, which inherits into the same job) once the
    /// job handle closes. Best-effort: a `false` return just means this
    /// child didn't get the orphan-kill protection, not a fatal error.
    pub(super) fn assign(&self, child: &std::process::Child) -> bool {
      use std::os::windows::io::AsRawHandle;
      let process = HANDLE(child.as_raw_handle());
      unsafe { AssignProcessToJobObject(self.0, process) }.is_ok()
    }
  }

  impl Drop for KillOnCloseJob {
    fn drop(&mut self) {
      let _ = unsafe { CloseHandle(self.0) };
    }
  }
}

/// Windows launcher — window + webview + native menu bar (File/Edit/Window),
/// attached via `Menu::init_for_hwnd` and localized the same way macOS's app
/// menu is: `menu-locales.json` + the locale resolver in `shared` (this
/// launcher can't call into Node's `menu-i18n.ts` either — see `imp_macos`'s
/// module for that same constraint). See `menu::build_windows_menu_bar` for
/// why its items are custom `MenuItem`s (not muda `PredefinedMenuItem`s like
/// macOS uses) and `webview::poll_menu_bar_events` for how their clicks are
/// picked up in the event loop below and dispatched into the webview.
///
/// The "About <app>" panel *is* handled here too, via a Help menu appended
/// by `menu::build_windows_menu_bar` (muda's `PredefinedMenuItem::about` is
/// cross-platform, same call macOS's app-name submenu uses) — see that
/// function's doc comment. `icon_path` isn't threaded through on Windows
/// (unlike macOS's `about`, below): muda's Windows About dialog is built from
/// this launcher's own `AboutInfo`, whose `icon_path` field is left `None`
/// here rather than plumbed from `window_icon`'s already-decoded tao `Icon`.
///
/// Deferred macOS-parity items, left for a later packaging phase:
///  - Menu-bar keyboard accelerators (Ctrl+Z etc.) — see
///    `menu::build_windows_menu_bar`'s doc comment for why they're
///    intentionally left unset rather than shipped as inert decoration.
///
/// The window's own icon (title bar / Alt-Tab thumbnail) *is* handled here
/// (`load_window_icon` below): `cli/bundle.ts`'s `embedWin32ExeResources`
/// already embeds `resources/icon.ico` into the `.exe`'s PE resources, which
/// covers Explorer/taskbar/Start menu — but tao's own `WindowBuilder` sets no
/// `hIcon` on its `WNDCLASSEX`, so without this the window chrome itself
/// (top-left corner, Alt-Tab) falls back to Windows' generic default even on
/// a properly icon-embedded `.exe`. Decoding `resources/icon.png` (the same
/// file `meta.icon` already points at for macOS's About panel) and setting
/// it via `WindowBuilder::with_window_icon` fixes that; tao's Windows backend
/// sets both `ICON_SMALL` and `ICON_BIG` (`WM_SETICON`) from the one image,
/// so there's no separate small/big asset to manage.
#[cfg(target_os = "windows")]
mod imp_win {
  use std::{cell::RefCell, io::Write, path::Path, rc::Rc, time::{Duration, Instant}};

  use tao::{
    dpi::LogicalSize,
    event::{Event, WindowEvent},
    event_loop::{ControlFlow, EventLoop},
    platform::windows::WindowExtWindows,
    window::{Icon, WindowBuilder},
  };

  use crate::{
    menu::{build_windows_menu_bar, AboutInfo, SharedMenu},
    types::WebviewOptions,
    webview::{poll_menu_bar_events, AppMenuContext, Webview},
    window::{center_on_primary_monitor, SharedWindow},
  };

  use super::shared::{
    acquire_instance, app_origin_port, load_menu_locales, maybe_spawn_apply_helper, normalize_locale,
    open_targets_from_args, open_targets_from_urls, read_meta, request_main_open, request_main_shutdown,
    resolve_menu_labels, runtime_token, spawn_prod_server, InstanceRole,
  };
  use super::win_job::KillOnCloseJob;

  enum AssociationMode {
    Install,
    Uninstall,
    Notify,
  }

  pub(super) fn maybe_manage_associations() -> Option<Result<(), String>> {
    let mode = std::env::args().find_map(|argument| match argument.as_str() {
      "--murasaki-associations-install" => Some(AssociationMode::Install),
      "--murasaki-associations-uninstall" => Some(AssociationMode::Uninstall),
      "--murasaki-notify-associations" => Some(AssociationMode::Notify),
      _ => None,
    })?;
    Some(manage_associations(mode))
  }

  fn manage_associations(mode: AssociationMode) -> Result<(), String> {
    if matches!(mode, AssociationMode::Notify) {
      notify_associations_changed();
      return Ok(());
    }
    let exe = std::env::current_exe().map_err(|e| format!("current_exe: {e}"))?;
    let resources_dir = exe.parent()
      .ok_or_else(|| "murasaki-launcher: executable has no parent directory".to_string())?
      .join("resources");
    let meta = read_meta(&resources_dir)?;
    let app_id = meta.app_id.as_deref()
      .ok_or_else(|| "murasaki-launcher: association metadata is missing appId".to_string())?;
    let command = format!("\"{}\" \"%1\"", exe.to_string_lossy());
    for protocol in &meta.protocols {
      let key = format!("Software\\Classes\\{}", protocol.scheme);
      let command_key = format!("{key}\\shell\\open\\command");
      let current_command = read_registry_string(&command_key, None);
      // The marker is diagnostic only. Another installer can legitimately
      // replace the scheme command without knowing to remove our private
      // marker, so only the live command proves ownership for overwrite or
      // deletion decisions.
      let command_owned_by_this_app = current_command.as_deref()
        .is_some_and(|value| value.eq_ignore_ascii_case(&command));
      if matches!(mode, AssociationMode::Install)
        && (current_command.is_none() || command_owned_by_this_app) {
        set_registry_string(&key, None, &format!("URL:{}", protocol.name.as_deref().unwrap_or(&meta.product_name)))?;
        set_registry_string(&key, Some("URL Protocol"), "")?;
        set_registry_string(&key, Some("MurasakiAppId"), app_id)?;
        set_registry_string(&format!("{key}\\DefaultIcon"), None, &format!("{},0", exe.to_string_lossy()))?;
        set_registry_string(&command_key, None, &command)?;
      } else if matches!(mode, AssociationMode::Uninstall) && command_owned_by_this_app {
        delete_registry_tree(&key)?;
      }
    }
    notify_associations_changed();
    Ok(())
  }

  fn notify_associations_changed() {
    // SAFETY: SHCNE_ASSOCCHANGED ignores both item pointers when paired with
    // SHCNF_IDLIST. This headless installer mode exits before any GUI/runtime
    // state is created.
    unsafe {
      windows::Win32::UI::Shell::SHChangeNotify(
        windows::Win32::UI::Shell::SHCNE_ASSOCCHANGED,
        windows::Win32::UI::Shell::SHCNF_IDLIST,
        None,
        None,
      );
    }
  }

  fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
  }

  fn set_registry_string(path: &str, name: Option<&str>, value: &str) -> Result<(), String> {
    use windows::{core::PCWSTR, Win32::{Foundation::ERROR_SUCCESS, System::Registry::{
      HKEY, HKEY_LOCAL_MACHINE, KEY_SET_VALUE, REG_OPTION_NON_VOLATILE, REG_SZ,
      RegCloseKey, RegCreateKeyExW, RegSetValueExW,
    }}};
    let path_wide = wide(path);
    let name_wide = name.map(wide);
    let class = PCWSTR::null();
    let mut key = HKEY(std::ptr::null_mut());
    // SAFETY: all pointers reference null-terminated buffers for the duration
    // of the calls; the returned key is closed before returning.
    let created = unsafe {
      RegCreateKeyExW(
        HKEY_LOCAL_MACHINE,
        PCWSTR(path_wide.as_ptr()),
        None,
        class,
        REG_OPTION_NON_VOLATILE,
        KEY_SET_VALUE,
        None,
        &mut key,
        None,
      )
    };
    if created != ERROR_SUCCESS {
      return Err(format!("create association registry key {path}: {}", created.0));
    }
    let encoded = wide(value);
    let bytes = unsafe {
      std::slice::from_raw_parts(encoded.as_ptr().cast::<u8>(), encoded.len() * std::mem::size_of::<u16>())
    };
    let value_name = name_wide.as_ref().map_or(PCWSTR::null(), |item| PCWSTR(item.as_ptr()));
    let written = unsafe { RegSetValueExW(key, value_name, None, REG_SZ, Some(bytes)) };
    let _ = unsafe { RegCloseKey(key) };
    if written != ERROR_SUCCESS {
      return Err(format!("write association registry key {path}: {}", written.0));
    }
    Ok(())
  }

  fn read_registry_string(path: &str, name: Option<&str>) -> Option<String> {
    use windows::{core::PCWSTR, Win32::{Foundation::ERROR_SUCCESS, System::Registry::{
      HKEY_LOCAL_MACHINE, RRF_RT_REG_SZ, RegGetValueW,
    }}};
    let path_wide = wide(path);
    let name_wide = name.map(wide);
    let value_name = name_wide.as_ref().map_or(PCWSTR::null(), |item| PCWSTR(item.as_ptr()));
    let mut bytes = 0_u32;
    let sized = unsafe {
      RegGetValueW(
        HKEY_LOCAL_MACHINE,
        PCWSTR(path_wide.as_ptr()),
        value_name,
        RRF_RT_REG_SZ,
        None,
        None,
        Some(&mut bytes),
      )
    };
    if sized != ERROR_SUCCESS || bytes < 2 { return None; }
    let mut buffer = vec![0_u16; bytes as usize / 2];
    let read = unsafe {
      RegGetValueW(
        HKEY_LOCAL_MACHINE,
        PCWSTR(path_wide.as_ptr()),
        value_name,
        RRF_RT_REG_SZ,
        None,
        Some(buffer.as_mut_ptr().cast()),
        Some(&mut bytes),
      )
    };
    if read != ERROR_SUCCESS { return None; }
    while buffer.last() == Some(&0) { buffer.pop(); }
    String::from_utf16(&buffer).ok()
  }

  fn delete_registry_tree(path: &str) -> Result<(), String> {
    use windows::{core::PCWSTR, Win32::{Foundation::{ERROR_FILE_NOT_FOUND, ERROR_SUCCESS}, System::Registry::{
      HKEY_LOCAL_MACHINE, RegDeleteTreeW,
    }}};
    let path_wide = wide(path);
    let deleted = unsafe { RegDeleteTreeW(HKEY_LOCAL_MACHINE, PCWSTR(path_wide.as_ptr())) };
    if deleted != ERROR_SUCCESS && deleted != ERROR_FILE_NOT_FOUND {
      return Err(format!("delete association registry key {path}: {}", deleted.0));
    }
    Ok(())
  }

  pub fn run() {
    if let Err(err) = run_inner() {
      // `eprintln!` panics if the write fails — which it can here since
      // there may be no console attached (this binary is built with
      // `windows_subsystem = "windows"`, see bin/murasaki-launcher.rs, and
      // can be launched without a console, e.g. from Explorer). Best-effort:
      // still exit non-zero either way.
      let _ = writeln!(std::io::stderr(), "murasaki-launcher: {err}");
      std::process::exit(1);
    }
  }

  fn run_inner() -> Result<(), String> {
    // The bundle layout is `<productName>.exe` + a sibling `resources/`
    // directory (see cli/bundle.ts's bundleWin32 — unlike macOS's
    // `Contents/MacOS/<exe>` + `Contents/Resources/`, there's no `..` hop)
    // — resolve it from our own binary's location rather than the current
    // directory, since the packaged executable can be launched from anywhere
    // (a shortcut, the Start menu, …).
    let exe = std::env::current_exe().map_err(|e| format!("current_exe: {e}"))?;
    let exe_dir = exe
      .parent()
      .ok_or_else(|| "murasaki-launcher: executable has no parent directory".to_string())?;
    let resources_dir = exe_dir
      .join("resources")
      .canonicalize()
      .map_err(|e| format!("resolve resources dir: {e}"))?;

    let meta = read_meta(&resources_dir)?;
    let app_id = meta.app_id.as_deref().unwrap_or(&meta.product_name);
    let mut primary_instance = match acquire_instance(app_id)? {
      InstanceRole::Primary(primary) => primary,
      InstanceRole::Secondary(secondary) => {
        secondary.activate_primary(&meta)?;
        return Ok(());
      }
    };
    let runtime_token = runtime_token()?;
    let origin_port = app_origin_port(app_id);

    // Contract §8: on Windows `--target` is the install dir (`exe_dir`) and
    // `--relaunch` is `<installDir>\<productName>.exe` — see
    // `maybe_spawn_apply_helper`'s call sites below. `exe_dir` is a `&Path`
    // borrowed from `exe`, so this is captured as an owned `PathBuf` now
    // rather than re-derived later.
    let apply_target = exe_dir.to_path_buf();
    let apply_relaunch = apply_target.join(format!("{}.exe", meta.product_name));

    // Spawns resources/node.exe prod-server.mjs — same handshake as macOS,
    // see `shared::spawn_prod_server`. `meta.console` (default `false`) hides
    // the console window `node.exe` would otherwise get, via
    // `CREATE_NO_WINDOW` — see that function's doc comment.
    let (mut child, port) = spawn_prod_server(
      &resources_dir,
      "node.exe",
      meta.console,
      origin_port,
      &runtime_token,
    )?;
    primary_instance.publish(port, &runtime_token)?;
    let startup_argv: Vec<String> = std::env::args().skip(1).collect();
    let startup_cwd = std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("."));
    let startup_targets = open_targets_from_args(&meta, &startup_argv, &startup_cwd);
    if !startup_targets.is_empty() {
      request_main_open(port, &runtime_token, "cold-start", "argv", startup_targets, Some(startup_cwd))?;
    }

    // Orphan protection (see `win_job`'s module doc comment) — assign the
    // freshly spawned node.exe to a KILL_ON_JOB_CLOSE job so it can't outlive
    // this launcher process, even if that's a crash rather than a clean exit.
    // `job` is intentionally kept alive on this stack frame for the rest of
    // `run_inner` (see the `event_loop.run` comment near the bottom of this
    // function for why nothing here needs an explicit lifetime beyond that).
    let job = KillOnCloseJob::new();
    if let Some(job) = &job {
      job.assign(&child);
    }

    let event_loop = EventLoop::<()>::new();
    // Lets the IPC handler (`appQuit`, from `quit()`) wake this event loop —
    // see `webview::Webview::new`'s `wake` parameter doc comment / the
    // matching comment in `imp_macos`.
    let quit_proxy = event_loop.create_proxy();

    // Matches prod-launcher.mjs's / the macOS launcher's `meta.width ?? 1000`
    // / `meta.height ?? 700`.
    let width = meta.width.unwrap_or(1000);
    let height = meta.height.unwrap_or(700);
    // Vibrancy is macOS-only (see window.rs) — a no-op here too.
    let _ = &meta.vibrancy;

    // Title-bar/Alt-Tab window icon — see the module doc comment above for
    // why this is needed in addition to the .exe's already-embedded PE icon.
    // `None` (no `config.icon`, or a decode failure) just means
    // `with_window_icon` leaves tao's default in place, same as before this.
    let window_icon = meta
      .icon
      .as_ref()
      .map(|icon| resources_dir.join(icon))
      .and_then(|path| load_window_icon(&path));

    let mut window_builder = WindowBuilder::new()
      .with_title(&meta.product_name)
      .with_inner_size(LogicalSize::new(width as f64, height as f64))
      .with_resizable(meta.resizable.unwrap_or(true))
      .with_transparent(meta.transparent.unwrap_or(false))
      .with_window_icon(window_icon);
    if let (Some(min_width), Some(min_height)) = (meta.min_width, meta.min_height) {
      window_builder = window_builder
        .with_min_inner_size(LogicalSize::new(min_width as f64, min_height as f64));
    }
    let window = window_builder
      .build(&event_loop)
      .map_err(|e| format!("build window: {e}"))?;
    center_on_primary_monitor(&window);

    // Read the HWND before `window` moves into `shared_window` below —
    // `init_for_hwnd` just needs the raw handle, not the tao `Window` itself.
    let hwnd = window.hwnd();

    let shared_window: SharedWindow = Rc::new(RefCell::new(Some(window)));

    // Native menu bar (File/Edit/Window) — localized the same way as macOS's
    // app menu (see the module doc comment above for why this launcher has
    // its own locale resolution instead of calling into `menu-i18n.ts`).
    let locale_table = load_menu_locales(&resources_dir);
    let locale = detect_locale();
    let menu_labels = resolve_menu_labels(
      &meta.product_name,
      &locale,
      meta.locales.as_deref(),
      &locale_table,
    );
    // No `icon_path` here (unlike `imp_macos`'s `about`, which reuses the
    // already-resolved `icon_path`): this launcher only ever decodes the app
    // icon into a tao `Icon` (`window_icon`, for the window chrome itself),
    // not a path muda's About dialog could load — see the module doc
    // comment above.
    let about = AboutInfo {
      name: &meta.product_name,
      icon_path: None,
      version: meta.version.as_deref(),
      description: meta.description.as_deref(),
      copyright: meta.copyright.as_deref(),
      homepage: meta.homepage.as_deref(),
      authors: meta.authors.as_deref(),
    };
    let menu_bar = build_windows_menu_bar(Some(&about), Some(&menu_labels))
      .map_err(|e| format!("build menu bar: {e}"))?;
    // SAFETY: `hwnd` names the window built above, which is still open (its
    // event loop hasn't run yet). A failure here is cosmetic (missing menu
    // bar) — log and keep going rather than error the launcher out over it.
    if let Err(e) = unsafe { menu_bar.init_for_hwnd(hwnd) } {
      let _ = writeln!(std::io::stderr(), "murasaki-launcher: failed to attach the menu bar: {e}");
    }
    // Retained so a later `{ kind: "appMenu" }` IPC message (`useAppMenu`)
    // can replace it — see `AppMenuContext`'s doc comment in webview.rs.
    let app_menu_slot: SharedMenu = Rc::new(RefCell::new(Some(menu_bar)));
    let app_menu_context = AppMenuContext {
      menu_slot: app_menu_slot.clone(),
      menu_labels: Some(menu_labels.clone()),
    };

    let url = format!("http://127.0.0.1:{port}/");
    // `Webview::new` pins the WebView2 user-data directory under
    // %LOCALAPPDATA% itself (see `webview::webview2_data_dir`'s doc comment)
    // — no extra wiring needed here since this goes through the same
    // constructor `murasaki dev` / `BrowserWindow::createWebview` use.
    let webview = Webview::new(
      shared_window.clone(),
      WebviewOptions {
        url: Some(url),
        html: None,
        devtools: Some(false),
        transparent: meta.transparent,
        app_id: meta.app_id.clone(),
        capabilities: meta.capabilities.clone(),
        tray_icon: meta.icon.as_ref().map(|icon| resources_dir.join(icon).to_string_lossy().into_owned()),
        serve_dir: None,
      },
      app_menu_context,
      Box::new(move || {
        let _ = quit_proxy.send_event(());
      }),
    )
    .map_err(|e| format!("build webview: {e}"))?;
    // Handle the menu bar's event loop poll dispatches into — see
    // `poll_menu_bar_events` below and its doc comment in webview.rs.
    let webview_handle = webview.handle();

    // Same shutdown story as the macOS launcher (see that module's
    // `event_loop.run` comment): tao's `EventLoop::run` never returns and
    // explicitly documents that values not passed into it aren't dropped, so
    // `webview`/`app_menu_slot`/`job` simply stay alive on this stack frame
    // for the app's lifetime (`shared_window` and `webview_handle` move into
    // the closure below, since the menu-bar poll needs them every tick).
    // `child`, `resources_dir`, `apply_target`, and `apply_relaunch` also
    // move in — the first to be killed on window close/Exit, the latter
    // three so every clean-exit path below can check for a pending
    // `.murasaki-apply.json` handoff (contract §7 REVISED step 6) on the way
    // out.
    let mut completed_initial_event_cycle = false;
    let mut received_open_event = false;
    event_loop.run(move |event, _target, control_flow| {
      *control_flow = ControlFlow::WaitUntil(Instant::now() + Duration::from_millis(250));

      if primary_instance.take_activation() {
        if let Some(window) = shared_window.borrow().as_ref() {
          window.set_visible(true);
          window.set_minimized(false);
          window.set_focus();
        }
      }


      if let Event::Opened { urls } = &event {
        let targets = open_targets_from_urls(&meta, urls);
        if !targets.is_empty() {
          let activation = if !received_open_event && !completed_initial_event_cycle {
            "cold-start"
          } else {
            "os-event"
          };
          let transport = if targets.iter().any(|target| matches!(target, super::shared::OpenTarget::Url { .. })) {
            "open-url"
          } else {
            "open-file"
          };
          let _ = request_main_open(port, &runtime_token, activation, transport, targets, None);
          received_open_event = true;
          if let Some(window) = shared_window.borrow().as_ref() {
            window.set_visible(true);
            window.set_minimized(false);
            window.set_focus();
          }
        }
      }
      if matches!(event, Event::MainEventsCleared) {
        completed_initial_event_cycle = true;
      }

      // Native menu-bar clicks (Edit commands + Minimize) arrive
      // asynchronously — see `poll_menu_bar_events`'s doc comment — so this
      // is checked every tick rather than read synchronously like the
      // context-menu popup in webview.rs. Exit is handled the same way as
      // the window's own close button, just below.
      if poll_menu_bar_events(&shared_window, &webview_handle) {
        if request_main_shutdown(port, &runtime_token, "app-quit", false).unwrap_or(false) {
          return;
        }
        *control_flow = ControlFlow::Exit;
        // Drop the wry WebView so WebView2 shuts its browser processes down —
        // `std::process::exit` below skips destructors, which orphaned them.
        let _ = webview_handle.borrow_mut().take();
        let _ = child.kill();
        maybe_spawn_apply_helper(&resources_dir, &apply_target, &apply_relaunch);
        std::process::exit(0);
      }
      crate::webview::poll_tray_events(&webview_handle);

      // `quit()` (`{ kind: "appQuit" }`) — see `webview::quit_requested`'s
      // doc comment. Same clean-shutdown path as Exit/CloseRequested above
      // and below: best-effort kill `child` directly (the Job Object above
      // is the real safety net if this process dies before reaching here).
      if crate::webview::quit_requested() {
        if request_main_shutdown(port, &runtime_token, "app-quit", false).unwrap_or(false) {
          return;
        }
        *control_flow = ControlFlow::Exit;
        // Drop the wry WebView so WebView2 shuts its browser processes down —
        // `std::process::exit` below skips destructors, which orphaned them.
        let _ = webview_handle.borrow_mut().take();
        let _ = child.kill();
        maybe_spawn_apply_helper(&resources_dir, &apply_target, &apply_relaunch);
        std::process::exit(0);
      }

      if let Event::WindowEvent {
        event: WindowEvent::CloseRequested,
        ..
      } = event
      {
        if request_main_shutdown(port, &runtime_token, "window-close", false).unwrap_or(false) {
          return;
        }
        *control_flow = ControlFlow::Exit;
        // Drop the wry WebView so WebView2 shuts its browser processes down —
        // `std::process::exit` below skips destructors, which orphaned them.
        let _ = webview_handle.borrow_mut().take();
        // Best-effort direct kill on the clean-shutdown path. If we instead
        // get killed before this ever runs (force-quit, crash), it's the
        // `job` assigned above — not this — that reaps `child`: Windows has
        // no ppid-reparenting signal for `prod-server.mjs` to detect itself
        // (unlike macOS/Linux's `ppid === 1` check), so the Job Object is
        // what actually guarantees no orphaned `node.exe` here.
        let _ = child.kill();
        maybe_spawn_apply_helper(&resources_dir, &apply_target, &apply_relaunch);
        std::process::exit(0);
      }
    });
  }

  /// Best-effort system UI language, normalized to a shipped locale key.
  /// Mirrors `menu-i18n.ts`'s `detectLocale()` and `imp_macos::detect_locale`
  /// — Windows locale names are already a clean BCP-47-ish tag (e.g. "ja-JP"),
  /// unlike macOS's `AppleLanguages`, so there's no property-list parsing
  /// step to mirror here.
  fn detect_locale() -> String {
    let raw = windows_ui_language().unwrap_or_else(|| "en".to_string());
    normalize_locale(&raw)
  }

  /// The user's default Windows locale name (e.g. "en-US"), or `None` if the
  /// call fails. `GetUserDefaultLocaleName` reflects the regional format
  /// setting rather than strictly the UI display language, but for our
  /// coarse `normalize_locale` bucketing (just the language prefix) the two
  /// agree closely enough in practice.
  fn windows_ui_language() -> Option<String> {
    use windows::Win32::Globalization::GetUserDefaultLocaleName;

    // LOCALE_NAME_MAX_LENGTH (85, per the Win32 docs) — `buf` must be at
    // least this long or the call fails.
    let mut buf = [0u16; 85];
    let len = unsafe { GetUserDefaultLocaleName(&mut buf) };
    if len <= 0 {
      return None;
    }
    // `len` includes the null terminator; trim it before decoding.
    let end = usize::try_from(len - 1).ok()?;
    Some(String::from_utf16_lossy(&buf[..end]))
  }

  /// Decodes a PNG at `path` into a `tao::window::Icon` for the window's
  /// title-bar/Alt-Tab icon — same decode logic as `menu::load_icon_rgba`
  /// (macOS's About-panel icon), just producing tao's `Icon` type instead of
  /// muda's; `png` (already a dependency for that macOS path) is reused
  /// as-is rather than pulling in a second decoder. Returns `None` on any
  /// decode failure (unreadable file, unsupported color type, etc.) — the
  /// caller falls back to no icon (tao's default) rather than erroring the
  /// launcher out over a cosmetic issue.
  fn load_window_icon(path: &Path) -> Option<Icon> {
    let file = std::fs::File::open(path).ok()?;
    let decoder = png::Decoder::new(file);
    let mut reader = decoder.read_info().ok()?;
    let mut buf = vec![0; reader.output_buffer_size()];
    let frame = reader.next_frame(&mut buf).ok()?;
    buf.truncate(frame.buffer_size());

    let info = reader.info();
    let (width, height) = (info.width, info.height);

    let rgba = match (info.color_type, info.bit_depth) {
      (png::ColorType::Rgba, png::BitDepth::Eight) => buf,
      (png::ColorType::Rgb, png::BitDepth::Eight) => {
        let mut out = Vec::with_capacity(buf.len() / 3 * 4);
        for chunk in buf.chunks_exact(3) {
          out.extend_from_slice(chunk);
          out.push(255);
        }
        out
      }
      _ => return None,
    };

    Icon::from_rgba(rgba, width, height).ok()
  }
}

/// Entry point for `bin/murasaki-launcher.rs`'s `main`. Checked *before*
/// anything else: `--apply-update` (see `updater.rs`) must be reachable
/// before any window/webview/event-loop is created, since that mode runs
/// headless right after the previous app instance has quit to make way for
/// it.
pub fn run_launcher() {
  if let Some(code) = crate::updater::maybe_apply_update() {
    std::process::exit(code);
  }

  #[cfg(target_os = "windows")]
  if let Some(result) = imp_win::maybe_manage_associations() {
    if let Err(error) = result {
      eprintln!("murasaki-launcher: {error}");
      std::process::exit(1);
    }
    return;
  }

  #[cfg(target_os = "macos")]
  imp_macos::run();
  #[cfg(target_os = "windows")]
  imp_win::run();
  #[cfg(not(any(target_os = "macos", target_os = "windows")))]
  eprintln!("murasaki-launcher: unsupported platform (macOS/Windows only)");
}
