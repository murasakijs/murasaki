//! Application — owns the tao EventLoop and drives the run-loop.
//!
//! macOS allows a single EventLoop per process, so Application is the
//! single source of truth. Windows and webviews are created via
//! `Application::createWindow()` — never with an independent EventLoop.

use napi::{
  bindgen_prelude::{Error, Result, Status},
  threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode},
};
use napi_derive::napi;
use std::{cell::RefCell, rc::Rc, sync::Arc, time::{Duration, Instant}};

use tao::{
  dpi::LogicalSize,
  event::{Event, WindowEvent},
  event_loop::{ControlFlow, EventLoop, EventLoopBuilder},
  window::WindowBuilder,
};
use tao::platform::run_return::EventLoopExtRunReturn;

#[cfg(any(target_os = "macos", target_os = "windows"))]
use crate::launcher::shared::{ShutdownCoordinator, ShutdownPoll};

#[cfg(target_os = "macos")]
use crate::menu::build_default_app_menu;
#[cfg(target_os = "windows")]
use crate::menu::build_windows_menu_bar;
use crate::{
  types::{WebviewOptions, WindowOptions},
  webview::Webview,
  window::{BrowserWindow, SharedWindowRegistry, WindowRegistry},
};

/// Custom user event dispatched from JS thread into the tao loop.
pub enum UserEvent {
  Wake,
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
#[derive(Clone)]
struct DevShutdownEndpoint {
  port: u16,
  runtime_token: String,
  transport_timeout: Duration,
}

#[napi]
pub struct Application {
  event_loop: Rc<RefCell<Option<EventLoop<UserEvent>>>>,
  on_quit: Rc<RefCell<Option<Arc<ThreadsafeFunction<()>>>>>,
  /// Holds the installed NSApp menu bar alive — muda's `Menu` releases the
  /// underlying NSMenu on drop, so this must outlive the app, not just the
  /// `create_window()` call that installs it. `None` until the primary window
  /// is created; also doubles as the "already installed" guard.
  app_menu: Rc<RefCell<Option<muda::Menu>>>,
  /// Windows only: same reasoning as `app_menu` above, just for the native
  /// Win32 menu bar (`Menu::init_for_hwnd`) instead of `init_for_nsapp`.
  /// `None` until the primary window is created.
  #[cfg(target_os = "windows")]
  windows_menu_bar: Rc<RefCell<Option<muda::Menu>>>,
  /// Every live/declaratively-created window keyed by its stable label.
  /// Webview IPC and the event loop share this registry so cross-window
  /// commands cannot escape the set of declared windows.
  windows: SharedWindowRegistry,
  #[cfg(any(target_os = "macos", target_os = "windows"))]
  shutdown_endpoint: Rc<RefCell<Option<DevShutdownEndpoint>>>,
}

#[napi]
impl Application {
  #[napi(constructor)]
  pub fn new() -> Result<Self> {
    let event_loop = EventLoopBuilder::<UserEvent>::with_user_event().build();

    // Ensure the CLI-launched process is a Regular (Dock-visible, focusable)
    // app. tao also applies this during `applicationDidFinishLaunching`, but
    // setting it up front makes the app take focus immediately on launch.
    #[cfg(target_os = "macos")]
    {
      use objc2::MainThreadMarker;
      use objc2_app_kit::{NSApplication, NSApplicationActivationPolicy};
      if let Some(mtm) = MainThreadMarker::new() {
        let ns_app = NSApplication::sharedApplication(mtm);
        ns_app.setActivationPolicy(NSApplicationActivationPolicy::Regular);
        #[allow(deprecated)]
        ns_app.activateIgnoringOtherApps(true);
      }
    }

    Ok(Self {
      event_loop: Rc::new(RefCell::new(Some(event_loop))),
      on_quit: Rc::new(RefCell::new(None)),
      app_menu: Rc::new(RefCell::new(None)),
      #[cfg(target_os = "windows")]
      windows_menu_bar: Rc::new(RefCell::new(None)),
      windows: Rc::new(RefCell::new(WindowRegistry::default())),
      #[cfg(any(target_os = "macos", target_os = "windows"))]
      shutdown_endpoint: Rc::new(RefCell::new(None)),
    })
  }

