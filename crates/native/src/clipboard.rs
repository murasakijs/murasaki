//! Clipboard via arboard.

use napi::bindgen_prelude::{Error, Result, Status};
use napi_derive::napi;

#[napi(js_name = "clipboardRead")]
pub fn clipboard_read() -> Result<String> {
  let mut cb = arboard::Clipboard::new()
    .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;
  cb.get_text()
    .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))
}

#[napi(js_name = "clipboardWrite")]
pub fn clipboard_write(text: String) -> Result<()> {
  let mut cb = arboard::Clipboard::new()
    .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;
  cb.set_text(text)
    .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;
  Ok(())
}
