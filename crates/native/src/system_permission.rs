//! Host operating-system permission queries and prompts.
//!
//! These are deliberately separate from Murasaki renderer capabilities:
//! capabilities authorize JavaScript to call a native command, while these
//! APIs reflect consent controlled by macOS. Windows unpackaged desktop apps
//! do not expose equivalent app-scoped startup prompts, so the same calls
//! return `unsupported` there instead of implying a grant that did not occur.
//!
//! Fifteen kinds are supported, all macOS-only, in three shapes:
//!   - capture-style, usage-description required, async request:
//!     `camera`/`microphone`/`location` (original three) and
//!     `photos`/`contacts`/`calendar`/`reminders`/`speechRecognition`/
//!     `bluetooth` (added for full TCC coverage — see each kind's section
//!     below for the framework call and its usage-description key).
//!   - prompt-style, granted-vs-not-granted only, no usage description:
//!     `screenRecording`/`accessibility`/`inputMonitoring`.
//!   - guidance-only, no TCC query/request API exists at all:
//!     `fullDiskAccess` (see `full_disk_access_status` below),
//!     `appleEvents` (per-target-app automation consent — see its section),
//!     and `localNetwork` (the OS prompts automatically on first local-network
//!     access; Murasaki only declares the purpose string).

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
use objc2_contacts::{CNAuthorizationStatus, CNContactStore, CNEntityType};
#[cfg(target_os = "macos")]
use objc2_core_bluetooth::{CBCentralManager, CBManager, CBManagerAuthorization};
#[cfg(target_os = "macos")]
use objc2_core_foundation::{CFBoolean, CFDictionary, CFRetained, CFType};
#[cfg(target_os = "macos")]
use objc2_core_graphics::{CGPreflightScreenCaptureAccess, CGRequestScreenCaptureAccess};
#[cfg(target_os = "macos")]
use objc2_core_location::{CLAuthorizationStatus, CLLocationManager};
#[cfg(target_os = "macos")]
use objc2_event_kit::{EKAuthorizationStatus, EKEntityType, EKEventStore};
#[cfg(target_os = "macos")]
use objc2_foundation::{NSBundle, NSError, NSOperatingSystemVersion, NSProcessInfo, NSString};
#[cfg(target_os = "macos")]
use objc2_photos::{PHAccessLevel, PHAuthorizationStatus, PHPhotoLibrary};
#[cfg(target_os = "macos")]
use objc2_speech::{SFSpeechRecognizer, SFSpeechRecognizerAuthorizationStatus};

pub(crate) const NAMES: &[&str] = &[
    "camera",
    "microphone",
    "screenRecording",
    "accessibility",
    "inputMonitoring",
    "location",
    "fullDiskAccess",
    "photos",
    "contacts",
    "calendar",
    "reminders",
    "speechRecognition",
    "bluetooth",
    "appleEvents",
    "localNetwork",
];