  /// Configure the private dev-server endpoint used to run the same
  /// cancellable Node main shutdown lifecycle as the production launcher.
  #[cfg(any(target_os = "macos", target_os = "windows"))]
  #[napi(js_name = "configureShutdown")]
  pub fn configure_shutdown(
    &self,
    port: u16,
    runtime_token: String,
    timeout_ms: u32,
  ) -> Result<()> {
    const MAX_TIMEOUT_MS: u32 = 300_000;
    const TRANSPORT_GRACE_MS: u64 = 2_000;
    if timeout_ms == 0 || timeout_ms > MAX_TIMEOUT_MS {
      return Err(Error::new(
        Status::InvalidArg,
        format!("shutdown timeout must be between 1 and {MAX_TIMEOUT_MS} milliseconds"),
      ));
    }
    if runtime_token.len() != 64 || !runtime_token.bytes().all(|byte| byte.is_ascii_hexdigit()) {
      return Err(Error::new(
        Status::InvalidArg,
        "runtime token must be a 256-bit hexadecimal value",
      ));
    }
    *self.shutdown_endpoint.borrow_mut() = Some(DevShutdownEndpoint {
      port,
      runtime_token,
      transport_timeout: Duration::from_millis(u64::from(timeout_ms) + TRANSPORT_GRACE_MS),
    });
    Ok(())
  }

