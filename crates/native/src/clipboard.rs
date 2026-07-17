//! Clipboard via arboard, including PNG-encoded image and HTML support.

use base64::{engine::general_purpose::STANDARD, Engine as _};
use napi::bindgen_prelude::{Error, Result, Status};
use napi_derive::napi;

use crate::types::{ClipboardImageData, ClipboardWriteHtmlOptions, ClipboardWriteImageOptions};

/// Bound on the decoded RGBA buffer for both `clipboard.readImage`'s clipboard
/// source and `clipboard.writeImage`'s decoded PNG — guards against a PNG
/// decompression bomb (a tiny compressed file whose header declares an
/// enormous image). Matches `png::Limits::default().bytes` (64 MiB) so this
/// check and the decoder's own built-in one agree; kept explicit rather than
/// relying on that default so the bound can't silently change with a `png`
/// point release, and so the resulting error message is command-specific.
pub(crate) const MAX_CLIPBOARD_IMAGE_RGBA_BYTES: usize = 64 * 1024 * 1024;
/// Per-dimension bound for both directions, checked against the PNG header
/// *before* allocating the decoded buffer above.
pub(crate) const MAX_CLIPBOARD_IMAGE_DIMENSION: usize = 16 * 1024;
/// `clipboard.readImage`'s PNG-encoded (pre-base64) response bound. Nothing in
/// wry's WKWebView/WebView2 `evaluate_script` bridges documents a hard
/// string-size ceiling (see `webview::dispatch_native_response`), but relaying
/// an unbounded blob through a `CustomEvent` detail string on the JS main
/// thread is still unbounded growth worth capping; matched to
/// `webview::MAX_CLIPBOARD_WRITE_IMAGE_BODY_BYTES` so the read and write
/// directions share one wire budget.
pub(crate) const MAX_CLIPBOARD_READ_IMAGE_PNG_BYTES: usize = 16 * 1024 * 1024;
const MAX_CLIPBOARD_HTML_BYTES: usize = 1024 * 1024;
const MAX_CLIPBOARD_HTML_ALT_TEXT_BYTES: usize = 64 * 1024;

#[napi(js_name = "clipboardRead")]
pub fn clipboard_read() -> Result<String> {
    let mut cb =
        arboard::Clipboard::new().map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;
    cb.get_text()
        .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))
}

#[napi(js_name = "clipboardWrite")]
pub fn clipboard_write(text: String) -> Result<()> {
    let mut cb =
        arboard::Clipboard::new().map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;
    cb.set_text(text)
        .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;
    Ok(())
}

#[napi(js_name = "clipboardReadImage")]
pub fn clipboard_read_image() -> Result<Option<ClipboardImageData>> {
    let mut cb =
        arboard::Clipboard::new().map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;
    let image = match cb.get_image() {
        Ok(image) => image,
        Err(arboard::Error::ContentNotAvailable) => return Ok(None),
        Err(error) => return Err(Error::new(Status::GenericFailure, error.to_string())),
    };
    let (width, height, png_bytes) =
        encode_clipboard_image(image).map_err(|error| Error::new(Status::GenericFailure, error))?;
    Ok(Some(ClipboardImageData {
        width,
        height,
        png_base64: STANDARD.encode(png_bytes),
    }))
}

#[napi(js_name = "clipboardWriteImage")]
pub fn clipboard_write_image(opts: ClipboardWriteImageOptions) -> Result<()> {
    let decoded = decode_clipboard_image(&opts.png_base64)
        .map_err(|error| Error::new(Status::InvalidArg, error))?;
    let mut cb =
        arboard::Clipboard::new().map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;
    cb.set_image(decoded.into_image_data())
        .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))
}

#[napi(js_name = "clipboardWriteHtml")]
pub fn clipboard_write_html(opts: ClipboardWriteHtmlOptions) -> Result<()> {
    validate_clipboard_html(&opts.html, opts.alt_text.as_deref())
        .map_err(|error| Error::new(Status::InvalidArg, error))?;
    let mut cb =
        arboard::Clipboard::new().map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;
    cb.set_html(opts.html.as_str(), opts.alt_text.as_deref())
        .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))
}

fn validate_clipboard_html(html: &str, alt_text: Option<&str>) -> std::result::Result<(), String> {
    if html.is_empty() || html.len() > MAX_CLIPBOARD_HTML_BYTES {
        return Err(format!(
            "clipboard.writeHtml html must be non-empty and at most {MAX_CLIPBOARD_HTML_BYTES} UTF-8 bytes"
        ));
    }
    if let Some(alt_text) = alt_text {
        if alt_text.len() > MAX_CLIPBOARD_HTML_ALT_TEXT_BYTES {
            return Err(format!(
                "clipboard.writeHtml altText must be at most {MAX_CLIPBOARD_HTML_ALT_TEXT_BYTES} UTF-8 bytes"
            ));
        }
    }
    Ok(())
}

#[derive(Debug)]
struct DecodedClipboardImage {
    width: usize,
    height: usize,
    rgba: Vec<u8>,
}

