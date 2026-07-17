//! Process-wide, renderer-owned global keyboard shortcuts.
//!
//! The operating-system registration is process-global, but every entry keeps
//! the stable window label of the renderer that created it. This lets the
//! event loop route triggers back to the correct webview and release all
//! registrations when that renderer is destroyed.

use std::{cell::RefCell, collections::HashMap, rc::Rc};

#[cfg(any(target_os = "macos", target_os = "windows"))]
use std::{
    collections::VecDeque,
    sync::{Arc, Mutex, Once, OnceLock},
};

#[cfg(any(target_os = "macos", target_os = "windows"))]
use global_hotkey::{
    hotkey::{Code, HotKey, Modifiers},
    GlobalHotKeyEvent, GlobalHotKeyManager, HotKeyState,
};

const MAX_ACCELERATOR_BYTES: usize = 128;
const MAX_SHORTCUT_ID_BYTES: usize = 128;
const MAX_REGISTRATIONS: usize = 64;
#[cfg(any(target_os = "macos", target_os = "windows"))]
const MAX_PENDING_EVENTS: usize = 256;

#[cfg(any(target_os = "macos", target_os = "windows"))]
type EventWaker = Arc<dyn Fn() + Send + Sync + 'static>;

#[cfg(any(target_os = "macos", target_os = "windows"))]
static EVENT_HANDLER_INIT: Once = Once::new();
#[cfg(any(target_os = "macos", target_os = "windows"))]
static PENDING_EVENTS: OnceLock<Mutex<VecDeque<GlobalHotKeyEvent>>> = OnceLock::new();
#[cfg(any(target_os = "macos", target_os = "windows"))]
static EVENT_WAKER: OnceLock<Mutex<Option<EventWaker>>> = OnceLock::new();

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn pending_events() -> &'static Mutex<VecDeque<GlobalHotKeyEvent>> {
    PENDING_EVENTS.get_or_init(|| Mutex::new(VecDeque::new()))
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn event_waker() -> &'static Mutex<Option<EventWaker>> {
    EVENT_WAKER.get_or_init(|| Mutex::new(None))
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn install_event_handler() {
    EVENT_HANDLER_INIT.call_once(|| {
        GlobalHotKeyEvent::set_event_handler(Some(enqueue_event));
    });
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn enqueue_event(event: GlobalHotKeyEvent) {
    {
        let mut events = pending_events()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if events.len() == MAX_PENDING_EVENTS {
            events.pop_front();
        }
        events.push_back(event);
    }
    let wake = event_waker()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .clone();
    if let Some(wake) = wake {
        wake();
    }
}

/// Connect global-hotkey's OS callback to the active tao loop. The callback
/// may run outside the UI stack (notably Windows key-release detection), so
/// it stores a bounded event and sends only a thread-safe user event.
#[cfg(any(target_os = "macos", target_os = "windows"))]
pub(crate) fn set_event_waker(wake: EventWaker) {
    install_event_handler();
    *event_waker()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(wake);
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct TriggeredShortcut {
    pub owner_label: String,
    pub id: String,
    pub accelerator: String,
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
#[derive(Clone, Debug)]
struct Registration {
    owner_label: String,
    id: String,
    accelerator: String,
    hotkey: HotKey,
}

#[derive(Default)]
pub(crate) struct ProcessGlobalShortcuts {
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    manager: Option<GlobalHotKeyManager>,
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    registrations: HashMap<String, Registration>,
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    native_ids: HashMap<u32, String>,
}

pub(crate) type SharedProcessGlobalShortcuts = Rc<RefCell<ProcessGlobalShortcuts>>;

#[cfg(any(target_os = "macos", target_os = "windows"))]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ModifierToken {
    Control,
    Alt,
    Shift,
    Super,
    CommandOrControl,
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn parse_modifier(token: &str) -> Option<ModifierToken> {
    match token.to_ascii_lowercase().as_str() {
        "control" | "ctrl" => Some(ModifierToken::Control),
        "alt" | "option" => Some(ModifierToken::Alt),
        "shift" => Some(ModifierToken::Shift),
        "command" | "cmd" | "super" | "meta" => Some(ModifierToken::Super),
        "commandorcontrol" | "commandorctrl" | "cmdorcontrol" | "cmdorctrl" => {
            Some(ModifierToken::CommandOrControl)
        }
        _ => None,
    }
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn resolved_modifier(token: ModifierToken) -> Modifiers {
    match token {
        ModifierToken::Control => Modifiers::CONTROL,
        ModifierToken::Alt => Modifiers::ALT,
        ModifierToken::Shift => Modifiers::SHIFT,
        ModifierToken::Super => Modifiers::SUPER,
        ModifierToken::CommandOrControl => {
            #[cfg(target_os = "macos")]
            {
                Modifiers::SUPER
            }
            #[cfg(target_os = "windows")]
            {
                Modifiers::CONTROL
            }
        }
    }
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn canonical_accelerator(hotkey: HotKey) -> String {
    let mut parts = Vec::with_capacity(5);
    if hotkey.mods.contains(Modifiers::CONTROL) {
        parts.push("Control".to_string());
    }
    if hotkey.mods.contains(Modifiers::ALT) {
        parts.push("Alt".to_string());
    }
    if hotkey.mods.contains(Modifiers::SHIFT) {
        parts.push("Shift".to_string());
    }
    if hotkey.mods.contains(Modifiers::SUPER) {
        #[cfg(target_os = "macos")]
        parts.push("Command".to_string());
        #[cfg(target_os = "windows")]
        parts.push("Super".to_string());
    }
    parts.push(hotkey.key.to_string());
    parts.join("+")
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn is_reserved(hotkey: HotKey) -> bool {
    #[cfg(target_os = "macos")]
    {
        let command_only = hotkey.mods == Modifiers::SUPER;
        let system_lock =
            hotkey.mods == (Modifiers::CONTROL | Modifiers::SUPER) && hotkey.key == Code::KeyQ;
        system_lock
            || (command_only
                && matches!(
                    hotkey.key,
                    Code::KeyQ | Code::KeyH | Code::KeyM | Code::Space | Code::Tab
                ))
    }
    #[cfg(target_os = "windows")]
    {
        (hotkey.mods == Modifiers::ALT && hotkey.key == Code::F4)
            || (hotkey.mods == Modifiers::SUPER && matches!(hotkey.key, Code::KeyL | Code::Tab))
            || (hotkey.mods == (Modifiers::CONTROL | Modifiers::ALT) && hotkey.key == Code::Delete)
    }
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn parse_accelerator(value: &str) -> Result<(HotKey, String), String> {
    if value.is_empty() || value.len() > MAX_ACCELERATOR_BYTES || !value.is_ascii() {
        return Err(format!(
            "accelerator must be 1-{MAX_ACCELERATOR_BYTES} ASCII bytes"
        ));
    }
    let tokens = value.split('+').map(str::trim).collect::<Vec<_>>();
    if !(2..=5).contains(&tokens.len()) || tokens.iter().any(|token| token.is_empty()) {
        return Err("accelerator requires one or more modifiers followed by one key".to_string());
    }

    let key = *tokens
        .last()
        .ok_or_else(|| "accelerator requires a key".to_string())?;
    if parse_modifier(key).is_some() {
        return Err("accelerator requires exactly one non-modifier key".to_string());
    }

    let mut modifiers = Modifiers::empty();
    for token in &tokens[..tokens.len() - 1] {
        let parsed = parse_modifier(token)
            .ok_or_else(|| format!("unknown accelerator modifier {token:?}"))?;
        let resolved = resolved_modifier(parsed);
        if modifiers.intersects(resolved) {
            return Err(format!("duplicate accelerator modifier {token:?}"));
        }
        modifiers |= resolved;
    }
    if modifiers.is_empty() {
        return Err("accelerator requires at least one modifier".to_string());
    }

    // Let global-hotkey's platform-maintained key table perform the final
    // known-key validation after our stricter format and duplicate checks.
    let parsed: HotKey = format!("{}+{key}", tokens[..tokens.len() - 1].join("+"))
        .parse()
        .map_err(|error| format!("invalid accelerator: {error}"))?;
    if parsed.mods != modifiers {
        return Err("accelerator modifier resolution is inconsistent".to_string());
    }
    if is_reserved(parsed) {
        return Err(
            "accelerator is reserved by the operating system or application lifecycle".to_string(),
        );
    }
    Ok((parsed, canonical_accelerator(parsed)))
}

fn validate_shortcut_id(id: &str) -> Result<(), String> {
    if id.is_empty()
        || id.len() > MAX_SHORTCUT_ID_BYTES
        || !id
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | ':' | '-' | '+'))
    {
        return Err(format!(
            "global shortcut id must be 1-{MAX_SHORTCUT_ID_BYTES} characters using letters, numbers, dot, underscore, colon, hyphen, or plus"
        ));
    }
    Ok(())
}

impl ProcessGlobalShortcuts {
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    pub(crate) fn register(
        &mut self,
        owner_label: &str,
        accelerator: &str,
        requested_id: Option<&str>,
    ) -> Result<(String, String), String> {
        let (hotkey, canonical) = parse_accelerator(accelerator)?;
        let id = requested_id.unwrap_or(&canonical).to_string();
        validate_shortcut_id(&id)?;
        if self.registrations.len() >= MAX_REGISTRATIONS {
            return Err(format!(
                "global shortcut limit of {MAX_REGISTRATIONS} registrations reached"
            ));
        }
        if self.registrations.contains_key(&id) {
            return Err(format!("global shortcut id {id:?} is already registered"));
        }
        if let Some(existing_id) = self.native_ids.get(&hotkey.id()) {
            return Err(format!(
                "accelerator {canonical:?} conflicts with registered shortcut {existing_id:?}"
            ));
        }
        if self.manager.is_none() {
            install_event_handler();
            self.manager = Some(
                GlobalHotKeyManager::new()
                    .map_err(|error| format!("initialize global shortcut manager: {error}"))?,
            );
        }
        self.manager
            .as_ref()
            .expect("manager initialized above")
            .register(hotkey)
            .map_err(|error| {
                format!(
                    "register global shortcut {canonical:?}: the shortcut is unavailable or already registered by another application ({error})"
                )
            })?;
        self.native_ids.insert(hotkey.id(), id.clone());
        self.registrations.insert(
            id.clone(),
            Registration {
                owner_label: owner_label.to_string(),
                id: id.clone(),
                accelerator: canonical.clone(),
                hotkey,
            },
        );
        Ok((id, canonical))
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    pub(crate) fn register(
        &mut self,
        _owner_label: &str,
        _accelerator: &str,
        _requested_id: Option<&str>,
    ) -> Result<(String, String), String> {
        Err("global shortcuts are supported only on macOS and Windows".to_string())
    }

    #[cfg(any(target_os = "macos", target_os = "windows"))]
    pub(crate) fn unregister(&mut self, owner_label: &str, id: &str) -> Result<(), String> {
        validate_shortcut_id(id)?;
        let registration = self
            .registrations
            .get(id)
            .ok_or_else(|| format!("global shortcut id {id:?} is not registered"))?;
        if registration.owner_label != owner_label {
            return Err(format!(
                "global shortcut id {id:?} belongs to a different renderer"
            ));
        }
        let registration = registration.clone();
        self.unregister_registration(&registration)
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    pub(crate) fn unregister(&mut self, _owner_label: &str, id: &str) -> Result<(), String> {
        validate_shortcut_id(id)?;
        Err("global shortcuts are supported only on macOS and Windows".to_string())
    }

    #[cfg(any(target_os = "macos", target_os = "windows"))]
    fn unregister_registration(&mut self, registration: &Registration) -> Result<(), String> {
        let unregister_result = self
            .manager
            .as_ref()
            .ok_or_else(|| "global shortcut manager is not initialized".to_string())?
            .unregister(registration.hotkey)
            .map_err(|error| format!("unregister global shortcut {:?}: {error}", registration.id));
        self.native_ids.remove(&registration.hotkey.id());
        self.registrations.remove(&registration.id);
        if let Err(error) = unregister_result {
            // Drop resets every OS registration (DestroyWindow on Windows;
            // explicit unregister in global-hotkey's macOS Drop), then restore
            // only the still-owned entries. This prevents a failed unregister
            // from leaving a ghost shortcut attached to a closed renderer.
            let recovery = self.rebuild_manager();
            return Err(match recovery {
                Ok(()) => format!("{error}; reset the global shortcut manager"),
                Err(recovery) => format!("{error}; manager recovery also failed: {recovery}"),
            });
        }
        Ok(())
    }

    #[cfg(any(target_os = "macos", target_os = "windows"))]
    fn rebuild_manager(&mut self) -> Result<(), String> {
        self.manager.take();
        self.native_ids.clear();
        if self.registrations.is_empty() {
            return Ok(());
        }
        let manager = GlobalHotKeyManager::new()
            .map_err(|error| format!("reinitialize global shortcut manager: {error}"))?;
        let registrations = self.registrations.values().cloned().collect::<Vec<_>>();
        for registration in registrations {
            if let Err(error) = manager.register(registration.hotkey) {
                self.registrations.clear();
                self.native_ids.clear();
                return Err(format!(
                    "restore global shortcut {:?}: {error}",
                    registration.id
                ));
            }
            self.native_ids
                .insert(registration.hotkey.id(), registration.id.clone());
        }
        self.manager = Some(manager);
        Ok(())
    }

    pub(crate) fn unregister_owner(&mut self, owner_label: &str) -> Result<(), String> {
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        {
            let registrations = self
                .registrations
                .values()
                .filter(|registration| registration.owner_label == owner_label)
                .cloned()
                .collect::<Vec<_>>();
            let mut first_error = None;
            for registration in registrations {
                if let Err(error) = self.unregister_registration(&registration) {
                    first_error.get_or_insert(error);
                }
            }
            if let Some(error) = first_error {
                return Err(error);
            }
        }
        Ok(())
    }

    pub(crate) fn unregister_all(&mut self) -> Result<(), String> {
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        {
            let registrations = self.registrations.values().cloned().collect::<Vec<_>>();
            let mut first_error = None;
            for registration in registrations {
                if let Err(error) = self.unregister_registration(&registration) {
                    first_error.get_or_insert(error);
                }
            }
            if let Some(error) = first_error {
                return Err(error);
            }
        }
        Ok(())
    }

    #[cfg(any(target_os = "macos", target_os = "windows"))]
    pub(crate) fn take_triggered(&self) -> Vec<TriggeredShortcut> {
        let mut triggered = Vec::new();
        let events = pending_events()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .drain(..)
            .collect::<Vec<_>>();
        for event in events {
            if event.state != HotKeyState::Pressed {
                continue;
            }
            let Some(id) = self.native_ids.get(&event.id) else {
                continue;
            };
            if let Some(registration) = self.registrations.get(id) {
                triggered.push(TriggeredShortcut {
                    owner_label: registration.owner_label.clone(),
                    id: registration.id.clone(),
                    accelerator: registration.accelerator.clone(),
                });
            }
        }
        triggered
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    pub(crate) fn take_triggered(&self) -> Vec<TriggeredShortcut> {
        Vec::new()
    }
}

#[cfg(test)]
mod tests {
    use super::validate_shortcut_id;

    #[test]
    fn shortcut_ids_are_bounded_and_safe() {
        for valid in [
            "capture",
            "capture.primary",
            "window_2:toggle",
            "item-42",
            "Control+Shift+KeyK",
        ] {
            assert!(
                validate_shortcut_id(valid).is_ok(),
                "expected valid id {valid}"
            );
        }
        for invalid in ["", "has space", "slash/name", "日本語"] {
            assert!(
                validate_shortcut_id(invalid).is_err(),
                "expected invalid id {invalid}"
            );
        }
    }

    #[cfg(any(target_os = "macos", target_os = "windows"))]
    #[test]
    fn accelerator_parser_rejects_unbounded_ambiguous_and_invalid_input() {
        use super::parse_accelerator;

        for value in [
            "K",
            "Control+Control+K",
            "Control+NoSuchKey",
            "Control+Shift",
            "Control++K",
            "Control+K+Shift",
            "日本語+K",
        ] {
            assert!(
                parse_accelerator(value).is_err(),
                "expected invalid {value}"
            );
        }
        assert!(parse_accelerator(&"A".repeat(129)).is_err());
    }

    #[cfg(any(target_os = "macos", target_os = "windows"))]
    #[test]
    fn accelerator_parser_normalizes_known_cross_platform_keys() {
        use super::parse_accelerator;

        let (first, canonical) = parse_accelerator("Ctrl + Shift + K").unwrap();
        let (second, _) = parse_accelerator("shift+control+KeyK").unwrap();
        assert_eq!(first, second);
        assert!(canonical.contains("Control"));
        assert!(canonical.contains("Shift"));
        assert!(canonical.ends_with("KeyK"));
    }

    #[cfg(any(target_os = "macos", target_os = "windows"))]
    #[test]
    fn os_event_callback_is_bounded_and_wakes_the_tao_proxy_path() {
        use super::{
            enqueue_event, event_waker, pending_events, GlobalHotKeyEvent, HotKeyState,
            MAX_PENDING_EVENTS,
        };
        use std::sync::{
            atomic::{AtomicUsize, Ordering},
            Arc,
        };

        pending_events()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clear();
        let wakes = Arc::new(AtomicUsize::new(0));
        let observed = wakes.clone();
        *event_waker()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(Arc::new(move || {
            observed.fetch_add(1, Ordering::SeqCst);
        }));

        for id in 0..(MAX_PENDING_EVENTS as u32 + 10) {
            enqueue_event(GlobalHotKeyEvent {
                id,
                state: HotKeyState::Pressed,
            });
        }
        assert_eq!(wakes.load(Ordering::SeqCst), MAX_PENDING_EVENTS + 10);
        let events = pending_events()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        assert_eq!(events.len(), MAX_PENDING_EVENTS);
        assert_eq!(events.front().map(|event| event.id), Some(10));
        drop(events);
        pending_events()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clear();
        *event_waker()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = None;
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_lifecycle_shortcuts_are_reserved() {
        use super::parse_accelerator;
        assert!(parse_accelerator("Command+Q").is_err());
        assert!(parse_accelerator("Command+Space").is_err());
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn windows_lifecycle_shortcuts_are_reserved() {
        use super::parse_accelerator;
        assert!(parse_accelerator("Alt+F4").is_err());
        assert!(parse_accelerator("Super+L").is_err());
    }
}
