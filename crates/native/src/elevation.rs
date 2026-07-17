//! Windows privilege elevation — `app.isElevated` (a read-only, all-platform
//! self-query of the *current* process) and `shell.runElevated` (launches a
//! program under a fresh, UAC-elevated process on Windows only).
//!
//! Unlike every other `shell.*` command, `shell.runElevated` has no
//! implementation at all outside Windows: macOS's closest equivalents
//! (`SMJobBless`/`AuthorizationExecuteWithPrivileges`) are deprecated, and
//! Linux has no single privilege-escalation mechanism a generic desktop app
//! could rely on (policykit/pkexec availability varies by distribution). So
//! non-Windows callers get a structured `unsupported` error rather than a
//! silent no-op.

use std::path::Path;

/// Exact message surfaced to the renderer when the user declines the UAC
/// consent prompt (`ShellExecuteExW` fails with `ERROR_CANCELLED`). Kept as a
/// constant so the webview IPC error and this module's own tests can't drift
/// apart, and so calling code can reliably distinguish "the user said no"
/// from every other failure by matching on it. Only `windows_run_elevated`
/// below produces this message — this module also builds on macOS/Linux
/// (for `is_elevated`'s non-Windows path, see the module doc comment), where
/// the constant is otherwise dead code outside its own test.
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
pub(crate) const ELEVATION_CANCELLED_MESSAGE: &str = "elevation was cancelled by the user";

const MAX_ARGS: usize = 64;
const MAX_ARG_BYTES: usize = 4096;

/// `app.isElevated()` — best-effort, read-only query of whether *this*
/// process already holds elevated privileges. Never fails: any underlying OS
/// query error is treated as "not known to be elevated" rather than
/// surfaced, since a query that cannot determine elevation status has told
/// an already-unprivileged renderer nothing it did not already know.
pub(crate) fn is_elevated() -> bool {
    #[cfg(target_os = "windows")]
    {
        windows_is_elevated()
    }
    #[cfg(not(target_os = "windows"))]
    {
        // "Elevated" has no Windows-token analog on Unix; the closest stand-in
        // is running as effective root, which is rare and discouraged for a
        // GUI application but is what a caller almost always means.
        unix_is_elevated()
    }
}

#[cfg(not(target_os = "windows"))]
fn unix_is_elevated() -> bool {
    // SAFETY: geteuid takes no arguments, performs no I/O, and cannot fail.
    unsafe { libc::geteuid() == 0 }
}

#[cfg(target_os = "windows")]
fn windows_is_elevated() -> bool {
    use windows::Win32::Foundation::{CloseHandle, HANDLE};
    use windows::Win32::Security::{TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY};
    use windows::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

    let mut token = HANDLE::default();
    // SAFETY: `GetCurrentProcess` is infallible and returns a pseudo-handle
    // that needs no closing; `OpenProcessToken` only writes a real, closeable
    // handle into `token` when it returns success.
    if unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) }.is_err() {
        return false;
    }

    let mut elevation = TOKEN_ELEVATION::default();
    let mut returned_len: u32 = 0;
    // SAFETY: `elevation` is a valid, correctly-sized `TOKEN_ELEVATION` out
    // buffer for the duration of this call.
    let queried = unsafe {
        windows::Win32::Security::GetTokenInformation(
            token,
            TokenElevation,
            Some((&mut elevation as *mut TOKEN_ELEVATION).cast()),
            std::mem::size_of::<TOKEN_ELEVATION>() as u32,
            &mut returned_len,
        )
    };
    let _ = unsafe { CloseHandle(token) };
    queried.is_ok() && elevation.TokenIsElevated != 0
}

/// Runs `executable` elevated through the Windows UAC "runas" verb (see the
/// module doc comment for every other platform). Absoluteness/traversal/
/// URL/UNC rejection matches `shell.openPath` exactly — this reuses
/// `crate::shell::validate_open_path_target` — and the capability
/// path-scope check happens one layer up in `webview.rs`, same as every
/// other path-scoped shell command.
pub(crate) fn shell_run_elevated(
    executable: &str,
    args: &[String],
) -> std::result::Result<(), String> {
    crate::shell::validate_open_path_target(executable)?;
    if !Path::new(executable).exists() {
        return Err("shell.runElevated executable does not exist".to_string());
    }
    validate_args(args)?;

    #[cfg(target_os = "windows")]
    {
        windows_run_elevated(executable, args)
    }
    #[cfg(not(target_os = "windows"))]
    {
        Err(
            "shell.runElevated is unsupported on this platform: elevated launch has no \
             single native mechanism outside Windows (macOS SMJobBless/\
             AuthorizationExecuteWithPrivileges is deprecated, and Linux has no equivalent)"
                .to_string(),
        )
    }
}