impl DecodedClipboardImage {
    fn into_image_data(self) -> arboard::ImageData<'static> {
        arboard::ImageData {
            width: self.width,
            height: self.height,
            bytes: std::borrow::Cow::Owned(self.rgba),
        }
    }
}

/// PNG-encodes `image` (RGBA8, as returned by `arboard::Clipboard::get_image`)
/// and enforces `clipboard.readImage`'s dimension and response-size bounds.
fn encode_clipboard_image(
    image: arboard::ImageData<'_>,
) -> std::result::Result<(i32, i32, Vec<u8>), String> {
    if image.width == 0
        || image.height == 0
        || image.width > MAX_CLIPBOARD_IMAGE_DIMENSION
        || image.height > MAX_CLIPBOARD_IMAGE_DIMENSION
    {
        return Err("clipboard image dimensions are out of the supported range".to_string());
    }
    let expected_len = image
        .width
        .checked_mul(image.height)
        .and_then(|pixels| pixels.checked_mul(4))
        .ok_or_else(|| "clipboard image dimensions overflow".to_string())?;
    if image.bytes.len() != expected_len {
        return Err(
            "clipboard image pixel buffer does not match its declared dimensions".to_string(),
        );
    }
    let png_bytes = encode_png(image.width as u32, image.height as u32, &image.bytes)?;
    if png_bytes.len() > MAX_CLIPBOARD_READ_IMAGE_PNG_BYTES {
        return Err("clipboard image is too large to return".to_string());
    }
    Ok((image.width as i32, image.height as i32, png_bytes))
}

fn encode_png(width: u32, height: u32, rgba: &[u8]) -> std::result::Result<Vec<u8>, String> {
    let mut png_bytes = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut png_bytes, width, height);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder
            .write_header()
            .map_err(|e| format!("encode clipboard image: {e}"))?;
        writer
            .write_image_data(rgba)
            .map_err(|e| format!("encode clipboard image: {e}"))?;
    }
    Ok(png_bytes)
}

/// Decodes and bounds-checks a base64 PNG for `clipboard.writeImage`. Checks
/// the header-declared dimensions and buffer size *before* allocating the
/// full pixel buffer, so a maliciously small file that declares an enormous
/// image is rejected without ever approaching `MAX_CLIPBOARD_IMAGE_RGBA_BYTES`
/// of allocation.
fn decode_clipboard_image(png_base64: &str) -> std::result::Result<DecodedClipboardImage, String> {
    if png_base64.is_empty() {
        return Err("clipboard.writeImage pngBase64 must not be empty".to_string());
    }
    let png_bytes = STANDARD
        .decode(png_base64)
        .map_err(|e| format!("clipboard.writeImage pngBase64 is not valid base64: {e}"))?;
    let decoder = png::Decoder::new(png_bytes.as_slice());
    let mut reader = decoder
        .read_info()
        .map_err(|e| format!("clipboard.writeImage could not decode PNG: {e}"))?;

    let (width, height) = {
        let info = reader.info();
        (info.width as usize, info.height as usize)
    };
    if width == 0
        || height == 0
        || width > MAX_CLIPBOARD_IMAGE_DIMENSION
        || height > MAX_CLIPBOARD_IMAGE_DIMENSION
    {
        return Err(format!(
            "clipboard.writeImage dimensions must be between 1 and {MAX_CLIPBOARD_IMAGE_DIMENSION} pixels"
        ));
    }
    let buffer_size = reader.output_buffer_size();
    if buffer_size > MAX_CLIPBOARD_IMAGE_RGBA_BYTES {
        return Err(format!(
            "clipboard.writeImage decoded image exceeds the maximum of {MAX_CLIPBOARD_IMAGE_RGBA_BYTES} bytes"
        ));
    }

    let mut buf = vec![0_u8; buffer_size];
    let frame = reader
        .next_frame(&mut buf)
        .map_err(|e| format!("clipboard.writeImage could not decode PNG: {e}"))?;
    buf.truncate(frame.buffer_size());
    let (color_type, bit_depth) = {
        let info = reader.info();
        (info.color_type, info.bit_depth)
    };
    let rgba = match (color_type, bit_depth) {
        (png::ColorType::Rgba, png::BitDepth::Eight) => buf,
        (png::ColorType::Rgb, png::BitDepth::Eight) => {
            let mut out = Vec::with_capacity(buf.len() / 3 * 4);
            for chunk in buf.chunks_exact(3) {
                out.extend_from_slice(chunk);
                out.push(255);
            }
            out
        }
        _ => return Err("clipboard.writeImage must be an 8-bit RGB or RGBA PNG".to_string()),
    };
    if rgba.len() > MAX_CLIPBOARD_IMAGE_RGBA_BYTES {
        return Err(format!(
            "clipboard.writeImage decoded image exceeds the maximum of {MAX_CLIPBOARD_IMAGE_RGBA_BYTES} bytes"
        ));
    }
    Ok(DecodedClipboardImage {
        width,
        height,
        rgba,
    })
}