fn validate_name(name: &str) -> Result<(), String> {
    if NAMES.contains(&name) {
        Ok(())
    } else {
        Err(format!(
      "unknown system permission {name}; expected camera, microphone, screenRecording, accessibility, inputMonitoring, location, fullDiskAccess, photos, contacts, calendar, reminders, speechRecognition, bluetooth, appleEvents, or localNetwork"
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

// --- Photos ----------------------------------------------------------------
//
// `authorizationStatusForAccessLevel:`/`requestAuthorizationForAccessLevel:
// handler:` replaced the older single-value `authorizationStatus`/
// `requestAuthorization:` pair to distinguish add-only from read-write
// access; Murasaki always uses `.readWrite` (full library access) since it
// has no add-only-specific API of its own. Both are available since macOS 11
// (this app's `LSMinimumSystemVersion`), so no runtime OS-version check is
// needed here (contrast `calendar`/`reminders` below).

#[cfg(target_os = "macos")]
fn photos_status() -> &'static str {
    // SAFETY: `PHAccessLevel::ReadWrite` is a documented enum value; this is a
    // read-only class-level TCC query with no side effects.
    match unsafe { PHPhotoLibrary::authorizationStatusForAccessLevel(PHAccessLevel::ReadWrite) } {
        PHAuthorizationStatus::Denied => "denied",
        PHAuthorizationStatus::Restricted => "restricted",
        // `Limited` (the user picked specific photos) still grants real
        // access, so it is folded into "granted" rather than added as its own
        // status value — Murasaki's status vocabulary doesn't distinguish
        // partial grants for any kind.
        PHAuthorizationStatus::Authorized | PHAuthorizationStatus::Limited => "granted",
        _ => "notDetermined", // NotDetermined.
    }
}

#[cfg(target_os = "macos")]
fn request_photos() -> Result<&'static str, String> {
    if !info_dictionary_key_present("NSPhotoLibraryUsageDescription") {
        return Err(
            "requesting photos requires systemPermissions.macOS.photos.usageDescription in a packaged app"
                .to_string(),
        );
    }
    if photos_status() == "notDetermined" {
        let completion = RcBlock::new(|_status: PHAuthorizationStatus| {});
        // SAFETY: this is a class method (no instance needed); PHPhotoLibrary
        // copies the completion block for its asynchronous reply.
        unsafe {
            PHPhotoLibrary::requestAuthorizationForAccessLevel_handler(
                PHAccessLevel::ReadWrite,
                &completion,
            );
        }
    }
    Ok(photos_status())
}

// --- Contacts ----------------------------------------------------------

#[cfg(target_os = "macos")]
fn contacts_status() -> &'static str {
    // SAFETY: `CNEntityType::Contacts` is the only entity type Contacts
    // exposes; this is a read-only class-level TCC query with no side effects.
    match unsafe { CNContactStore::authorizationStatusForEntityType(CNEntityType::Contacts) } {
        CNAuthorizationStatus::Denied => "denied",
        CNAuthorizationStatus::Restricted => "restricted",
        // `Limited` (partial contact access) folds into "granted", same
        // reasoning as Photos' `Limited` above.
        CNAuthorizationStatus::Authorized | CNAuthorizationStatus::Limited => "granted",
        _ => "notDetermined", // NotDetermined.
    }
}

#[cfg(target_os = "macos")]
fn request_contacts() -> Result<&'static str, String> {
    if !info_dictionary_key_present("NSContactsUsageDescription") {
        return Err(
            "requesting contacts requires systemPermissions.macOS.contacts.usageDescription in a packaged app"
                .to_string(),
        );
    }
    if contacts_status() == "notDetermined" {
        // SAFETY: `new` is CNContactStore's designated NSObject-style
        // constructor. The completion block, not this store instance, is
        // what CoreFoundation retains for the async reply — unlike
        // `location`/`bluetooth` below, this instance does not need to
        // outlive this call.
        let store = unsafe { CNContactStore::new() };
        let completion = RcBlock::new(|_granted: objc2::runtime::Bool, _error: *mut NSError| {});
        unsafe {
            store.requestAccessForEntityType_completionHandler(CNEntityType::Contacts, &completion);
        }
    }
    Ok(contacts_status())
}

// --- Calendar / Reminders ------------------------------------------------
//
// EventKit split the single `Authorized` status into `FullAccess`/
// `WriteOnly`, and added `requestFullAccessToEventsWithCompletion:`/
// `requestFullAccessToRemindersWithCompletion:` to replace the deprecated
// entity-type-based `requestAccessToEntityType:completion:`, in macOS 14.
// This app's `LSMinimumSystemVersion` is 11.0, so a single built app can run
// on either an old or a 14+ system: `ek_supports_full_access` checks the
// RUNNING system at request time (`NSProcessInfo.isOperatingSystemAtLeast
// Version:`) and falls back to the deprecated API pre-14, rather than
// assuming the newer selector exists — calling an unrecognized selector would
// crash the app instead of erroring.

#[cfg(target_os = "macos")]
fn ek_status(entity_type: EKEntityType) -> &'static str {
    // SAFETY: `entity_type` is one of EventKit's two documented entity types;
    // this is a read-only class-level TCC query with no side effects.
    match unsafe { EKEventStore::authorizationStatusForEntityType(entity_type) } {
        EKAuthorizationStatus::Denied => "denied",
        EKAuthorizationStatus::Restricted => "restricted",
        // `WriteOnly` (macOS 14+, e.g. a Reminders write-only grant) is still
        // a real grant, so it is folded into "granted" like Photos'/Contacts'
        // partial-access values above rather than added as its own status.
        EKAuthorizationStatus::FullAccess | EKAuthorizationStatus::WriteOnly => "granted",
        _ => "notDetermined", // NotDetermined.
    }
}

