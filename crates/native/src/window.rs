//! BrowserWindow — thin tao Window wrapper with attached webview + menu.
//!
//! Constructed exclusively via `Application::createWindow()` so that only
//! one EventLoop exists per process (macOS requirement).

use napi::bindgen_prelude::{Error, Result, Status};
use napi_derive::napi;
use std::{cell::RefCell, collections::HashMap, rc::Rc};

use tao::{dpi::LogicalSize, window::{Window, WindowId}};
use tray_icon::TrayIcon;
use wry::WebView;

use crate::{
  types::WebviewOptions,
  webview::{AppMenuContext, Webview},
};

pub(crate) type SharedWindow = Rc<RefCell<Option<Window>>>;
pub(crate) type SharedWebview = Rc<RefCell<Option<WebView>>>;

#[derive(Default)]
pub(crate) struct ProcessTray {
  pub icon: Option<TrayIcon>,
  pub owner_label: Option<String>,
  /// Native muda ids are generation-scoped so clicks from a replaced tray
  /// menu cannot be delivered to the new owner. Values are the public ids
  /// supplied to `tray.create({ menu })` / `tray.setMenu()`.
  pub menu_items: HashMap<String, String>,
}

pub(crate) type SharedProcessTray = Rc<RefCell<ProcessTray>>;

pub(crate) struct ClosedWindowResources {
  pub window: Option<Window>,
  pub webview: Option<WebView>,
  pub tray: Option<TrayIcon>,
}

#[derive(Clone)]
pub(crate) struct RegisteredWindow {
  pub label: String,
  pub primary: bool,
  pub window: SharedWindow,
  pub webview: Option<SharedWebview>,
}

pub(crate) struct WindowRegistry {
  entries: HashMap<String, RegisteredWindow>,
  pending_close: Vec<String>,
  tray: SharedProcessTray,
}

impl Default for WindowRegistry {
  fn default() -> Self {
    Self {
      entries: HashMap::new(),
      pending_close: Vec::new(),
      tray: Rc::new(RefCell::new(ProcessTray::default())),
    }
  }
}

pub(crate) type SharedWindowRegistry = Rc<RefCell<WindowRegistry>>;

#[derive(Debug, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WindowState {
  pub label: String,
  pub primary: bool,
  pub visible: bool,
  pub focused: bool,
  pub minimized: bool,
  pub maximized: bool,
}

pub(crate) fn validate_window_label(label: &str) -> std::result::Result<(), String> {
  let mut chars = label.chars();
  let Some(first) = chars.next() else {
    return Err("window label must not be empty".to_string());
  };
  if label.len() > 64
    || !first.is_ascii_alphanumeric()
    || !chars.all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-'))
  {
    return Err(
      "window label must be 1-64 characters using letters, numbers, dot, underscore, or hyphen"
        .to_string(),
    );
  }
  Ok(())
}

impl WindowRegistry {
  pub(crate) fn validate_registration(
    &self,
    label: &str,
    primary: bool,
  ) -> std::result::Result<(), String> {
    validate_window_label(label)?;
    if label.eq_ignore_ascii_case("main") && label != "main" {
      return Err("window label main is reserved for the primary window".to_string());
    }
    if primary && label != "main" {
      return Err("the primary window must use the reserved label main".to_string());
    }
    if !primary && label == "main" {
      return Err("window label main is reserved for the primary window".to_string());
    }
    if self.entries.contains_key(label) {
      return Err(format!("duplicate window label: {label}"));
    }
    if primary && self.entries.values().any(|entry| entry.primary) {
      return Err("only one primary window may be registered".to_string());
    }
    Ok(())
  }

  pub(crate) fn register(
    &mut self,
    label: String,
    primary: bool,
    window: SharedWindow,
  ) -> std::result::Result<(), String> {
    self.validate_registration(&label, primary)?;
    self.entries.insert(
      label.clone(),
      RegisteredWindow { label, primary, window, webview: None },
    );
    Ok(())
  }

  pub(crate) fn attach_webview(
    &mut self,
    label: &str,
    webview: SharedWebview,
  ) -> std::result::Result<(), String> {
    let entry = self.entries.get_mut(label)
      .ok_or_else(|| format!("unknown window label: {label}"))?;
    if entry.window.borrow().is_none() {
      return Err(format!("window {label} is closed and cannot be reopened"));
    }
    if entry.webview.as_ref().is_some_and(|slot| slot.borrow().is_some()) {
      return Err(format!("window {label} already has a webview"));
    }
    entry.webview = Some(webview);
    Ok(())
  }

  pub(crate) fn clear_webview(&mut self, label: &str) {
    if let Some(entry) = self.entries.get_mut(label) {
      entry.webview = None;
    }
  }

