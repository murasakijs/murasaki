//! OS-backed credential storage for renderer secrets.
//!
//! Validation and namespacing live outside the platform modules so they can
//! be unit tested without reading or modifying a developer's real credential
//! store. The platform layer has deliberately no file/plaintext fallback:
//! macOS uses Keychain Services and Windows uses Credential Manager; every
//! other target returns an explicit unsupported error.

use sha2::{Digest, Sha256};

pub(crate) const MAX_APP_ID_BYTES: usize = 255;
pub(crate) const MAX_KEY_BYTES: usize = 256;
pub(crate) const MAX_VALUE_BYTES: usize = 2 * 1024;

#[derive(Debug, PartialEq, Eq)]
struct StorageEntry {
    service: String,
    account: String,
}

impl StorageEntry {
    fn new(app_id: &str, key: &str) -> Result<Self, String> {
        validate_string(app_id, "appId", MAX_APP_ID_BYTES)?;
        validate_string(key, "secure storage key", MAX_KEY_BYTES)?;
        Ok(Self {
            service: format!(
                "murasaki.secure-storage.v1.{}",
                sha256_hex(app_id.as_bytes())
            ),
            account: sha256_hex(key.as_bytes()),
        })
    }

    #[cfg(target_os = "windows")]
    fn windows_target(&self) -> String {
        format!("{}/{}", self.service, self.account)
    }
}

pub(crate) fn get(app_id: &str, key: &str) -> Result<Option<String>, String> {
    let entry = StorageEntry::new(app_id, key)?;
    platform::get(&entry)?.map(decode_value).transpose()
}

pub(crate) fn set(app_id: &str, key: &str, value: &str) -> Result<(), String> {
    let entry = StorageEntry::new(app_id, key)?;
    validate_string(value, "secure storage value", MAX_VALUE_BYTES)?;
    platform::set(&entry, value.as_bytes())
}

pub(crate) fn delete(app_id: &str, key: &str) -> Result<(), String> {
    let entry = StorageEntry::new(app_id, key)?;
    platform::delete(&entry)
}

fn validate_string(value: &str, name: &str, max_bytes: usize) -> Result<(), String> {
    if value.is_empty() {
        return Err(format!("{name} must not be empty"));
    }
    if value.contains('\0') {
        return Err(format!("{name} must not contain NUL"));
    }
    if value.len() > max_bytes {
        return Err(format!("{name} must not exceed {max_bytes} UTF-8 bytes"));
    }
    Ok(())
}

fn decode_value(bytes: Vec<u8>) -> Result<String, String> {
    if bytes.is_empty() {
        return Err("secure storage contained an invalid empty value".to_string());
    }
    if bytes.len() > MAX_VALUE_BYTES {
        return Err(format!(
            "secure storage value exceeds the maximum of {MAX_VALUE_BYTES} UTF-8 bytes"
        ));
    }
    let value = String::from_utf8(bytes)
        .map_err(|_| "secure storage contained a non-UTF-8 value".to_string())?;
    if value.contains('\0') {
        return Err("secure storage contained a value with NUL".to_string());
    }
    Ok(value)
}

