//! Shell operations — openExternal, showItemInFolder.

use napi::bindgen_prelude::{Error, Result, Status};
use napi_derive::napi;

#[napi(js_name = "shellOpenExternal")]
pub fn shell_open_external(target: String) -> Result<()> {
    open::that_detached(&target).map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;
    Ok(())
}

#[napi(js_name = "shellShowItemInFolder")]
pub fn shell_show_item_in_folder(path: String) -> Result<()> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .args(["-R", &path])
            .spawn()
            .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;
        Ok(())
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .args(["/select,", &path])
            .spawn()
            .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;
        Ok(())
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let dir = std::path::Path::new(&path)
            .parent()
            .unwrap_or(std::path::Path::new("/"));
        open::that_detached(dir).map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;
        Ok(())
    }
}
