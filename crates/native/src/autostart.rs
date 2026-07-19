//! Per-user login autostart for packaged applications.
//!
//! Registration is deliberately renderer-capability gated in `webview.rs` and
//! unavailable under `murasaki dev`: registering the development Node binary
//! would create a persistent, broken login item. macOS uses a LaunchAgent,
//! Windows uses HKCU's Run key, and Linux uses XDG Autostart. Every generated
//! file/value is deterministic so `status` only reports `enabled` when the
//! registration still points at this exact packaged executable.

use std::path::{Path, PathBuf};

const MAX_APP_ID_BYTES: usize = 255;

pub(crate) fn status(app_id: &str, is_packaged: bool) -> Result<&'static str, String> {
    let registration = registration(app_id, is_packaged)?;
    if registration.is_enabled()? {
        Ok("enabled")
    } else {
        Ok("disabled")
    }
}

pub(crate) fn enable(app_id: &str, is_packaged: bool) -> Result<(), String> {
    registration(app_id, is_packaged)?.enable()
}

pub(crate) fn disable(app_id: &str, is_packaged: bool) -> Result<(), String> {
    registration(app_id, is_packaged)?.disable()
}

fn registration(app_id: &str, is_packaged: bool) -> Result<Registration, String> {
    if !is_packaged {
        return Err("autostart is available only in a packaged Murasaki application".to_string());
    }
    validate_app_id(app_id)?;
    let executable = packaged_executable()?;
    let executable_text = executable
        .to_str()
        .ok_or_else(|| "packaged executable path is not valid Unicode".to_string())?;
    if executable_text.chars().any(char::is_control) {
        return Err("packaged executable path contains a control character".to_string());
    }
    Ok(Registration {
        app_id: app_id.to_string(),
        executable,
    })
}

fn validate_app_id(app_id: &str) -> Result<(), String> {
    if app_id.is_empty()
        || app_id.len() > MAX_APP_ID_BYTES
        || !app_id.contains('.')
        || app_id.starts_with('.')
        || app_id.ends_with('.')
        || app_id.split('.').any(|part| {
            part.is_empty()
                || part.starts_with('-')
                || part.ends_with('-')
                || !part
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
        })
    {
        return Err(
            "autostart requires a safe reverse-DNS appId containing only letters, digits, dots, and hyphens"
                .to_string(),
        );
    }
    Ok(())
}

fn packaged_executable() -> Result<PathBuf, String> {
    #[cfg(target_os = "linux")]
    if let Some(appimage) = std::env::var_os("APPIMAGE") {
        let path = PathBuf::from(appimage);
        if path.is_absolute() && path.is_file() {
            return Ok(path);
        }
        return Err("APPIMAGE must identify an existing absolute file for autostart".to_string());
    }

    let executable = std::env::current_exe()
        .map_err(|error| format!("cannot resolve packaged executable for autostart: {error}"))?;
    if !executable.is_absolute() || !executable.is_file() {
        return Err(
            "packaged executable for autostart must be an existing absolute file".to_string(),
        );
    }
    Ok(executable)
}

struct Registration {
    app_id: String,
    executable: PathBuf,
}

impl Registration {
    #[cfg(target_os = "macos")]
    fn file_path(&self) -> Result<PathBuf, String> {
        let home = std::env::var_os("HOME")
            .filter(|value| !value.is_empty())
            .ok_or_else(|| {
                "HOME is unavailable; cannot manage the macOS LaunchAgent".to_string()
            })?;
        Ok(PathBuf::from(home)
            .join("Library")
            .join("LaunchAgents")
            .join(format!("{}.plist", self.app_id)))
    }

    #[cfg(target_os = "linux")]
    fn file_path(&self) -> Result<PathBuf, String> {
        let config = std::env::var_os("XDG_CONFIG_HOME")
            .filter(|value| !value.is_empty())
            .map(PathBuf::from)
            .or_else(|| {
                std::env::var_os("HOME")
                    .filter(|value| !value.is_empty())
                    .map(|home| PathBuf::from(home).join(".config"))
            })
            .ok_or_else(|| {
                "XDG_CONFIG_HOME and HOME are unavailable; cannot manage XDG Autostart".to_string()
            })?;
        Ok(config
            .join("autostart")
            .join(format!("{}.desktop", self.app_id)))
    }

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    fn contents(&self) -> String {
        registration_contents(&self.app_id, &self.executable)
    }

