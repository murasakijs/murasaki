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
    fs,
    io::{BufRead, BufReader, Write},
    path::Path,
    process::{Child, Command, Stdio},
    sync::mpsc,
    thread,
    time::Duration,
  };

  use serde::Deserialize;

  /// Subset of the packaged resources dir's `murasaki-meta.json` (written by
  /// `cli/bundle.ts`; `Contents/Resources/` on macOS, `resources/` on
  /// Windows) this launcher needs. Fields the packager may omit
  /// (`config.window` / `config.description` etc. are all optional in
  /// `MurasakiConfig`) are `#[serde(default)]` so a missing JSON key becomes
  /// `None` instead of a parse error.
  #[derive(Deserialize)]
  #[serde(rename_all = "camelCase")]
  pub(super) struct Meta {
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
  ) -> Result<(Child, u16), String> {
    let node_path = resources_dir.join(node_binary_name);
    let mut cmd = Command::new(&node_path);
    cmd
      .arg("prod-server.mjs")
      .arg("--client")
      .arg(resources_dir.join("client"))
      .arg("--registry")
      .arg(resources_dir.join("server").join("actions.mjs"))
      .arg("--routes")
      .arg(resources_dir.join("server").join("routes.mjs"))
      .arg("--port")
      .arg("0")
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
}

#[cfg(target_os = "macos")]
mod imp_macos {
  use std::{cell::RefCell, collections::HashMap, fs, path::Path, process::Command, rc::Rc};

  use tao::{
    dpi::LogicalSize,
    event::{Event, WindowEvent},
    event_loop::{ControlFlow, EventLoop},
    window::WindowBuilder,
  };

  use crate::{
    menu::{build_default_app_menu, AboutInfo},
    types::{MenuLabels, WebviewOptions},
    webview::Webview,
    window::{center_on_primary_monitor, SharedWindow},
  };

  use super::shared::{read_meta, spawn_prod_server};

  /// One locale's worth of default-menu labels — mirrors `MenuLabels` in
  /// `packages/murasaki/src/menu-i18n.ts`, deserialized straight out of
  /// `Contents/Resources/menu-locales.json`.
  #[derive(serde::Deserialize, Clone)]
  #[serde(rename_all = "camelCase")]
  struct LocaleLabels {
    about: String,
    services: String,
    hide: String,
    hide_others: String,
    show_all: String,
    quit: String,
    edit: String,
    undo: String,
    redo: String,
    cut: String,
    copy: String,
    paste: String,
    select_all: String,
    window: String,
    minimize: String,
    zoom: String,
  }

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

    let meta = read_meta(&resources_dir)?;
    // `meta.console` is Windows-only (see that field's doc comment) — ignored
    // here, `spawn_prod_server` only acts on it under `#[cfg(target_os =
    // "windows")]`.
    let (mut child, port) = spawn_prod_server(&resources_dir, "node", meta.console)?;

    set_activation_policy_regular();

    let event_loop = EventLoop::<()>::new();

    // Matches prod-launcher.mjs's `meta.width ?? 1000` / `meta.height ?? 700`
    // (not Application::createWindow's 1280x800 default, which is for
    // `murasaki dev`'s window created with no explicit size).
    let width = meta.width.unwrap_or(1000);
    let height = meta.height.unwrap_or(700);
    // Vibrancy isn't wired up on the native side yet — accepted here for
    // murasaki-meta.json parity but currently a no-op, same as
    // `BrowserWindow::from_window` (see window.rs).
    let _ = &meta.vibrancy;

    let window = WindowBuilder::new()
      .with_title(&meta.product_name)
      .with_inner_size(LogicalSize::new(width as f64, height as f64))
      .with_resizable(true)
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

    let url = format!("http://127.0.0.1:{port}/");
    // `Webview::new` gives us the external-link navigation handler for free
    // (see webview.rs) — kept alive for the app's lifetime, see the comment
    // on `event_loop.run` below for why it's fine that it's never touched
    // again after this.
    let _webview = Webview::new(
      shared_window.clone(),
      WebviewOptions {
        url: Some(url),
        html: None,
        devtools: Some(false),
        transparent: None,
        serve_dir: None,
      },
    )
    .map_err(|e| format!("build webview: {e}"))?;

