//! Shell operations — openExternal, showItemInFolder, trashItem, openPath.

use napi::bindgen_prelude::{Error, Result, Status};
use napi_derive::napi;
use std::path::{Component, Path, PathBuf};

#[napi(js_name = "shellOpenExternal")]
pub fn shell_open_external(target: String) -> Result<()> {
    open::that_detached(&target).map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;
    Ok(())
}

#[napi(js_name = "shellShowItemInFolder")]
pub fn shell_show_item_in_folder(path: String) -> Result<()> {
    let path = resolve_entry_parent_target(&path, "shell.showItemInFolder")
        .map_err(|e| Error::new(Status::InvalidArg, e))?;
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .args(["-R", path.as_str()])
            .spawn()
            .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;
        Ok(())
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .args(["/select,", path.as_str()])
            .spawn()
            .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;
        Ok(())
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let dir = Path::new(&path).parent().unwrap_or(Path::new("/"));
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
    let resolved = resolve_entry_parent_target(path, "shell.trashItem")?;
    trash::delete(resolved).map_err(|e| format!("move to trash: {e}"))
}

/// Resolve every directory component while deliberately leaving the final
/// entry unresolved. This prevents an allowed path such as
/// `/allowed/link-dir/file` (`link-dir -> /outside`) from escaping its scope,
/// while preserving the expected behaviour for a final symlink: the link
/// itself is revealed/trashed, not the file it points at.
pub(crate) fn resolve_entry_parent_target(
    path: &str,
    operation: &str,
) -> std::result::Result<String, String> {
    let requested = Path::new(path);
    if !requested.is_absolute()
        || requested
            .components()
            .any(|component| matches!(component, Component::ParentDir))
    {
        return Err(format!(
            "{operation} requires an absolute path without traversal"
        ));
    }
    let name = requested
        .file_name()
        .ok_or_else(|| format!("{operation} requires a file or directory entry"))?;
    let parent = requested
        .parent()
        .ok_or_else(|| format!("{operation} path has no parent directory"))?;
    let resolved_parent = std::fs::canonicalize(parent)
        .map_err(|e| format!("{operation} could not resolve parent directory: {e}"))?;
    let resolved = resolved_parent.join(name);
    std::fs::symlink_metadata(&resolved)
        .map_err(|e| format!("{operation} path does not exist: {e}"))?;
    render_resolved_path(resolved, operation)
}

fn render_resolved_path(path: PathBuf, operation: &str) -> std::result::Result<String, String> {
    let rendered = path
        .to_str()
        .ok_or_else(|| format!("{operation} resolved path is not valid Unicode"))?;

    #[cfg(target_os = "windows")]
    let rendered = rendered
        .strip_prefix(r"\\?\UNC\")
        .map(|rest| format!(r"\\{rest}"))
        .or_else(|| rendered.strip_prefix(r"\\?\").map(str::to_string))
        .unwrap_or_else(|| rendered.to_string());
    #[cfg(not(target_os = "windows"))]
    let rendered = rendered.to_string();

    Ok(rendered)
}

/// Opens `path` with the OS default handler for its type — like
/// double-clicking it in a file manager. See `validate_open_path_target`'s
/// doc comment for why this additionally rejects URLs and UNC/device paths
/// that `capability_policy`'s generic path scoping would otherwise accept.
pub(crate) fn shell_open_path(path: &str) -> std::result::Result<(), String> {
    let resolved = resolve_open_path_target(path)?;
    open::that_detached(resolved).map_err(|e| format!("open path: {e}"))
}

/// Resolve symlinks before capability authorization. The renderer-facing
/// dispatcher requires both the requested path and this real target to stay
/// in scope, preventing `/allowed/link -> /outside/app` escapes.
pub(crate) fn resolve_open_path_target(path: &str) -> std::result::Result<String, String> {
    validate_open_path_target(path)?;
    let resolved = std::fs::canonicalize(path)
        .map_err(|e| format!("shell.openPath could not resolve path: {e}"))?;
    let rendered = render_resolved_path(resolved, "shell.openPath")?;

    validate_open_path_target(&rendered)?;
    Ok(rendered)
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

    #[cfg(unix)]
    #[test]
    fn resolves_symlinks_to_the_real_open_target() {
        use std::os::unix::fs::symlink;
        let root = std::env::temp_dir().join(format!(
            "murasaki-shell-symlink-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let allowed = root.join("allowed");
        let outside = root.join("outside.txt");
        std::fs::create_dir_all(&allowed).unwrap();
        std::fs::write(&outside, b"outside").unwrap();
        let link = allowed.join("link.txt");
        symlink(&outside, &link).unwrap();

        assert_eq!(
            super::resolve_open_path_target(link.to_str().unwrap()).unwrap(),
            outside.canonicalize().unwrap().to_str().unwrap()
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn resolves_intermediate_symlinks_but_preserves_the_final_entry() {
        use std::os::unix::fs::symlink;
        let root = std::env::temp_dir().join(format!(
            "murasaki-shell-entry-symlink-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let allowed = root.join("allowed");
        let outside = root.join("outside");
        std::fs::create_dir_all(&allowed).unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        std::fs::write(outside.join("secret.txt"), b"outside").unwrap();
        symlink(&outside, allowed.join("linked-dir")).unwrap();
        symlink(outside.join("secret.txt"), allowed.join("final-link")).unwrap();

        assert_eq!(
            super::resolve_entry_parent_target(
                allowed.join("linked-dir/secret.txt").to_str().unwrap(),
                "test"
            )
            .unwrap(),
            outside
                .canonicalize()
                .unwrap()
                .join("secret.txt")
                .to_str()
                .unwrap()
        );
        assert_eq!(
            super::resolve_entry_parent_target(
                allowed.join("final-link").to_str().unwrap(),
                "test"
            )
            .unwrap(),
            allowed
                .canonicalize()
                .unwrap()
                .join("final-link")
                .to_str()
                .unwrap()
        );
        std::fs::remove_dir_all(root).unwrap();
    }
}