/// Bounds and content rules shared by every platform (so a Windows-only
/// runtime failure never masks an otherwise-invalid request, and so the
/// rules can be verified from this crate's cross-platform test run).
fn validate_args(args: &[String]) -> std::result::Result<(), String> {
    if args.len() > MAX_ARGS {
        return Err(format!(
            "shell.runElevated accepts at most {MAX_ARGS} arguments"
        ));
    }
    for arg in args {
        if arg.len() > MAX_ARG_BYTES {
            return Err(format!(
                "shell.runElevated arguments must be at most {MAX_ARG_BYTES} UTF-8 bytes"
            ));
        }
        if arg.chars().any(char::is_control) {
            return Err(
                "shell.runElevated arguments must not contain control characters".to_string(),
            );
        }
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn windows_run_elevated(executable: &str, args: &[String]) -> std::result::Result<(), String> {
    use windows::core::{HRESULT, PCWSTR};
    use windows::Win32::Foundation::{ERROR_CANCELLED, HWND};
    use windows::Win32::UI::Shell::{ShellExecuteExW, SHELLEXECUTEINFOW};

    // `SHELLEXECUTEINFOW::nShow` is a plain `i32`, not the `SHOW_WINDOW_CMD`
    // newtype, so the raw winuser.h `SW_SHOWNORMAL` value is used directly
    // instead of adding the Win32_UI_WindowsAndMessaging feature for one
    // constant.
    const SW_SHOWNORMAL: i32 = 1;

    let verb = wide("runas");
    let file = wide(executable);
    let parameters = join_and_quote_args(args);
    // `parameters` stays alive as `parameters_wide` for the whole call;
    // `PCWSTR::null()` (rather than an empty wide string) matches how every
    // other optional `SHELLEXECUTEINFOW` string field is normally left unset.
    let parameters_wide = (!parameters.is_empty()).then(|| wide(&parameters));

    let mut info = SHELLEXECUTEINFOW {
        cbSize: std::mem::size_of::<SHELLEXECUTEINFOW>() as u32,
        fMask: 0,
        hwnd: HWND::default(),
        lpVerb: PCWSTR::from_raw(verb.as_ptr()),
        lpFile: PCWSTR::from_raw(file.as_ptr()),
        lpParameters: parameters_wide
            .as_ref()
            .map_or(PCWSTR::null(), |wide| PCWSTR::from_raw(wide.as_ptr())),
        lpDirectory: PCWSTR::null(),
        nShow: SW_SHOWNORMAL,
        ..Default::default()
    };

    // SAFETY: `verb`/`file`/`parameters_wide` are NUL-terminated buffers that
    // outlive this call, matching every `PCWSTR` field `info` holds.
    match unsafe { ShellExecuteExW(&mut info) } {
        Ok(()) => Ok(()),
        Err(error) if error.code() == HRESULT::from_win32(ERROR_CANCELLED.0) => {
            Err(ELEVATION_CANCELLED_MESSAGE.to_string())
        }
        Err(error) => Err(format!("shell.runElevated failed to launch: {error}")),
    }
}

#[cfg(target_os = "windows")]
fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

/// Joins `args` into one `lpParameters` string using the same quoting rules
/// as `CommandLineToArgvW` (and therefore every MSVCRT-linked program's argv
/// parser): an argument is wrapped in double quotes only when it contains
/// whitespace, a quote, or is empty; embedded quotes are escaped; and a run
/// of backslashes is doubled only when it immediately precedes a literal
/// quote or the argument's own closing quote — never otherwise. `lpFile` is
/// never routed through a shell, so there is no `cmd.exe` metacharacter to
/// worry about, only argv-splitting. Pure and platform-independent so it can
/// be unit-tested without Windows.
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
fn join_and_quote_args(args: &[String]) -> String {
    args.iter()
        .map(|arg| quote_windows_arg(arg))
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
fn quote_windows_arg(arg: &str) -> String {
    if !arg.is_empty()
        && !arg
            .chars()
            .any(|ch| matches!(ch, ' ' | '\t' | '\n' | '\x0b' | '"'))
    {
        return arg.to_string();
    }

    let mut quoted = String::with_capacity(arg.len() + 2);
    quoted.push('"');
    let mut chars = arg.chars().peekable();
    loop {
        let mut backslashes = 0usize;
        while chars.peek() == Some(&'\\') {
            chars.next();
            backslashes += 1;
        }
        match chars.next() {
            Some('"') => {
                quoted.push_str(&"\\".repeat(backslashes * 2 + 1));
                quoted.push('"');
            }
            Some(ch) => {
                quoted.push_str(&"\\".repeat(backslashes));
                quoted.push(ch);
            }
            None => {
                quoted.push_str(&"\\".repeat(backslashes * 2));
                break;
            }
        }
    }
    quoted.push('"');
    quoted
}

#[cfg(test)]
mod tests {
    use super::{join_and_quote_args, quote_windows_arg, validate_args, MAX_ARGS, MAX_ARG_BYTES};

    // Every expected value below was cross-checked against a Python
    // reimplementation of the same algorithm rather than hand-derived, since
    // backslash/quote escaping is exactly the kind of thing that's easy to
    // get subtly wrong by inspection. Plain (non-raw) string literals are
    // used throughout so every backslash and quote is spelled out
    // explicitly — a raw string can't represent an embedded `"` without a
    // different, easy-to-miscount delimiter.

    #[test]
    fn plain_arguments_are_left_unquoted() {
        assert_eq!(quote_windows_arg("value"), "value");
        assert_eq!(quote_windows_arg("--flag=value"), "--flag=value");
        // C:\Users\example\file.txt — no space/quote, so returned as-is.
        assert_eq!(
            quote_windows_arg("C:\\Users\\example\\file.txt"),
            "C:\\Users\\example\\file.txt",
        );
    }

    #[test]
    fn empty_arguments_become_an_empty_quoted_pair() {
        assert_eq!(quote_windows_arg(""), "\"\"");
    }

    #[test]
    fn embedded_spaces_are_wrapped_in_quotes() {
        assert_eq!(quote_windows_arg("hello world"), "\"hello world\"");
        assert_eq!(quote_windows_arg("a\tb"), "\"a\tb\"");
    }

    #[test]
    fn embedded_quotes_are_escaped_with_one_extra_backslash() {
        // say "hi" -> "say \"hi\""
        assert_eq!(quote_windows_arg("say \"hi\""), "\"say \\\"hi\\\"\"");
        // " -> "\""
        assert_eq!(quote_windows_arg("\""), "\"\\\"\"");
    }

    #[test]
    fn backslashes_before_a_quote_are_doubled() {
        // A run of backslashes immediately preceding an embedded quote must
        // double so CommandLineToArgvW doesn't treat it as escaping that
        // quote away: a\"b (one backslash, then quote) -> "a\\\"b"
        assert_eq!(quote_windows_arg("a\\\"b"), "\"a\\\\\\\"b\"");
        // a\\" (two backslashes, then quote, nothing after) -> "a\\\\\""
        assert_eq!(quote_windows_arg("a\\\\\""), "\"a\\\\\\\\\\\"\"");
    }

    #[test]
    fn trailing_backslashes_are_doubled_before_the_closing_quote() {
        // Needs quoting because of the embedded space; the single trailing
        // backslash must double so it doesn't escape our own closing quote:
        // C:\Program Files\ -> "C:\Program Files\\"
        assert_eq!(
            quote_windows_arg("C:\\Program Files\\"),
            "\"C:\\Program Files\\\\\"",
        );
    }

    #[test]
    fn backslashes_not_before_a_quote_are_left_alone() {
        // a\b c (backslash precedes an ordinary character, not a quote) ->
        // "a\b c" — the backslash is copied through unchanged.
        assert_eq!(quote_windows_arg("a\\b c"), "\"a\\b c\"");
    }

    #[test]
    fn join_and_quote_args_space_separates_quoted_arguments() {
        assert_eq!(
            join_and_quote_args(&[
                "--input".to_string(),
                "C:\\path with space\\a.txt".to_string(),
            ]),
            "--input \"C:\\path with space\\a.txt\"",
        );
        assert_eq!(join_and_quote_args(&[]), "");
    }

    #[test]
    fn validate_args_enforces_count_and_length_bounds() {
        assert!(validate_args(&[]).is_ok());
        assert!(validate_args(&vec!["ok".to_string(); MAX_ARGS]).is_ok());
        assert!(validate_args(&vec!["ok".to_string(); MAX_ARGS + 1]).is_err());
        assert!(validate_args(&["x".repeat(MAX_ARG_BYTES)]).is_ok());
        assert!(validate_args(&["x".repeat(MAX_ARG_BYTES + 1)]).is_err());
    }

    #[test]
    fn validate_args_rejects_control_characters() {
        assert!(validate_args(&["line\nbreak".to_string()]).is_err());
        assert!(validate_args(&["nul\0byte".to_string()]).is_err());
    }

    /// The exact wire string a caller matches on to detect a declined UAC
    /// prompt (see `windows_run_elevated`). Asserted here — rather than only
    /// relied on where it's produced — so an edit that changes the message
    /// can't silently break that contract.
    #[test]
    fn elevation_cancelled_message_is_stable() {
        assert_eq!(
            super::ELEVATION_CANCELLED_MESSAGE,
            "elevation was cancelled by the user"
        );
    }

    /// `is_elevated()`'s Unix path is exactly `geteuid() == 0` — verified
    /// directly against `libc::geteuid()` rather than hardcoding an
    /// assumption about the test runner's privileges (CI may or may not run
    /// as root).
    #[cfg(not(target_os = "windows"))]
    #[test]
    fn is_elevated_matches_effective_uid_zero_on_unix() {
        let expected = unsafe { libc::geteuid() == 0 };
        assert_eq!(super::is_elevated(), expected);
    }
}
