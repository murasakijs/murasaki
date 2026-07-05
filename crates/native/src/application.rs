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
use std::{cell::RefCell, rc::Rc, sync::Arc};

use tao::{
  dpi::LogicalSize,
  event::{Event, WindowEvent},
  event_loop::{ControlFlow, EventLoop, EventLoopBuilder},
  window::WindowBuilder,
};

#[cfg(target_os = "macos")]
use crate::menu::build_default_app_menu;
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
      let menu = build_default_app_menu(&about)?;
      menu.init_for_nsapp();
      *self.app_menu.borrow_mut() = Some(menu);
    }

    let event_loop_ref = self.event_loop.borrow();
    let event_loop = event_loop_ref
      .as_ref()
      .ok_or_else(|| Error::new(Status::GenericFailure, "event loop already consumed"))?;

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

    // Center on the primary monitor. tao's default placement can land the
    // window off-screen (e.g. negative Y on multi-monitor setups), so we
    // compute the centered position explicitly.
    if let Some(monitor) = window.primary_monitor().or_else(|| window.current_monitor()) {
      let screen = monitor.size();
      let win = window.outer_size();
      let mon_pos = monitor.position();
      let x = mon_pos.x + ((screen.width as i32 - win.width as i32) / 2).max(0);
      let y = mon_pos.y + ((screen.height as i32 - win.height as i32) / 2).max(0);
      window.set_outer_position(tao::dpi::PhysicalPosition::new(x, y));
    }

    Ok(BrowserWindow::from_window(window))
  }

  /// Sugar: create a window + attach a webview in one call.
  #[napi(js_name = "createWebview")]
  pub fn create_webview(
    &self,
    window_opts: Option<WindowOptions>,
    webview_opts: WebviewOptions,
  ) -> Result<Webview> {
    let win = self.create_window(window_opts)?;
    win.create_webview(webview_opts)
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

    event_loop.run(move |event, _target, control_flow| {
      *control_flow = ControlFlow::Wait;

      match event {
        Event::WindowEvent {
          event: WindowEvent::CloseRequested,
          ..
        } => {
          *control_flow = ControlFlow::Exit;
          if let Some(tsf) = on_quit.borrow().as_ref() {
            let _ = tsf.call(Ok(()), ThreadsafeFunctionCallMode::NonBlocking);
          }
        }
        Event::UserEvent(UserEvent::Quit) => {
          *control_flow = ControlFlow::Exit;
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
