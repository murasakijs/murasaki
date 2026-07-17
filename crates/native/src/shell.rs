//! Shell operations — openExternal, showItemInFolder, trashItem, openPath.

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

/// `shell.openPath` must never hand a URL to the OS "open" verb — unlike
/// `shell_show_item_in_folder` above, `open::that_detached` opens its argument
/// exactly like double-clicking it, so a scheme the OS resolves to a browser,
/// mail client, or another registered protocol handler would silently gain
/// the same command surface as `shell.openExternal` without its scheme
/// allowlist.
///
/// A bare Windows drive letter ("C:/…") is *also* syntactically a
/// one-character URL scheme, so only reject a `Url::parse` success that
/// carries an authority (`host()`) or a scheme longer than one character —
/// plain drive-letter and POSIX absolute paths never match either. UNC
/// network shares (`\\server\share\…`) and Windows device-namespace paths
/// (`\\.\PhysicalDrive0`, `\\?\C:\…`) don't parse as a URL at all (`Url::parse`
/// requires a base for a string starting with a bare slash/backslash), so
/// they're rejected outright by the explicit prefix check instead:
/// `shell.openPath` supports only plain drive-letter and POSIX absolute
/// paths, matching `capability_policy`'s own `PathRoot::Posix`/`Drive` (never
/// `Unc`) requirement one layer up.
pub(crate) fn validate_open_path_target(path: &str) -> std::result::Result<(), String> {
    if path.starts_with("\\\\") || path.starts_with("//") {
        return Err(
            "shell.openPath does not support UNC network paths or device paths".to_string(),
        );
    }
    if let Ok(parsed) = url::Url::parse(path) {
        if parsed.host().is_some() || parsed.scheme().len() != 1 {
            return Err("shell.openPath requires a filesystem path, not a URL".to_string());
        }
    }
    Ok(())
}

/// Moves `path` to the OS trash/recycle bin. Absoluteness and traversal are
/// enforced one layer up by `capability_policy` (see
/// `CapabilityResource::Path`, applied even to legacy flat grants); this only
/// adds the existence check the policy layer can't perform.
pub(crate) fn shell_trash_item(path: &str) -> std::result::Result<(), String> {
    if !std::path::Path::new(path).exists() {
        return Err("shell.trashItem path does not exist".to_string());
    }
    trash::delete(path).map_err(|e| format!("move to trash: {e}"))
}

/// Opens `path` with the OS default handler for its type — like
/// double-clicking it in a file manager. See `validate_open_path_target`'s
/// doc comment for why this additionally rejects URLs and UNC/device paths
/// that `capability_policy`'s generic path scoping would otherwise accept.
pub(crate) fn shell_open_path(path: &str) -> std::result::Result<(), String> {
    validate_open_path_target(path)?;
    if !std::path::Path::new(path).exists() {
        return Err("shell.openPath path does not exist".to_string());
    }
    open::that_detached(path).map_err(|e| format!("open path: {e}"))
}

#[cfg(test)]
mod tests {
    use super::validate_open_path_target;

    #[test]
    fn allows_plain_drive_and_posix_absolute_paths() {
        for allowed in [
            "/Users/example/file.txt",
            r"C:/Users/example/file.txt",
            r"C:\Users\example\file.txt",
            "D:/data",
        ] {
            assert!(validate_open_path_target(allowed).is_ok(), "{allowed}");
        }
    }

    #[test]
    fn rejects_urls_with_a_multi_character_scheme_or_a_host() {
        for rejected in [
            "https://evil.example",
            "http://127.0.0.1/",
            "mailto:a@b.com",
            "file:///etc/passwd",
            "calculator:",
        ] {
            assert!(validate_open_path_target(rejected).is_err(), "{rejected}");
        }
    }

    #[test]
    fn rejects_unc_network_shares_and_device_namespace_paths() {
        for rejected in [
            r"\\server\share\file.txt",
            r"\\.\PhysicalDrive0",
            r"\\?\C:\Users\example",
            "//server/share/file.txt",
        ] {
            assert!(validate_open_path_target(rejected).is_err(), "{rejected}");
        }
    }
}