    fn enable(&self) -> Result<(), String> {
        #[cfg(any(target_os = "macos", target_os = "linux"))]
        {
            return write_registration_file(&self.file_path()?, self.contents().as_bytes());
        }

        #[cfg(target_os = "windows")]
        {
            use windows_registry::CURRENT_USER;
            const RUN_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
            let value = windows_command(&self.executable)?;
            CURRENT_USER
                .create(RUN_KEY)
                .and_then(|key| key.set_string(&self.app_id, value))
                .map_err(|error| format!("cannot register Windows autostart: {error}"))?;
            return Ok(());
        }

        #[allow(unreachable_code)]
        Err("autostart is unsupported on this platform".to_string())
    }

    fn disable(&self) -> Result<(), String> {
        #[cfg(any(target_os = "macos", target_os = "linux"))]
        {
            let path = self.file_path()?;
            return match std::fs::remove_file(path) {
                Ok(()) => Ok(()),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
                Err(error) => Err(format!("cannot remove autostart registration: {error}")),
            };
        }

        #[cfg(target_os = "windows")]
        {
            use windows_registry::CURRENT_USER;
            const RUN_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
            let key = match CURRENT_USER.options().write().open(RUN_KEY) {
                Ok(key) => key,
                Err(error) if error.code().0 as u32 == 0x8007_0002 => return Ok(()),
                Err(error) => return Err(format!("cannot open Windows autostart key: {error}")),
            };
            return match key.remove_value(&self.app_id) {
                Ok(()) => Ok(()),
                Err(error) if error.code().0 as u32 == 0x8007_0002 => Ok(()),
                Err(error) => Err(format!("cannot remove Windows autostart: {error}")),
            };
        }

        #[allow(unreachable_code)]
        Err("autostart is unsupported on this platform".to_string())
    }

    fn is_enabled(&self) -> Result<bool, String> {
        #[cfg(any(target_os = "macos", target_os = "linux"))]
        {
            let path = self.file_path()?;
            return match std::fs::read(path) {
                Ok(contents) => Ok(contents == self.contents().as_bytes()),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
                Err(error) => Err(format!("cannot read autostart registration: {error}")),
            };
        }

        #[cfg(target_os = "windows")]
        {
            use windows_registry::CURRENT_USER;
            const RUN_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
            let expected = windows_command(&self.executable)?;
            let key = match CURRENT_USER.open(RUN_KEY) {
                Ok(key) => key,
                Err(error) if error.code().0 as u32 == 0x8007_0002 => return Ok(false),
                Err(error) => return Err(format!("cannot open Windows autostart key: {error}")),
            };
            return match key.get_string(&self.app_id) {
                Ok(value) => Ok(value == expected),
                Err(error) if error.code().0 as u32 == 0x8007_0002 => Ok(false),
                Err(error) => Err(format!("cannot read Windows autostart: {error}")),
            };
        }

        #[allow(unreachable_code)]
        Err("autostart is unsupported on this platform".to_string())
    }
}

#[cfg(target_os = "macos")]
fn registration_contents(app_id: &str, executable: &Path) -> String {
    let executable = xml_escape(&executable.to_string_lossy());
    let app_id = xml_escape(app_id);
    format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n\
<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n\
<plist version=\"1.0\">\n<dict>\n\
  <key>Label</key>\n  <string>{app_id}</string>\n\
  <key>ProgramArguments</key>\n  <array>\n    <string>{executable}</string>\n  </array>\n\
  <key>RunAtLoad</key>\n  <true/>\n\
</dict>\n</plist>\n"
    )
}

#[cfg(target_os = "macos")]
fn xml_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

#[cfg(target_os = "linux")]
fn registration_contents(app_id: &str, executable: &Path) -> String {
    format!(
        "[Desktop Entry]\nType=Application\nVersion=1.0\nName={}\nExec={}\nStartupNotify=false\nTerminal=false\nX-Murasaki-Autostart=true\n",
        app_id,
        desktop_exec_quote(&executable.to_string_lossy()),
    )
}

#[cfg(target_os = "linux")]
fn desktop_exec_quote(value: &str) -> String {
    let escaped = value
        .replace('%', "%%")
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('`', "\\`")
        .replace('$', "\\$");
    format!("\"{escaped}\"")
}