#[cfg(target_os = "macos")]
fn ek_supports_full_access() -> bool {
    // SAFETY: `processInfo`/`isOperatingSystemAtLeastVersion:` are plain
    // read-only NSProcessInfo queries with no side effects.
    NSProcessInfo::processInfo().isOperatingSystemAtLeastVersion(NSOperatingSystemVersion {
        majorVersion: 14,
        minorVersion: 0,
        patchVersion: 0,
    })
}

#[cfg(target_os = "macos")]
fn request_ek(
    name: &str,
    entity_type: EKEntityType,
    usage_key: &str,
) -> Result<&'static str, String> {
    if !info_dictionary_key_present(usage_key) {
        return Err(format!(
            "requesting {name} requires systemPermissions.macOS.{name}.usageDescription in a packaged app"
        ));
    }
    if ek_status(entity_type) == "notDetermined" {
        // SAFETY: `new` is EKEventStore's designated NSObject-style
        // constructor. As with `contacts` above, the completion block (not
        // this store instance) is what's retained for the async reply, so
        // the instance does not need to outlive this call.
        let store = unsafe { EKEventStore::new() };
        let completion = RcBlock::new(|_granted: objc2::runtime::Bool, _error: *mut NSError| {});
        let handler = RcBlock::as_ptr(&completion);
        unsafe {
            if ek_supports_full_access() {
                match entity_type {
                    EKEntityType::Reminder => {
                        store.requestFullAccessToRemindersWithCompletion(handler)
                    }
                    _ => store.requestFullAccessToEventsWithCompletion(handler),
                }
            } else {
                // Deprecated, but still the only request API available
                // pre-macOS-14 — see `ek_supports_full_access` above.
                #[allow(deprecated)]
                store.requestAccessToEntityType_completion(entity_type, handler);
            }
        }
    }
    Ok(ek_status(entity_type))
}

#[cfg(target_os = "macos")]
fn request_calendar() -> Result<&'static str, String> {
    request_ek(
        "calendar",
        EKEntityType::Event,
        "NSCalendarsUsageDescription",
    )
}

#[cfg(target_os = "macos")]
fn request_reminders() -> Result<&'static str, String> {
    request_ek(
        "reminders",
        EKEntityType::Reminder,
        "NSRemindersUsageDescription",
    )
}

// --- Speech Recognition ---------------------------------------------------

#[cfg(target_os = "macos")]
fn speech_recognition_status() -> &'static str {
    // SAFETY: this is a read-only class-level TCC query with no side effects.
    match unsafe { SFSpeechRecognizer::authorizationStatus() } {
        SFSpeechRecognizerAuthorizationStatus::Denied => "denied",
        SFSpeechRecognizerAuthorizationStatus::Restricted => "restricted",
        SFSpeechRecognizerAuthorizationStatus::Authorized => "granted",
        _ => "notDetermined", // NotDetermined.
    }
}

#[cfg(target_os = "macos")]
fn request_speech_recognition() -> Result<&'static str, String> {
    if !info_dictionary_key_present("NSSpeechRecognitionUsageDescription") {
        return Err(
            "requesting speechRecognition requires systemPermissions.macOS.speechRecognition.usageDescription in a packaged app"
                .to_string(),
        );
    }
    if speech_recognition_status() == "notDetermined" {
        let completion = RcBlock::new(|_status: SFSpeechRecognizerAuthorizationStatus| {});
        // SAFETY: this is a class method (no instance needed); Speech copies
        // the completion block for its asynchronous reply.
        unsafe {
            SFSpeechRecognizer::requestAuthorization(&completion);
        }
    }
    Ok(speech_recognition_status())
}

// --- Bluetooth ---------------------------------------------------------
//
// Unlike every other capture-style kind above, CoreBluetooth has no explicit
// request-authorization call: consent is determined implicitly the first
// time a `CBCentralManager` is instantiated (Apple's documented behavior).
// `+[CBManager authorization]` (a CLASS property) reads the current status
// WITHOUT needing a live manager instance at all, so — unlike a concern that
// reading status might need a delegate/run loop — the status read here is as
// cheap as any other kind's. `request` still needs an actual manager instance
// to trigger the OS's connection to the Bluetooth daemon (and thus the TCC
// prompt); since there is no completion block for this one either, that
// instance — not a block — must outlive this call, so it is deliberately
// leaked the same way `location`'s manager is above.

