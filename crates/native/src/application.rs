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

#[cfg(target_os = "macos")]
use crate::menu::build_default_app_menu;
#[cfg(target_os = "windows")]
use crate::menu::build_windows_menu_bar;
use crate::{
  types::{WebviewOptions, WindowOptions},
  webview::Webview,
  window::BrowserWindow,
};

/// Custom user event dispatched from JS thread into the tao loop.
pub enum UserEvent {
  Wake,
  Quit,
}

#[napi]
pub struct Application {
  event_loop: Rc<RefCell<Option<EventLoop<UserEvent>>>>,
  on_quit: Rc<RefCell<Option<Arc<ThreadsafeFunction<()>>>>>,
  /// Holds the installed NSApp menu bar alive — muda's `Menu` releases the
  /// underlying NSMenu on drop, so this must outlive the app, not just the
  /// `create_window()` call that installs it. `None` until the first window
  /// is created; also doubles as the "already installed" guard.
  app_menu: Rc<RefCell<Option<muda::Menu>>>,
  /// Windows only: same reasoning as `app_menu` above, just for the native
  /// Win32 menu bar (`Menu::init_for_hwnd`) instead of `init_for_nsapp`.
  /// `None` until the first window is created.
  #[cfg(target_os = "windows")]
  windows_menu_bar: Rc<RefCell<Option<muda::Menu>>>,
  /// A handle to the most recently created webview, so `run()` can dispatch
  /// native menu clicks into it (see `webview::poll_menu_bar_events`/
  /// `webview::poll_app_menu_events`). `None` before a webview exists.
  #[cfg(any(target_os = "macos", target_os = "windows"))]
  webview_handle: Rc<RefCell<Option<crate::webview::SharedWebview>>>,
  /// Windows only: a handle to the most recently created window, so `run()`
  /// can act on menu-bar clicks that operate on the window itself (currently
  /// just Minimize — see `webview::poll_menu_bar_events`). `None` before a
  /// window exists.
  #[cfg(target_os = "windows")]
  window_handle: Rc<RefCell<Option<crate::window::SharedWindow>>>,
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
      #[cfg(any(target_os = "macos", target_os = "windows"))]
      webview_handle: Rc::new(RefCell::new(None)),
      #[cfg(target_os = "windows")]
      window_handle: Rc::new(RefCell::new(None)),
    })
  }

  /// Create a native window bound to this Application's event loop.
  #[napi(js_name = "createWindow")]
  pub fn create_window(&self, opts: Option<WindowOptions>) -> Result<BrowserWindow> {
    let opts = opts.unwrap_or(WindowOptions {
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

    // Install the standard macOS app menu bar (App/Edit/Window) once, on the
    // first window created. Without this, NSApp has no main menu at all: the
    // bold app-name menu is empty and Cmd+Q/Cmd+C/Cmd+V don't work.
    #[cfg(target_os = "macos")]
    if self.app_menu.borrow().is_none() {
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
    // `Quit`) so `run()`'s `quit_requested()` poll below still fires the
    // registered `onQuit` callback — `UserEvent::Quit` exits without it.
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
      .with_resizable(opts.resizable.unwrap_or(true));

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

    // Install the native Win32 menu bar (File/Edit/Window) once, on the first
    // window created — same "install once" semantics as the macOS app menu
    // above, since (for now) murasaki only ever drives one window per
    // process. Attaching requires the window's HWND, so unlike the macOS
    // block above this has to happen after `build()` rather than before it.
    #[cfg(target_os = "windows")]
    if self.windows_menu_bar.borrow().is_none() {
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

    let browser_window = BrowserWindow::from_window(window, self.app_menu_context(&opts), wake);

    // Windows only: keep a handle so `run()`'s event loop can act on
    // menu-bar clicks that operate on the window itself — see
    // `window_handle`'s doc comment.
    #[cfg(target_os = "windows")]
    {
      *self.window_handle.borrow_mut() = Some(browser_window.handle());
    }

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
    // Keep a handle so `run()`'s event loop can dispatch native menu clicks
    // into it — see `webview_handle`'s doc comment.
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    {
      *self.webview_handle.borrow_mut() = Some(webview.handle());
    }
    Ok(webview)
  }

  /// Run the tao event loop. Blocks the calling thread until quit.
  #[napi]
  pub fn run(&self) -> Result<()> {
    let event_loop = self
      .event_loop
      .borrow_mut()
      .take()
      .ok_or_else(|| Error::new(Status::GenericFailure, "event loop already consumed"))?;

    let on_quit = self.on_quit.clone();
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    let webview_handle = self.webview_handle.clone();
    #[cfg(target_os = "windows")]
    let window_handle = self.window_handle.clone();

    event_loop.run(move |event, _target, control_flow| {
      *control_flow = ControlFlow::WaitUntil(Instant::now() + Duration::from_millis(250));

      // Windows: drain native menu clicks every tick (both the startup
      // default bar and any `useAppMenu` replacement — the menu bar is
      // persistent, unlike the context-menu popup in webview.rs, which reads
      // its one expected event synchronously right where it's shown instead)
      // — see `poll_menu_bar_events`'s doc comment. Exit is handled the same
      // way as the window's own close button, just below.
      #[cfg(target_os = "windows")]
      {
        let window_handle_ref = window_handle.borrow();
        let webview_handle_ref = webview_handle.borrow();
        if let (Some(window_slot), Some(webview_slot)) =
          (window_handle_ref.as_ref(), webview_handle_ref.as_ref())
        {
          if crate::webview::poll_menu_bar_events(window_slot, webview_slot) {
            *control_flow = ControlFlow::Exit;
            // Drop the wry WebView so WebView2 shuts its browser processes
            // down — `EventLoop::run` calls `std::process::exit` once this
            // closure returns, which skips destructors, orphaning it.
            let _ = webview_slot.borrow_mut().take();
            if let Some(tsf) = on_quit.borrow().as_ref() {
              let _ = tsf.call(Ok(()), ThreadsafeFunctionCallMode::NonBlocking);
            }
          }
        }
      }

      // macOS: drain clicks on `useAppMenu`'s custom (non-role) items —
      // see `poll_app_menu_events`'s doc comment for why macOS never needed
      // this before `useAppMenu` existed.
      #[cfg(target_os = "macos")]
      {
        if let Some(webview_slot) = webview_handle.borrow().as_ref() {
          crate::webview::poll_app_menu_events(webview_slot);
          crate::webview::poll_tray_events(webview_slot);
        }
      }

      #[cfg(target_os = "windows")]
      if let Some(webview_slot) = webview_handle.borrow().as_ref() {
        crate::webview::poll_tray_events(webview_slot);
      }

      // `quit()` (`{ kind: "appQuit" }`) — see `webview::quit_requested`'s
      // doc comment. Same shutdown path as the window's own close button
      // below: fire the registered `onQuit` callback and exit the loop.
      if crate::webview::quit_requested() {
        *control_flow = ControlFlow::Exit;
        // Drop the wry WebView so WebView2 shuts its browser processes down —
        // `EventLoop::run` calls `std::process::exit` once this closure
        // returns, which skips destructors, orphaning it.
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        if let Some(webview_slot) = webview_handle.borrow().as_ref() {
          let _ = webview_slot.borrow_mut().take();
        }
        if let Some(tsf) = on_quit.borrow().as_ref() {
          let _ = tsf.call(Ok(()), ThreadsafeFunctionCallMode::NonBlocking);
        }
      }

      match event {
        Event::WindowEvent {
          event: WindowEvent::CloseRequested,
          ..
        } => {
          *control_flow = ControlFlow::Exit;
          // Drop the wry WebView so WebView2 shuts its browser processes
          // down — see the `quit_requested()` branch above for why.
          #[cfg(any(target_os = "macos", target_os = "windows"))]
          if let Some(webview_slot) = webview_handle.borrow().as_ref() {
            let _ = webview_slot.borrow_mut().take();
          }
          if let Some(tsf) = on_quit.borrow().as_ref() {
            let _ = tsf.call(Ok(()), ThreadsafeFunctionCallMode::NonBlocking);
          }
        }
        Event::UserEvent(UserEvent::Quit) => {
          *control_flow = ControlFlow::Exit;
          // Drop the wry WebView so WebView2 shuts its browser processes
          // down — see the `quit_requested()` branch above for why.
          #[cfg(any(target_os = "macos", target_os = "windows"))]
          if let Some(webview_slot) = webview_handle.borrow().as_ref() {
            let _ = webview_slot.borrow_mut().take();
          }
        }
        _ => {}
      }
    });
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
