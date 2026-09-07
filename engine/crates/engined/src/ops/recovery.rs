//! OCR runs on this connection thread; it never asks the ingest to perform image work.
use super::{error, reply, Outcome};
use protocol::generated::{RecoveryOcrRequest, ReplyResult};

pub(super) fn recognize(request: RecoveryOcrRequest) -> Outcome {
    match crate::recovery_ocr::recognize(&request.params.png_base64) {
        Ok(result) => reply(request.id, ReplyResult::RecoveryOcrResult(result)),
        Err(why) => error(request.id, why.code, why.message),
    }
}
