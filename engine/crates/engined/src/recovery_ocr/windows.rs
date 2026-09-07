//! Safe WinRT factories initialize MTA through windows-core's CO_E_NOTINITIALIZED fallback.

use super::{png_dimensions, Failure};
use protocol::generated::{RecoveryOcrLine, RecoveryOcrResult, RecoveryOcrWord};
use windows::{
    core::HSTRING,
    Globalization::Language,
    Graphics::Imaging::{BitmapAlphaMode, BitmapDecoder, BitmapPixelFormat, SoftwareBitmap},
    Media::Ocr::{OcrEngine, OcrResult},
    Storage::Streams::{DataWriter, InMemoryRandomAccessStream},
};

fn unavailable(_: windows::core::Error) -> Failure {
    Failure::unavailable("Windows English OCR could not process this screenshot")
}

fn decode(png: &[u8]) -> Result<SoftwareBitmap, Failure> {
    let stream = InMemoryRandomAccessStream::new().map_err(unavailable)?;
    let writer = DataWriter::CreateDataWriter(&stream).map_err(unavailable)?;
    writer.WriteBytes(png).map_err(unavailable)?;
    writer
        .StoreAsync()
        .map_err(unavailable)?
        .join()
        .map_err(unavailable)?;
    writer.DetachStream().map_err(unavailable)?;
    stream.Seek(0).map_err(unavailable)?;
    let invalid = |_| Failure::invalid("OCR image must be a decodable PNG");
    let decoder = BitmapDecoder::CreateWithIdAsync(
        BitmapDecoder::PngDecoderId().map_err(unavailable)?,
        &stream,
    )
    .map_err(invalid)?
    .join()
    .map_err(invalid)?;
    let dimensions = (
        decoder.PixelWidth().map_err(invalid)?,
        decoder.PixelHeight().map_err(invalid)?,
    );
    if dimensions != png_dimensions(png)? {
        return Err(Failure::invalid(
            "OCR PNG dimensions disagree with its header",
        ));
    }
    decoder
        .GetSoftwareBitmapConvertedAsync(BitmapPixelFormat::Bgra8, BitmapAlphaMode::Ignore)
        .map_err(invalid)?
        .join()
        .map_err(invalid)
}

fn result_rows(result: &OcrResult) -> Result<RecoveryOcrResult, Failure> {
    let lines = result.Lines().map_err(unavailable)?;
    let line_count = lines.Size().map_err(unavailable)?;
    let too_large = || Failure::unavailable("OCR text exceeds the supported result size");
    if line_count > 2_000 {
        return Err(too_large());
    }
    let mut rows = Vec::new();
    let mut word_count = 0;
    let mut text_bytes = 0;
    for index in 0..line_count {
        let line = lines.GetAt(index).map_err(unavailable)?;
        let text = line.Text().map_err(unavailable)?.to_string();
        text_bytes += text.len() + usize::from(index != 0);
        let words = line.Words().map_err(unavailable)?;
        let count = words.Size().map_err(unavailable)?;
        word_count += count;
        if text_bytes > 100_000 || count > 2_000 || word_count > 20_000 {
            return Err(too_large());
        }
        let mut bounds = Vec::new();
        for index in 0..count {
            let word = words.GetAt(index).map_err(unavailable)?;
            let rect = word.BoundingRect().map_err(unavailable)?;
            bounds.push(RecoveryOcrWord {
                text: word.Text().map_err(unavailable)?.to_string(),
                x: f64::from(rect.X),
                y: f64::from(rect.Y),
                width: f64::from(rect.Width),
                height: f64::from(rect.Height),
            });
        }
        rows.push(RecoveryOcrLine {
            text,
            words: bounds,
        });
    }
    let text = rows
        .iter()
        .map(|line| line.text.as_str())
        .collect::<Vec<_>>()
        .join("\n");
    Ok(RecoveryOcrResult { text, lines: rows })
}

pub(super) fn recognize(png: &[u8]) -> Result<RecoveryOcrResult, Failure> {
    let language = Language::CreateLanguage(&HSTRING::from("en-US")).map_err(unavailable)?;
    if !OcrEngine::IsLanguageSupported(&language).map_err(unavailable)? {
        return Err(Failure::unavailable(
            "Windows English OCR language support is not installed",
        ));
    }
    let limit = OcrEngine::MaxImageDimension().map_err(unavailable)?;
    let (width, height) = png_dimensions(png)?;
    if width > limit || height > limit {
        return Err(Failure::invalid(
            "OCR PNG dimensions exceed the Windows OCR limit",
        ));
    }
    let bitmap = decode(png)?;
    let engine = OcrEngine::TryCreateFromLanguage(&language).map_err(unavailable)?;
    let result = engine
        .RecognizeAsync(&bitmap)
        .map_err(unavailable)?
        .join()
        .map_err(unavailable)?;
    result_rows(&result)
}