  /// Create a native window bound to this Application's event loop.
  #[napi(js_name = "createWindow")]
  pub fn create_window(&self, opts: Option<WindowOptions>) -> Result<BrowserWindow> {
    let opts = opts.unwrap_or(WindowOptions {
      label: Some("main".to_string()),
      primary: Some(true),
      visible: Some(true),
      title: None,
      width: None,
      height: None,
      min_width: None,
      min_height: None,
      resizable: None,
      transparent: None,
      vibrancy: None,
      icon: None,
      version: None,
      description: None,
      copyright: None,
      homepage: None,
      authors: None,
      menu_labels: None,
    });
    let label = opts.label.clone().unwrap_or_else(|| "main".to_string());
    let primary = opts.primary.unwrap_or(label == "main");
    self.windows.borrow().validate_registration(&label, primary)
      .map_err(|error| Error::new(Status::InvalidArg, error))?;

    // Install the standard macOS app menu bar (App/Edit/Window) once, for the
    // primary window. Without this, NSApp has no main menu at all: the
    // bold app-name menu is empty and Cmd+Q/Cmd+C/Cmd+V don't work.
    #[cfg(target_os = "macos")]
    if primary && self.app_menu.borrow().is_none() {
      let app_name = opts.title.as_deref().unwrap_or("Murasaki");
      let about = crate::menu::AboutInfo {
        name: app_name,
        icon_path: opts.icon.as_deref(),
        version: opts.version.as_deref(),
        description: opts.description.as_deref(),
        copyright: opts.copyright.as_deref(),
        homepage: opts.homepage.as_deref(),
        authors: opts.authors.as_deref(),
      };
      let menu = build_default_app_menu(&about, opts.menu_labels.as_ref())?;
      menu.init_for_nsapp();
      *self.app_menu.borrow_mut() = Some(menu);
    }

    let event_loop_ref = self.event_loop.borrow();
    let event_loop = event_loop_ref
      .as_ref()
      .ok_or_else(|| Error::new(Status::GenericFailure, "event loop already consumed"))?;

    // Lets the IPC handler (`appQuit`, from `quit()`) wake this event loop —
    // see `webview::Webview::new`'s `wake` parameter doc comment. Without
    // this, a JS-posted IPC message generates no OS event, so a
    // `ControlFlow::Wait` loop never re-polls `quit_requested()` until the
    // next mouse/keyboard event. Routed through `UserEvent::Wake` (not
    // a separate quit event) so `run()`'s `quit_requested()` poll below still
    // fires the registered `onQuit` callback.
    let wake_proxy = event_loop.create_proxy();
    let wake: Rc<dyn Fn()> = Rc::new(move || {
      let _ = wake_proxy.send_event(UserEvent::Wake);
    });

    let mut builder = WindowBuilder::new()
      .with_title(opts.title.as_deref().unwrap_or("Murasaki"))
      .with_inner_size(LogicalSize::new(
        opts.width.unwrap_or(1280) as f64,
        opts.height.unwrap_or(800) as f64,
      ))
      .with_resizable(opts.resizable.unwrap_or(true))
      .with_visible(opts.visible.unwrap_or(true));

    if let (Some(w), Some(h)) = (opts.min_width, opts.min_height) {
      builder = builder.with_min_inner_size(LogicalSize::new(w as f64, h as f64));
    }
    if opts.transparent.unwrap_or(false) {
      builder = builder.with_transparent(true);
    }

    let window = builder
      .build(event_loop)
      .map_err(|e| Error::new(Status::GenericFailure, format!("build window: {e}")))?;

    crate::window::center_on_primary_monitor(&window);

    // Install the native Win32 menu bar (File/Edit/Window) once, on the
    // primary window — same "install once" semantics as the macOS app menu
    // above. Attaching requires the window's HWND, so unlike the macOS
    // block above this has to happen after `build()` rather than before it.
    #[cfg(target_os = "windows")]
    if primary && self.windows_menu_bar.borrow().is_none() {
      // Dev mode has no config→native plumbing for About metadata yet — `None`
      // here just means the startup bar has no Help/About submenu, same as
      // before this feature (see `menu::build_windows_menu_bar`'s doc comment).
      match build_windows_menu_bar(None, opts.menu_labels.as_ref()) {
        Ok(menu) => {
          use tao::platform::windows::WindowExtWindows;
          // SAFETY: `hwnd` was just read from the `window` built above, which
          // is still alive on this stack frame.
          match unsafe { menu.init_for_hwnd(window.hwnd()) } {
            Ok(()) => *self.windows_menu_bar.borrow_mut() = Some(menu),
            // Cosmetic: a missing menu bar shouldn't crash the app.
            Err(e) => eprintln!("murasaki: failed to attach the Windows menu bar: {e}"),
          }
        }
        Err(e) => eprintln!("murasaki: failed to build the Windows menu bar: {e}"),
      }
    }

    let browser_window = BrowserWindow::from_window(
      window,
      label,
      primary,
      self.windows.clone(),
      self.app_menu_context(&opts),
      wake,
    )?;

    Ok(browser_window)
  }

  /// Builds the `AppMenuContext` a `BrowserWindow`'s `Webview`(s) need to
  /// install/replace the application menu on demand (see that struct's doc
  /// comment and the `{ kind: "appMenu" }` IPC branch in `webview.rs`).
  /// `menu_slot` is a clone of whichever field above (`app_menu` on macOS,
  /// `windows_menu_bar` on Windows) already holds the startup default menu
  /// installed just above — so a `useAppMenu` replacement and `Application`'s
  /// own bookkeeping always agree on what's currently installed.
  fn app_menu_context(&self, opts: &WindowOptions) -> crate::webview::AppMenuContext {
    #[cfg(target_os = "macos")]
    let menu_slot = self.app_menu.clone();
    #[cfg(target_os = "windows")]
    let menu_slot = self.windows_menu_bar.clone();
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let menu_slot = Rc::new(RefCell::new(None));

    crate::webview::AppMenuContext {
      menu_slot,
      menu_labels: opts.menu_labels.clone(),
      #[cfg(target_os = "macos")]
      about_info: crate::menu::AboutInfoOwned {
        name: opts.title.clone().unwrap_or_else(|| "Murasaki".to_string()),
        icon_path: opts.icon.clone(),
        version: opts.version.clone(),
        description: opts.description.clone(),
        copyright: opts.copyright.clone(),
        homepage: opts.homepage.clone(),
        authors: opts.authors.clone(),
      },
    }
  }