#[cfg(target_os = "windows")]
fn windows_command(executable: &Path) -> Result<String, String> {
    let value = executable
        .to_str()
        .ok_or_else(|| "packaged executable path is not valid Unicode".to_string())?;
    if value.contains('"') || value.chars().any(char::is_control) {
        return Err(
            "packaged executable path contains an unsafe Windows command character".to_string(),
        );
    }
    Ok(format!("\"{value}\""))
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn write_registration_file(path: &Path, contents: &[u8]) -> Result<(), String> {
    use std::io::Write;
    use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};

    let parent = path
        .parent()
        .ok_or_else(|| "autostart registration has no parent directory".to_string())?;
    std::fs::create_dir_all(parent)
        .map_err(|error| format!("cannot create autostart directory: {error}"))?;
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "autostart registration filename is invalid".to_string())?;
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|error| format!("cannot create autostart registration timestamp: {error}"))?
        .as_nanos();
    let temp = parent.join(format!(".{file_name}.{}.{nonce}.tmp", std::process::id()));
    let result = (|| {
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&temp)
            .map_err(|error| format!("cannot create autostart registration: {error}"))?;
        file.write_all(contents)
            .and_then(|()| file.sync_all())
            .map_err(|error| format!("cannot write autostart registration: {error}"))?;
        std::fs::rename(&temp, path)
            .map_err(|error| format!("cannot install autostart registration: {error}"))?;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
            .map_err(|error| format!("cannot secure autostart registration: {error}"))?;
        Ok(())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(temp);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::validate_app_id;

    #[test]
    fn app_ids_are_safe_path_and_registry_components() {
        assert!(validate_app_id("com.example.Murasaki-Notes").is_ok());
        for value in [
            "",
            "single",
            ".com.example",
            "com.example.",
            "com..example",
            "com.-example",
            "com.example/../../agent",
            "com.example\nagent",
        ] {
            assert!(
                validate_app_id(value).is_err(),
                "{value:?} must be rejected"
            );
        }
    }

    #[test]
    fn development_never_creates_or_reads_a_registration() {
        assert_eq!(
            super::status("com.example.safe", false).unwrap_err(),
            "autostart is available only in a packaged Murasaki application"
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn launch_agent_xml_escapes_the_executable() {
        let contents = super::registration_contents(
            "com.example.safe",
            std::path::Path::new("/Applications/A&B <Notes>.app/Contents/MacOS/A&B"),
        );
        assert!(contents.contains("A&amp;B &lt;Notes&gt;.app"));
        assert!(!contents.contains("A&B <Notes>"));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn generated_launch_agent_passes_plutil_validation() {
        let path = std::env::temp_dir().join(format!(
            "murasaki-autostart-plist-{}-{}.plist",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let contents = super::registration_contents(
            "com.example.safe",
            std::path::Path::new("/Applications/Murasaki Notes.app/Contents/MacOS/Murasaki Notes"),
        );
        std::fs::write(&path, contents).unwrap();

        let output = std::process::Command::new("/usr/bin/plutil")
            .args(["-lint", "--"])
            .arg(&path)
            .output()
            .unwrap();
        let _ = std::fs::remove_file(&path);

        assert!(
            output.status.success(),
            "generated LaunchAgent is invalid: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[cfg(unix)]
    #[test]
    fn registration_file_atomically_replaces_a_symlink_without_touching_its_target() {
        use std::os::unix::fs::{symlink, PermissionsExt};

        let root = std::env::temp_dir().join(format!(
            "murasaki-autostart-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let victim = root.join("victim");
        let registration = root.join("com.example.safe.plist");
        std::fs::write(&victim, b"do not replace").unwrap();
        symlink(&victim, &registration).unwrap();

        super::write_registration_file(&registration, b"safe registration").unwrap();

        assert_eq!(std::fs::read(&victim).unwrap(), b"do not replace");
        assert_eq!(std::fs::read(&registration).unwrap(), b"safe registration");
        assert!(!std::fs::symlink_metadata(&registration)
            .unwrap()
            .file_type()
            .is_symlink());
        assert_eq!(
            std::fs::metadata(&registration)
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn xdg_exec_escapes_reserved_characters() {
        assert_eq!(
            super::desktop_exec_quote("/opt/Mura %U $aki/`app`\\bin\""),
            "\"/opt/Mura %%U \\$aki/\\`app\\`\\\\bin\\\"\"",
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn windows_run_command_quotes_the_executable_and_rejects_injection() {
        assert_eq!(
            super::windows_command(std::path::Path::new(
                r"C:\Program Files\Murasaki Notes\Murasaki.exe"
            ))
            .unwrap(),
            r#""C:\Program Files\Murasaki Notes\Murasaki.exe""#
        );
        assert!(super::windows_command(std::path::Path::new(
            "C:\\Apps\\Murasaki\" --unexpected.exe"
        ))
        .is_err());
    }
}