fn sha256_hex(value: &[u8]) -> String {
    Sha256::digest(value)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

#[cfg(target_os = "macos")]
mod platform {
    use super::StorageEntry;
    use security_framework::passwords::{
        delete_generic_password, generic_password, set_generic_password, PasswordOptions,
    };
    use security_framework_sys::base::errSecItemNotFound;

    pub(super) fn get(entry: &StorageEntry) -> Result<Option<Vec<u8>>, String> {
        match generic_password(PasswordOptions::new_generic_password(
            &entry.service,
            &entry.account,
        )) {
            Ok(value) => Ok(Some(value)),
            Err(error) if error.code() == errSecItemNotFound => Ok(None),
            Err(error) => Err(format!("macOS Keychain read failed: {error}")),
        }
    }

    pub(super) fn set(entry: &StorageEntry, value: &[u8]) -> Result<(), String> {
        set_generic_password(&entry.service, &entry.account, value)
            .map_err(|error| format!("macOS Keychain write failed: {error}"))
    }

    pub(super) fn delete(entry: &StorageEntry) -> Result<(), String> {
        match delete_generic_password(&entry.service, &entry.account) {
            Ok(()) => Ok(()),
            Err(error) if error.code() == errSecItemNotFound => Ok(()),
            Err(error) => Err(format!("macOS Keychain delete failed: {error}")),
        }
    }
}

#[cfg(target_os = "windows")]
mod platform {
    use super::{StorageEntry, MAX_VALUE_BYTES};
    use std::ffi::c_void;
    use windows::{
        core::{HRESULT, PCWSTR, PWSTR},
        Win32::{
            Foundation::ERROR_NOT_FOUND,
            Security::Credentials::{
                CredDeleteW, CredFree, CredReadW, CredWriteW, CREDENTIALW,
                CRED_PERSIST_LOCAL_MACHINE, CRED_TYPE_GENERIC,
            },
        },
    };

    struct CredentialBuffer(*mut CREDENTIALW);

    impl Drop for CredentialBuffer {
        fn drop(&mut self) {
            if !self.0.is_null() {
                // SAFETY: CredReadW returned this buffer and transfers its
                // release to the caller through CredFree.
                unsafe { CredFree(self.0.cast::<c_void>()) };
            }
        }
    }

    pub(super) fn get(entry: &StorageEntry) -> Result<Option<Vec<u8>>, String> {
        let target = wide(&entry.windows_target());
        let mut raw = std::ptr::null_mut();
        // SAFETY: target stays allocated and NUL-terminated for the call;
        // `raw` receives a Credential Manager-owned CREDENTIALW buffer.
        let result = unsafe {
            CredReadW(
                PCWSTR::from_raw(target.as_ptr()),
                CRED_TYPE_GENERIC,
                None,
                &mut raw,
            )
        };
        if let Err(error) = result {
            if error.code() == HRESULT::from_win32(ERROR_NOT_FOUND.0) {
                return Ok(None);
            }
            return Err(format!("Windows Credential Manager read failed: {error}"));
        }
        if raw.is_null() {
            return Err(
                "Windows Credential Manager returned an empty credential buffer".to_string(),
            );
        }
        let buffer = CredentialBuffer(raw);
        // SAFETY: `buffer` owns a live CREDENTIALW allocated by CredReadW
        // until this function returns and its Drop calls CredFree.
        let credential = unsafe { &*buffer.0 };
        let size = credential.CredentialBlobSize as usize;
        if size > MAX_VALUE_BYTES {
            return Err(format!(
                "Windows credential exceeds the maximum of {MAX_VALUE_BYTES} bytes"
            ));
        }
        if size > 0 && credential.CredentialBlob.is_null() {
            return Err("Windows Credential Manager returned a null credential value".to_string());
        }
        let value = if size == 0 {
            Vec::new()
        } else {
            // SAFETY: CredentialBlob is valid for CredentialBlobSize bytes
            // while the CredReadW buffer is alive.
            unsafe { std::slice::from_raw_parts(credential.CredentialBlob, size) }.to_vec()
        };
        Ok(Some(value))
    }

    pub(super) fn set(entry: &StorageEntry, value: &[u8]) -> Result<(), String> {
        let mut target = wide(&entry.windows_target());
        let mut username = wide("Murasaki");
        let mut blob = value.to_vec();
        let credential = CREDENTIALW {
            Type: CRED_TYPE_GENERIC,
            TargetName: PWSTR::from_raw(target.as_mut_ptr()),
            CredentialBlobSize: blob.len() as u32,
            CredentialBlob: blob.as_mut_ptr(),
            Persist: CRED_PERSIST_LOCAL_MACHINE,
            UserName: PWSTR::from_raw(username.as_mut_ptr()),
            ..Default::default()
        };
        // SAFETY: every pointer in credential refers to a live backing Vec
        // for this synchronous call; CredWriteW copies the fields.
        let result = unsafe { CredWriteW(&credential, 0) }
            .map_err(|error| format!("Windows Credential Manager write failed: {error}"));
        blob.fill(0);
        result
    }

    pub(super) fn delete(entry: &StorageEntry) -> Result<(), String> {
        let target = wide(&entry.windows_target());
        // SAFETY: target stays allocated and NUL-terminated for the call.
        match unsafe { CredDeleteW(PCWSTR::from_raw(target.as_ptr()), CRED_TYPE_GENERIC, None) } {
            Ok(()) => Ok(()),
            Err(error) if error.code() == HRESULT::from_win32(ERROR_NOT_FOUND.0) => Ok(()),
            Err(error) => Err(format!("Windows Credential Manager delete failed: {error}")),
        }
    }

    fn wide(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(std::iter::once(0)).collect()
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod platform {
    use super::StorageEntry;

    pub(super) fn get(_entry: &StorageEntry) -> Result<Option<Vec<u8>>, String> {
        Err("secure storage is unsupported on this platform".to_string())
    }

    pub(super) fn set(_entry: &StorageEntry, _value: &[u8]) -> Result<(), String> {
        Err("secure storage is unsupported on this platform".to_string())
    }

    pub(super) fn delete(_entry: &StorageEntry) -> Result<(), String> {
        Err("secure storage is unsupported on this platform".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::{decode_value, StorageEntry, MAX_APP_ID_BYTES, MAX_KEY_BYTES, MAX_VALUE_BYTES};

    #[test]
    fn validates_app_namespace_key_and_value_boundaries() {
        for (app_id, key) in [
            ("", "key"),
            ("app", ""),
            ("app\0id", "key"),
            ("app", "key\0"),
        ] {
            assert!(StorageEntry::new(app_id, key).is_err());
        }
        assert!(StorageEntry::new(&"a".repeat(MAX_APP_ID_BYTES), "key").is_ok());
        assert!(StorageEntry::new(&"a".repeat(MAX_APP_ID_BYTES + 1), "key").is_err());
        assert!(StorageEntry::new("app", &"k".repeat(MAX_KEY_BYTES)).is_ok());
        assert!(StorageEntry::new("app", &"k".repeat(MAX_KEY_BYTES + 1)).is_err());

        assert!(super::validate_string("v", "value", MAX_VALUE_BYTES).is_ok());
        assert!(super::validate_string("", "value", MAX_VALUE_BYTES).is_err());
        assert!(super::validate_string("bad\0value", "value", MAX_VALUE_BYTES).is_err());
        assert!(
            super::validate_string(&"v".repeat(MAX_VALUE_BYTES), "value", MAX_VALUE_BYTES).is_ok()
        );
        assert!(
            super::validate_string(&"v".repeat(MAX_VALUE_BYTES + 1), "value", MAX_VALUE_BYTES)
                .is_err()
        );
    }

    #[test]
    fn namespaces_are_deterministic_app_and_key_isolated_and_do_not_expose_inputs() {
        let first = StorageEntry::new("com.example.first", "refresh-token").unwrap();
        let same = StorageEntry::new("com.example.first", "refresh-token").unwrap();
        let other_app = StorageEntry::new("com.example.second", "refresh-token").unwrap();
        let other_key = StorageEntry::new("com.example.first", "access-token").unwrap();
        assert_eq!(first, same);
        assert_ne!(first.service, other_app.service);
        assert_ne!(first.account, other_key.account);
        assert!(!first.service.contains("com.example.first"));
        assert!(!first.account.contains("refresh-token"));
    }

    #[test]
    fn stored_values_must_remain_bounded_nonempty_utf8_without_nul() {
        assert_eq!(decode_value(b"secret".to_vec()).unwrap(), "secret");
        assert!(decode_value(Vec::new()).is_err());
        assert!(decode_value(vec![0xff]).is_err());
        assert!(decode_value(b"bad\0value".to_vec()).is_err());
        assert!(decode_value(vec![b'x'; MAX_VALUE_BYTES + 1]).is_err());
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    #[test]
    fn unsupported_platforms_never_fall_back_to_plaintext() {
        assert!(super::get("com.example.app", "key")
            .unwrap_err()
            .contains("unsupported"));
        assert!(super::set("com.example.app", "key", "value")
            .unwrap_err()
            .contains("unsupported"));
        assert!(super::delete("com.example.app", "key")
            .unwrap_err()
            .contains("unsupported"));
    }
}
