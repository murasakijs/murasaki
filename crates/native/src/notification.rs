//! System notifications via notify-rust.

use napi::bindgen_prelude::{Error, Result, Status};
use napi_derive::napi;

use crate::types::NotificationOptions;

#[napi(js_name = "showNotification")]
pub fn show_notification(opts: NotificationOptions) -> Result<()> {
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
  Ok(())
}
