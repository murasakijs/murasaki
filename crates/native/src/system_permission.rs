//! Host operating-system permission queries and prompts.
//!
//! These are deliberately separate from Murasaki renderer capabilities:
//! capabilities authorize JavaScript to call a native command, while these
//! APIs reflect consent controlled by macOS. Windows unpackaged desktop apps
//! do not expose equivalent app-scoped startup prompts, so the same calls
//! return `unsupported` there instead of implying a grant that did not occur.
//!
//! Seven kinds are supported, all macOS-only: `camera`/`microphone` (capture,
//! usage-description required), `screenRecording`/`accessibility`/
//! `inputMonitoring` (prompt-style, granted-vs-not-granted only),
//! `location` (capture-style, usage-description required), and
//! `fullDiskAccess` (guidance-only — see `full_disk_access_status` below;
//! there is no TCC request API for it).

#[cfg(target_os = "macos")]
use std::os::raw::c_int;

#[cfg(target_os = "macos")]
use block2::RcBlock;
#[cfg(target_os = "macos")]
use objc2_application_services::{
    kAXTrustedCheckOptionPrompt, AXIsProcessTrusted, AXIsProcessTrustedWithOptions,
};
#[cfg(target_os = "macos")]
use objc2_av_foundation::{
    AVAuthorizationStatus, AVCaptureDevice, AVMediaType, AVMediaTypeAudio, AVMediaTypeVideo,
};
#[cfg(target_os = "macos")]
use objc2_core_foundation::{CFBoolean, CFDictionary, CFRetained, CFType};
#[cfg(target_os = "macos")]
use objc2_core_graphics::{CGPreflightScreenCaptureAccess, CGRequestScreenCaptureAccess};
#[cfg(target_os = "macos")]
use objc2_core_location::{CLAuthorizationStatus, CLLocationManager};
#[cfg(target_os = "macos")]
use objc2_foundation::{NSBundle, NSString};

pub(crate) const NAMES: &[&str] = &[
    "camera",
    "microphone",
    "screenRecording",
    "accessibility",
    "inputMonitoring",
    "location",
    "fullDiskAccess",
];

fn validate_name(name: &str) -> Result<(), String> {
    if NAMES.contains(&name) {
        Ok(())
    } else {
        Err(format!(
      "unknown system permission {name}; expected camera, microphone, screenRecording, accessibility, inputMonitoring, location, or fullDiskAccess"
    ))
    }
}

#[cfg(target_os = "macos")]
fn capture_media_type(name: &str) -> Option<&'static AVMediaType> {
    // SAFETY: AVFoundation exports these process-lifetime NSString constants.
    unsafe {
        match name {
            "camera" => AVMediaTypeVideo,
            "microphone" => AVMediaTypeAudio,
            _ => None,
        }
    }
}

#[cfg(target_os = "macos")]
fn capture_status(media_type: &AVMediaType) -> &'static str {
    // SAFETY: media_type is one of AVMediaTypeVideo/Audio, the only values this
    // API accepts. Calling a class authorization query has no side effects.
    match unsafe { AVCaptureDevice::authorizationStatusForMediaType(media_type) } {
        AVAuthorizationStatus::Authorized => "granted",
        AVAuthorizationStatus::Denied => "denied",
        AVAuthorizationStatus::Restricted => "restricted",
        AVAuthorizationStatus::NotDetermined => "notDetermined",
        _ => "notGranted",
    }
}

#[cfg(target_os = "macos")]
fn info_dictionary_key_present(key: &str) -> bool {
    let key = NSString::from_str(key);
    NSBundle::mainBundle()
        .objectForInfoDictionaryKey(&key)
        .is_some()
}

#[cfg(target_os = "macos")]
fn capture_usage_description_present(name: &str) -> bool {
    match name {
        "camera" => info_dictionary_key_present("NSCameraUsageDescription"),
        "microphone" => info_dictionary_key_present("NSMicrophoneUsageDescription"),
        _ => false,
    }
}

