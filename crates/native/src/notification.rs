//! System notifications via notify-rust.

use napi::bindgen_prelude::{Error, Result, Status};
use napi_derive::napi;

use crate::types::NotificationOptions;

/// Generates a process-local id for the shown notification. Upstream
/// notify-rust cannot deliver click/action callbacks on macOS or Windows (see
/// `capabilities.json`'s `native-utilities` limitations), so this id is
/// caller-side bookkeeping only — it does not correlate with any later event.
fn generate_notification_id() -> std::result::Result<String, String> {
    let mut bytes = [0_u8; 16];
    getrandom::fill(&mut bytes).map_err(|e| format!("generate notification id: {e}"))?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

#[napi(js_name = "showNotification")]
pub fn show_notification(opts: NotificationOptions) -> Result<String> {
    let mut n = notify_rust::Notification::new();
    n.summary(&opts.title);
    if let Some(body) = &opts.body {
        n.body(body);
    }
    if let Some(icon) = &opts.icon {
        n.icon(icon);
    }
    #[cfg(target_os = "macos")]
    if opts.sound.unwrap_or(false) {
        n.sound_name("default");
    }
    n.show()
        .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;
    generate_notification_id().map_err(|e| Error::new(Status::GenericFailure, e))
}

#[cfg(test)]
mod tests {
    use super::generate_notification_id;

    #[test]
    fn ids_are_32_lowercase_hex_characters_and_unlikely_to_collide() {
        let first = generate_notification_id().unwrap();
        let second = generate_notification_id().unwrap();
        for id in [&first, &second] {
            assert_eq!(id.len(), 32);
            assert!(id
                .chars()
                .all(|ch| ch.is_ascii_hexdigit() && !ch.is_ascii_uppercase()));
        }
        assert_ne!(first, second);
    }
}
