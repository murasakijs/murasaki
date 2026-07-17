#![no_main]

use libfuzzer_sys::fuzz_target;

// Pure parse, no OS APIs: feeds arbitrary bytes straight into the update
// journal's JSON deserialization + structural validation
// (crates/native/src/updater.rs) via the `fuzzing`-gated wrapper. Non-UTF-8
// input is skipped, matching the real caller, which only ever hands the
// parser a JSON string read from the on-disk journal file.
fuzz_target!(|data: &[u8]| {
    if let Ok(raw) = std::str::from_utf8(data) {
        murasaki_native::fuzz_parse_update_journal(raw);
    }
});
