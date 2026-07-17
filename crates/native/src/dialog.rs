//! Native file dialogs via rfd.

use napi::bindgen_prelude::{Error, Result, Status};
use napi_derive::napi;
use rfd::{FileDialog, MessageButtons, MessageDialog, MessageDialogResult, MessageLevel};

use crate::types::{MessageDialogOptions, OpenFileOptions, SaveFileOptions};

const MAX_MESSAGE_DIALOG_TITLE_BYTES: usize = 256;
const MAX_MESSAGE_DIALOG_MESSAGE_BYTES: usize = 4096;

#[napi(js_name = "openFileDialog")]
pub fn open_file_dialog(opts: Option<OpenFileOptions>) -> Result<Vec<String>> {
    let opts = opts.unwrap_or(OpenFileOptions {
        title: None,
        default_path: None,
        filters: None,
        multiple: None,
    });

    let mut dialog = FileDialog::new();
    if let Some(t) = opts.title {
        dialog = dialog.set_title(t);
    }
    if let Some(p) = opts.default_path {
        dialog = dialog.set_directory(p);
    }
    if let Some(fs) = opts.filters {
        for f in fs {
            let exts: Vec<&str> = f.extensions.iter().map(String::as_str).collect();
            dialog = dialog.add_filter(&f.name, &exts);
        }
    }

    let picks = if opts.multiple.unwrap_or(false) {
        dialog
            .pick_files()
            .unwrap_or_default()
            .into_iter()
            .map(|p| p.display().to_string())
            .collect()
    } else {
        dialog
            .pick_file()
            .into_iter()
            .map(|p| p.display().to_string())
            .collect()
    };

    Ok(picks)
}

#[napi(js_name = "openDirectoryDialog")]
pub fn open_directory_dialog(opts: Option<OpenFileOptions>) -> Result<Option<String>> {
    let opts = opts.unwrap_or(OpenFileOptions {
        title: None,
        default_path: None,
        filters: None,
        multiple: None,
    });

    let mut dialog = FileDialog::new();
    if let Some(t) = opts.title {
        dialog = dialog.set_title(t);
    }
    if let Some(p) = opts.default_path {
        dialog = dialog.set_directory(p);
    }

    Ok(dialog.pick_folder().map(|p| p.display().to_string()))
}

#[napi(js_name = "saveFileDialog")]
pub fn save_file_dialog(opts: Option<SaveFileOptions>) -> Result<Option<String>> {
    let opts = opts.unwrap_or(SaveFileOptions {
        title: None,
        default_path: None,
        default_name: None,
        filters: None,
    });

    let mut dialog = FileDialog::new();
    if let Some(t) = opts.title {
        dialog = dialog.set_title(t);
    }
    if let Some(p) = opts.default_path {
        dialog = dialog.set_directory(p);
    }
    if let Some(n) = opts.default_name {
        dialog = dialog.set_file_name(n);
    }
    if let Some(fs) = opts.filters {
        for f in fs {
            let exts: Vec<&str> = f.extensions.iter().map(String::as_str).collect();
            dialog = dialog.add_filter(&f.name, &exts);
        }
    }

    Ok(dialog.save_file().map(|p| p.display().to_string()))
}

/// Validated, defaulted form of `MessageDialogOptions` — parsed once so
/// `show_message_dialog` never has to re-check bounds after committing to a
/// choice of level/buttons.
struct ValidatedMessageDialog<'a> {
    title: Option<&'a str>,
    level: MessageLevel,
    buttons: MessageButtons,
}

fn validate_message_dialog_options(
    opts: &MessageDialogOptions,
) -> std::result::Result<ValidatedMessageDialog<'_>, String> {
    if let Some(title) = opts.title.as_deref() {
        if title.len() > MAX_MESSAGE_DIALOG_TITLE_BYTES || title.chars().any(char::is_control) {
            return Err(format!(
                "dialog.showMessage title must be at most {MAX_MESSAGE_DIALOG_TITLE_BYTES} UTF-8 bytes and contain no control characters"
            ));
        }
    }
    if opts.message.is_empty()
        || opts.message.len() > MAX_MESSAGE_DIALOG_MESSAGE_BYTES
        || opts.message.chars().any(|ch| ch.is_control() && ch != '\n')
    {
        return Err(format!(
            "dialog.showMessage message must be non-empty, at most {MAX_MESSAGE_DIALOG_MESSAGE_BYTES} UTF-8 bytes, and contain no control characters other than newline"
        ));
    }
    let level = match opts.level.as_deref().unwrap_or("info") {
        "info" => MessageLevel::Info,
        "warning" => MessageLevel::Warning,
        "error" => MessageLevel::Error,
        other => {
            return Err(format!(
                "dialog.showMessage level must be info, warning, or error, got {other:?}"
            ))
        }
    };
    let buttons = match opts.buttons.as_deref().unwrap_or("ok") {
        "ok" => MessageButtons::Ok,
        "okCancel" => MessageButtons::OkCancel,
        "yesNo" => MessageButtons::YesNo,
        other => {
            return Err(format!(
                "dialog.showMessage buttons must be ok, okCancel, or yesNo, got {other:?}"
            ))
        }
    };
    Ok(ValidatedMessageDialog {
        title: opts.title.as_deref(),
        level,
        buttons,
    })
}

