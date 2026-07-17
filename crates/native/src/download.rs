//! `webview:download` support — default Downloads-folder resolution,
//! suggested-filename sanitization, and confinement of the final on-disk path
//! inside the resolved directory. Wired up from `webview.rs`'s
//! `with_download_started_handler`/`with_download_completed_handler`.

use std::path::{Path, PathBuf};

/// Hand-rolled per-OS default Downloads folder. Wry itself resolves one
/// internally on macOS (via a vendored `dirs` dependency, not exposed to
/// callers), but there is no public helper for it and no other per-OS
/// directory resolver already lives in this crate (see `webview2_data_dir` in
/// `webview.rs` for the sibling WebView2-profile case) — pulling in the
/// `dirs` crate for one directory lookup isn't worth a new dependency.
pub(crate) fn default_downloads_dir() -> Option<PathBuf> {
    if cfg!(target_os = "windows") {
        std::env::var_os("USERPROFILE").map(|home| PathBuf::from(home).join("Downloads"))
    } else {
        // macOS and Linux (development-only) both default to `~/Downloads`;
        // Linux's XDG user-dirs can redirect this, but honoring that would
        // need parsing `~/.config/user-dirs.dirs` for a directory that's
        // already user-configurable via `webview.downloads.directory`.
        std::env::var_os("HOME").map(|home| PathBuf::from(home).join("Downloads"))
    }
}

/// Sanitizes a suggested download filename down to a safe basename: strips
/// any directory components (so `../../etc/passwd` becomes `passwd`),
/// control characters, and leading dots (hidden-file tricks); falls back to
/// `download` when nothing usable remains.
///
/// Splits on both `/` and `\` regardless of host OS — a suggested filename is
/// attacker-influenced (server- or page-controlled), and `Path::file_name`
/// only treats `\` as a separator on Windows, so relying on it alone would
/// let a `..\..\evil` suggestion slip through unsanitized on macOS/Linux.
pub(crate) fn sanitize_filename(suggested: &str) -> String {
    let basename = suggested.rsplit(['/', '\\']).next().unwrap_or("");
    let cleaned: String = basename.chars().filter(|ch| !ch.is_control()).collect();
    let trimmed = cleaned.trim().trim_start_matches('.');
    if trimmed.is_empty() {
        "download".to_string()
    } else {
        trimmed.to_string()
    }
}

/// Confines `filename` (already sanitized — no separators) inside `dir`,
/// resolving a name collision by appending ` (n)` before the extension, like
/// wry's own macOS download-destination logic. Creates `dir` if missing (a
/// fresh profile/custom directory may not exist yet), then canonicalizes it
/// and re-verifies the final candidate's parent is exactly that canonical
/// directory before ever handing the path to wry — defense in depth beyond
/// `sanitize_filename` alone.
pub(crate) fn confine_download_path(
    dir: &Path,
    filename: &str,
) -> std::result::Result<PathBuf, String> {
    std::fs::create_dir_all(dir).map_err(|e| format!("create downloads directory: {e}"))?;
    let canonical_dir = dir
        .canonicalize()
        .map_err(|e| format!("resolve downloads directory: {e}"))?;

    let (stem, ext) = split_extension(filename);
    let mut candidate = canonical_dir.join(filename);
    let mut counter = 1_u32;
    while candidate.exists() {
        candidate = canonical_dir.join(match &ext {
            Some(ext) => format!("{stem} ({counter}).{ext}"),
            None => format!("{stem} ({counter})"),
        });
        counter += 1;
    }

    match candidate.parent() {
        Some(parent) if parent == canonical_dir => Ok(candidate),
        _ => Err("download path escaped the configured directory".to_string()),
    }
}

fn split_extension(filename: &str) -> (String, Option<String>) {
    match filename.rsplit_once('.') {
        Some((stem, ext)) if !stem.is_empty() && !ext.is_empty() => {
            (stem.to_string(), Some(ext.to_string()))
        }
        _ => (filename.to_string(), None),
    }
}

/// Generates a process-local id for a started download, reported in the
/// `murasaki:downloadstarted` `CustomEvent` detail. There is no reliable way
/// to correlate it with the later `murasaki:downloadcompleted` event upstream
/// (wry's completed handler only reports url/path/success — see
/// `capabilities.json`'s `webview-session-network` limitations), so this id
/// is caller-side bookkeeping only.
pub(crate) fn generate_download_id() -> std::result::Result<String, String> {
    let mut bytes = [0_u8; 8];
    getrandom::fill(&mut bytes).map_err(|e| format!("generate download id: {e}"))?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

#[cfg(test)]
mod tests {
    use super::{confine_download_path, sanitize_filename, split_extension};

    #[test]
    fn sanitizes_traversal_control_and_hidden_names() {
        assert_eq!(sanitize_filename("report.pdf"), "report.pdf");
        assert_eq!(sanitize_filename("../../etc/passwd"), "passwd");
        assert_eq!(sanitize_filename("/etc/passwd"), "passwd");
        assert_eq!(sanitize_filename("..\\..\\windows\\system32"), "system32");
        assert_eq!(sanitize_filename(""), "download");
        assert_eq!(sanitize_filename("."), "download");
        assert_eq!(sanitize_filename(".."), "download");
        assert_eq!(sanitize_filename("...hidden"), "hidden");
        assert_eq!(sanitize_filename("na\u{0}me.txt"), "name.txt");
        assert_eq!(sanitize_filename("  spaced.txt  "), "spaced.txt");
    }

    #[test]
    fn splits_extensions_conservatively() {
        assert_eq!(
            split_extension("report.pdf"),
            ("report".to_string(), Some("pdf".to_string()))
        );
        assert_eq!(split_extension("README"), ("README".to_string(), None));
        assert_eq!(
            split_extension(".gitignore"),
            (".gitignore".to_string(), None)
        );
        assert_eq!(
            split_extension("archive.tar.gz"),
            ("archive.tar".to_string(), Some("gz".to_string()))
        );
    }

    #[test]
    fn confines_paths_inside_the_directory_and_resolves_collisions() {
        let base =
            std::env::temp_dir().join(format!("murasaki-download-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);

        let first = confine_download_path(&base, "report.pdf").unwrap();
        assert_eq!(first.file_name().unwrap(), "report.pdf");
        std::fs::write(&first, b"one").unwrap();

        let second = confine_download_path(&base, "report.pdf").unwrap();
        assert_eq!(second.file_name().unwrap(), "report (1).pdf");
        std::fs::write(&second, b"two").unwrap();

        let third = confine_download_path(&base, "report.pdf").unwrap();
        assert_eq!(third.file_name().unwrap(), "report (2).pdf");

        // No-extension collisions still get a numbered suffix.
        let plain = confine_download_path(&base, "README").unwrap();
        std::fs::write(&plain, b"one").unwrap();
        let plain_dup = confine_download_path(&base, "README").unwrap();
        assert_eq!(plain_dup.file_name().unwrap(), "README (1)");

        std::fs::remove_dir_all(&base).unwrap();
    }
}
