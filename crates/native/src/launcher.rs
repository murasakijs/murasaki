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
#[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
pub(crate) mod shared {
    use std::{
        collections::{HashMap, HashSet},
        fs::{self, File, OpenOptions},
        io::{BufRead, BufReader, Read, Seek, SeekFrom, Write},
        net::TcpStream,
        path::{Path, PathBuf},
        process::{Child, Command, Stdio},
        sync::{
            atomic::{AtomicBool, Ordering},
            mpsc, Arc,
        },
        thread,
        time::Duration,
    };

    use fs2::FileExt;
    use serde::{Deserialize, Serialize};

    use crate::types::{MenuLabels, WebviewDownloadsOptions, WebviewProxyOptions};
    use crate::window::{WindowControlCommand, WindowLifecycleEvent};

    const DEFAULT_MAIN_SHUTDOWN_TIMEOUT_MS: u64 = 10_000;
    const MAX_MAIN_SHUTDOWN_TIMEOUT_MS: u64 = 300_000;
    const SHUTDOWN_TRANSPORT_GRACE_MS: u64 = 2_000;

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
        #[serde(default)]
        pub(super) capability_policy: Option<String>,
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
        pub(super) decorations: Option<bool>,
        #[serde(default)]
        pub(super) title_bar_style: Option<String>,
        #[serde(default)]
        pub(super) max_width: Option<i32>,
        #[serde(default)]
        pub(super) max_height: Option<i32>,
        #[serde(default)]
        pub(super) fullscreen: Option<bool>,
        #[serde(default)]
        pub(super) icon: Option<String>,
        #[serde(default)]
        pub(super) webview: WebviewMeta,
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
        /// Fully-resolved declarative windows written by the packager. Empty is
        /// accepted for backwards compatibility with legacy single-window
        /// metadata, which the launcher expands to one `main` window below.
        #[serde(default)]
        pub(super) windows: Vec<WindowMeta>,
        #[serde(default)]
        pub(super) main_shutdown_timeout_ms: Option<u64>,
        #[cfg(target_os = "macos")]
        #[serde(default)]
        pub(super) system_permissions_on_launch: Vec<String>,
    }

    #[derive(Clone, Default, Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    pub(super) struct WebviewMeta {
        #[serde(default)]
        pub(super) user_agent: Option<String>,
        #[serde(default)]
        pub(super) incognito: Option<bool>,
        #[serde(default)]
        pub(super) proxy: Option<WebviewProxyOptions>,
        #[serde(default)]
        pub(super) downloads: Option<WebviewDownloadsOptions>,
        #[serde(default)]
        pub(super) init_scripts: Option<Vec<String>>,
        #[serde(default)]
        pub(super) hotkeys_zoom: Option<bool>,
    }

    pub(super) fn main_shutdown_transport_timeout(meta: &Meta) -> Result<Duration, String> {
        let configured = meta
            .main_shutdown_timeout_ms
            .unwrap_or(DEFAULT_MAIN_SHUTDOWN_TIMEOUT_MS);
        if configured == 0 || configured > MAX_MAIN_SHUTDOWN_TIMEOUT_MS {
            return Err(format!(
        "mainShutdownTimeoutMs must be between 1 and {MAX_MAIN_SHUTDOWN_TIMEOUT_MS} milliseconds"
      ));
        }
        Ok(Duration::from_millis(
            configured + SHUTDOWN_TRANSPORT_GRACE_MS,
        ))
    }

    #[derive(Clone, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub(super) struct WindowMeta {
        pub(super) label: String,
        #[serde(default = "default_true")]
        pub(super) create_on_launch: bool,
        #[serde(default)]
        pub(super) primary: Option<bool>,
        #[serde(default)]
        pub(super) route: Option<String>,
        #[serde(default)]
        pub(super) title: Option<String>,
        #[serde(default)]
        pub(super) width: Option<i32>,
        #[serde(default)]
        pub(super) height: Option<i32>,
        #[serde(default)]
        pub(super) min_width: Option<i32>,
        #[serde(default)]
        pub(super) min_height: Option<i32>,
        #[serde(default)]
        pub(super) visible: Option<bool>,
        #[serde(default)]
        pub(super) resizable: Option<bool>,
        #[serde(default)]
        pub(super) transparent: Option<bool>,
        #[serde(default)]
        pub(super) vibrancy: Option<String>,
        #[serde(default)]
        pub(super) decorations: Option<bool>,
        #[serde(default)]
        pub(super) title_bar_style: Option<String>,
        #[serde(default)]
        pub(super) max_width: Option<i32>,
        #[serde(default)]
        pub(super) max_height: Option<i32>,
        #[serde(default)]
        pub(super) fullscreen: Option<bool>,
        #[serde(default)]
        pub(super) capabilities: Option<Vec<String>>,
        #[serde(default)]
        pub(super) capability_policy: Option<String>,
    }

    fn default_true() -> bool {
        true
    }

    impl WindowMeta {
        pub(super) fn is_primary(&self) -> bool {
            self.primary.unwrap_or(self.label == "main")
        }

        pub(super) fn route(&self) -> &str {
            self.route.as_deref().unwrap_or("/")
        }
    }

    pub(super) fn resolve_windows(meta: &Meta) -> Result<Vec<WindowMeta>, String> {
        let mut windows = if meta.windows.is_empty() {
            vec![WindowMeta {
                label: "main".to_string(),
                create_on_launch: true,
                primary: Some(true),
                route: Some("/".to_string()),
                title: Some(meta.product_name.clone()),
                width: meta.width,
                height: meta.height,
                min_width: meta.min_width,
                min_height: meta.min_height,
                visible: Some(true),
                resizable: meta.resizable,
                transparent: meta.transparent,
                vibrancy: meta.vibrancy.clone(),
                decorations: meta.decorations,
                title_bar_style: meta.title_bar_style.clone(),
                max_width: meta.max_width,
                max_height: meta.max_height,
                fullscreen: meta.fullscreen,
                capabilities: meta.capabilities.clone(),
                capability_policy: meta.capability_policy.clone(),
            }]
        } else {
            meta.windows.clone()
        };

        let mut labels = HashSet::new();
        let mut primary_count = 0;
        for window in &mut windows {
            crate::window::validate_window_label(&window.label)
                .map_err(|error| format!("invalid window label {}: {error}", window.label))?;
            if !labels.insert(window.label.clone()) {
                return Err(format!("duplicate window label: {}", window.label));
            }
            let primary = window.is_primary();
            if window.label.eq_ignore_ascii_case("main") && window.label != "main" {
                return Err("window label main is reserved for the primary window".to_string());
            }
            if primary != (window.label == "main") {
                return Err("the primary window must use the reserved label main".to_string());
            }
            if primary {
                primary_count += 1;
                if !window.create_on_launch {
                    return Err("the primary main window must be created on launch".to_string());
                }
            }
            let route = window.route().to_string();
            if route.is_empty()
                || !route.starts_with('/')
                || route.starts_with("//")
                || route.contains('\\')
            {
                return Err(format!(
                    "window {} route must be a same-origin absolute path",
                    window.label
                ));
            }
            window.primary = Some(primary);
            window.route = Some(route);
            window.visible = Some(window.visible.unwrap_or(primary));
            window.capabilities.get_or_insert_with(Vec::new);
        }
        if primary_count != 1 {
            return Err("window metadata must contain exactly one primary main window".to_string());
        }
        windows.sort_by_key(|window| !window.is_primary());
        Ok(windows)
    }

    #[derive(Deserialize)]
    pub(super) struct ProtocolMeta {
        pub(super) scheme: String,
        #[serde(default)]
        #[cfg_attr(not(target_os = "windows"), allow(dead_code))]
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
        let schemes = meta
            .protocols
            .iter()
            .map(|item| item.scheme.as_str())
            .collect::<Vec<_>>();
        let extensions = meta
            .file_associations
            .iter()
            .flat_map(|item| item.extensions.iter().map(String::as_str))
            .collect::<Vec<_>>();
        let mut targets = Vec::new();
        for raw in argv.iter().take(32) {
            if raw.starts_with('-') || raw.len() > 32_768 {
                continue;
            }
            if let Ok(parsed) = url::Url::parse(raw) {
                let scheme = parsed.scheme().to_ascii_lowercase();
                if scheme != "file"
                    && schemes
                        .iter()
                        .any(|allowed| allowed.eq_ignore_ascii_case(&scheme))
                {
                    targets.push(OpenTarget::Url {
                        url: parsed.to_string(),
                        scheme,
                    });
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
            let absolute = if path.is_absolute() {
                path
            } else {
                cwd.join(path)
            };
            push_registered_file(&mut targets, absolute, &extensions);
        }
        targets
    }

    pub(super) fn open_targets_from_urls(meta: &Meta, urls: &[url::Url]) -> Vec<OpenTarget> {
        let schemes = meta
            .protocols
            .iter()
            .map(|item| item.scheme.as_str())
            .collect::<Vec<_>>();
        let extensions = meta
            .file_associations
            .iter()
            .flat_map(|item| item.extensions.iter().map(String::as_str))
            .collect::<Vec<_>>();
        let mut targets = Vec::new();
        for parsed in urls.iter().take(32) {
            let scheme = parsed.scheme().to_ascii_lowercase();
            if scheme == "file" {
                if let Ok(path) = parsed.to_file_path() {
                    push_registered_file(&mut targets, path, &extensions);
                }
            } else if schemes
                .iter()
                .any(|allowed| allowed.eq_ignore_ascii_case(&scheme))
            {
                targets.push(OpenTarget::Url {
                    url: parsed.to_string(),
                    scheme,
                });
            }
        }
        targets
    }

    fn push_registered_file(targets: &mut Vec<OpenTarget>, path: PathBuf, extensions: &[&str]) {
        let Some(extension) = path.extension().and_then(|value| value.to_str()) else {
            return;
        };
        if !extensions
            .iter()
            .any(|allowed| allowed.eq_ignore_ascii_case(extension))
        {
            return;
        }
        let normalized = fs::canonicalize(&path).unwrap_or(path);
        targets.push(OpenTarget::File {
            path: normalized.to_string_lossy().into_owned(),
        });
    }

    /// Reads and parses `<resources_dir>/murasaki-meta.json`.
    pub(super) fn read_meta(resources_dir: &Path) -> Result<Meta, String> {
        let meta_path = resources_dir.join("murasaki-meta.json");
        let meta_raw = fs::read_to_string(&meta_path)
            .map_err(|e| format!("read {}: {e}", meta_path.display()))?;
        let meta: Meta = serde_json::from_str(&meta_raw)
            .map_err(|e| format!("parse {}: {e}", meta_path.display()))?;
        main_shutdown_transport_timeout(&meta)
            .map_err(|e| format!("parse {}: {e}", meta_path.display()))?;
        Ok(meta)
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
    pub(super) fn spawn_prod_server<F>(
        resources_dir: &Path,
        node_binary_name: &str,
        console: bool,
        port: u16,
        runtime_token: &str,
        guard_child: F,
    ) -> Result<(Child, u16), String>
    where
        F: FnOnce(&Child) -> Result<(), String>,
    {
        let node_path = resources_dir.join(node_binary_name);
        let mut cmd = Command::new(&node_path);
        cmd.arg("prod-server.mjs")
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

        // Keep the bundled Node runtime and every sidecar it spawns in one
        // process group. If Node crashes independently, the macOS launcher can
        // tear down the whole backend tree before closing its WebViews instead
        // of leaving orphaned sidecars behind.
        #[cfg(target_os = "macos")]
        {
            use std::os::unix::process::CommandExt;
            cmd.process_group(0);
        }

        let mut child = cmd
            .spawn()
            .map_err(|e| format!("spawn {}: {e}", node_path.display()))?;

        // Install platform process-lifetime protection immediately after spawn,
        // before the Node main runtime is allowed to finish startup and report
        // its port. In particular, Windows descendants only inherit a Job Object
        // after their parent has been assigned to it; waiting for MURASAKI_PORT
        // first leaves the whole main-runtime startup window unguarded.
        if let Err(error) = guard_child(&child) {
            let _ = child.kill();
            let _ = child.wait();
            return Err(error);
        }

        match wait_for_port(&mut child, Duration::from_secs(15)) {
            Ok(port) => Ok((child, port)),
            Err(err) => {
                let _ = child.kill();
                let _ = child.wait();
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

    fn app_instance_key(app_id: &str) -> String {
        use sha2::{Digest, Sha256};

        Sha256::digest(app_id.as_bytes())
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect()
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
        // The stable HTTP port has only 14 bits and therefore cannot identify an
        // app for locking purposes: two unrelated app IDs can map to the same
        // port. Keep the lock/activation channel keyed by the full app ID hash so
        // a port collision fails at bind time instead of cross-activating another
        // application and exposing its runtime coordinates.
        let key = app_instance_key(app_id);
        Ok((
            dir.join(format!("{key}.lock")),
            dir.join(format!("{key}.activate")),
        ))
    }

    /// Acquire the per-user, app-scoped single-instance lock. The file remains
    /// locked for the primary launcher's entire lifetime; a secondary launch
    /// reads the authenticated loopback coordinates written into the same file.
    pub(super) fn acquire_instance(app_id: &str) -> Result<InstanceRole, String> {
        let (state_path, activation_path) = instance_paths(app_id)?;
        let file = OpenOptions::new()
            .create(true)
            .truncate(false)
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
            Ok(()) => Ok(InstanceRole::Primary(PrimaryInstance {
                file,
                activation_path,
            })),
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                Ok(InstanceRole::Secondary(SecondaryInstance {
                    state_path,
                    activation_path,
                }))
            }
            Err(error) => Err(format!("lock primary instance: {error}")),
        }
    }

    impl PrimaryInstance {
        pub(super) fn publish(&mut self, port: u16, runtime_token: &str) -> Result<(), String> {
            self.file
                .set_len(0)
                .map_err(|e| format!("truncate instance state: {e}"))?;
            self.file
                .seek(SeekFrom::Start(0))
                .map_err(|e| format!("seek instance state: {e}"))?;
            serde_json::to_writer(
                &mut self.file,
                &InstanceState {
                    port,
                    runtime_token: runtime_token.to_string(),
                },
            )
            .map_err(|e| format!("write instance state: {e}"))?;
            self.file
                .sync_data()
                .map_err(|e| format!("sync instance state: {e}"))
        }

        pub(super) fn take_activation(&self) -> bool {
            fs::remove_file(&self.activation_path).is_ok()
        }
    }

    impl SecondaryInstance {
        pub(super) fn activate_primary(&self, meta: &Meta) -> Result<(), String> {
            // The primary owns the lock before Node has finished listening. Retry
            // briefly until it publishes the token/port rather than racing startup.
            let state = (0..60)
                .find_map(|_| {
                    let parsed = fs::read_to_string(&self.state_path)
                        .ok()
                        .and_then(|raw| serde_json::from_str::<InstanceState>(&raw).ok());
                    if parsed.is_none() {
                        thread::sleep(Duration::from_millis(50));
                    }
                    parsed
                })
                .ok_or_else(|| "primary instance did not publish activation state".to_string())?;

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
            request_main_second_instance(state.port, &state.runtime_token, argv, cwd)?;
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
            &format!("127.0.0.1:{port}")
                .parse()
                .map_err(|e| format!("parse activation address: {e}"))?,
            timeout,
        )
        .map_err(|e| format!("connect primary instance: {e}"))?;
        stream.set_read_timeout(Some(timeout)).ok();
        stream.set_write_timeout(Some(timeout)).ok();
        let body = serde_json::json!({ "argv": argv, "cwd": cwd.to_string_lossy() }).to_string();
        let request = format!(
      "POST /__murasaki/main/second-instance HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nCookie: murasaki_runtime={runtime_token}\r\nX-Murasaki-Native-Token: {runtime_token}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
      body.len()
    );
        stream
            .write_all(request.as_bytes())
            .map_err(|e| format!("write activation: {e}"))?;
        let mut response = String::new();
        stream
            .read_to_string(&mut response)
            .map_err(|e| format!("read activation: {e}"))?;
        if !response.starts_with("HTTP/1.1 204") {
            return Err(format!(
                "primary activation returned {}",
                response.lines().next().unwrap_or("an invalid response")
            ));
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
            &format!("127.0.0.1:{port}")
                .parse()
                .map_err(|e| format!("parse open-request address: {e}"))?,
            timeout,
        )
        .map_err(|e| format!("connect main open request: {e}"))?;
        stream.set_read_timeout(Some(timeout)).ok();
        stream.set_write_timeout(Some(timeout)).ok();
        let body = serde_json::json!({
          "activation": activation,
          "transport": transport,
          "targets": targets,
          "cwd": cwd.map(|value| value.to_string_lossy().into_owned()),
        })
        .to_string();
        let request = format!(
      "POST /__murasaki/main/open-request HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nCookie: murasaki_runtime={runtime_token}\r\nX-Murasaki-Native-Token: {runtime_token}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
      body.len()
    );
        stream
            .write_all(request.as_bytes())
            .map_err(|e| format!("write main open request: {e}"))?;
        let mut response = String::new();
        stream
            .read_to_string(&mut response)
            .map_err(|e| format!("read main open request: {e}"))?;
        if !response.starts_with("HTTP/1.1 204") {
            return Err(format!(
                "main open request returned {}",
                response.lines().next().unwrap_or("an invalid response")
            ));
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
    pub(crate) fn request_main_shutdown(
        port: u16,
        runtime_token: &str,
        reason: &str,
        force: bool,
        timeout: Duration,
    ) -> Result<bool, String> {
        let connect_timeout = timeout.min(Duration::from_millis(SHUTDOWN_TRANSPORT_GRACE_MS));
        let mut stream = TcpStream::connect_timeout(
            &format!("127.0.0.1:{port}")
                .parse()
                .map_err(|e| format!("parse main address: {e}"))?,
            connect_timeout,
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

    pub(crate) enum ShutdownPoll {
        None,
        Cancelled,
        Proceed { transport_error: Option<String> },
    }

    struct ShutdownCompletion {
        id: u64,
        result: Result<bool, String>,
    }

    pub(crate) struct ShutdownCoordinator {
        next_id: u64,
        pending_id: Option<u64>,
        tx: mpsc::Sender<ShutdownCompletion>,
        rx: mpsc::Receiver<ShutdownCompletion>,
    }

    impl ShutdownCoordinator {
        pub(crate) fn new() -> Self {
            let (tx, rx) = mpsc::channel();
            Self {
                next_id: 1,
                pending_id: None,
                tx,
                rx,
            }
        }

        pub(crate) fn begin<F>(
            &mut self,
            port: u16,
            runtime_token: &str,
            reason: &str,
            timeout: Duration,
            wake: F,
        ) where
            F: FnOnce() + Send + 'static,
        {
            if self.pending_id.is_some() {
                return;
            }
            let id = self.next_id;
            self.next_id = self.next_id.wrapping_add(1).max(1);
            self.pending_id = Some(id);
            let tx = self.tx.clone();
            let runtime_token = runtime_token.to_string();
            let reason = reason.to_string();
            thread::spawn(move || {
                let result = request_main_shutdown(port, &runtime_token, &reason, false, timeout);
                let _ = tx.send(ShutdownCompletion { id, result });
                wake();
            });
        }

        pub(crate) fn poll(&mut self) -> ShutdownPoll {
            while let Ok(completion) = self.rx.try_recv() {
                if self.pending_id != Some(completion.id) {
                    continue;
                }
                self.pending_id = None;
                return match completion.result {
                    Ok(true) => ShutdownPoll::Cancelled,
                    Ok(false) => ShutdownPoll::Proceed {
                        transport_error: None,
                    },
                    Err(error) => ShutdownPoll::Proceed {
                        transport_error: Some(error),
                    },
                };
            }
            ShutdownPoll::None
        }

        #[cfg(test)]
        pub(super) fn is_pending(&self) -> bool {
            self.pending_id.is_some()
        }
    }

    enum WindowControlOutbound {
        Result {
            id: String,
            result: std::result::Result<serde_json::Value, String>,
        },
        Event(WindowLifecycleEvent),
    }

    /// Background authenticated transport between the Node Main process and
    /// the native UI thread. HTTP runs here rather than inside tao's event loop,
    /// so a busy Node hook cannot stall window painting/input.
    pub(crate) struct WindowControlCoordinator {
        commands: mpsc::Receiver<WindowControlCommand>,
        outbound: mpsc::Sender<WindowControlOutbound>,
        stop: Arc<AtomicBool>,
        worker: Option<thread::JoinHandle<()>>,
    }

    impl WindowControlCoordinator {
        pub(crate) fn start<F>(port: u16, runtime_token: &str, wake: F) -> Self
        where
            F: Fn() + Send + 'static,
        {
            let (command_tx, command_rx) = mpsc::channel();
            let (outbound_tx, outbound_rx) = mpsc::channel();
            let stop = Arc::new(AtomicBool::new(false));
            let worker_stop = stop.clone();
            let token = runtime_token.to_string();
            let worker = thread::spawn(move || {
                let mut pending_outbound = std::collections::VecDeque::new();
                while !worker_stop.load(Ordering::Relaxed) {
                    while let Ok(outbound) = outbound_rx.try_recv() {
                        if pending_outbound.len() < 256 {
                            pending_outbound.push_back(outbound);
                        }
                    }

                    while let Some(outbound) = pending_outbound.front() {
                        if post_window_control(port, &token, outbound).is_err() {
                            break;
                        }
                        pending_outbound.pop_front();
                    }

                    if let Ok(commands) = fetch_window_commands(port, &token) {
                        if !commands.is_empty() {
                            for command in commands {
                                let _ = command_tx.send(command);
                            }
                            wake();
                        }
                    }

                    match outbound_rx.recv_timeout(Duration::from_millis(50)) {
                        Ok(outbound) if pending_outbound.len() < 256 => {
                            pending_outbound.push_back(outbound)
                        }
                        Ok(_) | Err(mpsc::RecvTimeoutError::Timeout) => {}
                        Err(mpsc::RecvTimeoutError::Disconnected) => break,
                    }
                }
            });
            Self {
                commands: command_rx,
                outbound: outbound_tx,
                stop,
                worker: Some(worker),
            }
        }

        pub(crate) fn take_commands(&self) -> Vec<WindowControlCommand> {
            self.commands.try_iter().take(32).collect()
        }

        pub(crate) fn respond(
            &self,
            id: String,
            result: std::result::Result<serde_json::Value, String>,
        ) {
            let _ = self
                .outbound
                .send(WindowControlOutbound::Result { id, result });
        }

        pub(crate) fn emit(&self, event: WindowLifecycleEvent) {
            let _ = self.outbound.send(WindowControlOutbound::Event(event));
        }
    }

    impl Drop for WindowControlCoordinator {
        fn drop(&mut self) {
            self.stop.store(true, Ordering::Relaxed);
            if let Some(worker) = self.worker.take() {
                let _ = worker.join();
            }
        }
    }

    fn fetch_window_commands(
        port: u16,
        runtime_token: &str,
    ) -> Result<Vec<WindowControlCommand>, String> {
        let (status, body) = native_control_request(
            port,
            runtime_token,
            "GET",
            "/__murasaki/main/windows/commands",
            None,
        )?;
        if status != 200 {
            return Err(format!("native window command poll returned {status}"));
        }
        let commands: Vec<WindowControlCommand> = serde_json::from_str(&body)
            .map_err(|error| format!("parse native window commands: {error}"))?;
        if commands.len() > 32 {
            return Err("native window command batch exceeds 32 entries".to_string());
        }
        Ok(commands)
    }

    fn post_window_control(
        port: u16,
        runtime_token: &str,
        outbound: &WindowControlOutbound,
    ) -> Result<(), String> {
        let (path, body) = match outbound {
            WindowControlOutbound::Result { id, result } => {
                let body = match result {
                    Ok(value) => serde_json::json!({ "id": id, "ok": true, "value": value }),
                    Err(error) => serde_json::json!({ "id": id, "ok": false, "error": error }),
                };
                ("/__murasaki/main/windows/result", body)
            }
            WindowControlOutbound::Event(event) => (
                "/__murasaki/main/windows/event",
                serde_json::to_value(event).map_err(|error| error.to_string())?,
            ),
        };
        let (status, _) =
            native_control_request(port, runtime_token, "POST", path, Some(&body.to_string()))?;
        if status != 204 {
            return Err(format!("native window control POST returned {status}"));
        }
        Ok(())
    }

    fn native_control_request(
        port: u16,
        runtime_token: &str,
        method: &str,
        path: &str,
        body: Option<&str>,
    ) -> Result<(u16, String), String> {
        const MAX_RESPONSE_BYTES: u64 = 512 * 1024;
        let timeout = Duration::from_millis(500);
        let address = format!("127.0.0.1:{port}")
            .parse()
            .map_err(|error| format!("parse native control address: {error}"))?;
        let mut stream = TcpStream::connect_timeout(&address, timeout)
            .map_err(|error| format!("connect native control: {error}"))?;
        stream.set_read_timeout(Some(timeout)).ok();
        stream.set_write_timeout(Some(timeout)).ok();
        let body = body.unwrap_or("");
        let request = format!(
      "{method} {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nCookie: murasaki_runtime={runtime_token}\r\nX-Murasaki-Native-Token: {runtime_token}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
      body.len(),
    );
        stream
            .write_all(request.as_bytes())
            .map_err(|error| format!("write native control: {error}"))?;
        let mut response = String::new();
        stream
            .take(MAX_RESPONSE_BYTES)
            .read_to_string(&mut response)
            .map_err(|error| format!("read native control: {error}"))?;
        let status = response
            .lines()
            .next()
            .and_then(|line| line.split_whitespace().nth(1))
            .and_then(|value| value.parse::<u16>().ok())
            .ok_or_else(|| "native control returned an invalid HTTP response".to_string())?;
        let body = response
            .split_once("\r\n\r\n")
            .map(|(_, body)| body.to_string())
            .unwrap_or_default();
        Ok((status, body))
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
            let launcher_stdout = std::io::stdout();
            let mut forwarded = launcher_stdout.lock();
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
                // Stdout becomes block-buffered when a packaged app is launched by a
                // CI script or log collector with output redirected to a file. Flush
                // every complete child line so renderer/backend diagnostics are
                // observable while the GUI process is still running; otherwise a
                // smoke test can wait forever for a marker already sitting in this
                // process's userspace buffer.
                if writeln!(forwarded, "{line}").is_ok() {
                    let _ = forwarded.flush();
                }
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

    /// Remove an untrusted/stale update handoff without executing it. This is
    /// used when the bundled Node runtime exits unexpectedly or its graceful
    /// shutdown response cannot be authenticated to completion.
    pub(super) fn discard_apply_handoff(resources_dir: &Path) {
        let handoff_path = resources_dir.join(".murasaki-apply.json");
        match fs::remove_file(&handoff_path) {
            Ok(()) => {
                let _ = writeln!(
                    std::io::stderr(),
                    "murasaki-launcher: discarded unconfirmed update handoff {}",
                    handoff_path.display()
                );
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                let _ = writeln!(
                    std::io::stderr(),
                    "murasaki-launcher: failed to discard {}: {error}",
                    handoff_path.display()
                );
            }
        }
    }

    /// Stop and reap the complete packaged backend tree on macOS. Other
    /// platforms still reap the direct child here; Windows additionally
    /// terminates its Job Object at the call sites so descendants cannot live
    /// past a clean or failed handoff.
    pub(super) fn terminate_and_wait_child(child: &mut Child) {
        #[cfg(target_os = "macos")]
        {
            let process_group = -(child.id() as i32);
            // SAFETY: `spawn_prod_server` created the child as leader of this
            // dedicated process group. SIGKILL is intentionally bounded and
            // cannot be ignored by a stuck sidecar.
            let _ = unsafe { libc::kill(process_group, libc::SIGKILL) };
        }
        #[cfg(not(target_os = "macos"))]
        let _ = child.kill();
        let _ = child.wait();
    }

    /// Poll the bundled Node process without blocking tao's UI thread. Any
    /// observed exit is unexpected because the launcher owns normal shutdown
    /// and terminates Node only after the authenticated lifecycle completes.
    pub(super) fn poll_unexpected_child_exit(child: &mut Child) -> Result<Option<String>, String> {
        child
            .try_wait()
            .map(|status| status.map(|value| value.to_string()))
            .map_err(|error| format!("poll bundled Node process: {error}"))
    }

    pub(super) fn shutdown_allows_update(transport_error: &Option<String>) -> bool {
        transport_error.is_none()
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
            let _ = writeln!(
                std::io::stderr(),
                "murasaki-launcher: failed to spawn apply-helper: {e}"
            );
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
                let normalized_allowed: Vec<String> =
                    allowed.iter().map(|a| normalize_locale(a)).collect();
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
        use std::{
            fs,
            io::{Read, Write},
            net::TcpListener,
            process::Command,
            thread,
            time::{Duration, SystemTime, UNIX_EPOCH},
        };

        use super::{
            app_instance_key, app_origin_port, discard_apply_handoff,
            main_shutdown_transport_timeout, open_targets_from_args, poll_unexpected_child_exit,
            request_main_shutdown, resolve_windows, runtime_token, shutdown_allows_update, Meta,
            OpenTarget, ShutdownCompletion, ShutdownCoordinator, ShutdownPoll,
        };

        #[test]
        fn app_origin_is_stable_and_private() {
            let first = app_origin_port("com.example.notes");
            assert_eq!(first, app_origin_port("com.example.notes"));
            assert!((49_152..=65_535).contains(&first));
            assert_ne!(first, app_origin_port("com.example.chat"));
        }

        #[test]
        fn packaged_metadata_parses_app_wide_webview_network_settings() {
            let meta: Meta = serde_json::from_value(serde_json::json!({
                "productName": "Network test",
                "webview": {
                    "userAgent": "Murasaki/1.0",
                    "incognito": true,
                    "proxy": {
                        "protocol": "http",
                        "host": "proxy.example.com",
                        "port": 8080
                    }
                }
            }))
            .unwrap();
            assert_eq!(meta.webview.user_agent.as_deref(), Some("Murasaki/1.0"));
            assert_eq!(meta.webview.incognito, Some(true));
            let proxy = meta.webview.proxy.unwrap();
            assert_eq!(proxy.protocol, "http");
            assert_eq!(proxy.host, "proxy.example.com");
            assert_eq!(proxy.port, 8080);

            assert!(serde_json::from_value::<Meta>(serde_json::json!({
                "productName": "Invalid proxy metadata",
                "webview": {
                    "proxy": {
                        "protocol": "http",
                        "host": "proxy.example.com",
                        "port": 8080,
                        "password": "secret"
                    }
                }
            }))
            .is_err());
        }

        #[test]
        fn instance_identity_does_not_collapse_origin_port_collisions() {
            let first = "com.example.app91";
            let second = "com.example.app790";
            assert_eq!(app_origin_port(first), app_origin_port(second));
            assert_ne!(app_instance_key(first), app_instance_key(second));
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
        fn unexpected_child_exit_is_observed_without_blocking() {
            #[cfg(target_os = "windows")]
            let mut child = Command::new("cmd")
                .args(["/C", "exit", "7"])
                .spawn()
                .expect("spawn test child");
            #[cfg(not(target_os = "windows"))]
            let mut child = Command::new("sh")
                .args(["-c", "exit 7"])
                .spawn()
                .expect("spawn test child");

            let mut observed = None;
            for _ in 0..100 {
                observed = poll_unexpected_child_exit(&mut child).expect("poll child");
                if observed.is_some() {
                    break;
                }
                thread::sleep(Duration::from_millis(5));
            }
            assert!(observed.is_some_and(|status| status.contains('7')));
        }

        #[test]
        fn unconfirmed_shutdown_cannot_apply_an_update() {
            assert!(shutdown_allows_update(&None));
            assert!(!shutdown_allows_update(&Some("offline".to_string())));
        }

        #[test]
        fn failed_runtime_discards_pending_update_handoff() {
            let nonce = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let dir = std::env::temp_dir().join(format!(
                "murasaki-discard-handoff-{}-{nonce}",
                std::process::id()
            ));
            fs::create_dir_all(&dir).unwrap();
            let handoff = dir.join(".murasaki-apply.json");
            fs::write(&handoff, br#"{"payload":"x","sha256":"y"}"#).unwrap();

            discard_apply_handoff(&dir);
            assert!(!handoff.exists());
            fs::remove_dir_all(dir).unwrap();
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

            assert!(request_main_shutdown(
                port,
                "secret",
                "window-close",
                false,
                Duration::from_secs(12),
            )
            .unwrap());
            server.join().unwrap();
        }

        #[test]
        fn async_shutdown_ignores_stale_results_and_recovers_after_cancel() {
            let mut coordinator = ShutdownCoordinator::new();
            coordinator.pending_id = Some(7);
            coordinator
                .tx
                .send(ShutdownCompletion {
                    id: 6,
                    result: Ok(false),
                })
                .unwrap();
            coordinator
                .tx
                .send(ShutdownCompletion {
                    id: 7,
                    result: Ok(true),
                })
                .unwrap();
            assert!(matches!(coordinator.poll(), ShutdownPoll::Cancelled));
            assert!(!coordinator.is_pending());

            coordinator.pending_id = Some(8);
            coordinator
                .tx
                .send(ShutdownCompletion {
                    id: 8,
                    result: Err("offline".to_string()),
                })
                .unwrap();
            assert!(matches!(
              coordinator.poll(),
              ShutdownPoll::Proceed { transport_error: Some(error) } if error == "offline"
            ));
            assert!(!coordinator.is_pending());
        }

        #[test]
        fn main_shutdown_transport_timeout_tracks_config_and_rejects_extremes() {
            let default_meta: Meta = serde_json::from_value(serde_json::json!({
              "productName": "Default"
            }))
            .unwrap();
            assert_eq!(
                main_shutdown_transport_timeout(&default_meta).unwrap(),
                Duration::from_millis(12_000),
            );

            let configured: Meta = serde_json::from_value(serde_json::json!({
              "productName": "Configured",
              "mainShutdownTimeoutMs": 20_000
            }))
            .unwrap();
            assert_eq!(
                main_shutdown_transport_timeout(&configured).unwrap(),
                Duration::from_millis(22_000),
            );

            for timeout in [0_u64, 300_001, u64::MAX] {
                let invalid: Meta = serde_json::from_value(serde_json::json!({
                  "productName": "Invalid",
                  "mainShutdownTimeoutMs": timeout
                }))
                .unwrap();
                assert!(main_shutdown_transport_timeout(&invalid).is_err());
            }
            assert!(serde_json::from_value::<Meta>(serde_json::json!({
              "productName": "Fractional",
              "mainShutdownTimeoutMs": 1.5
            }))
            .is_err());
        }

        #[test]
        fn normalizes_only_registered_open_arguments() {
            let meta: Meta = serde_json::from_value(serde_json::json!({
              "productName": "Violet",
              "protocols": [{ "scheme": "violet" }],
              "fileAssociations": [{ "extensions": ["vnote"] }]
            }))
            .unwrap();
            let root =
                std::env::temp_dir().join(format!("murasaki-open-test-{}", std::process::id()));
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
            assert_eq!(
                targets[0],
                OpenTarget::Url {
                    url: "violet://open/42".to_string(),
                    scheme: "violet".to_string(),
                }
            );
            assert_eq!(
                targets[1],
                OpenTarget::File {
                    path: fs::canonicalize(root.join("hello.vnote"))
                        .unwrap()
                        .to_string_lossy()
                        .into_owned(),
                }
            );
            let _ = fs::remove_dir_all(root);
        }

        #[test]
        fn resolves_declarative_windows_and_legacy_metadata() {
            let meta: Meta = serde_json::from_value(serde_json::json!({
              "productName": "Violet",
              "windows": [
                {
                  "label": "main",
                  "primary": true,
                  "route": "/",
                  "visible": true,
                  "capabilities": ["window:open"],
                  "capabilityPolicy": "{\"version\":1,\"grants\":[\"window:open\"]}"
                },
                {
                  "label": "settings",
                  "route": "/settings",
                  "visible": false,
                  "width": 640,
                  "height": 480,
                  "capabilities": ["window:getLabel"]
                }
              ]
            }))
            .unwrap();
            let windows = resolve_windows(&meta).unwrap();
            assert_eq!(windows.len(), 2);
            assert_eq!(windows[0].label, "main");
            assert!(windows[0].is_primary());
            assert!(windows[0]
                .capability_policy
                .as_deref()
                .unwrap()
                .contains("window:open"));
            assert_eq!(windows[1].label, "settings");
            assert!(!windows[1].is_primary());
            assert_eq!(windows[1].route(), "/settings");
            assert_eq!(windows[1].visible, Some(false));
            assert_eq!(
                windows[1].capabilities.as_ref().unwrap()[0],
                "window:getLabel"
            );

            let legacy: Meta = serde_json::from_value(serde_json::json!({
              "productName": "Legacy",
              "width": 900,
              "capabilities": ["clipboard:readText"],
              "capabilityPolicy": "{\"version\":1,\"grants\":[\"clipboard:readText\"]}"
            }))
            .unwrap();
            let legacy_windows = resolve_windows(&legacy).unwrap();
            assert_eq!(legacy_windows.len(), 1);
            assert_eq!(legacy_windows[0].label, "main");
            assert_eq!(legacy_windows[0].width, Some(900));
            assert_eq!(
                legacy_windows[0].capabilities.as_ref().unwrap()[0],
                "clipboard:readText"
            );
            assert!(legacy_windows[0]
                .capability_policy
                .as_deref()
                .unwrap()
                .contains("clipboard:readText"));
        }

        #[test]
        fn window_metadata_parses_frameless_titlebar_max_size_and_fullscreen_fields() {
            let meta: Meta = serde_json::from_value(serde_json::json!({
              "productName": "Frameless",
              "windows": [
                {
                  "label": "main",
                  "primary": true,
                  "decorations": false,
                  "titleBarStyle": "hidden",
                  "maxWidth": 1600,
                  "maxHeight": 1200,
                  "fullscreen": true
                },
                { "label": "settings" }
              ]
            }))
            .unwrap();
            let windows = resolve_windows(&meta).unwrap();
            assert_eq!(windows[0].decorations, Some(false));
            assert_eq!(windows[0].title_bar_style.as_deref(), Some("hidden"));
            assert_eq!(windows[0].max_width, Some(1600));
            assert_eq!(windows[0].max_height, Some(1200));
            assert_eq!(windows[0].fullscreen, Some(true));
            // Unset on a declaration that never mentions these keys.
            assert_eq!(windows[1].decorations, None);
            assert_eq!(windows[1].title_bar_style, None);
            assert_eq!(windows[1].max_width, None);
            assert_eq!(windows[1].fullscreen, None);

            // The legacy single-window fallback (no `windows` array) carries the
            // same top-level fields through onto the synthesized `main` entry.
            let legacy: Meta = serde_json::from_value(serde_json::json!({
              "productName": "Legacy Frameless",
              "decorations": false,
              "titleBarStyle": "hidden",
              "maxWidth": 2000,
              "maxHeight": 1500,
              "fullscreen": true
            }))
            .unwrap();
            let legacy_windows = resolve_windows(&legacy).unwrap();
            assert_eq!(legacy_windows[0].decorations, Some(false));
            assert_eq!(legacy_windows[0].title_bar_style.as_deref(), Some("hidden"));
            assert_eq!(legacy_windows[0].max_width, Some(2000));
            assert_eq!(legacy_windows[0].max_height, Some(1500));
            assert_eq!(legacy_windows[0].fullscreen, Some(true));
        }

        #[test]
        fn rejects_unsafe_or_ambiguous_window_metadata() {
            for windows in [
                serde_json::json!([
                  { "label": "main", "primary": true },
                  { "label": "main" }
                ]),
                serde_json::json!([
                  { "label": "main", "primary": true },
                  { "label": "settings", "primary": true }
                ]),
                serde_json::json!([
                  { "label": "main", "primary": true },
                  { "label": "settings", "route": "https://example.com" }
                ]),
            ] {
                let meta: Meta = serde_json::from_value(serde_json::json!({
                  "productName": "Invalid",
                  "windows": windows,
                }))
                .unwrap();
                assert!(resolve_windows(&meta).is_err());
            }
        }
    }
}

#[cfg(target_os = "macos")]
mod imp_macos {
    use std::{
        cell::RefCell,
        path::Path,
        process::Command,
        rc::Rc,
        sync::Arc,
        time::{Duration, Instant},
    };

    use tao::{
        event::{Event, WindowEvent},
        event_loop::{ControlFlow, EventLoop},
    };

    use crate::{
        menu::{build_default_app_menu, AboutInfo, AboutInfoOwned, SharedMenu},
        types::{RuntimeWindowTemplate, WebviewOptions, WindowOptions},
        webview::{AppMenuContext, ProcessWebContext, SharedWebContext},
        window::{
            execute_window_control, RuntimeWindowManager, SharedWindowRegistry, WindowRegistry,
        },
    };

    use super::shared::{
        acquire_instance, app_origin_port, discard_apply_handoff, load_menu_locales,
        main_shutdown_transport_timeout, maybe_spawn_apply_helper, normalize_locale,
        open_targets_from_args, open_targets_from_urls, poll_unexpected_child_exit, read_meta,
        request_main_open, resolve_menu_labels, resolve_windows, runtime_token,
        shutdown_allows_update, spawn_prod_server, terminate_and_wait_child, InstanceRole,
        ShutdownCoordinator, ShutdownPoll, WindowControlCoordinator,
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
        // Derive the app target without touching Resources first: a broken new
        // bundle may be missing those files, but must still be able to hand off
        // to the recovery helper and restore the previous bundle.
        let app_bundle = macos_dir
            .parent()
            .and_then(Path::parent)
            .map(Path::to_path_buf)
            .ok_or_else(|| "murasaki-launcher: could not resolve .app bundle path".to_string())?;
        match crate::updater::prepare_startup_update(&app_bundle)? {
            crate::updater::StartupUpdateAction::None
            | crate::updater::StartupUpdateAction::ContinueHealthAttempt => {}
            crate::updater::StartupUpdateAction::ExitForUpdateInProgress => return Ok(()),
            crate::updater::StartupUpdateAction::RecoveryRequired {
                relaunch: _,
                failed_pid,
            } => {
                crate::updater::spawn_recovery_helper(&app_bundle, failed_pid)?;
                return Ok(());
            }
        }
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
        let meta = read_meta(&resources_dir)?;
        let shutdown_transport_timeout = main_shutdown_transport_timeout(&meta)?;
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
            |_| Ok(()),
        )?;
        primary_instance.publish(port, &runtime_token)?;
        let startup_argv: Vec<String> = std::env::args().skip(1).collect();
        let startup_cwd = std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("."));
        let startup_targets = open_targets_from_args(&meta, &startup_argv, &startup_cwd);
        if !startup_targets.is_empty() {
            request_main_open(
                port,
                &runtime_token,
                "cold-start",
                "argv",
                startup_targets,
                Some(startup_cwd),
            )?;
        }

        set_activation_policy_regular();

        let event_loop = EventLoop::<()>::new();
        crate::system_permission::request_many(&meta.system_permissions_on_launch)?;
        // Lets the IPC handler (`appQuit`, from `quit()`) wake this event loop —
        // see `webview::Webview::new`'s `wake` parameter doc comment. Without
        // this, a JS-posted IPC message generates no OS event, so a
        // `ControlFlow::Wait` loop never re-polls `quit_requested()` until the
        // next mouse/keyboard event.
        let quit_proxy = event_loop.create_proxy();
        let shortcut_proxy = quit_proxy.clone();
        crate::global_shortcut::set_event_waker(Arc::new(move || {
            let _ = shortcut_proxy.send_event(());
        }));

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
            icon_path: icon_path
                .as_ref()
                .and_then(|p| p.to_str())
                .map(String::from),
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

        let declarations = resolve_windows(&meta)?;
        let windows: SharedWindowRegistry = Rc::new(RefCell::new(WindowRegistry::default()));
        let web_context: SharedWebContext = Rc::new(RefCell::new(ProcessWebContext::default()));
        let runtime_templates = declarations
            .into_iter()
            .map(|declaration| {
                let route = declaration.route().to_string();
                let template = RuntimeWindowTemplate {
                    window: WindowOptions {
                        label: Some(declaration.label),
                        primary: declaration.primary,
                        visible: declaration.visible,
                        title: Some(
                            declaration
                                .title
                                .unwrap_or_else(|| meta.product_name.clone()),
                        ),
                        width: declaration.width.or(Some(1000)),
                        height: declaration.height.or(Some(700)),
                        min_width: declaration.min_width,
                        min_height: declaration.min_height,
                        resizable: declaration.resizable,
                        transparent: declaration.transparent,
                        vibrancy: declaration.vibrancy,
                        decorations: declaration.decorations,
                        title_bar_style: declaration.title_bar_style,
                        max_width: declaration.max_width,
                        max_height: declaration.max_height,
                        fullscreen: declaration.fullscreen,
                        icon: icon_path
                            .as_ref()
                            .and_then(|path| path.to_str())
                            .map(String::from),
                        version: meta.version.clone(),
                        description: meta.description.clone(),
                        copyright: meta.copyright.clone(),
                        homepage: meta.homepage.clone(),
                        authors: meta.authors.clone(),
                        menu_labels: Some(menu_labels.clone()),
                    },
                    webview: WebviewOptions {
                        url: Some(format!("http://127.0.0.1:{port}{}", route)),
                        html: None,
                        devtools: Some(false),
                        transparent: declaration.transparent,
                        app_id: meta.app_id.clone(),
                        user_agent: meta.webview.user_agent.clone(),
                        incognito: meta.webview.incognito,
                        proxy: meta.webview.proxy.clone(),
                        capabilities: declaration.capabilities,
                        capability_policy: declaration.capability_policy,
                        tray_icon: icon_path
                            .as_ref()
                            .and_then(|path| path.to_str())
                            .map(String::from),
                        serve_dir: None,
                        downloads: meta.webview.downloads.clone(),
                        init_scripts: meta.webview.init_scripts.clone(),
                        hotkeys_zoom: meta.webview.hotkeys_zoom,
                    },
                    create_on_launch: declaration.create_on_launch,
                };
                (template, app_menu_context.clone())
            })
            .collect();
        let manager_wake = quit_proxy.clone();
        let mut runtime_windows = RuntimeWindowManager::new(
            windows.clone(),
            web_context,
            Rc::new(move || {
                let _ = manager_wake.send_event(());
            }),
        );
        runtime_windows.configure(runtime_templates)?;
        runtime_windows.create_on_launch(&event_loop)?;

        // Dock/About-panel icon — mirrors Application::set_icon_path. As the real
        // CFBundleExecutable, CFBundleIconFile (see cli/bundle.ts's Info.plist)
        // already covers the Dock/Finder icon; this additionally covers the
        // About panel, which doesn't reliably pick up CFBundleIconFile.
        if let Some(path) = &icon_path {
            set_app_icon(path);
        }

        // This is the updater's first-launch health checkpoint: the packaged
        // Node runtime is listening, the instance endpoint is published, and
        // every createOnLaunch native window/webview has been created. Dormant
        // templates are intentionally outside this startup checkpoint. Only
        // now is it safe to delete the previous bundle retained by the helper.
        if let Some(status) = poll_unexpected_child_exit(&mut child)? {
            discard_apply_handoff(&resources_dir);
            terminate_and_wait_child(&mut child);
            return Err(format!(
                "bundled Node process exited before startup health acknowledgement: {status}"
            ));
        }
        if let Err(error) = crate::updater::acknowledge_update_health(&app_bundle) {
            terminate_and_wait_child(&mut child);
            return Err(format!("acknowledge update health: {error}"));
        }

        // tao's `EventLoop::run` never returns (`-> !`) and explicitly documents
        // that "values not passed to this function will *not* be dropped" — so
        // `runtime_windows` owns the frozen catalog and shared browser context
        // and moves into the event-loop closure with the registry. The child,
        // resources dir, and app bundle move there too so menu dispatch can
        // select the focused webview, runtime create/destroy can build only a
        // declared template, and clean exit can perform update handoff.
        let mut completed_initial_event_cycle = false;
        let mut received_open_event = false;
        let mut shutdown = ShutdownCoordinator::new();
        let control_wake = quit_proxy.clone();
        let window_control = WindowControlCoordinator::start(port, &runtime_token, move || {
            let _ = control_wake.send_event(());
        });
        event_loop.run(move |event, target, control_flow| {
            *control_flow = ControlFlow::WaitUntil(Instant::now() + Duration::from_millis(250));
            if matches!(&event, Event::LoopDestroyed) {
                let resources = windows.borrow_mut().prepare_close_all();
                crate::window::drop_all_webviews(resources);
                terminate_and_wait_child(&mut child);
                return;
            }
            match poll_unexpected_child_exit(&mut child) {
                Ok(None) => {}
                Ok(Some(status)) => {
                    eprintln!(
                        "murasaki-launcher: bundled Node process exited unexpectedly: {status}"
                    );
                    discard_apply_handoff(&resources_dir);
                    let resources = windows.borrow_mut().prepare_close_all();
                    crate::window::drop_all_webviews(resources);
                    terminate_and_wait_child(&mut child);
                    std::process::exit(1);
                }
                Err(error) => {
                    eprintln!("murasaki-launcher: {error}");
                    discard_apply_handoff(&resources_dir);
                    let resources = windows.borrow_mut().prepare_close_all();
                    crate::window::drop_all_webviews(resources);
                    terminate_and_wait_child(&mut child);
                    std::process::exit(1);
                }
            }
            let shutdown_proceed = match shutdown.poll() {
                ShutdownPoll::Proceed { transport_error } => Some(transport_error),
                ShutdownPoll::Cancelled | ShutdownPoll::None => None,
            };
            for command in window_control.take_commands() {
                let result = if matches!(command.method.as_str(), "create" | "destroy") {
                    runtime_windows.execute(target, &command)
                } else {
                    execute_window_control(&windows, &command)
                };
                window_control.respond(command.id, result);
            }

            if primary_instance.take_activation() {
                if let Some(window_slot) = WindowRegistry::primary_window(&windows) {
                    if let Some(window) = window_slot.borrow().as_ref() {
                        window.set_visible(true);
                        window.set_minimized(false);
                        window.set_focus();
                    }
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
                    let transport = if targets
                        .iter()
                        .any(|target| matches!(target, super::shared::OpenTarget::Url { .. }))
                    {
                        "open-url"
                    } else {
                        "open-file"
                    };
                    let _ = request_main_open(
                        port,
                        &runtime_token,
                        activation,
                        transport,
                        targets,
                        None,
                    );
                    received_open_event = true;
                    if let Some(window_slot) = WindowRegistry::primary_window(&windows) {
                        if let Some(window) = window_slot.borrow().as_ref() {
                            window.set_visible(true);
                            window.set_minimized(false);
                            window.set_focus();
                        }
                    }
                }
            }
            if matches!(&event, Event::MainEventsCleared) {
                completed_initial_event_cycle = true;
            }

            // Lifecycle roles follow the focused window. Custom application-menu
            // ids always return to the primary renderer, which exclusively owns
            // `useAppMenu` handlers.
            let mut shutdown_reason = None;
            if let (Some((label, window_slot, _)), Some((_, _, app_menu_webview))) = (
                WindowRegistry::dispatch_target(&windows),
                WindowRegistry::primary_dispatch_target(&windows),
            ) {
                let outcome = crate::webview::poll_app_menu_events(
                    &window_slot,
                    &app_menu_webview,
                    &app_menu_slot,
                );
                if outcome.quit {
                    shutdown_reason = Some("app-quit");
                }
                if outcome.close {
                    if windows.borrow().is_primary(&label) {
                        shutdown_reason = Some("window-close");
                    } else {
                        crate::window::set_window_visible(&window_slot, false);
                        windows.borrow_mut().record_lifecycle("hidden", &label);
                    }
                }
            }
            if let Some((_label, webview_slot, tray_slot)) =
                WindowRegistry::tray_dispatch_target(&windows)
            {
                crate::webview::poll_tray_events(&webview_slot, &tray_slot);
            }
            crate::webview::poll_global_shortcut_events(&windows);
            let close_requests = windows.borrow_mut().take_close_requests();
            for label in close_requests {
                if windows.borrow().is_primary(&label) {
                    shutdown_reason = Some("window-close");
                } else {
                    let resources = windows.borrow_mut().prepare_close_secondary(&label);
                    match resources {
                        Ok(resources) => crate::window::drop_closed_window(resources),
                        Err(error) => {
                            eprintln!("murasaki-launcher: failed to close window {label}: {error}")
                        }
                    }
                }
            }

            // `quit()` (`{ kind: "appQuit" }`) — see `webview::quit_requested`'s
            // doc comment. Same clean-shutdown as the window's own close button
            // just below: best-effort kill the spawned `node` child, hand off to
            // the apply-helper if one is pending, then exit.
            if crate::webview::quit_requested() {
                shutdown_reason = Some("app-quit");
            }

            if let Event::WindowEvent {
                event: WindowEvent::CloseRequested,
                window_id,
                ..
            } = &event
            {
                let identity = WindowRegistry::identity_for_id(&windows, *window_id);
                if let Some(identity) = identity {
                    if windows.borrow().is_primary(&identity.label) {
                        shutdown_reason = Some("window-close");
                    } else {
                        let window = windows.borrow().live_window(&identity.label);
                        match window {
                            Ok(window) => {
                                crate::window::set_window_visible(&window, false);
                                windows
                                    .borrow_mut()
                                    .record_lifecycle_for_identity("hidden", &identity);
                            }
                            Err(error) => eprintln!(
                                "murasaki-launcher: failed to hide window {}: {error}",
                                identity.label
                            ),
                        }
                    }
                }
            }

            if let Event::WindowEvent {
                event: WindowEvent::Focused(focused),
                window_id,
                ..
            } = &event
            {
                if let Some(identity) = WindowRegistry::identity_for_id(&windows, *window_id) {
                    windows.borrow_mut().record_lifecycle_for_identity(
                        if *focused { "focused" } else { "blurred" },
                        &identity,
                    );
                }
            }

            for event in windows.borrow_mut().take_lifecycle_events() {
                window_control.emit(event);
            }

            if let Some(reason) = shutdown_reason {
                let wake = quit_proxy.clone();
                shutdown.begin(
                    port,
                    &runtime_token,
                    reason,
                    shutdown_transport_timeout,
                    move || {
                        let _ = wake.send_event(());
                    },
                );
            }
            if let Some(transport_error) = shutdown_proceed {
                let confirmed_shutdown = shutdown_allows_update(&transport_error);
                if let Some(error) = transport_error.as_ref() {
                    eprintln!("murasaki-launcher: graceful shutdown transport failed: {error}");
                }
                *control_flow = ControlFlow::Exit;
                let resources = windows.borrow_mut().prepare_close_all();
                crate::window::drop_all_webviews(resources);
                terminate_and_wait_child(&mut child);
                if confirmed_shutdown {
                    maybe_spawn_apply_helper(&resources_dir, &app_bundle, &app_bundle);
                } else {
                    discard_apply_handoff(&resources_dir);
                }
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

        let Some(mtm) = MainThreadMarker::new() else {
            return;
        };
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
                SetInformationJobObject, TerminateJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
                JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
            },
        },
    };

    pub(super) struct KillOnCloseJob(HANDLE);

    impl KillOnCloseJob {
        /// Creates the job object and sets `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`
        /// on it. Callers fail startup if this returns `None`: running without
        /// this guard can orphan the packaged Node backend after a launcher crash.
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
        /// job handle closes. Callers treat `false` as a fatal startup error and
        /// explicitly terminate the just-spawned child.
        pub(super) fn assign(&self, child: &std::process::Child) -> bool {
            use std::os::windows::io::AsRawHandle;
            let process = HANDLE(child.as_raw_handle());
            unsafe { AssignProcessToJobObject(self.0, process) }.is_ok()
        }

        /// Immediately terminate every process in the job. Clean shutdown and
        /// unexpected Node exit both call this before update handoff so a
        /// descendant cannot keep files locked or outlive the desktop host.
        pub(super) fn terminate(&self) {
            let _ = unsafe { TerminateJobObject(self.0, 1) };
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
    use std::{
        cell::RefCell,
        io::Write,
        path::Path,
        rc::Rc,
        sync::Arc,
        time::{Duration, Instant},
    };

    use tao::{
        event::{Event, WindowEvent},
        event_loop::{ControlFlow, EventLoop},
        window::Icon,
    };

    use crate::{
        menu::{build_windows_menu_bar, AboutInfo, SharedMenu},
        types::{RuntimeWindowTemplate, WebviewOptions, WindowOptions},
        webview::{poll_menu_bar_events, AppMenuContext, ProcessWebContext, SharedWebContext},
        window::{
            execute_window_control, RuntimeWindowManager, SharedWindowRegistry, WindowRegistry,
        },
    };

    use super::shared::{
        acquire_instance, app_origin_port, discard_apply_handoff, load_menu_locales,
        main_shutdown_transport_timeout, maybe_spawn_apply_helper, normalize_locale,
        open_targets_from_args, open_targets_from_urls, poll_unexpected_child_exit, read_meta,
        request_main_open, resolve_menu_labels, resolve_windows, runtime_token,
        shutdown_allows_update, spawn_prod_server, terminate_and_wait_child, InstanceRole,
        ShutdownCoordinator, ShutdownPoll, WindowControlCoordinator,
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
        let resources_dir = exe
            .parent()
            .ok_or_else(|| "murasaki-launcher: executable has no parent directory".to_string())?
            .join("resources");
        let meta = read_meta(&resources_dir)?;
        let app_id = meta.app_id.as_deref().ok_or_else(|| {
            "murasaki-launcher: association metadata is missing appId".to_string()
        })?;
        let command = format!("\"{}\" \"%1\"", exe.to_string_lossy());
        for protocol in &meta.protocols {
            let key = format!("Software\\Classes\\{}", protocol.scheme);
            let command_key = format!("{key}\\shell\\open\\command");
            let current_command = read_registry_string(&command_key, None);
            // The marker is diagnostic only. Another installer can legitimately
            // replace the scheme command without knowing to remove our private
            // marker, so only the live command proves ownership for overwrite or
            // deletion decisions.
            let command_owned_by_this_app = current_command
                .as_deref()
                .is_some_and(|value| value.eq_ignore_ascii_case(&command));
            if matches!(mode, AssociationMode::Install)
                && (current_command.is_none() || command_owned_by_this_app)
            {
                set_registry_string(
                    &key,
                    None,
                    &format!(
                        "URL:{}",
                        protocol.name.as_deref().unwrap_or(&meta.product_name)
                    ),
                )?;
                set_registry_string(&key, Some("URL Protocol"), "")?;
                set_registry_string(&key, Some("MurasakiAppId"), app_id)?;
                set_registry_string(
                    &format!("{key}\\DefaultIcon"),
                    None,
                    &format!("{},0", exe.to_string_lossy()),
                )?;
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
        use windows::{
            core::PCWSTR,
            Win32::{
                Foundation::ERROR_SUCCESS,
                System::Registry::{
                    RegCloseKey, RegCreateKeyExW, RegSetValueExW, HKEY, HKEY_LOCAL_MACHINE,
                    KEY_SET_VALUE, REG_OPTION_NON_VOLATILE, REG_SZ,
                },
            },
        };
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
            return Err(format!(
                "create association registry key {path}: {}",
                created.0
            ));
        }
        let encoded = wide(value);
        let bytes = unsafe {
            std::slice::from_raw_parts(
                encoded.as_ptr().cast::<u8>(),
                encoded.len() * std::mem::size_of::<u16>(),
            )
        };
        let value_name = name_wide
            .as_ref()
            .map_or(PCWSTR::null(), |item| PCWSTR(item.as_ptr()));
        let written = unsafe { RegSetValueExW(key, value_name, None, REG_SZ, Some(bytes)) };
        let _ = unsafe { RegCloseKey(key) };
        if written != ERROR_SUCCESS {
            return Err(format!(
                "write association registry key {path}: {}",
                written.0
            ));
        }
        Ok(())
    }

    fn read_registry_string(path: &str, name: Option<&str>) -> Option<String> {
        use windows::{
            core::PCWSTR,
            Win32::{
                Foundation::ERROR_SUCCESS,
                System::Registry::{RegGetValueW, HKEY_LOCAL_MACHINE, RRF_RT_REG_SZ},
            },
        };
        let path_wide = wide(path);
        let name_wide = name.map(wide);
        let value_name = name_wide
            .as_ref()
            .map_or(PCWSTR::null(), |item| PCWSTR(item.as_ptr()));
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
        if sized != ERROR_SUCCESS || bytes < 2 {
            return None;
        }
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
        if read != ERROR_SUCCESS {
            return None;
        }
        while buffer.last() == Some(&0) {
            buffer.pop();
        }
        String::from_utf16(&buffer).ok()
    }

    fn delete_registry_tree(path: &str) -> Result<(), String> {
        use windows::{
            core::PCWSTR,
            Win32::{
                Foundation::{ERROR_FILE_NOT_FOUND, ERROR_SUCCESS},
                System::Registry::{RegDeleteTreeW, HKEY_LOCAL_MACHINE},
            },
        };
        let path_wide = wide(path);
        let deleted = unsafe { RegDeleteTreeW(HKEY_LOCAL_MACHINE, PCWSTR(path_wide.as_ptr())) };
        if deleted != ERROR_SUCCESS && deleted != ERROR_FILE_NOT_FOUND {
            return Err(format!(
                "delete association registry key {path}: {}",
                deleted.0
            ));
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
        let apply_target = exe_dir.to_path_buf();
        match crate::updater::prepare_startup_update(&apply_target)? {
            crate::updater::StartupUpdateAction::None
            | crate::updater::StartupUpdateAction::ContinueHealthAttempt => {}
            crate::updater::StartupUpdateAction::ExitForUpdateInProgress => return Ok(()),
            crate::updater::StartupUpdateAction::RecoveryRequired {
                relaunch: _,
                failed_pid,
            } => {
                crate::updater::spawn_recovery_helper(&apply_target, failed_pid)?;
                return Ok(());
            }
        }
        let resources_dir = exe_dir
            .join("resources")
            .canonicalize()
            .map_err(|e| format!("resolve resources dir: {e}"))?;

        let meta = read_meta(&resources_dir)?;
        let shutdown_transport_timeout = main_shutdown_transport_timeout(&meta)?;
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
        let apply_relaunch = apply_target.join(format!("{}.exe", meta.product_name));

        // Create the lifetime guard before spawning. `spawn_prod_server` assigns
        // node.exe to it immediately after `Command::spawn`, before waiting for
        // the main runtime to start and print MURASAKI_PORT. This matters because
        // only descendants created after assignment inherit the Job Object.
        // `job` intentionally remains alive for the rest of this stack frame.
        let job = match KillOnCloseJob::new() {
            Some(job) => job,
            None => {
                return Err(
                    "Windows Job Object setup failed; refused to start an unguarded Node backend"
                        .to_string(),
                );
            }
        };

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
            |child| {
                if job.assign(child) {
                    Ok(())
                } else {
                    Err(
            "Windows Job Object assignment failed; refused to start an unguarded Node backend"
              .to_string(),
          )
                }
            },
        )?;

        primary_instance.publish(port, &runtime_token)?;
        let startup_argv: Vec<String> = std::env::args().skip(1).collect();
        let startup_cwd = std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("."));
        let startup_targets = open_targets_from_args(&meta, &startup_argv, &startup_cwd);
        if !startup_targets.is_empty() {
            request_main_open(
                port,
                &runtime_token,
                "cold-start",
                "argv",
                startup_targets,
                Some(startup_cwd),
            )?;
        }

        let event_loop = EventLoop::<()>::new();
        // Lets the IPC handler (`appQuit`, from `quit()`) wake this event loop —
        // see `webview::Webview::new`'s `wake` parameter doc comment / the
        // matching comment in `imp_macos`.
        let quit_proxy = event_loop.create_proxy();
        let shortcut_proxy = quit_proxy.clone();
        crate::global_shortcut::set_event_waker(Arc::new(move || {
            let _ = shortcut_proxy.send_event(());
        }));

        // Title-bar/Alt-Tab window icon — see the module doc comment above for
        // why this is needed in addition to the .exe's already-embedded PE icon.
        // `None` (no `config.icon`, or a decode failure) just means
        // `with_window_icon` leaves tao's default in place, same as before this.
        let window_icon = meta
            .icon
            .as_ref()
            .map(|icon| resources_dir.join(icon))
            .and_then(|path| load_window_icon(&path));

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
        // Retained so a later `{ kind: "appMenu" }` IPC message (`useAppMenu`)
        // can replace it — see `AppMenuContext`'s doc comment in webview.rs.
        let app_menu_slot: SharedMenu = Rc::new(RefCell::new(Some(menu_bar)));
        let app_menu_context = AppMenuContext {
            menu_slot: app_menu_slot.clone(),
            menu_labels: Some(menu_labels.clone()),
        };

        let declarations = resolve_windows(&meta)?;
        let windows: SharedWindowRegistry = Rc::new(RefCell::new(WindowRegistry::default()));
        let web_context: SharedWebContext = Rc::new(RefCell::new(ProcessWebContext::default()));
        let runtime_templates = declarations
            .into_iter()
            .map(|declaration| {
                let route = declaration.route().to_string();
                let template = RuntimeWindowTemplate {
                    window: WindowOptions {
                        label: Some(declaration.label),
                        primary: declaration.primary,
                        visible: declaration.visible,
                        title: Some(
                            declaration
                                .title
                                .unwrap_or_else(|| meta.product_name.clone()),
                        ),
                        width: declaration.width.or(Some(1000)),
                        height: declaration.height.or(Some(700)),
                        min_width: declaration.min_width,
                        min_height: declaration.min_height,
                        resizable: declaration.resizable,
                        transparent: declaration.transparent,
                        vibrancy: declaration.vibrancy,
                        decorations: declaration.decorations,
                        title_bar_style: declaration.title_bar_style,
                        max_width: declaration.max_width,
                        max_height: declaration.max_height,
                        fullscreen: declaration.fullscreen,
                        icon: None,
                        version: meta.version.clone(),
                        description: meta.description.clone(),
                        copyright: meta.copyright.clone(),
                        homepage: meta.homepage.clone(),
                        authors: meta.authors.clone(),
                        menu_labels: Some(menu_labels.clone()),
                    },
                    webview: WebviewOptions {
                        url: Some(format!("http://127.0.0.1:{port}{route}")),
                        html: None,
                        devtools: Some(false),
                        transparent: declaration.transparent,
                        app_id: meta.app_id.clone(),
                        user_agent: meta.webview.user_agent.clone(),
                        incognito: meta.webview.incognito,
                        proxy: meta.webview.proxy.clone(),
                        capabilities: declaration.capabilities,
                        capability_policy: declaration.capability_policy,
                        tray_icon: meta
                            .icon
                            .as_ref()
                            .map(|icon| resources_dir.join(icon).to_string_lossy().into_owned()),
                        serve_dir: None,
                        downloads: meta.webview.downloads.clone(),
                        init_scripts: meta.webview.init_scripts.clone(),
                        hotkeys_zoom: meta.webview.hotkeys_zoom,
                    },
                    create_on_launch: declaration.create_on_launch,
                };
                (template, app_menu_context.clone())
            })
            .collect();
        let manager_wake = quit_proxy.clone();
        let mut runtime_windows = RuntimeWindowManager::new(
            windows.clone(),
            web_context,
            Rc::new(move || {
                let _ = manager_wake.send_event(());
            }),
        );
        runtime_windows.configure(runtime_templates)?;
        runtime_windows.set_windows_icon(window_icon.clone())?;
        runtime_windows.create_on_launch(&event_loop)?;

        if let Some(status) = poll_unexpected_child_exit(&mut child)? {
            discard_apply_handoff(&resources_dir);
            job.terminate();
            return Err(format!(
                "bundled Node process exited before startup health acknowledgement: {status}"
            ));
        }
        if let Err(error) = crate::updater::acknowledge_update_health(&apply_target) {
            job.terminate();
            terminate_and_wait_child(&mut child);
            return Err(format!("acknowledge update health: {error}"));
        }

        // Same shutdown story as the macOS launcher (see that module's
        // `event_loop.run` comment): tao's `EventLoop::run` never returns and
        // explicitly documents that values not passed into it aren't dropped, so
        // `runtime_windows` owns the frozen catalog and shared browser context
        // and moves into the event-loop closure with the registry. `job`,
        // `child`, `resources_dir`, `apply_target`, and `apply_relaunch` remain
        // alive there too, so runtime window commands and every clean update
        // handoff share the same process lifetime.
        let mut completed_initial_event_cycle = false;
        let mut received_open_event = false;
        let mut shutdown = ShutdownCoordinator::new();
        let control_wake = quit_proxy.clone();
        let window_control = WindowControlCoordinator::start(port, &runtime_token, move || {
            let _ = control_wake.send_event(());
        });
        event_loop.run(move |event, target, control_flow| {
            *control_flow = ControlFlow::WaitUntil(Instant::now() + Duration::from_millis(250));
            match poll_unexpected_child_exit(&mut child) {
                Ok(None) => {}
                Ok(Some(status)) => {
                    let _ = writeln!(
                        std::io::stderr(),
                        "murasaki-launcher: bundled Node process exited unexpectedly: {status}"
                    );
                    discard_apply_handoff(&resources_dir);
                    let resources = windows.borrow_mut().prepare_close_all();
                    crate::window::drop_all_webviews(resources);
                    job.terminate();
                    std::process::exit(1);
                }
                Err(error) => {
                    let _ = writeln!(std::io::stderr(), "murasaki-launcher: {error}");
                    discard_apply_handoff(&resources_dir);
                    let resources = windows.borrow_mut().prepare_close_all();
                    crate::window::drop_all_webviews(resources);
                    job.terminate();
                    terminate_and_wait_child(&mut child);
                    std::process::exit(1);
                }
            }
            let shutdown_proceed = match shutdown.poll() {
                ShutdownPoll::Proceed { transport_error } => Some(transport_error),
                ShutdownPoll::Cancelled | ShutdownPoll::None => None,
            };
            for command in window_control.take_commands() {
                let result = if matches!(command.method.as_str(), "create" | "destroy") {
                    runtime_windows.execute(target, &command)
                } else {
                    execute_window_control(&windows, &command)
                };
                window_control.respond(command.id, result);
            }

            if primary_instance.take_activation() {
                if let Some(window_slot) = WindowRegistry::primary_window(&windows) {
                    if let Some(window) = window_slot.borrow().as_ref() {
                        window.set_visible(true);
                        window.set_minimized(false);
                        window.set_focus();
                    }
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
                    let transport = if targets
                        .iter()
                        .any(|target| matches!(target, super::shared::OpenTarget::Url { .. }))
                    {
                        "open-url"
                    } else {
                        "open-file"
                    };
                    let _ = request_main_open(
                        port,
                        &runtime_token,
                        activation,
                        transport,
                        targets,
                        None,
                    );
                    received_open_event = true;
                    if let Some(window_slot) = WindowRegistry::primary_window(&windows) {
                        if let Some(window) = window_slot.borrow().as_ref() {
                            window.set_visible(true);
                            window.set_minimized(false);
                            window.set_focus();
                        }
                    }
                }
            }
            if matches!(&event, Event::MainEventsCleared) {
                completed_initial_event_cycle = true;
            }

            let mut shutdown_reason = None;
            if let Some((label, window_slot, webview_slot)) =
                WindowRegistry::dispatch_target(&windows)
            {
                let app_menu_webview = WindowRegistry::primary_dispatch_target(&windows)
                    .map(|(_, _, webview)| webview)
                    .unwrap_or_else(|| webview_slot.clone());
                let outcome = poll_menu_bar_events(
                    &window_slot,
                    &webview_slot,
                    &app_menu_webview,
                    &app_menu_slot,
                );
                if outcome.quit {
                    shutdown_reason = Some("app-quit");
                }
                if outcome.close {
                    if windows.borrow().is_primary(&label) {
                        shutdown_reason = Some("window-close");
                    } else {
                        crate::window::set_window_visible(&window_slot, false);
                        windows.borrow_mut().record_lifecycle("hidden", &label);
                    }
                }
            }
            if let Some((_label, webview_slot, tray_slot)) =
                WindowRegistry::tray_dispatch_target(&windows)
            {
                crate::webview::poll_tray_events(&webview_slot, &tray_slot);
            }
            crate::webview::poll_global_shortcut_events(&windows);

            let close_requests = windows.borrow_mut().take_close_requests();
            for label in close_requests {
                if windows.borrow().is_primary(&label) {
                    shutdown_reason = Some("window-close");
                } else {
                    let resources = windows.borrow_mut().prepare_close_secondary(&label);
                    match resources {
                        Ok(resources) => crate::window::drop_closed_window(resources),
                        Err(error) => {
                            let _ = writeln!(
                                std::io::stderr(),
                                "murasaki-launcher: failed to close window {label}: {error}"
                            );
                        }
                    }
                }
            }

            // `quit()` (`{ kind: "appQuit" }`) — see `webview::quit_requested`'s
            // doc comment. Same clean-shutdown path as Exit/CloseRequested above
            // and below: best-effort kill `child` directly (the Job Object above
            // is the real safety net if this process dies before reaching here).
            if crate::webview::quit_requested() {
                shutdown_reason = Some("app-quit");
            }

            if let Event::WindowEvent {
                event: WindowEvent::CloseRequested,
                window_id,
                ..
            } = &event
            {
                let identity = WindowRegistry::identity_for_id(&windows, *window_id);
                if let Some(identity) = identity {
                    if windows.borrow().is_primary(&identity.label) {
                        shutdown_reason = Some("window-close");
                    } else {
                        let window = windows.borrow().live_window(&identity.label);
                        match window {
                            Ok(window) => {
                                crate::window::set_window_visible(&window, false);
                                windows
                                    .borrow_mut()
                                    .record_lifecycle_for_identity("hidden", &identity);
                            }
                            Err(error) => {
                                let _ = writeln!(
                                    std::io::stderr(),
                                    "murasaki-launcher: failed to hide window {}: {error}",
                                    identity.label
                                );
                            }
                        }
                    }
                }
            }

            if let Event::WindowEvent {
                event: WindowEvent::Focused(focused),
                window_id,
                ..
            } = &event
            {
                if let Some(identity) = WindowRegistry::identity_for_id(&windows, *window_id) {
                    windows.borrow_mut().record_lifecycle_for_identity(
                        if *focused { "focused" } else { "blurred" },
                        &identity,
                    );
                }
            }

            for event in windows.borrow_mut().take_lifecycle_events() {
                window_control.emit(event);
            }

            if let Some(reason) = shutdown_reason {
                let wake = quit_proxy.clone();
                shutdown.begin(
                    port,
                    &runtime_token,
                    reason,
                    shutdown_transport_timeout,
                    move || {
                        let _ = wake.send_event(());
                    },
                );
            }
            if let Some(transport_error) = shutdown_proceed {
                let confirmed_shutdown = shutdown_allows_update(&transport_error);
                if let Some(error) = transport_error.as_ref() {
                    let _ = writeln!(
                        std::io::stderr(),
                        "murasaki-launcher: graceful shutdown transport failed: {error}"
                    );
                }
                *control_flow = ControlFlow::Exit;
                let resources = windows.borrow_mut().prepare_close_all();
                crate::window::drop_all_webviews(resources);
                job.terminate();
                terminate_and_wait_child(&mut child);
                if confirmed_shutdown {
                    maybe_spawn_apply_helper(&resources_dir, &apply_target, &apply_relaunch);
                } else {
                    discard_apply_handoff(&resources_dir);
                }
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
    if let Some(code) = crate::updater::maybe_recover_update() {
        std::process::exit(code);
    }
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
