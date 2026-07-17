//! BrowserWindow — thin tao Window wrapper with attached webview + menu.
//!
//! Constructed exclusively via `Application::createWindow()` so that only
//! one EventLoop exists per process (macOS requirement).

use napi::bindgen_prelude::{Error, Result, Status};
use napi_derive::napi;
use std::{
    cell::RefCell,
    collections::{HashMap, VecDeque},
    rc::Rc,
};

use tao::{
    dpi::LogicalSize,
    event_loop::EventLoopWindowTarget,
    window::WindowBuilder,
    window::{Window, WindowId},
};
use tray_icon::TrayIcon;
use wry::WebView;

use crate::{
    global_shortcut::{ProcessGlobalShortcuts, SharedProcessGlobalShortcuts},
    types::{RuntimeWindowTemplate, WebviewOptions, WindowOptions},
    webview::{AppMenuContext, SharedWebContext, Webview},
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

pub(crate) struct CloseAllResources {
    pub webviews: Vec<WebView>,
    pub tray: Option<TrayIcon>,
    pub windows: Vec<Window>,
}

#[derive(Clone)]
pub(crate) struct RegisteredWindow {
    pub label: String,
    pub generation: u64,
    pub primary: bool,
    pub window: SharedWindow,
    pub webview: Option<SharedWebview>,
}

pub(crate) struct WindowRegistry {
    entries: HashMap<String, RegisteredWindow>,
    generations: HashMap<String, u64>,
    window_ids: HashMap<WindowId, WindowIdentity>,
    pending_close: Vec<String>,
    lifecycle_events: VecDeque<WindowLifecycleEvent>,
    tray: SharedProcessTray,
    global_shortcuts: SharedProcessGlobalShortcuts,
}

impl Default for WindowRegistry {
    fn default() -> Self {
        Self {
            entries: HashMap::new(),
            generations: HashMap::new(),
            window_ids: HashMap::new(),
            pending_close: Vec::new(),
            lifecycle_events: VecDeque::new(),
            tray: Rc::new(RefCell::new(ProcessTray::default())),
            global_shortcuts: Rc::new(RefCell::new(ProcessGlobalShortcuts::default())),
        }
    }
}

pub(crate) type SharedWindowRegistry = Rc<RefCell<WindowRegistry>>;

#[derive(Clone, Debug, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WindowState {
    pub label: String,
    pub generation: u64,
    pub primary: bool,
    pub visible: bool,
    pub focused: bool,
    pub minimized: bool,
    pub maximized: bool,
}

#[derive(Debug, serde::Deserialize, PartialEq, Eq)]
pub(crate) struct WindowControlCommand {
    pub id: String,
    pub method: String,
    #[serde(default)]
    pub label: Option<String>,
}

#[derive(Clone, Debug, serde::Serialize, PartialEq, Eq)]
pub(crate) struct WindowLifecycleEvent {
    #[serde(rename = "type")]
    pub kind: String,
    pub label: String,
    pub generation: u64,
    pub primary: bool,
    pub state: Option<WindowState>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct WindowIdentity {
    pub label: String,
    pub generation: u64,
}

fn generation_is_current(current: Option<u64>, expected: u64) -> bool {
    current == Some(expected)
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
        self.insert_registration(label, primary, window, None)
    }

    pub(crate) fn register_complete(
        &mut self,
        label: String,
        primary: bool,
        window: SharedWindow,
        webview: SharedWebview,
    ) -> std::result::Result<(), String> {
        self.insert_registration(label, primary, window, Some(webview))
    }

    fn insert_registration(
        &mut self,
        label: String,
        primary: bool,
        window: SharedWindow,
        webview: Option<SharedWebview>,
    ) -> std::result::Result<(), String> {
        self.validate_registration(&label, primary)?;
        let window_id = window
            .try_borrow()
            .ok()
            .and_then(|window| window.as_ref().map(Window::id))
            .ok_or_else(|| format!("window {label} is unavailable during registration"))?;
        let generation = self
            .generations
            .get(&label)
            .copied()
            .unwrap_or(0)
            .checked_add(1)
            .ok_or_else(|| format!("window {label} generation overflow"))?;
        let identity = WindowIdentity {
            label: label.clone(),
            generation,
        };
        self.entries.insert(
            label.clone(),
            RegisteredWindow {
                label,
                generation,
                primary,
                window,
                webview,
            },
        );
        self.generations.insert(identity.label.clone(), generation);
        self.window_ids.insert(window_id, identity);
        Ok(())
    }

    pub(crate) fn is_live(&self, label: &str) -> bool {
        self.entries.get(label).is_some_and(|entry| {
            entry
                .window
                .try_borrow()
                .is_ok_and(|window| window.is_some())
        })
    }