// --- Input Monitoring -------------------------------------------------------
//
// IOHIDCheckAccess/IOHIDRequestAccess gate the HID event stream
// (IOHIDManager/IOHIDDevice), and live in IOKit's C `hidsystem` API rather
// than an Objective-C class, so objc2 has no binding for them. This declares
// their minimal, stable public FFI surface directly. Values verified against
// `IOKit.framework/Headers/hidsystem/IOHIDLib.h` (both introduced macOS
// 10.15):
//   enum IOHIDRequestType { kIOHIDRequestTypePostEvent = 0, kIOHIDRequestTypeListenEvent = 1 };
//   enum IOHIDAccessType { kIOHIDAccessTypeGranted = 0, kIOHIDAccessTypeDenied = 1, kIOHIDAccessTypeUnknown = 2 };
#[cfg(target_os = "macos")]
const IOHID_REQUEST_TYPE_LISTEN_EVENT: c_int = 1;
#[cfg(target_os = "macos")]
const IOHID_ACCESS_TYPE_GRANTED: c_int = 0;
#[cfg(target_os = "macos")]
const IOHID_ACCESS_TYPE_DENIED: c_int = 1;

#[cfg(target_os = "macos")]
#[link(name = "IOKit", kind = "framework")]
unsafe extern "C" {
    #[link_name = "IOHIDCheckAccess"]
    fn iohid_check_access(request_type: c_int) -> c_int;
    #[link_name = "IOHIDRequestAccess"]
    fn iohid_request_access(request_type: c_int) -> bool;
}

#[cfg(target_os = "macos")]
fn input_monitoring_status() -> &'static str {
    // SAFETY: the argument is IOKit's own stable request-type constant; the
    // call is a read-only TCC query with no side effects.
    match unsafe { iohid_check_access(IOHID_REQUEST_TYPE_LISTEN_EVENT) } {
        IOHID_ACCESS_TYPE_GRANTED => "granted",
        IOHID_ACCESS_TYPE_DENIED => "denied",
        _ => "notDetermined", // kIOHIDAccessTypeUnknown: not yet decided.
    }
}

#[cfg(target_os = "macos")]
fn request_input_monitoring() -> &'static str {
    // SAFETY: same constant as above. Like screenRecording/accessibility
    // below, IOKit itself avoids re-prompting once the user has already
    // answered.
    let _ = unsafe { iohid_request_access(IOHID_REQUEST_TYPE_LISTEN_EVENT) };
    input_monitoring_status()
}

// --- Location ----------------------------------------------------------------
//
// `mode: 'always'` is resolved from the Info.plist key `cli/bundle.ts`'s
// `infoPlist()` only writes when `systemPermissions.macOS.location.mode ===
// 'always'` (`NSLocationAlwaysAndWhenInUseUsageDescription`), rather than
// being threaded separately through launch metadata. That keeps one source of
// truth for the resolved mode and makes it apply identically to
// `requestOnLaunch` and a runtime `systemPermission.request('location')` call.

#[cfg(target_os = "macos")]
fn location_status() -> &'static str {
    // SAFETY: `new` is CLLocationManager's designated NSObject-style
    // constructor; `authorizationStatus` is a read-only query. A fresh,
    // unretained instance is fine here since we don't need it to outlive this
    // call.
    let manager = unsafe { CLLocationManager::new() };
    match unsafe { manager.authorizationStatus() } {
        CLAuthorizationStatus::Denied => "denied",
        CLAuthorizationStatus::Restricted => "restricted",
        CLAuthorizationStatus::AuthorizedAlways | CLAuthorizationStatus::AuthorizedWhenInUse => {
            "granted"
        }
        _ => "notDetermined", // NotDetermined.
    }
}