  /// Sugar: create a window + attach a webview in one call.
  #[napi(js_name = "createWebview")]
  pub fn create_webview(
    &self,
    window_opts: Option<WindowOptions>,
    webview_opts: WebviewOptions,
  ) -> Result<Webview> {
    let win = self.create_window(window_opts)?;
    let webview = win.create_webview(webview_opts)?;
    Ok(webview)
  }

  /// Run the tao event loop. Blocks the calling thread until quit.
  #[napi]
  pub fn run(&self) -> Result<()> {
    let mut event_loop = self
      .event_loop
      .borrow_mut()
      .take()
      .ok_or_else(|| Error::new(Status::GenericFailure, "event loop already consumed"))?;

    let on_quit = self.on_quit.clone();
    let windows = self.windows.clone();
    #[cfg(target_os = "macos")]
    let app_menu_slot = self.app_menu.clone();
    #[cfg(target_os = "windows")]
    let app_menu_slot = self.windows_menu_bar.clone();
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    let shutdown_endpoint = self.shutdown_endpoint.clone();
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    let wake_proxy = event_loop.create_proxy();
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    let mut shutdown = ShutdownCoordinator::new();
    let mut did_quit = false;

    event_loop.run_return(|event, _target, control_flow| {
      *control_flow = ControlFlow::WaitUntil(Instant::now() + Duration::from_millis(250));
      let mut shutdown_reason = None;

      #[cfg(any(target_os = "macos", target_os = "windows"))]
      match shutdown.poll() {
        ShutdownPoll::Proceed { transport_error } => {
          if let Some(error) = transport_error {
            eprintln!("murasaki: graceful shutdown transport failed: {error}");
          }
          *control_flow = ControlFlow::Exit;
          let resources = windows.borrow_mut().prepare_close_all();
          crate::window::drop_all_webviews(resources);
          did_quit = true;
          return;
        }
        ShutdownPoll::Cancelled | ShutdownPoll::None => {}
      }

      // Windows: drain native menu clicks every tick (both the startup
      // default bar and any `useAppMenu` replacement — the menu bar is
      // persistent, unlike the context-menu popup in webview.rs, which reads
      // its one expected event synchronously right where it's shown instead)
      // — see `poll_menu_bar_events`'s doc comment. Exit is handled the same
      // way as the window's own close button, just below.
      #[cfg(target_os = "windows")]
      {
        if let Some((label, window_slot, webview_slot)) = WindowRegistry::dispatch_target(&windows) {
          let app_menu_webview = WindowRegistry::primary_dispatch_target(&windows)
            .map(|(_, _, webview)| webview)
            .unwrap_or_else(|| webview_slot.clone());
          let outcome = crate::webview::poll_menu_bar_events(
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
            }
          }
        }
      }

      // macOS: drain clicks on `useAppMenu`'s custom (non-role) items —
      // see `poll_app_menu_events`'s doc comment for why macOS never needed
      // this before `useAppMenu` existed.
      #[cfg(target_os = "macos")]
      {
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
            }
          }
        }
      }

      #[cfg(any(target_os = "macos", target_os = "windows"))]
      if let Some((_label, webview_slot, tray_slot)) = WindowRegistry::tray_dispatch_target(&windows) {
        crate::webview::poll_tray_events(&webview_slot, &tray_slot);
      }

