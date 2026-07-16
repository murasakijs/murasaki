//! BrowserWindow — thin tao Window wrapper with attached webview + menu.
//!
//! Constructed exclusively via `Application::createWindow()` so that only
//! one EventLoop exists per process (macOS requirement).

use napi::bindgen_prelude::Result;
use napi_derive::napi;
use std::{cell::RefCell, rc::Rc};

use tao::{dpi::LogicalSize, window::Window};

use crate::{
  types::WebviewOptions,
  webview::{AppMenuContext, Webview},
};

pub(crate) type SharedWindow = Rc<RefCell<Option<Window>>>;

/// Centers `window` on its primary monitor. tao's default placement can land
/// the window off-screen (e.g. negative Y on multi-monitor setups), so
/// callers that build a `tao::window::Window` directly — `Application::createWindow`
/// and the production launcher (`crate::launcher`) — compute the centered
/// position explicitly rather than relying on the OS default.
pub(crate) fn center_on_primary_monitor(window: &Window) {
  if let Some(monitor) = window.primary_monitor().or_else(|| window.current_monitor()) {
    let screen = monitor.size();
    let win = window.outer_size();
    let mon_pos = monitor.position();
    let x = mon_pos.x + ((screen.width as i32 - win.width as i32) / 2).max(0);
    let y = mon_pos.y + ((screen.height as i32 - win.height as i32) / 2).max(0);
    window.set_outer_position(tao::dpi::PhysicalPosition::new(x, y));
  }
}

#[napi]
pub struct BrowserWindow {
  window: SharedWindow,
  /// Retained so `create_webview` below can hand a clone to every `Webview`
  /// it builds (`&self`, so in principle more than once) — see
  /// `AppMenuContext`'s doc comment for what this is for.
  app_menu: AppMenuContext,
  /// Wakes `Application`'s tao event loop — see `webview::Webview::new`'s
  /// `wake` parameter doc comment. `Rc` (not `Box`) for the same
  /// "`&self`, in principle more than once" reason as `app_menu` above: each
  /// `create_webview` call needs its own owned `Box<dyn Fn()>` to hand to
  /// `Webview::new`, so this is cloned (cheaply, via the `Rc`) into a fresh
  /// box below rather than moved out of `&self`.
  wake: Rc<dyn Fn()>,
}

impl BrowserWindow {
  pub(crate) fn from_window(window: Window, app_menu: AppMenuContext, wake: Rc<dyn Fn()>) -> Self {
    #[cfg(target_os = "macos")]
    let _ = &window; // vibrancy hook lands in the follow-up commit
    Self {
      window: Rc::new(RefCell::new(Some(window))),
      app_menu,
      wake,
    }
  }

  /// Windows only: a clone-able handle to the underlying window, so
  /// `Application` can act on it from the tao event loop (see
  /// `webview::poll_menu_bar_events`'s Minimize handling).
  #[cfg(target_os = "windows")]
  pub(crate) fn handle(&self) -> SharedWindow {
    self.window.clone()
  }
}

#[napi]
impl BrowserWindow {
  /// Attach a webview to this window.
  ///
  /// Hands the webview a clone of the shared window handle so the tao window
  /// outlives this `BrowserWindow` — otherwise `Application::createWebview`,
  /// which drops its intermediate `BrowserWindow`, would close the NSWindow
  /// before the event loop runs.
  #[napi(js_name = "createWebview")]
  pub fn create_webview(&self, opts: WebviewOptions) -> Result<Webview> {
    if self.window.borrow().is_none() {
      return Err(napi::Error::new(
        napi::Status::GenericFailure,
        "window disposed",
      ));
    }
    let wake = self.wake.clone();
    Webview::new(
      self.window.clone(),
      opts,
      self.app_menu.clone(),
      Box::new(move || wake()),
    )
  }

  #[napi(js_name = "setTitle")]
  pub fn set_title(&self, title: String) -> Result<()> {
    if let Some(w) = self.window.borrow().as_ref() {
      w.set_title(&title);
    }
    Ok(())
  }

  #[napi(js_name = "setSize")]
  pub fn set_size(&self, width: f64, height: f64) -> Result<()> {
    if let Some(w) = self.window.borrow().as_ref() {
      w.set_inner_size(LogicalSize::new(width, height));
    }
    Ok(())
  }

  #[napi(js_name = "minimize")]
  pub fn minimize(&self) -> Result<()> {
    if let Some(w) = self.window.borrow().as_ref() {
      w.set_minimized(true);
    }
    Ok(())
  }

  #[napi(js_name = "toggleMaximize")]
  pub fn toggle_maximize(&self) -> Result<()> {
    if let Some(w) = self.window.borrow().as_ref() {
      w.set_maximized(!w.is_maximized());
    }
    Ok(())
  }

  #[napi]
  pub fn show(&self) -> Result<()> {
    if let Some(w) = self.window.borrow().as_ref() {
      w.set_visible(true);
    }
    Ok(())
  }

  #[napi]
  pub fn hide(&self) -> Result<()> {
    if let Some(w) = self.window.borrow().as_ref() {
      w.set_visible(false);
    }
    Ok(())
  }

  #[napi]
  pub fn focus(&self) -> Result<()> {
    if let Some(w) = self.window.borrow().as_ref() {
      w.set_focus();
    }
    Ok(())
  }

  #[napi(js_name = "setAlwaysOnTop")]
  pub fn set_always_on_top(&self, enabled: bool) -> Result<()> {
    if let Some(w) = self.window.borrow().as_ref() {
      w.set_always_on_top(enabled);
    }
    Ok(())
  }

  #[napi(js_name = "isVisible")]
  pub fn is_visible(&self) -> bool {
    self.window.borrow().as_ref().is_some_and(Window::is_visible)
  }

  #[napi(js_name = "isFocused")]
  pub fn is_focused(&self) -> bool {
    self.window.borrow().as_ref().is_some_and(Window::is_focused)
  }

  #[napi(js_name = "isMaximized")]
  pub fn is_maximized(&self) -> bool {
    self.window.borrow().as_ref().is_some_and(Window::is_maximized)
  }

  #[napi(js_name = "isMinimized")]
  pub fn is_minimized(&self) -> bool {
    self.window.borrow().as_ref().is_some_and(Window::is_minimized)
  }

  #[napi(js_name = "close")]
  pub fn close(&self) -> Result<()> {
    self.window.borrow_mut().take();
    Ok(())
  }
}