fn message_dialog_result_str(result: MessageDialogResult) -> &'static str {
    match result {
        MessageDialogResult::Ok => "ok",
        // Custom buttons are never offered (only the fixed ok/okCancel/yesNo
        // sets above), so a `Custom` result never occurs in practice; treat
        // it the same as a dismissed dialog rather than exposing it as a
        // distinct wire value.
        MessageDialogResult::Cancel | MessageDialogResult::Custom(_) => "cancel",
        MessageDialogResult::Yes => "yes",
        MessageDialogResult::No => "no",
    }
}

/// Blocking, main-thread rfd message box — called synchronously from
/// `handle_native_call` exactly like `open_file_dialog`/`save_file_dialog`
/// above (no spawned thread or channel of its own).
#[napi(js_name = "showMessageDialog")]
pub fn show_message_dialog(opts: MessageDialogOptions) -> Result<String> {
    let validated = validate_message_dialog_options(&opts)
        .map_err(|error| Error::new(Status::InvalidArg, error))?;

    let mut dialog = MessageDialog::new()
        .set_level(validated.level)
        .set_buttons(validated.buttons)
        .set_description(opts.message.as_str());
    if let Some(title) = validated.title {
        dialog = dialog.set_title(title);
    }

    Ok(message_dialog_result_str(dialog.show()).to_string())
}

#[cfg(test)]
mod tests {
    use super::{
        message_dialog_result_str, validate_message_dialog_options,
        MAX_MESSAGE_DIALOG_MESSAGE_BYTES, MAX_MESSAGE_DIALOG_TITLE_BYTES,
    };
    use crate::types::MessageDialogOptions;

    fn opts(
        title: Option<&str>,
        message: &str,
        level: Option<&str>,
        buttons: Option<&str>,
    ) -> MessageDialogOptions {
        MessageDialogOptions {
            title: title.map(str::to_string),
            message: message.to_string(),
            level: level.map(str::to_string),
            buttons: buttons.map(str::to_string),
        }
    }

    #[test]
    fn defaults_to_info_level_and_an_ok_button() {
        let wire = opts(None, "hello", None, None);
        let validated = validate_message_dialog_options(&wire).unwrap();
        assert!(matches!(validated.level, rfd::MessageLevel::Info));
        assert!(matches!(validated.buttons, rfd::MessageButtons::Ok));
    }

    #[test]
    fn accepts_every_documented_level_and_button_set() {
        for level in ["info", "warning", "error"] {
            assert!(
                validate_message_dialog_options(&opts(None, "hello", Some(level), None)).is_ok()
            );
        }
        for buttons in ["ok", "okCancel", "yesNo"] {
            assert!(
                validate_message_dialog_options(&opts(None, "hello", None, Some(buttons))).is_ok()
            );
        }
    }

    #[test]
    fn rejects_unknown_levels_and_button_sets() {
        assert!(
            validate_message_dialog_options(&opts(None, "hello", Some("critical"), None)).is_err()
        );
        assert!(
            validate_message_dialog_options(&opts(None, "hello", None, Some("yesNoCancel")))
                .is_err()
        );
    }

    #[test]
    fn bounds_title_and_message_and_rejects_control_characters() {
        assert!(validate_message_dialog_options(&opts(None, "", None, None)).is_err());
        assert!(validate_message_dialog_options(&opts(
            None,
            &"m".repeat(MAX_MESSAGE_DIALOG_MESSAGE_BYTES),
            None,
            None
        ))
        .is_ok());
        assert!(validate_message_dialog_options(&opts(
            None,
            &"m".repeat(MAX_MESSAGE_DIALOG_MESSAGE_BYTES + 1),
            None,
            None
        ))
        .is_err());
        assert!(validate_message_dialog_options(&opts(
            Some(&"t".repeat(MAX_MESSAGE_DIALOG_TITLE_BYTES)),
            "hello",
            None,
            None
        ))
        .is_ok());
        assert!(validate_message_dialog_options(&opts(
            Some(&"t".repeat(MAX_MESSAGE_DIALOG_TITLE_BYTES + 1)),
            "hello",
            None,
            None
        ))
        .is_err());
        // Newlines are allowed in the message only.
        assert!(
            validate_message_dialog_options(&opts(None, "line one\nline two", None, None)).is_ok()
        );
        assert!(validate_message_dialog_options(&opts(None, "bad\0null", None, None)).is_err());
        assert!(
            validate_message_dialog_options(&opts(Some("bad\ntitle"), "hello", None, None))
                .is_err()
        );
    }

    #[test]
    fn every_wire_result_maps_to_its_documented_string() {
        assert_eq!(
            message_dialog_result_str(rfd::MessageDialogResult::Ok),
            "ok"
        );
        assert_eq!(
            message_dialog_result_str(rfd::MessageDialogResult::Cancel),
            "cancel"
        );
        assert_eq!(
            message_dialog_result_str(rfd::MessageDialogResult::Yes),
            "yes"
        );
        assert_eq!(
            message_dialog_result_str(rfd::MessageDialogResult::No),
            "no"
        );
        assert_eq!(
            message_dialog_result_str(rfd::MessageDialogResult::Custom("x".to_string())),
            "cancel"
        );
    }
}