#[cfg(target_os = "macos")]
fn bluetooth_status() -> &'static str {
    // SAFETY: a read-only class-level query with no side effects; does not
    // require (or create) a live CBCentralManager.
    match unsafe { CBManager::authorization_class() } {
        CBManagerAuthorization::Denied => "denied",
        CBManagerAuthorization::Restricted => "restricted",
        CBManagerAuthorization::AllowedAlways => "granted",
        _ => "notDetermined", // NotDetermined.
    }
}

#[cfg(target_os = "macos")]
fn request_bluetooth() -> Result<&'static str, String> {
    if !info_dictionary_key_present("NSBluetoothAlwaysUsageDescription") {
        return Err(
            "requesting bluetooth requires systemPermissions.macOS.bluetooth.usageDescription in a packaged app"
                .to_string(),
        );
    }
    if bluetooth_status() == "notDetermined" {
        // SAFETY: `new` is CBCentralManager's inherited NSObject-style
        // constructor (nil delegate, main queue) — CoreBluetooth still stands
        // up its connection to the Bluetooth daemon from that alone, which is
        // what triggers the TCC prompt.
        let manager = unsafe { CBCentralManager::new() };
        // Mirrors `location`'s manager above: no delegate/completion callback
        // is registered, so the manager itself must not be deallocated before
        // the OS finishes determining/prompting for authorization.
        std::mem::forget(manager);
    }
    Ok(bluetooth_status())
}

// --- Apple Events (Automation) --------------------------------------------
//
// Automation consent (`AEDeterminePermissionToAutomateTarget`) is granted per
// TARGET application, not as one general "automation" permission, and can
// only be resolved by actually attempting to send an Apple Event to a
// specific target bundle id — there is no single status this could
// meaningfully report. So, like Full Disk Access above, this is
// guidance-only: `status` always reports "unknown", and `request` opens
// System Settings' Automation pane (consistent with `fullDiskAccess`'s own
// guidance behavior) rather than claiming a grant that can't be verified.

#[cfg(target_os = "macos")]
fn request_apple_events() -> Result<&'static str, String> {
    if !info_dictionary_key_present("NSAppleEventsUsageDescription") {
        return Err(
            "requesting appleEvents requires systemPermissions.macOS.appleEvents.usageDescription in a packaged app"
                .to_string(),
        );
    }
    open::that_detached(
        "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation",
    )
    .map_err(|e| format!("failed to open Automation settings: {e}"))?;
    Ok("unknown")
}

// --- Local Network -----------------------------------------------------
//
// There is no query or request API for Local Network access at all: macOS
// prompts automatically the first time the process itself attempts local
// network traffic (binds/connects on the local subnet, Bonjour/mDNS, …),
// independent of anything Murasaki calls here. Murasaki's only role is
// declaring `NSLocalNetworkUsageDescription`; both `status` and `request` are
// honest, static "unknown" no-ops (handled directly in `status`/`request`
// below — there is nothing for a dedicated function to do).

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
            "photos" => Ok(photos_status()),
            "contacts" => Ok(contacts_status()),
            "calendar" => Ok(ek_status(EKEntityType::Event)),
            "reminders" => Ok(ek_status(EKEntityType::Reminder)),
            "speechRecognition" => Ok(speech_recognition_status()),
            "bluetooth" => Ok(bluetooth_status()),
            // Guidance-only kinds with no TCC query API — see their sections
            // above for why "unknown" is the only honest answer.
            "appleEvents" | "localNetwork" => Ok("unknown"),
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
            "photos" => request_photos(),
            "contacts" => request_contacts(),
            "calendar" => request_calendar(),
            "reminders" => request_reminders(),
            "speechRecognition" => request_speech_recognition(),
            "bluetooth" => request_bluetooth(),
            "appleEvents" => request_apple_events(),
            // No request API exists at all — see the "Local Network" section
            // above.
            "localNetwork" => Ok("unknown"),
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
        assert!(validate_name("photos").is_ok());
        assert!(validate_name("contacts").is_ok());
        assert!(validate_name("calendar").is_ok());
        assert!(validate_name("reminders").is_ok());
        assert!(validate_name("speechRecognition").is_ok());
        assert!(validate_name("bluetooth").is_ok());
        assert!(validate_name("appleEvents").is_ok());
        assert!(validate_name("localNetwork").is_ok());
        assert!(validate_name("bluetoothLE").is_err());
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
