//! Host operating-system permission queries and prompts.
//!
//! These are deliberately separate from Murasaki renderer capabilities:
//! capabilities authorize JavaScript to call a native command, while these
//! APIs reflect consent controlled by macOS. Windows unpackaged desktop apps
//! do not expose equivalent app-scoped startup prompts, so the same calls
//! return `unsupported` there instead of implying a grant that did not occur.

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
use objc2_foundation::{NSBundle, NSString};

pub(crate) const NAMES: &[&str] = &["camera", "microphone", "screenRecording", "accessibility"];

fn validate_name(name: &str) -> Result<(), String> {
    if NAMES.contains(&name) {
        Ok(())
    } else {
        Err(format!(
      "unknown system permission {name}; expected camera, microphone, screenRecording, or accessibility"
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
fn capture_usage_description_present(name: &str) -> bool {
    let key = NSString::from_str(match name {
        "camera" => "NSCameraUsageDescription",
        "microphone" => "NSMicrophoneUsageDescription",
        _ => return false,
    });
    NSBundle::mainBundle()
        .objectForInfoDictionaryKey(&key)
        .is_some()
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
            // CoreGraphics/Accessibility only expose granted vs. not granted; they
            // do not distinguish a first request from a denial.
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
        assert!(validate_name("location").is_err());
    }
}
