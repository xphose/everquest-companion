//! Bounded screenshot OCR, independent of the log fold and with no filesystem access.
//! Accepts PNGs up to 5 MiB and 20 MP within Windows' OCR side limit. Results keep line breaks
//! and are bounded to 100 kB text, 2,000 lines, 2,000 words per line, and 20,000 total words.

use base64::{engine::general_purpose::STANDARD, Engine};
use protocol::generated::{ErrorCode, RecoveryOcrResult};
use std::sync::Mutex;

#[cfg(windows)]
mod windows;

const MAX_PNG_BYTES: usize = 5 * 1024 * 1024;
const MAX_BASE64_BYTES: usize = MAX_PNG_BYTES.div_ceil(3) * 4;
const MAX_PIXELS: u64 = 20_000_000;
static ACTIVE: Mutex<()> = Mutex::new(());

/// A request refusal, without retaining any screenshot bytes.
#[derive(Debug)]
pub struct Failure {
    /// Protocol error category.
    pub code: ErrorCode,
    /// Bounded diagnostic; never echoes the image.
    pub message: String,
}

impl Failure {
    fn invalid(message: &str) -> Self {
        Self {
            code: ErrorCode::BadParams,
            message: message.to_owned(),
        }
    }

    fn unavailable(message: &str) -> Self {
        Self {
            code: ErrorCode::Unavailable,
            message: message.to_owned(),
        }
    }
}

fn decode_png(encoded: &str) -> Result<Vec<u8>, Failure> {
    if encoded.is_empty() || encoded.len() > MAX_BASE64_BYTES {
        return Err(Failure::invalid("OCR accepts a PNG of at most 5 MiB"));
    }
    let bytes = STANDARD
        .decode(encoded)
        .map_err(|_| Failure::invalid("OCR image is not valid standard base64"))?;
    if bytes.len() > MAX_PNG_BYTES {
        return Err(Failure::invalid("OCR accepts a PNG of at most 5 MiB"));
    }
    png_dimensions(&bytes)?;
    Ok(bytes)
}

fn png_dimensions(bytes: &[u8]) -> Result<(u32, u32), Failure> {
    if bytes.len() < 33 || &bytes[..8] != b"\x89PNG\r\n\x1a\n" || &bytes[8..16] != b"\0\0\0\rIHDR" {
        return Err(Failure::invalid("OCR image must be a valid PNG"));
    }
    let width = u32::from_be_bytes(bytes[16..20].try_into().expect("checked PNG header"));
    let height = u32::from_be_bytes(bytes[20..24].try_into().expect("checked PNG header"));
    if width == 0 || height == 0 || u64::from(width) * u64::from(height) > MAX_PIXELS {
        return Err(Failure::invalid(
            "OCR PNG dimensions must be positive and at most 20 million pixels",
        ));
    }
    Ok((width, height))
}

/// Recognize a screenshot on the calling connection thread. Concurrent requests fail promptly.
pub fn recognize(encoded: &str) -> Result<RecoveryOcrResult, Failure> {
    let _active = ACTIVE
        .try_lock()
        .map_err(|_| Failure::unavailable("Another OCR request is already running"))?;
    let png = decode_png(encoded)?;
    native(&png)
}

#[cfg(windows)]
fn native(png: &[u8]) -> Result<RecoveryOcrResult, Failure> {
    windows::recognize(png)
}

#[cfg(not(windows))]
fn native(_png: &[u8]) -> Result<RecoveryOcrResult, Failure> {
    Err(Failure::unavailable("Screenshot OCR requires Windows"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn header(width: u32, height: u32) -> Vec<u8> {
        let mut bytes = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR".to_vec();
        bytes.extend(width.to_be_bytes());
        bytes.extend(height.to_be_bytes());
        bytes.resize(33, 0);
        bytes
    }

    #[test]
    fn rejects_invalid_base64_non_png_and_oversized_encoded_or_decoded_input() {
        for text in ["", "%%%", "aGVsbG8="] {
            assert!(matches!(
                decode_png(text).unwrap_err().code,
                ErrorCode::BadParams
            ));
        }
        assert!(decode_png(&"A".repeat(MAX_BASE64_BYTES + 1)).is_err());
        let mut oversized = header(1, 1);
        oversized.resize(MAX_PNG_BYTES + 1, 0);
        assert!(decode_png(&STANDARD.encode(oversized)).is_err());
    }

    #[test]
    fn checks_pixel_budget_before_a_native_decoder_can_allocate() {
        assert!(png_dimensions(&header(5000, 4000)).is_ok());
        for (width, height) in [(0, 1), (1, 0), (5001, 4000), (u32::MAX, u32::MAX)] {
            assert!(png_dimensions(&header(width, height)).is_err());
        }
        assert!(png_dimensions(&header(1, 1)[..23]).is_err());
    }

    #[test]
    fn a_concurrent_call_is_refused_without_waiting_or_decoding() {
        let _held = ACTIVE.lock().unwrap();
        let refusal = recognize("not decoded while busy").unwrap_err();
        assert!(matches!(refusal.code, ErrorCode::Unavailable));
    }
}