      let close_requests = windows.borrow_mut().take_close_requests();
      for label in close_requests {
        if windows.borrow().is_primary(&label) {
          shutdown_reason = Some("window-close");
        } else {
          let resources = windows.borrow_mut().prepare_close_secondary(&label);
          match resources {
            Ok(resources) => crate::window::drop_closed_window(resources),
            Err(error) => eprintln!("murasaki: failed to close window {label}: {error}"),
          }
        }
      }

      // `quit()` (`{ kind: "appQuit" }`) — see `webview::quit_requested`'s
      // doc comment. Same shutdown path as the window's own close button
      // below: fire the registered `onQuit` callback and exit the loop.
      if crate::webview::quit_requested() {
        shutdown_reason = Some("app-quit");
      }

      if let Event::WindowEvent {
        event: WindowEvent::CloseRequested,
        window_id,
        ..
      } = &event {
        let label = WindowRegistry::label_for_id(&windows, *window_id);
        if let Some(label) = label {
          if windows.borrow().is_primary(&label) {
            shutdown_reason = Some("window-close");
          } else {
            let window = windows.borrow().live_window(&label);
            match window {
              Ok(window) => crate::window::set_window_visible(&window, false),
              Err(error) => eprintln!("murasaki: failed to hide window {label}: {error}"),
            }
          }
        }
      }

      if let Some(reason) = shutdown_reason {
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        if let Some(endpoint) = shutdown_endpoint.borrow().clone() {
          let wake = wake_proxy.clone();
          shutdown.begin(
            endpoint.port,
            &endpoint.runtime_token,
            reason,
            endpoint.transport_timeout,
            move || {
              let _ = wake.send_event(UserEvent::Wake);
            },
          );
          return;
        }

        *control_flow = ControlFlow::Exit;
        let resources = windows.borrow_mut().prepare_close_all();
        crate::window::drop_all_webviews(resources);
        did_quit = true;
      }
    });

    // `run_return` restores the JavaScript event loop. Clean up any resources
    // left by an external OS termination path before scheduling the legacy
    // callback; normal dev orchestration performs child kill/wait immediately
    // after this method returns.
    if !did_quit {
      let resources = windows.borrow_mut().prepare_close_all();
      crate::window::drop_all_webviews(resources);
    }
    if let Some(tsf) = on_quit.borrow().as_ref() {
      let _ = tsf.call(Ok(()), ThreadsafeFunctionCallMode::NonBlocking);
    }
    Ok(())
  }

  #[napi(js_name = "onQuit")]
  pub fn on_quit(&self, callback: ThreadsafeFunction<()>) -> Result<()> {
    *self.on_quit.borrow_mut() = Some(Arc::new(callback));
    Ok(())
  }

  #[napi]
  pub fn exit(&self) -> Result<()> {
    std::process::exit(0);
  }

  /// Set the Dock/About-panel icon at runtime. Packaged apps run under a
  /// bundled `node` binary (not a "real" app executable), so `Info.plist`'s
  /// `CFBundleIconFile` alone doesn't reliably make the About panel pick up
  /// the app icon — this sets `NSApp.applicationIconImage` explicitly.
  /// No-op (not an error) if `path` doesn't point at a readable image, or on
  /// non-macOS platforms.
  #[napi(js_name = "setIconPath")]
  pub fn set_icon_path(&self, path: String) -> Result<()> {
    #[cfg(target_os = "macos")]
    {
      use objc2::{AllocAnyThread, MainThreadMarker};
      use objc2_app_kit::{NSApplication, NSImage};
      use objc2_foundation::NSString;

      if let Some(mtm) = MainThreadMarker::new() {
        let ns_app = NSApplication::sharedApplication(mtm);
        let ns_path = NSString::from_str(&path);
        if let Some(image) = NSImage::initWithContentsOfFile(NSImage::alloc(), &ns_path) {
          unsafe { ns_app.setApplicationIconImage(Some(&image)) };
        }
      }
    }
    #[cfg(not(target_os = "macos"))]
    {
      let _ = path;
    }
    Ok(())
  }
}