#[cfg(target_os = "macos")]
fn request_location() -> Result<&'static str, String> {
    if !info_dictionary_key_present("NSLocationWhenInUseUsageDescription") {
        return Err(
            "requesting location requires systemPermissions.macOS.location.usageDescription in a packaged app"
                .to_string(),
        );
    }
    if location_status() == "notDetermined" {
        let always = info_dictionary_key_present("NSLocationAlwaysAndWhenInUseUsageDescription");
        // SAFETY: `new` is CLLocationManager's designated constructor.
        // requestWhenInUseAuthorization/requestAlwaysAuthorization trigger
        // macOS's asynchronous consent sheet; we do not register a delegate
        // and do not need a location fix, only the side effect of the
        // prompt appearing.
        let manager = unsafe { CLLocationManager::new() };
        unsafe {
            if always {
                manager.requestAlwaysAuthorization();
            } else {
                manager.requestWhenInUseAuthorization();
            }
        }
        // The manager must not be deallocated before the user dismisses the
        // prompt, which can outlive this function call. There's no delegate
        // callback we need afterward, so rather than race a real drop
        // against the OS's own outstanding reference to it, we deliberately
        // leak it (never release) for the remainder of the process — bounded
        // by how many times `request("location")` is actually invoked, which
        // is developer/user-driven, not a hot loop.
        std::mem::forget(manager);
    }
    Ok(location_status())
}

// --- Full Disk Access ----------------------------------------------------
//
// There is no public TCC query or request API for Full Disk Access.

#[cfg(target_os = "macos")]
fn tcc_db_path() -> Option<std::path::PathBuf> {
    let home = std::env::var_os("HOME")?;
    let mut path = std::path::PathBuf::from(home);
    path.push("Library/Application Support/com.apple.TCC/TCC.db");
    Some(path)
}

/// HEURISTIC, not a documented API: `~/Library/Application
/// Support/com.apple.TCC/TCC.db` is itself gated by Full Disk Access — macOS
/// refuses even an open-for-read to a process that lacks it (`EACCES`), and
/// allows it once FDA is granted. That's an OS side effect, not a contract,
/// so the result is reported as best-effort:
/// - a successful open ⇒ FDA is (almost certainly) granted.
/// - a permission error ⇒ very likely not granted, though a stray
///   sandboxing/SIP change could theoretically also produce this.
/// - anything else (missing file, a future macOS moving/renaming the
///   database, …) ⇒ `"unknown"` rather than guessed at, since asserting
///   granted/notGranted here could be actively wrong and this permission has
///   no consent UI a caller could use to double check.
#[cfg(target_os = "macos")]
fn full_disk_access_status_at(tcc_db: &std::path::Path) -> &'static str {
    match std::fs::File::open(tcc_db) {
        Ok(_) => "granted",
        Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => "notGranted",
        Err(_) => "unknown",
    }
}

#[cfg(target_os = "macos")]
fn full_disk_access_status() -> &'static str {
    match tcc_db_path() {
        Some(path) => full_disk_access_status_at(&path),
        None => "unknown",
    }
}

#[cfg(target_os = "macos")]
fn request_full_disk_access() -> Result<&'static str, String> {
    if full_disk_access_status() != "granted" {
        // There is no TCC request API for Full Disk Access; opening System
        // Settings' own pane is Apple's documented workaround. This never
        // implies the user actually grants it — status() is re-queried
        // below instead of assuming success.
        open::that_detached(
            "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles",
        )
        .map_err(|e| format!("failed to open Full Disk Access settings: {e}"))?;
    }
    Ok(full_disk_access_status())
}

pub(crate) fn status(name: &str) -> Result<&'static str, String> {
    validate_name(name)?;
    #[cfg(target_os = "macos")]
    {
        if matches!(name, "camera" | "microphone") {
            let media_type = capture_media_type(name).ok_or_else(|| {
                format!("macOS did not expose the {name} media permission constant")
            })?;
            return Ok(capture_status(media_type));
        }
        match name {
            // CoreGraphics/Accessibility/IOKit only expose granted vs. not
            // granted; they do not distinguish a first request from a denial.
            "screenRecording" => Ok(if CGPreflightScreenCaptureAccess() {
                "granted"
            } else {
                "notGranted"
            }),
            "accessibility" => Ok(if unsafe { AXIsProcessTrusted() } {
                "granted"
            } else {
                "notGranted"
            }),
            "inputMonitoring" => Ok(input_monitoring_status()),
            "location" => Ok(location_status()),
            "fullDiskAccess" => Ok(full_disk_access_status()),
            _ => unreachable!(),
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok("unsupported")
    }
}