    // Dock/About-panel icon — mirrors Application::set_icon_path. As the real
    // CFBundleExecutable, CFBundleIconFile (see cli/bundle.ts's Info.plist)
    // already covers the Dock/Finder icon; this additionally covers the
    // About panel, which doesn't reliably pick up CFBundleIconFile.
    if let Some(path) = &icon_path {
      set_app_icon(path);
    }

    // tao's `EventLoop::run` never returns (`-> !`) and explicitly documents
    // that "values not passed to this function will *not* be dropped" — so
    // `menu`/`_webview`/`shared_window`, though never referenced again after
    // this point, simply stay alive on this stack frame for as long as the
    // app runs. Only `child` needs to move into the closure, to be killed on
    // window close.
    event_loop.run(move |event, _target, control_flow| {
      *control_flow = ControlFlow::Wait;
      if let Event::WindowEvent {
        event: WindowEvent::CloseRequested,
        ..
      } = event
      {
        *control_flow = ControlFlow::Exit;
        // Best-effort: if we get killed before this runs (force-quit, crash),
        // prod-server.mjs's own orphan check (`ppid === 1`) reaps it within ~2s.
        let _ = child.kill();
        std::process::exit(0);
      }
    });
  }

  /// Reads `Contents/Resources/menu-locales.json`. Missing or unparsable ⇒
  /// empty map, which makes `resolve_menu_labels` fall through to muda's
  /// English defaults (see `MenuLabels`'s doc comment in types.rs).
  fn load_menu_locales(resources_dir: &Path) -> HashMap<String, LocaleLabels> {
    let path = resources_dir.join("menu-locales.json");
    fs::read_to_string(&path)
      .ok()
      .and_then(|raw| serde_json::from_str(&raw).ok())
      .unwrap_or_default()
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

  /// Mirrors `menu-i18n.ts`'s `normalizeLocale()`.
  fn normalize_locale(raw: &str) -> String {
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
  fn resolve_menu_labels(
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

/// Windows launcher — window + webview only, no native menu bar / About
/// panel yet. Deferred macOS-parity items, left for a later packaging phase:
///  - Native menu bar (muda has a Win32 backend, but nothing builds/installs
///    one here yet) and the About dialog it would host — mirrors
///    `webview::show_context_menu`'s Windows stub for the same story on
///    context menus.
///  - Locale-aware chrome (`meta.locales`) — irrelevant until there's a menu
///    bar to localize, so unused here too.
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
  use std::{cell::RefCell, io::Write, path::Path, rc::Rc};

  use tao::{
    dpi::LogicalSize,
    event::{Event, WindowEvent},
    event_loop::{ControlFlow, EventLoop},
    window::{Icon, WindowBuilder},
  };

  use crate::{
    types::WebviewOptions,
    webview::Webview,
    window::{center_on_primary_monitor, SharedWindow},
  };

  use super::shared::{read_meta, spawn_prod_server};
  use super::win_job::KillOnCloseJob;

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
    // Spawns resources/node.exe prod-server.mjs — same handshake as macOS,
    // see `shared::spawn_prod_server`. `meta.console` (default `false`) hides
    // the console window `node.exe` would otherwise get, via
    // `CREATE_NO_WINDOW` — see that function's doc comment.
    let (mut child, port) = spawn_prod_server(&resources_dir, "node.exe", meta.console)?;

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

    // Matches prod-launcher.mjs's / the macOS launcher's `meta.width ?? 1000`
    // / `meta.height ?? 700`.
    let width = meta.width.unwrap_or(1000);
    let height = meta.height.unwrap_or(700);
    // Vibrancy is macOS-only (see window.rs) — a no-op here too.
    let _ = &meta.vibrancy;
    // Deferred — see the module doc comment above.
    let _ = &meta.locales;
    let _ = &meta.version;
    let _ = &meta.description;
    let _ = &meta.copyright;
    let _ = &meta.homepage;
    let _ = &meta.authors;

    // Title-bar/Alt-Tab window icon — see the module doc comment above for
    // why this is needed in addition to the .exe's already-embedded PE icon.
    // `None` (no `config.icon`, or a decode failure) just means
    // `with_window_icon` leaves tao's default in place, same as before this.
    let window_icon = meta
      .icon
      .as_ref()
      .map(|icon| resources_dir.join(icon))
      .and_then(|path| load_window_icon(&path));

    let window = WindowBuilder::new()
      .with_title(&meta.product_name)
      .with_inner_size(LogicalSize::new(width as f64, height as f64))
      .with_resizable(true)
      // Frameless: the web layer renders its own "VS Code-style" title bar
      // instead (see `webview.rs`'s injected `window.__MURASAKI__` and its
      // `handle_window_control` IPC branch) — this module is `#[cfg(target_os
      // = "windows")]` already, so this is Windows-only by construction.
      .with_decorations(false)
      .with_window_icon(window_icon)
      .build(&event_loop)
      .map_err(|e| format!("build window: {e}"))?;
    center_on_primary_monitor(&window);

    let shared_window: SharedWindow = Rc::new(RefCell::new(Some(window)));

    let url = format!("http://127.0.0.1:{port}/");
    // `Webview::new` pins the WebView2 user-data directory under
    // %LOCALAPPDATA% itself (see `webview::webview2_data_dir`'s doc comment)
    // — no extra wiring needed here since this goes through the same
    // constructor `murasaki dev` / `BrowserWindow::createWebview` use.
    let _webview = Webview::new(
      shared_window.clone(),
      WebviewOptions {
        url: Some(url),
        html: None,
        devtools: Some(false),
        transparent: None,
        serve_dir: None,
      },
    )
    .map_err(|e| format!("build webview: {e}"))?;

    // Same shutdown story as the macOS launcher (see that module's
    // `event_loop.run` comment): tao's `EventLoop::run` never returns and
    // explicitly documents that values not passed into it aren't dropped, so
    // `shared_window`/`_webview`/`job` simply stay alive on this stack frame
    // for the app's lifetime. Only `child` needs to move into the closure, to
    // be killed on window close.
    event_loop.run(move |event, _target, control_flow| {
      *control_flow = ControlFlow::Wait;
      if let Event::WindowEvent {
        // `CloseRequested` is the OS-level close request (Alt+F4, the
        // taskbar's "Close window" — both still delivered even though the
        // window has no decorations, see `.with_decorations(false)` above).
        // `Destroyed` is how the web layer's custom title bar reaches this
        // same shutdown path: its `{ kind: "windowControl", action: "close"
        // }` IPC message (`webview.rs`'s `handle_window_control`) just drops
        // the shared tao `Window`, and dropping a tao `Window` on Windows
        // posts a message that ends in `DestroyWindow`, which fires
        // `Destroyed` here — so the native and the custom close button both
        // quit the app the same way.
        event: WindowEvent::CloseRequested | WindowEvent::Destroyed,
        ..
      } = event
      {
        *control_flow = ControlFlow::Exit;
        // Best-effort direct kill on the clean-shutdown path. If we instead
        // get killed before this ever runs (force-quit, crash), it's the
        // `job` assigned above — not this — that reaps `child`: Windows has
        // no ppid-reparenting signal for `prod-server.mjs` to detect itself
        // (unlike macOS/Linux's `ppid === 1` check), so the Job Object is
        // what actually guarantees no orphaned `node.exe` here.
        let _ = child.kill();
        std::process::exit(0);
      }
    });
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

#[cfg(target_os = "macos")]
pub fn run_launcher() {
  imp_macos::run();
}

#[cfg(target_os = "windows")]
pub fn run_launcher() {
  imp_win::run();
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub fn run_launcher() {
  eprintln!("murasaki-launcher: unsupported platform (macOS/Windows only)");
}