    pub(crate) fn attach_webview(
        &mut self,
        label: &str,
        webview: SharedWebview,
    ) -> std::result::Result<(), String> {
        let entry = self
            .entries
            .get_mut(label)
            .ok_or_else(|| format!("unknown window label: {label}"))?;
        if entry.window.borrow().is_none() {
            return Err(format!("window {label} is closed and cannot be reopened"));
        }
        if entry
            .webview
            .as_ref()
            .is_some_and(|slot| slot.borrow().is_some())
        {
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
        let entry = self
            .entries
            .get(label)
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

    fn state_for_entry(entry: &RegisteredWindow) -> Option<WindowState> {
        let window_ref = entry.window.try_borrow().ok()?;
        let window = window_ref.as_ref()?;
        Some(WindowState {
            label: entry.label.clone(),
            generation: entry.generation,
            primary: entry.primary,
            visible: window.is_visible(),
            focused: window.is_focused(),
            minimized: window.is_minimized(),
            maximized: window.is_maximized(),
        })
    }

    pub(crate) fn state(&self, label: &str) -> std::result::Result<Option<WindowState>, String> {
        validate_window_label(label)?;
        Ok(self.entries.get(label).and_then(Self::state_for_entry))
    }

    pub(crate) fn record_lifecycle(&mut self, kind: &str, label: &str) {
        let Some(entry) = self.entries.get(label) else {
            return;
        };
        let event = WindowLifecycleEvent {
            kind: kind.to_string(),
            label: label.to_string(),
            generation: entry.generation,
            primary: entry.primary,
            state: Self::state_for_entry(entry),
        };
        self.push_lifecycle(event);
    }

    /// Records an OS event only when its WindowId generation is still the
    /// registry's live generation. This rejects delayed events emitted for a
    /// destroyed native window after the same label has been recreated.
    pub(crate) fn record_lifecycle_for_identity(&mut self, kind: &str, identity: &WindowIdentity) {
        let Some(entry) = self.entries.get(&identity.label) else {
            return;
        };
        if !generation_is_current(Some(entry.generation), identity.generation) {
            return;
        }
        let event = WindowLifecycleEvent {
            kind: kind.to_string(),
            label: identity.label.clone(),
            generation: identity.generation,
            primary: entry.primary,
            state: Self::state_for_entry(entry),
        };
        self.push_lifecycle(event);
    }

    fn push_lifecycle(&mut self, event: WindowLifecycleEvent) {
        const MAX_PENDING_LIFECYCLE_EVENTS: usize = 256;
        if self.lifecycle_events.len() == MAX_PENDING_LIFECYCLE_EVENTS {
            self.lifecycle_events.pop_front();
        }
        self.lifecycle_events.push_back(event);
    }

    pub(crate) fn take_lifecycle_events(&mut self) -> Vec<WindowLifecycleEvent> {
        self.lifecycle_events.drain(..).collect()
    }

    pub(crate) fn tray(&self) -> SharedProcessTray {
        self.tray.clone()
    }

    pub(crate) fn global_shortcuts(&self) -> SharedProcessGlobalShortcuts {
        self.global_shortcuts.clone()
    }

    pub(crate) fn webview_for_label(
        registry: &SharedWindowRegistry,
        label: &str,
    ) -> Option<SharedWebview> {
        let registry = registry.borrow();
        let entry = registry.entries.get(label)?;
        if !entry
            .window
            .try_borrow()
            .is_ok_and(|window| window.is_some())
        {
            return None;
        }
        entry
            .webview
            .as_ref()
            .filter(|slot| slot.try_borrow().is_ok_and(|webview| webview.is_some()))
            .cloned()
    }

    pub(crate) fn list(registry: &SharedWindowRegistry) -> Vec<WindowState> {
        let entries = registry.borrow().snapshot();
        let mut states = entries
            .iter()
            .filter_map(Self::state_for_entry)
            .collect::<Vec<_>>();
        states.sort_by(|left, right| {
            right
                .primary
                .cmp(&left.primary)
                .then_with(|| left.label.cmp(&right.label))
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
        let entry = self
            .entries
            .remove(label)
            .ok_or_else(|| format!("unknown window label: {label}"))?;
        if entry.primary {
            self.entries.insert(label.to_string(), entry);
            return Err("the primary window requires application shutdown".to_string());
        }
        if let Ok(window) = entry.window.try_borrow() {
            if let Some(window) = window.as_ref() {
                self.window_ids.remove(&window.id());
            }
        }
        self.pending_close.retain(|pending| pending != label);
        if let Err(error) = self.global_shortcuts.borrow_mut().unregister_owner(label) {
            eprintln!("murasaki: failed to release global shortcuts for {label}: {error}");
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
        let resources = ClosedWindowResources {
            window: entry.window.borrow_mut().take(),
            webview: entry
                .webview
                .as_ref()
                .and_then(|webview| webview.borrow_mut().take()),
            tray,
        };
        self.push_lifecycle(WindowLifecycleEvent {
            kind: "closed".to_string(),
            label: label.to_string(),
            generation: entry.generation,
            primary: false,
            state: None,
        });
        Ok(resources)
    }

    pub(crate) fn identity_for_id(
        registry: &SharedWindowRegistry,
        id: WindowId,
    ) -> Option<WindowIdentity> {
        let registry = registry.borrow();
        let identity = registry.window_ids.get(&id)?.clone();
        let entry = registry.entries.get(&identity.label)?;
        if !generation_is_current(Some(entry.generation), identity.generation) {
            return None;
        }
        let window = entry.window.try_borrow().ok()?;
        window
            .as_ref()
            .filter(|window| window.id() == id)
            .map(|_| identity)
    }

    pub(crate) fn primary_window(registry: &SharedWindowRegistry) -> Option<SharedWindow> {
        let entries = registry.borrow().snapshot();
        entries
            .iter()
            .find(|entry| {
                entry.primary
                    && entry
                        .window
                        .try_borrow()
                        .is_ok_and(|window| window.is_some())
            })
            .map(|entry| entry.window.clone())
    }

    pub(crate) fn dispatch_target(
        registry: &SharedWindowRegistry,
    ) -> Option<(String, SharedWindow, SharedWebview)> {
        let entries = registry.borrow().snapshot();
        let focused = entries.iter().find(|entry| {
            entry
                .window
                .try_borrow()
                .is_ok_and(|window| window.as_ref().is_some_and(Window::is_focused))
                && entry
                    .webview
                    .as_ref()
                    .is_some_and(|slot| slot.try_borrow().is_ok_and(|webview| webview.is_some()))
        });
        let fallback = entries.iter().find(|entry| {
            entry.primary
                && entry
                    .window
                    .try_borrow()
                    .is_ok_and(|window| window.is_some())
                && entry
                    .webview
                    .as_ref()
                    .is_some_and(|slot| slot.try_borrow().is_ok_and(|webview| webview.is_some()))
        });
        focused.or(fallback).and_then(|entry| {
            entry
                .webview
                .as_ref()
                .map(|webview| (entry.label.clone(), entry.window.clone(), webview.clone()))
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
        entries
            .iter()
            .find(|entry| {
                entry.primary
                    && entry
                        .window
                        .try_borrow()
                        .is_ok_and(|window| window.is_some())
                    && entry.webview.as_ref().is_some_and(|slot| {
                        slot.try_borrow().is_ok_and(|webview| webview.is_some())
                    })
            })
            .and_then(|entry| {
                entry
                    .webview
                    .as_ref()
                    .map(|webview| (entry.label.clone(), entry.window.clone(), webview.clone()))
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
        let owned = owner.as_deref().and_then(|owner| {
            entries.iter().find(|entry| {
                entry.label == owner
                    && entry
                        .window
                        .try_borrow()
                        .is_ok_and(|window| window.is_some())
                    && entry.webview.as_ref().is_some_and(|slot| {
                        slot.try_borrow().is_ok_and(|webview| webview.is_some())
                    })
            })
        });
        let fallback = entries.iter().find(|entry| {
            entry.primary
                && entry
                    .window
                    .try_borrow()
                    .is_ok_and(|window| window.is_some())
                && entry
                    .webview
                    .as_ref()
                    .is_some_and(|slot| slot.try_borrow().is_ok_and(|webview| webview.is_some()))
        });
        owned.or(fallback).and_then(|entry| {
            entry.webview.as_ref().map(|webview| {
                (
                    entry.label.clone(),
                    webview.clone(),
                    registry.borrow().tray.clone(),
                )
            })
        })
    }

    pub(crate) fn prepare_close_all(&mut self) -> CloseAllResources {
        if let Err(error) = self.global_shortcuts.borrow_mut().unregister_all() {
            eprintln!("murasaki: failed to release global shortcuts at shutdown: {error}");
        }
        let entries = std::mem::take(&mut self.entries);
        let mut webviews = Vec::with_capacity(entries.len());
        let mut native_windows = Vec::with_capacity(entries.len());
        for (_, mut entry) in entries {
            if let Some(webview) = entry
                .webview
                .take()
                .and_then(|webview| webview.borrow_mut().take())
            {
                webviews.push(webview);
            }
            if let Some(window) = entry.window.borrow_mut().take() {
                native_windows.push(window);
            }
        }
        self.window_ids.clear();
        self.pending_close.clear();
        let tray = {
            let mut tray = self.tray.borrow_mut();
            tray.owner_label = None;
            tray.menu_items.clear();
            tray.icon.take()
        };
        CloseAllResources {
            webviews,
            tray,
            windows: native_windows,
        }
    }
}

pub(crate) fn execute_window_control(
    registry: &SharedWindowRegistry,
    command: &WindowControlCommand,
) -> std::result::Result<serde_json::Value, String> {
    if command.id.is_empty() || command.id.len() > 64 {
        return Err("invalid native window command id".to_string());
    }
    let label = || {
        command
            .label
            .as_deref()
            .ok_or_else(|| format!("window command {} requires a label", command.method))
    };
    match command.method.as_str() {
        "list" => {
            serde_json::to_value(WindowRegistry::list(registry)).map_err(|error| error.to_string())
        }
        "get" => {
            let label = label()?;
            let state = registry.borrow().state(label)?;
            serde_json::to_value(state).map_err(|error| error.to_string())
        }
        "show" => {
            let label = label()?;
            let target = registry.borrow().live_window(label)?;
            open_window(&target);
            registry.borrow_mut().record_lifecycle("shown", label);
            Ok(serde_json::Value::Null)
        }
        "hide" => {
            let label = label()?;
            let target = registry.borrow().live_window(label)?;
            set_window_visible(&target, false);
            registry.borrow_mut().record_lifecycle("hidden", label);
            Ok(serde_json::Value::Null)
        }
        "focus" => {
            let label = label()?;
            let target = registry.borrow().live_window(label)?;
            if let Ok(target) = target.try_borrow() {
                if let Some(target) = target.as_ref() {
                    target.set_focus();
                }
            };
            Ok(serde_json::Value::Null)
        }
        "close" => {
            let label = label()?;
            registry.borrow_mut().request_close(label)?;
            Ok(serde_json::Value::Null)
        }
        _ => Err(format!("unknown native window command: {}", command.method)),
    }
}

#[derive(Clone)]
struct ConfiguredRuntimeWindow {
    window: WindowOptions,
    webview: WebviewOptions,
    create_on_launch: bool,
    app_menu: AppMenuContext,
    #[cfg(target_os = "windows")]
    icon: Option<tao::window::Icon>,
}

/// Event-loop-owned runtime window factory. The catalog is frozen before
/// `run`, and runtime IPC may only instantiate one of these immutable
/// templates; callers cannot inject a URL, capability policy, icon, or menu.
pub(crate) struct RuntimeWindowManager {
    catalog: HashMap<String, ConfiguredRuntimeWindow>,
    order: Vec<String>,
    registry: SharedWindowRegistry,
    web_context: SharedWebContext,
    wake: Rc<dyn Fn()>,
    configured: bool,
}

impl RuntimeWindowManager {
    pub(crate) fn new(
        registry: SharedWindowRegistry,
        web_context: SharedWebContext,
        wake: Rc<dyn Fn()>,
    ) -> Self {
        Self {
            catalog: HashMap::new(),
            order: Vec::new(),
            registry,
            web_context,
            wake,
            configured: false,
        }
    }

    pub(crate) fn configure(
        &mut self,
        templates: Vec<(RuntimeWindowTemplate, AppMenuContext)>,
    ) -> std::result::Result<(), String> {
        if self.configured {
            return Err("runtime window templates are already configured".to_string());
        }
        let plain_templates = templates
            .iter()
            .map(|(template, _)| template.clone())
            .collect::<Vec<_>>();
        Self::validate_templates(&plain_templates)?;
        let mut catalog = HashMap::with_capacity(templates.len());
        let mut order = Vec::with_capacity(templates.len());
        for (template, app_menu) in templates {
            let label = template
                .window
                .label
                .clone()
                .unwrap_or_else(|| "main".to_string());
            order.push(label.clone());
            catalog.insert(
                label,
                ConfiguredRuntimeWindow {
                    window: template.window,
                    webview: template.webview,
                    create_on_launch: template.create_on_launch,
                    app_menu,
                    #[cfg(target_os = "windows")]
                    icon: None,
                },
            );
        }
        self.catalog = catalog;
        self.order = order;
        self.configured = true;
        Ok(())
    }

    pub(crate) fn validate_templates(
        templates: &[RuntimeWindowTemplate],
    ) -> std::result::Result<(), String> {
        if templates.is_empty() {
            return Err("runtime window templates must include primary main".to_string());
        }
        let mut labels = std::collections::HashSet::with_capacity(templates.len());
        let mut primary_count = 0;
        for template in templates {
            let label = template.window.label.as_deref().unwrap_or("main");
            let primary = template.window.primary.unwrap_or(label == "main");
            validate_window_label(label)?;
            if primary != (label == "main") {
                return Err("the primary window must use the reserved label main".to_string());
            }
            if primary {
                primary_count += 1;
                if !template.create_on_launch {
                    return Err("the primary main window must be created on launch".to_string());
                }
            }
            if !labels.insert(label.to_string()) {
                return Err(format!("duplicate window label: {label}"));
            }
        }
        if primary_count != 1 {
            return Err(
                "runtime window templates must contain exactly one primary main".to_string(),
            );
        }
        if templates[0].window.label.as_deref().unwrap_or("main") != "main" {
            return Err("primary main must be the first runtime window template".to_string());
        }
        Ok(())
    }

    #[cfg(target_os = "windows")]
    pub(crate) fn set_windows_icon(
        &mut self,
        icon: Option<tao::window::Icon>,
    ) -> std::result::Result<(), String> {
        if !self.configured {
            return Err("runtime window templates are not configured".to_string());
        }
        for template in self.catalog.values_mut() {
            template.icon = icon.clone();
        }
        Ok(())
    }

    pub(crate) fn create_on_launch<T: 'static>(
        &self,
        target: &EventLoopWindowTarget<T>,
    ) -> std::result::Result<(), String> {
        for label in self.startup_labels() {
            self.create_known(target, &label, true)?;
        }
        Ok(())
    }

    fn startup_labels(&self) -> Vec<String> {
        self.order
            .iter()
            .filter(|label| {
                self.catalog
                    .get(*label)
                    .is_some_and(|template| template.create_on_launch)
            })
            .cloned()
            .collect()
    }

    pub(crate) fn execute<T: 'static>(
        &self,
        target: &EventLoopWindowTarget<T>,
        command: &WindowControlCommand,
    ) -> std::result::Result<serde_json::Value, String> {
        if command.id.is_empty() || command.id.len() > 64 {
            return Err("invalid native window command id".to_string());
        }
        let label = command
            .label
            .as_deref()
            .ok_or_else(|| format!("window command {} requires a label", command.method))?;
        match command.method.as_str() {
            "create" => {
                let state = self.create_known(target, label, false)?;
                serde_json::to_value(state).map_err(|error| error.to_string())
            }
            "destroy" => {
                self.destroy_known(label)?;
                Ok(serde_json::Value::Null)
            }
            _ => Err(format!(
                "runtime window manager cannot execute {}",
                command.method
            )),
        }
    }

    fn create_known<T: 'static>(
        &self,
        target: &EventLoopWindowTarget<T>,
        label: &str,
        startup: bool,
    ) -> std::result::Result<WindowState, String> {
        validate_window_label(label)?;
        let template = self
            .catalog
            .get(label)
            .ok_or_else(|| format!("unknown runtime window template: {label}"))?;
        let primary = template.window.primary.unwrap_or(label == "main");
        if primary && !startup {
            return Err("the primary main window cannot be created at runtime".to_string());
        }
        if startup && !template.create_on_launch {
            return Err(format!("window {label} is not configured for launch"));
        }
        self.registry
            .borrow()
            .validate_registration(label, primary)?;

        let initially_visible = template.window.visible.unwrap_or(primary);
        let mut builder = WindowBuilder::new()
            .with_title(template.window.title.as_deref().unwrap_or("Murasaki"))
            .with_inner_size(LogicalSize::new(
                template.window.width.unwrap_or(1280) as f64,
                template.window.height.unwrap_or(800) as f64,
            ))
            .with_resizable(template.window.resizable.unwrap_or(true))
            .with_visible(false);
        if let (Some(width), Some(height)) = (template.window.min_width, template.window.min_height)
        {
            builder = builder.with_min_inner_size(LogicalSize::new(width as f64, height as f64));
        }
        let transparent_webview =
            vibrancy_requires_transparency(template.window.vibrancy.as_deref());
        if template.window.transparent.unwrap_or(false) || transparent_webview {
            builder = builder.with_transparent(true);
        }
        builder = apply_window_builder_options(builder, &template.window);
        #[cfg(target_os = "windows")]
        if let Some(icon) = template.icon.clone() {
            builder = builder.with_window_icon(Some(icon));
        }
        let window = builder
            .build(target)
            .map_err(|error| format!("build window {label}: {error}"))?;
        // GTK-specific: unlike Win32's HWND or Cocoa's NSWindow, a GtkWindow's
        // native handle (the underlying GdkWindow/X11 XID `raw-window-handle`
        // exposes) doesn't exist until the widget is *realized* — which
        // normally only happens as part of showing it. This window is built
        // hidden above (`.with_visible(false)`) and only actually shown later,
        // once `initially_visible`, by `open_window()` below — so nothing
        // flashes an unstyled blank window before the webview has content —
        // but `Webview::new_unregistered` just below needs a real handle right
        // now, before that. `realize()` creates that handle without mapping
        // (showing) the window, so the "hidden until ready" behavior these
        // dormant/lazy windows rely on is unaffected. Discovered running the
        // production launcher (`imp_linux`) end-to-end under Xvfb — see
        // RFC 0002 phase L2a's Docker verification notes.
        #[cfg(target_os = "linux")]
        {
            use gtk::prelude::WidgetExt;
            use tao::platform::unix::WindowExtUnix;
            window.gtk_window().realize();
            // `realize()` only requests realization; the underlying GdkWindow/
            // X11 XID isn't actually allocated until GTK's main loop processes
            // that request. Pump the queue synchronously so it's ready by the
            // time `Webview::new_unregistered` grabs the native handle just
            // below, instead of racing the tao event loop's own next tick.
            while gtk::events_pending() {
                gtk::main_iteration();
            }
        }
        apply_window_vibrancy(&window, template.window.vibrancy.as_deref())?;
        // Centering computes a position from the window's already-fullscreen
        // outer size; skip it so an initial `fullscreen: true` isn't fought
        // with a redundant/late `set_outer_position` call right after tao
        // itself just fullscreened the window via `with_fullscreen` above.
        if !template.window.fullscreen.unwrap_or(false) {
            center_on_primary_monitor(&window);
        }

        #[cfg(any(target_os = "windows", target_os = "linux"))]
        if primary {
            if let Some(menu) = template.app_menu.menu_slot.borrow().as_ref() {
                crate::menu::attach_menu_bar(menu, &window)
                    .map_err(|error| format!("attach menu for {label}: {error}"))?;
            }
        }

        let shared_window: SharedWindow = Rc::new(RefCell::new(Some(window)));
        let wake = self.wake.clone();
        let mut webview_options = template.webview.clone();
        if transparent_webview {
            webview_options.transparent = Some(true);
        }
        let webview = match Webview::new_unregistered(
            shared_window.clone(),
            webview_options,
            template.app_menu.clone(),
            label.to_string(),
            self.registry.clone(),
            self.web_context.clone(),
            Box::new(move || wake()),
        ) {
            Ok(webview) => webview,
            Err(error) => {
                let window = shared_window.borrow_mut().take();
                drop(window);
                return Err(format!("build webview {label}: {error}"));
            }
        };
        let webview_slot = webview.shared_slot();
        if let Err(error) = self.registry.borrow_mut().register_complete(
            label.to_string(),
            primary,
            shared_window.clone(),
            webview_slot,
        ) {
            webview.drop_unregistered();
            let window = shared_window.borrow_mut().take();
            drop(window);
            return Err(error);
        }
        self.registry
            .borrow_mut()
            .record_lifecycle("created", label);
        if initially_visible {
            open_window(&shared_window);
            self.registry.borrow_mut().record_lifecycle("shown", label);
        }
        self.registry
            .borrow()
            .state(label)?
            .ok_or_else(|| format!("window {label} disappeared after creation"))
    }

    fn destroy_known(&self, label: &str) -> std::result::Result<(), String> {
        validate_window_label(label)?;
        let template = self
            .catalog
            .get(label)
            .ok_or_else(|| format!("unknown runtime window template: {label}"))?;
        if template.window.primary.unwrap_or(label == "main") {
            return Err("the primary main window requires application shutdown".to_string());
        }
        if !self.registry.borrow().is_live(label) {
            return Ok(());
        }
        let resources = self.registry.borrow_mut().prepare_close_secondary(label)?;
        drop_closed_window(resources);
        Ok(())
    }
}

pub(crate) fn drop_closed_window(resources: ClosedWindowResources) {
    drop(resources.tray);
    drop(resources.webview);
    drop(resources.window);
}

pub(crate) fn drop_all_webviews(resources: CloseAllResources) {
    // WebViews borrow their platform windows and WebContext, so preserve this
    // explicit destruction order throughout dev and packaged launchers.
    drop(resources.webviews);
    drop(resources.tray);
    drop(resources.windows);
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

/// Whether a configured macOS material needs a transparent tao window and
/// WebView. Other targets ignore this macOS-only option without changing their
/// window composition.
#[cfg(target_os = "macos")]
pub(crate) fn vibrancy_requires_transparency(vibrancy: Option<&str>) -> bool {
    vibrancy.is_some_and(|value| !value.is_empty())
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn vibrancy_requires_transparency(_vibrancy: Option<&str>) -> bool {
    false
}

#[cfg(target_os = "macos")]
fn parse_vibrancy_material(
    value: &str,
) -> std::result::Result<window_vibrancy::NSVisualEffectMaterial, String> {
    use window_vibrancy::NSVisualEffectMaterial;

    match value {
        "hud" => Ok(NSVisualEffectMaterial::HudWindow),
        "sidebar" => Ok(NSVisualEffectMaterial::Sidebar),
        "popover" => Ok(NSVisualEffectMaterial::Popover),
        _ => Err(format!(
            "unsupported macOS window vibrancy material: {value}"
        )),
    }
}

/// Apply the configured semantic macOS material underneath the WebView.
/// `window-vibrancy` uses the tao raw AppKit view and installs one retained
/// NSVisualEffectView on the main thread. Other platforms intentionally ignore
/// this macOS-only option.
#[cfg(target_os = "macos")]
pub(crate) fn apply_window_vibrancy(
    window: &Window,
    vibrancy: Option<&str>,
) -> std::result::Result<(), String> {
    let Some(value) = vibrancy else {
        return Ok(());
    };
    let material = parse_vibrancy_material(value)?;
    window_vibrancy::apply_vibrancy(window, material, None, None)
        .map_err(|error| format!("apply macOS window vibrancy: {error}"))
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn apply_window_vibrancy(
    _window: &Window,
    _vibrancy: Option<&str>,
) -> std::result::Result<(), String> {
    Ok(())
}

/// Applies the `WindowOptions` fields shared verbatim by both call sites that
/// build a `tao::window::WindowBuilder` directly — `RuntimeWindowManager::create_known`
/// (declarative windows, dev and packaged) and `Application::create_window`
/// (the ad-hoc single-window API). Kept here, not inlined at either call
/// site, so the two never drift on how `decorations`/`titleBarStyle`/max
/// size/`fullscreen` are interpreted.
pub(crate) fn apply_window_builder_options(
    mut builder: WindowBuilder,
    opts: &WindowOptions,
) -> WindowBuilder {
    builder = builder.with_decorations(opts.decorations.unwrap_or(true));
    #[cfg(target_os = "macos")]
    if opts.title_bar_style.as_deref() == Some("hidden") {
        use tao::platform::macos::WindowBuilderExtMacOS;
        // Traffic lights stay; only the title text and titlebar background go
        // away, and the WebView is allowed to extend underneath them — the
        // standard "custom titlebar" recipe on macOS.
        builder = builder
            .with_titlebar_transparent(true)
            .with_title_hidden(true)
            .with_fullsize_content_view(true);
    }
    // `config.ts`'s `resolveWindowDeclarations` always resolves both axes
    // together (filling an unset one with a very large sentinel), so this
    // mirrors the min-size gate above rather than accepting one axis alone.
    if let (Some(width), Some(height)) = (opts.max_width, opts.max_height) {
        builder = builder.with_max_inner_size(LogicalSize::new(width as f64, height as f64));
    }
    if opts.fullscreen.unwrap_or(false) {
        builder = builder.with_fullscreen(Some(tao::window::Fullscreen::Borderless(None)));
    }
    builder
}

/// Centers `window` on its primary monitor. tao's default placement can land
/// the window off-screen (e.g. negative Y on multi-monitor setups), so
/// callers that build a `tao::window::Window` directly — `Application::createWindow`
/// and the production launcher (`crate::launcher`) — compute the centered
/// position explicitly rather than relying on the OS default.
pub(crate) fn center_on_primary_monitor(window: &Window) {
    if let Some(monitor) = window
        .primary_monitor()
        .or_else(|| window.current_monitor())
    {
        let screen = monitor.size();
        let win = window.outer_size();
        let mon_pos = monitor.position();
        let x = mon_pos.x + ((screen.width as i32 - win.width as i32) / 2).max(0);
        let y = mon_pos.y + ((screen.height as i32 - win.height as i32) / 2).max(0);
        window.set_outer_position(tao::dpi::PhysicalPosition::new(x, y));
    }
}

/// One OS display, as returned by `window.getMonitors()` (see
/// `webview::handle_native_call`). Every geometry field is in physical
/// pixels, not logical — a caller wanting logical values divides by
/// `scale_factor` itself.
#[derive(Clone, Debug, serde::Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MonitorInfo {
    pub name: Option<String>,
    pub is_primary: bool,
    pub is_current: bool,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub scale_factor: f64,
}

/// Every OS monitor visible to `window`, in tao's enumeration order.
pub(crate) fn window_monitors(window: &Window) -> Vec<MonitorInfo> {
    let primary = window.primary_monitor();
    let current = window.current_monitor();
    window
        .available_monitors()
        .map(|monitor| {
            let position = monitor.position();
            let size = monitor.size();
            MonitorInfo {
                name: monitor.name(),
                is_primary: primary.as_ref() == Some(&monitor),
                is_current: current.as_ref() == Some(&monitor),
                x: position.x,
                y: position.y,
                width: size.width,
                height: size.height,
                scale_factor: monitor.scale_factor(),
            }
        })
        .collect()
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
    web_context: SharedWebContext,
    /// macOS visual-effect materials are visible only when the child WebView
    /// itself is transparent. This is derived from immutable WindowOptions.
    transparent_webview: bool,
    /// Wakes `Application`'s tao event loop — see `webview::Webview::new`'s
    /// `wake` parameter doc comment. `Rc` (not `Box`) for the same
    /// "`&self`, in principle more than once" reason as `app_menu` above: each
    /// `create_webview` call needs its own owned `Box<dyn Fn()>` to hand to
    /// `Webview::new`, so this is cloned (cheaply, via the `Rc`) into a fresh
    /// box below rather than moved out of `&self`.
    wake: Rc<dyn Fn()>,
}

pub(crate) struct BrowserWindowIdentity {
    pub(crate) label: String,
    pub(crate) primary: bool,
    pub(crate) transparent_webview: bool,
}

impl BrowserWindow {
    pub(crate) fn from_window(
        window: Window,
        identity: BrowserWindowIdentity,
        registry: SharedWindowRegistry,
        app_menu: AppMenuContext,
        web_context: SharedWebContext,
        wake: Rc<dyn Fn()>,
    ) -> Result<Self> {
        let window = Rc::new(RefCell::new(Some(window)));
        registry
            .borrow_mut()
            .register(identity.label.clone(), identity.primary, window.clone())
            .map_err(|error| Error::new(Status::InvalidArg, error))?;
        Ok(Self {
            window,
            label: identity.label,
            registry,
            app_menu,
            web_context,
            transparent_webview: identity.transparent_webview,
            wake,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::{
        execute_window_control, generation_is_current, validate_window_label, MonitorInfo,
        RuntimeWindowManager, WindowControlCommand, WindowRegistry,
    };
    // Only exercised by `configured_vibrancy_requires_a_transparent_webview`
    // below, which is itself macOS-only (vibrancy is a macOS-only concept —
    // see `vibrancy_requires_transparency`'s doc comment) — an unconditional
    // import here is unused on every other target.
    #[cfg(target_os = "macos")]
    use super::vibrancy_requires_transparency;
    use crate::{
        types::{RuntimeWindowTemplate, WebviewOptions, WindowOptions},
        webview::{AppMenuContext, ProcessWebContext},
    };
    use std::{cell::RefCell, rc::Rc};

    fn window_template(
        label: &str,
        primary: bool,
        create_on_launch: bool,
    ) -> RuntimeWindowTemplate {
        RuntimeWindowTemplate {
            window: WindowOptions {
                label: Some(label.to_string()),
                primary: Some(primary),
                visible: Some(primary),
                title: Some(label.to_string()),
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
                decorations: None,
                title_bar_style: None,
                max_width: None,
                max_height: None,
                fullscreen: None,
            },
            webview: WebviewOptions::default(),
            create_on_launch,
        }
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn configured_vibrancy_requires_a_transparent_webview() {
        assert!(vibrancy_requires_transparency(Some("hud")));
        assert!(vibrancy_requires_transparency(Some("sidebar")));
        assert!(!vibrancy_requires_transparency(None));
        assert!(!vibrancy_requires_transparency(Some("")));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_vibrancy_materials_are_bounded() {
        use super::parse_vibrancy_material;
        use window_vibrancy::NSVisualEffectMaterial;

        assert_eq!(
            parse_vibrancy_material("hud").unwrap(),
            NSVisualEffectMaterial::HudWindow
        );
        assert_eq!(
            parse_vibrancy_material("sidebar").unwrap(),
            NSVisualEffectMaterial::Sidebar
        );
        assert_eq!(
            parse_vibrancy_material("popover").unwrap(),
            NSVisualEffectMaterial::Popover
        );
        assert!(parse_vibrancy_material("appearance-based").is_err());
    }

    fn app_menu_context() -> AppMenuContext {
        AppMenuContext {
            menu_slot: Rc::new(RefCell::new(None)),
            menu_labels: None,
            #[cfg(target_os = "macos")]
            about_info: crate::menu::AboutInfoOwned {
                name: "Murasaki".to_string(),
                icon_path: None,
                version: None,
                description: None,
                copyright: None,
                homepage: None,
                authors: None,
            },
        }
    }

    fn manager() -> RuntimeWindowManager {
        RuntimeWindowManager::new(
            Rc::new(RefCell::new(WindowRegistry::default())),
            Rc::new(RefCell::new(ProcessWebContext::default())),
            Rc::new(|| {}),
        )
    }

    #[test]
    fn window_labels_match_the_public_contract() {
        for valid in ["main", "settings", "note.42", "tool_bar", "window-2"] {
            assert!(
                validate_window_label(valid).is_ok(),
                "expected valid label {valid}"
            );
        }
        for invalid in ["", "-leading", "has space", "slash/name", "日本語"] {
            assert!(
                validate_window_label(invalid).is_err(),
                "expected invalid label {invalid}"
            );
        }
        assert!(validate_window_label(&"a".repeat(64)).is_ok());
        assert!(validate_window_label(&"a".repeat(65)).is_err());
    }

    /// `window.getMonitors()`'s per-monitor shape — camelCase keys, physical
    /// pixels. Built by hand rather than through a real `tao::window::Window`:
    /// enumerating actual OS monitors needs a live event loop, unavailable in
    /// a headless unit test.
    #[test]
    fn monitor_info_serializes_to_the_documented_camel_case_shape() {
        let monitor = MonitorInfo {
            name: Some("Built-in Retina Display".to_string()),
            is_primary: true,
            is_current: true,
            x: 0,
            y: 0,
            width: 3024,
            height: 1964,
            scale_factor: 2.0,
        };
        assert_eq!(
            serde_json::to_value(&monitor).unwrap(),
            serde_json::json!({
                "name": "Built-in Retina Display",
                "isPrimary": true,
                "isCurrent": true,
                "x": 0,
                "y": 0,
                "width": 3024,
                "height": 1964,
                "scaleFactor": 2.0,
            }),
        );

        let unnamed = MonitorInfo {
            name: None,
            is_primary: false,
            is_current: false,
            x: 1920,
            y: 0,
            width: 1920,
            height: 1080,
            scale_factor: 1.0,
        };
        assert_eq!(
            serde_json::to_value(&unnamed).unwrap()["name"],
            serde_json::Value::Null
        );
    }

    #[test]
    fn main_window_control_is_closed_over_declared_registry_entries() {
        let registry = Rc::new(RefCell::new(WindowRegistry::default()));
        let list = execute_window_control(
            &registry,
            &WindowControlCommand {
                id: "1".to_string(),
                method: "list".to_string(),
                label: None,
            },
        )
        .unwrap();
        assert_eq!(list, serde_json::json!([]));

        let missing = execute_window_control(
            &registry,
            &WindowControlCommand {
                id: "2".to_string(),
                method: "get".to_string(),
                label: Some("settings".to_string()),
            },
        )
        .unwrap();
        assert_eq!(missing, serde_json::Value::Null);

        let escaped = execute_window_control(
            &registry,
            &WindowControlCommand {
                id: "3".to_string(),
                method: "show".to_string(),
                label: Some("../settings".to_string()),
            },
        )
        .unwrap_err();
        assert!(escaped.contains("window label"));

        let unknown = execute_window_control(
            &registry,
            &WindowControlCommand {
                id: "4".to_string(),
                method: "create".to_string(),
                label: Some("settings".to_string()),
            },
        )
        .unwrap_err();
        assert!(unknown.contains("unknown native window command"));
    }

    #[test]
    fn invalid_catalog_does_not_mutate_manager_and_can_be_retried() {
        let mut manager = manager();
        let invalid = vec![(window_template("main", true, false), app_menu_context())];
        assert!(manager.configure(invalid).is_err());
        assert!(!manager.configured);
        assert!(manager.catalog.is_empty());
        assert!(manager.order.is_empty());

        manager
            .configure(vec![(
                window_template("main", true, true),
                app_menu_context(),
            )])
            .unwrap();
        assert!(manager.configured);
    }

    #[test]
    fn startup_catalog_preserves_declaration_order_and_skips_lazy_windows() {
        let mut manager = manager();
        manager
            .configure(vec![
                (window_template("main", true, true), app_menu_context()),
                (
                    window_template("settings", false, false),
                    app_menu_context(),
                ),
                (window_template("logs", false, true), app_menu_context()),
                (window_template("about", false, true), app_menu_context()),
            ])
            .unwrap();
        assert_eq!(manager.startup_labels(), ["main", "logs", "about"]);

        let wrong_order = vec![
            window_template("settings", false, true),
            window_template("main", true, true),
        ];
        assert!(RuntimeWindowManager::validate_templates(&wrong_order).is_err());
    }

    #[test]
    fn stale_window_generations_are_rejected() {
        assert!(generation_is_current(Some(4), 4));
        assert!(!generation_is_current(Some(5), 4));
        assert!(!generation_is_current(None, 4));
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
    pub fn create_webview(&self, mut opts: WebviewOptions) -> Result<Webview> {
        if self.window.borrow().is_none() {
            return Err(napi::Error::new(
                napi::Status::GenericFailure,
                "window disposed",
            ));
        }
        if self.transparent_webview {
            opts.transparent = Some(true);
        }
        let wake = self.wake.clone();
        Webview::new(
            self.window.clone(),
            opts,
            self.app_menu.clone(),
            self.label.clone(),
            self.registry.clone(),
            self.web_context.clone(),
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
        self.registry
            .borrow_mut()
            .record_lifecycle("shown", &self.label);
        Ok(())
    }

    #[napi]
    pub fn hide(&self) -> Result<()> {
        if let Some(w) = self.window.borrow().as_ref() {
            w.set_visible(false);
        }
        self.registry
            .borrow_mut()
            .record_lifecycle("hidden", &self.label);
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
        self.window
            .borrow()
            .as_ref()
            .is_some_and(Window::is_visible)
    }

    #[napi(js_name = "isFocused")]
    pub fn is_focused(&self) -> bool {
        self.window
            .borrow()
            .as_ref()
            .is_some_and(Window::is_focused)
    }

    #[napi(js_name = "isMaximized")]
    pub fn is_maximized(&self) -> bool {
        self.window
            .borrow()
            .as_ref()
            .is_some_and(Window::is_maximized)
    }

    #[napi(js_name = "isMinimized")]
    pub fn is_minimized(&self) -> bool {
        self.window
            .borrow()
            .as_ref()
            .is_some_and(Window::is_minimized)
    }

    #[napi(js_name = "close")]
    pub fn close(&self) -> Result<()> {
        let primary = self.registry.borrow().is_primary(&self.label);
        if primary {
            self.registry
                .borrow_mut()
                .request_close(&self.label)
                .map_err(|error| Error::new(Status::InvalidArg, error))?;
            (self.wake)();
        } else {
            let window = self
                .registry
                .borrow()
                .live_window(&self.label)
                .map_err(|error| Error::new(Status::InvalidArg, error))?;
            set_window_visible(&window, false);
            self.registry
                .borrow_mut()
                .record_lifecycle("hidden", &self.label);
        }
        Ok(())
    }
}