pub(crate) fn request(name: &str) -> Result<&'static str, String> {
    validate_name(name)?;
    #[cfg(target_os = "macos")]
    {
        if matches!(name, "camera" | "microphone") {
            let media_type = capture_media_type(name).ok_or_else(|| {
                format!("macOS did not expose the {name} media permission constant")
            })?;
            if !capture_usage_description_present(name) {
                return Err(format!(
          "requesting {name} requires systemPermissions.macOS.{name}.usageDescription in a packaged app"
        ));
            }
            if capture_status(media_type) == "notDetermined" {
                let completion = RcBlock::new(|_granted: objc2::runtime::Bool| {});
                // SAFETY: media_type is Video/Audio and AVFoundation copies the
                // completion block for its asynchronous reply.
                unsafe {
                    AVCaptureDevice::requestAccessForMediaType_completionHandler(
                        media_type,
                        &completion,
                    );
                }
            }
            return status(name);
        }
        match name {
            "screenRecording" => {
                let _ = CGRequestScreenCaptureAccess();
                status(name)
            }
            "accessibility" => {
                let prompt = CFBoolean::new(true);
                // SAFETY: kAXTrustedCheckOptionPrompt is a process-lifetime
                // ApplicationServices CFString constant.
                let prompt_key = unsafe { kAXTrustedCheckOptionPrompt };
                let typed = CFDictionary::<CFType, CFType>::from_slices(
                    &[prompt_key.as_ref()],
                    &[prompt.as_ref()],
                );
                // The generated ApplicationServices binding accepts an opaque
                // CFDictionary because the C API is heterogenous.
                let options: CFRetained<CFDictionary> =
                    unsafe { CFRetained::cast_unchecked(typed) };
                let _ = unsafe { AXIsProcessTrustedWithOptions(Some(&options)) };
                status(name)
            }
            "inputMonitoring" => Ok(request_input_monitoring()),
            "location" => request_location(),
            "fullDiskAccess" => request_full_disk_access(),
            _ => unreachable!(),
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok("unsupported")
    }
}

#[cfg(target_os = "macos")]
pub(crate) fn request_many(names: &[String]) -> Result<(), String> {
    for name in names {
        request(name)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn permission_names_are_closed() {
        assert!(validate_name("camera").is_ok());
        assert!(validate_name("microphone").is_ok());
        assert!(validate_name("screenRecording").is_ok());
        assert!(validate_name("accessibility").is_ok());
        assert!(validate_name("inputMonitoring").is_ok());
        assert!(validate_name("location").is_ok());
        assert!(validate_name("fullDiskAccess").is_ok());
        assert!(validate_name("contacts").is_err());
    }

    #[cfg(target_os = "macos")]
    mod macos {
        use super::super::*;
        use std::os::unix::fs::PermissionsExt;

        #[test]
        fn full_disk_access_status_reports_granted_for_a_readable_file() {
            let path =
                std::env::temp_dir().join(format!("murasaki-fda-granted-{}", std::process::id()));
            std::fs::write(&path, b"x").unwrap();
            assert_eq!(full_disk_access_status_at(&path), "granted");
            let _ = std::fs::remove_file(&path);
        }

        #[test]
        fn full_disk_access_status_reports_unknown_for_a_missing_file() {
            let path =
                std::env::temp_dir().join(format!("murasaki-fda-missing-{}", std::process::id()));
            let _ = std::fs::remove_file(&path);
            assert_eq!(full_disk_access_status_at(&path), "unknown");
        }

        #[test]
        fn full_disk_access_status_reports_not_granted_for_a_permission_denied_file() {
            let path =
                std::env::temp_dir().join(format!("murasaki-fda-denied-{}", std::process::id()));
            std::fs::write(&path, b"x").unwrap();
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o000)).unwrap();
            let observed = full_disk_access_status_at(&path);
            let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644));
            let _ = std::fs::remove_file(&path);
            // Running as root bypasses the permission bits entirely (root can
            // always read 0o000), so only assert the mapping when this
            // process actually observed a permission error.
            if unsafe { libc::geteuid() } != 0 {
                assert_eq!(observed, "notGranted");
            }
        }
    }
}