  fn live_entry(&self, label: &str) -> std::result::Result<&RegisteredWindow, String> {
    validate_window_label(label)?;
    let entry = self.entries.get(label)
      .ok_or_else(|| format!("unknown window label: {label}"))?;
    if entry.window.borrow().is_none() {
      return Err(format!("window {label} is closed and cannot be reopened"));
    }
    Ok(entry)
  }

  pub(crate) fn live_window(&self, label: &str) -> std::result::Result<SharedWindow, String> {
    Ok(self.live_entry(label)?.window.clone())
  }

  fn snapshot(&self) -> Vec<RegisteredWindow> {
    self.entries.values().cloned().collect()
  }

  pub(crate) fn tray(&self) -> SharedProcessTray {
    self.tray.clone()
  }

  pub(crate) fn list(registry: &SharedWindowRegistry) -> Vec<WindowState> {
    let entries = registry.borrow().snapshot();
    let mut states = entries.iter().filter_map(|entry| {
      let window_ref = entry.window.try_borrow().ok()?;
      let window = window_ref.as_ref()?;
      Some(WindowState {
        label: entry.label.clone(),
        primary: entry.primary,
        visible: window.is_visible(),
        focused: window.is_focused(),
        minimized: window.is_minimized(),
        maximized: window.is_maximized(),
      })
    }).collect::<Vec<_>>();
    states.sort_by(|left, right| {
      right.primary.cmp(&left.primary).then_with(|| left.label.cmp(&right.label))
    });
    states
  }

  pub(crate) fn request_close(&mut self, label: &str) -> std::result::Result<(), String> {
    self.live_entry(label)?;
    if !self.pending_close.iter().any(|pending| pending == label) {
      self.pending_close.push(label.to_string());
    }
    Ok(())
  }

  pub(crate) fn take_close_requests(&mut self) -> Vec<String> {
    std::mem::take(&mut self.pending_close)
  }

  pub(crate) fn is_primary(&self, label: &str) -> bool {
    self.entries.get(label).is_some_and(|entry| entry.primary)
  }

  pub(crate) fn prepare_close_secondary(
    &mut self,
    label: &str,
  ) -> std::result::Result<ClosedWindowResources, String> {
    let entry = self.entries.get_mut(label)
      .ok_or_else(|| format!("unknown window label: {label}"))?;
    if entry.primary {
      return Err("the primary window requires application shutdown".to_string());
    }
    let tray = {
      let mut tray = self.tray.borrow_mut();
      if tray.owner_label.as_deref() == Some(label) {
        tray.owner_label = None;
        tray.menu_items.clear();
        tray.icon.take()
      } else {
        None
      }
    };
    Ok(ClosedWindowResources {
      window: entry.window.borrow_mut().take(),
      webview: entry.webview.take().and_then(|webview| webview.borrow_mut().take()),
      tray,
    })
  }

  pub(crate) fn label_for_id(registry: &SharedWindowRegistry, id: WindowId) -> Option<String> {
    let entries = registry.borrow().snapshot();
    entries.iter().find_map(|entry| {
      let window_ref = entry.window.try_borrow().ok()?;
      window_ref.as_ref().filter(|window| window.id() == id).map(|_| entry.label.clone())
    })
  }

  pub(crate) fn primary_window(registry: &SharedWindowRegistry) -> Option<SharedWindow> {
    let entries = registry.borrow().snapshot();
    entries.iter()
      .find(|entry| entry.primary && entry.window.try_borrow().is_ok_and(|window| window.is_some()))
      .map(|entry| entry.window.clone())
  }

  pub(crate) fn dispatch_target(
    registry: &SharedWindowRegistry,
  ) -> Option<(String, SharedWindow, SharedWebview)> {
    let entries = registry.borrow().snapshot();
    let focused = entries.iter().find(|entry| {
      entry.window.try_borrow().is_ok_and(|window| window.as_ref().is_some_and(Window::is_focused))
        && entry.webview.as_ref().is_some_and(|slot| slot.try_borrow().is_ok_and(|webview| webview.is_some()))
    });
    let fallback = entries.iter().find(|entry| {
      entry.primary && entry.window.try_borrow().is_ok_and(|window| window.is_some())
        && entry.webview.as_ref().is_some_and(|slot| slot.try_borrow().is_ok_and(|webview| webview.is_some()))
    });
    focused.or(fallback).and_then(|entry| {
      entry.webview.as_ref().map(|webview| {
        (entry.label.clone(), entry.window.clone(), webview.clone())
      })
    })
  }