#[cfg(test)]
mod tests {
    use super::{
        decode_clipboard_image, encode_clipboard_image, encode_png, validate_clipboard_html,
        MAX_CLIPBOARD_HTML_ALT_TEXT_BYTES, MAX_CLIPBOARD_HTML_BYTES, MAX_CLIPBOARD_IMAGE_DIMENSION,
        MAX_CLIPBOARD_IMAGE_RGBA_BYTES,
    };
    use base64::{engine::general_purpose::STANDARD, Engine as _};

    fn rgba_image(width: usize, height: usize) -> arboard::ImageData<'static> {
        arboard::ImageData {
            width,
            height,
            bytes: std::borrow::Cow::Owned(vec![0_u8; width * height * 4]),
        }
    }

    #[test]
    fn encode_then_decode_round_trips_dimensions_and_pixels() {
        let rgba = vec![
            10, 20, 30, 255, 40, 50, 60, 255, 70, 80, 90, 255, 100, 110, 120, 255,
        ];
        let image = arboard::ImageData {
            width: 2,
            height: 2,
            bytes: std::borrow::Cow::Borrowed(&rgba),
        };
        let (width, height, png_bytes) = encode_clipboard_image(image).unwrap();
        assert_eq!((width, height), (2, 2));

        let decoded = decode_clipboard_image(&STANDARD.encode(&png_bytes)).unwrap();
        assert_eq!((decoded.width, decoded.height), (2, 2));
        assert_eq!(decoded.rgba, rgba);
    }

    #[test]
    fn rejects_zero_and_oversized_dimensions_before_encoding() {
        assert!(encode_clipboard_image(rgba_image(0, 10)).is_err());
        assert!(encode_clipboard_image(rgba_image(MAX_CLIPBOARD_IMAGE_DIMENSION + 1, 1)).is_err());
        assert!(encode_clipboard_image(rgba_image(4, 4)).is_ok());
    }

    #[test]
    fn rejects_a_pixel_buffer_that_does_not_match_its_declared_dimensions() {
        let mismatched = arboard::ImageData {
            width: 4,
            height: 4,
            bytes: std::borrow::Cow::Owned(vec![0_u8; 10]),
        };
        assert!(encode_clipboard_image(mismatched).is_err());
    }

    #[test]
    fn rejects_a_decoded_png_wider_or_taller_than_the_dimension_bound() {
        // A thin (1px-tall) strip keeps the actual pixel buffer tiny while
        // still exercising the >16384 width guard on its own, isolated from
        // the byte-size bound below.
        let width = MAX_CLIPBOARD_IMAGE_DIMENSION + 1;
        let png_bytes = super::encode_png(width as u32, 1, &vec![0_u8; width * 4]).unwrap();
        let error = decode_clipboard_image(&STANDARD.encode(&png_bytes)).unwrap_err();
        assert!(error.contains("between 1 and"), "{error}");
    }

    #[test]
    fn rejects_a_decoded_image_over_the_64_mib_byte_bound_within_the_dimension_cap() {
        // 4128 x 4128 x 4 bytes ~= 64.12 MiB: both dimensions individually
        // stay within MAX_CLIPBOARD_IMAGE_DIMENSION, isolating the byte-size
        // check from the per-dimension one above.
        let side: u32 = 4128;
        assert!((side as usize) <= MAX_CLIPBOARD_IMAGE_DIMENSION);
        let rgba = vec![0_u8; side as usize * side as usize * 4];
        assert!(rgba.len() as u64 > MAX_CLIPBOARD_IMAGE_RGBA_BYTES as u64);
        let png_bytes = encode_png(side, side, &rgba).unwrap();
        let error = decode_clipboard_image(&STANDARD.encode(&png_bytes)).unwrap_err();
        assert!(error.contains("exceeds the maximum"), "{error}");
    }

    #[test]
    fn rejects_invalid_base64_and_undecodable_png_bytes() {
        assert!(decode_clipboard_image("").is_err());
        assert!(decode_clipboard_image("not valid base64!!").is_err());
        assert!(decode_clipboard_image(&STANDARD.encode(b"not a png")).is_err());
    }

    #[test]
    fn html_bounds_reject_empty_oversized_html_and_oversized_alt_text() {
        assert!(validate_clipboard_html("<b>hi</b>", None).is_ok());
        assert!(validate_clipboard_html("", None).is_err());
        assert!(validate_clipboard_html(&"x".repeat(MAX_CLIPBOARD_HTML_BYTES), None).is_ok());
        assert!(validate_clipboard_html(&"x".repeat(MAX_CLIPBOARD_HTML_BYTES + 1), None).is_err());
        assert!(validate_clipboard_html(
            "<b>hi</b>",
            Some(&"a".repeat(MAX_CLIPBOARD_HTML_ALT_TEXT_BYTES))
        )
        .is_ok());
        assert!(validate_clipboard_html(
            "<b>hi</b>",
            Some(&"a".repeat(MAX_CLIPBOARD_HTML_ALT_TEXT_BYTES + 1))
        )
        .is_err());
    }
}