  /// The renderer that owns process-global application-menu declarations.
  ///
  /// Window lifecycle roles still operate on `dispatch_target` (the focused
  /// window), but custom `useAppMenu` ids must always return to the primary
  /// renderer: only the reserved `main` window is allowed to register those
  /// handlers. Keeping this lookup separate prevents a focused secondary
  /// window from silently swallowing an application-menu click.
  pub(crate) fn primary_dispatch_target(
    registry: &SharedWindowRegistry,
  ) -> Option<(String, SharedWindow, SharedWebview)> {
    let entries = registry.borrow().snapshot();
    entries.iter().find(|entry| {
      entry.primary
        && entry.window.try_borrow().is_ok_and(|window| window.is_some())
        && entry.webview.as_ref().is_some_and(|slot| {
          slot.try_borrow().is_ok_and(|webview| webview.is_some())
        })
    }).and_then(|entry| {
      entry.webview.as_ref().map(|webview| {
        (entry.label.clone(), entry.window.clone(), webview.clone())
      })
    })
  }

  pub(crate) fn tray_dispatch_target(
    registry: &SharedWindowRegistry,
  ) -> Option<(String, SharedWebview, SharedProcessTray)> {
    let (entries, owner) = {
      let registry = registry.borrow();
      let owner = registry.tray.borrow().owner_label.clone();
      (registry.snapshot(), owner)
    };
    let owned = owner.as_deref().and_then(|owner| entries.iter().find(|entry| {
      entry.label == owner
        && entry.window.try_borrow().is_ok_and(|window| window.is_some())
        && entry.webview.as_ref().is_some_and(|slot| slot.try_borrow().is_ok_and(|webview| webview.is_some()))
    }));
    let fallback = entries.iter().find(|entry| {
      entry.primary
        && entry.window.try_borrow().is_ok_and(|window| window.is_some())
        && entry.webview.as_ref().is_some_and(|slot| slot.try_borrow().is_ok_and(|webview| webview.is_some()))
    });
    owned.or(fallback).and_then(|entry| {
      entry.webview.as_ref().map(|webview| {
        (entry.label.clone(), webview.clone(), registry.borrow().tray.clone())
      })
    })
  }

  pub(crate) fn prepare_close_all(&mut self) -> (Vec<WebView>, Option<TrayIcon>) {
    let webviews = self.entries.values_mut().filter_map(|entry| {
      entry.webview.take().and_then(|webview| webview.borrow_mut().take())
    }).collect();
    let tray = {
      let mut tray = self.tray.borrow_mut();
      tray.owner_label = None;
      tray.menu_items.clear();
      tray.icon.take()
    };
    (webviews, tray)
  }
}

pub(crate) fn drop_closed_window(resources: ClosedWindowResources) {
  drop(resources.tray);
  drop(resources.webview);
  drop(resources.window);
}

pub(crate) fn drop_all_webviews(resources: (Vec<WebView>, Option<TrayIcon>)) {
  drop(resources.0);
  drop(resources.1);
}

pub(crate) fn set_window_visible(window: &SharedWindow, visible: bool) {
  if let Ok(window) = window.try_borrow() {
    if let Some(window) = window.as_ref() {
      window.set_visible(visible);
    }
  }
}

pub(crate) fn open_window(window: &SharedWindow) {
  if let Ok(window) = window.try_borrow() {
    if let Some(window) = window.as_ref() {
      window.set_visible(true);
      window.set_minimized(false);
      window.set_focus();
    }
  }
}

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
  label: String,
  registry: SharedWindowRegistry,
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
  pub(crate) fn from_window(
    window: Window,
    label: String,
    primary: bool,
    registry: SharedWindowRegistry,
    app_menu: AppMenuContext,
    wake: Rc<dyn Fn()>,
  ) -> Result<Self> {
    #[cfg(target_os = "macos")]
    let _ = &window; // vibrancy hook lands in the follow-up commit
    let window = Rc::new(RefCell::new(Some(window)));
    registry.borrow_mut().register(label.clone(), primary, window.clone())
      .map_err(|error| Error::new(Status::InvalidArg, error))?;
    Ok(Self {
      window,
      label,
      registry,
      app_menu,
      wake,
    })
  }

}

#[cfg(test)]
mod tests {
  use super::validate_window_label;

  #[test]
  fn window_labels_match_the_public_contract() {
    for valid in ["main", "settings", "note.42", "tool_bar", "window-2"] {
      assert!(validate_window_label(valid).is_ok(), "expected valid label {valid}");
    }
    for invalid in ["", "-leading", "has space", "slash/name", "日本語"] {
      assert!(validate_window_label(invalid).is_err(), "expected invalid label {invalid}");
    }
    assert!(validate_window_label(&"a".repeat(64)).is_ok());
    assert!(validate_window_label(&"a".repeat(65)).is_err());
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
      self.label.clone(),
      self.registry.clone(),
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
    let primary = self.registry.borrow().is_primary(&self.label);
    if primary {
      self.registry.borrow_mut().request_close(&self.label)
        .map_err(|error| Error::new(Status::InvalidArg, error))?;
      (self.wake)();
    } else {
      let window = self.registry.borrow().live_window(&self.label)
        .map_err(|error| Error::new(Status::InvalidArg, error))?;
      set_window_visible(&window, false);
    }
    Ok(())
  }
}
