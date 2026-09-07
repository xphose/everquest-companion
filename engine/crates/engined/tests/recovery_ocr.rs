//! Native OCR over the authenticated socket, without any attached log or filesystem parameter.
mod harness;

use base64::{engine::general_purpose::STANDARD, Engine as _};
#[cfg(windows)]
use harness::health;
use harness::{echo, Engine};
#[cfg(windows)]
use protocol::generated::HealthResultStatus;
use protocol::generated::{
    ClientMessage, EngineMessage, ErrorCode, RecoveryOcrParams, RecoveryOcrRequest,
    RecoveryOcrRequestOp, ReplyResult, RequestId,
};

const TABLE: &[u8] = include_bytes!("../../../../tests/fixtures/ocr-quest-table.png");

fn request(id: i64, encoded: &str) -> ClientMessage {
    ClientMessage::RecoveryOcrRequest(RecoveryOcrRequest {
        id: RequestId(id),
        op: RecoveryOcrRequestOp::RecoveryOcr,
        params: RecoveryOcrParams {
            png_base64: encoded.try_into().expect("within schema size"),
        },
    })
}

#[test]
fn invalid_images_are_refused_and_the_connection_remains_usable() {
    let engine = Engine::start();
    let mut client = engine.connected();
    for encoded in [
        "%%%".to_owned(),
        STANDARD.encode(b"not PNG"),
        STANDARD.encode(&TABLE[..24]),
    ] {
        client.send(&request(1, &encoded));
        let EngineMessage::ErrorReply(reply) = client.recv() else {
            panic!("invalid PNG must be refused")
        };
        assert_eq!(*reply.id, 1);
        assert!(matches!(reply.error.code, ErrorCode::BadParams));
    }
    client.send(&echo(2, "still connected"));
    let EngineMessage::Reply(reply) = client.recv() else {
        panic!("echo reply")
    };
    assert!(matches!(reply.result, ReplyResult::EchoResult(_)));
}

#[test]
fn oversized_pixels_and_wrong_param_types_are_bad_params_not_unknown_ops() {
    let engine = Engine::start();
    let mut client = engine.connected();
    let mut huge = TABLE.to_vec();
    huge[16..20].copy_from_slice(&5001_u32.to_be_bytes());
    huge[20..24].copy_from_slice(&4000_u32.to_be_bytes());
    client.send(&request(3, &STANDARD.encode(huge)));
    let EngineMessage::ErrorReply(reply) = client.recv() else {
        panic!("pixel limit refusal")
    };
    assert!(matches!(reply.error.code, ErrorCode::BadParams));
    client.send_bytes(b"{\"id\":4,\"op\":\"recovery.ocr\",\"params\":{\"pngBase64\":55}}\n");
    let EngineMessage::ErrorReply(reply) = client.recv() else {
        panic!("param shape refusal")
    };
    assert_eq!(*reply.id, 4);
    assert!(matches!(reply.error.code, ErrorCode::BadParams));
}

#[cfg(windows)]
#[test]
fn windows_reads_the_synthetic_table_and_word_bounds_before_any_attach() {
    let engine = Engine::start();
    let mut client = engine.connected();
    client.send(&request(5, &STANDARD.encode(TABLE)));
    let message = client.recv();
    let EngineMessage::Reply(reply) = message else {
        panic!("native English OCR: {message:?}")
    };
    let ReplyResult::RecoveryOcrResult(result) = reply.result else {
        panic!("OCR result")
    };
    assert!(
        result.text.contains("Blackburrow Brewers"),
        "{}",
        result.text
    );
    assert!(
        result.text.contains("Clay Bracelet Quest"),
        "{}",
        result.text
    );
    assert_eq!(
        result.text,
        result
            .lines
            .iter()
            .map(|line| line.text.as_str())
            .collect::<Vec<_>>()
            .join("\n")
    );
    let words: Vec<_> = result.lines.iter().flat_map(|line| &line.words).collect();
    let title = words
        .iter()
        .find(|word| word.text == "Blackburrow")
        .expect("quest name word");
    let date = words
        .iter()
        .find(|word| word.text == "09/01/2026")
        .expect("same-row date");
    assert!(title.x < date.x && (title.y - date.y).abs() < 8.0);
    assert!(words
        .iter()
        .all(|word| word.width > 0.0 && word.height > 0.0));
    assert!(words
        .iter()
        .all(|word| word.x >= 0.0 && word.x + word.width <= 700.0));
    assert!(words
        .iter()
        .all(|word| word.y >= 0.0 && word.y + word.height <= 190.0));
    client.send(&health(6));
    let EngineMessage::Reply(reply) = client.recv() else {
        panic!("health reply")
    };
    let ReplyResult::HealthResult(result) = reply.result else {
        panic!("health result")
    };
    assert!(matches!(result.status, HealthResultStatus::Idle));
    assert_eq!(*result.epoch, 1, "OCR never attaches or changes epochs");
}

#[cfg(windows)]
#[test]
fn a_complete_header_without_png_pixels_is_a_decode_refusal_not_a_panic() {
    let engine = Engine::start();
    let mut client = engine.connected();
    client.send(&request(7, &STANDARD.encode(&TABLE[..33])));
    let EngineMessage::ErrorReply(reply) = client.recv() else {
        panic!("decode refusal")
    };
    assert!(matches!(reply.error.code, ErrorCode::BadParams));
}

#[cfg(not(windows))]
#[test]
fn other_platforms_report_ocr_unavailable() {
    let engine = Engine::start();
    let mut client = engine.connected();
    client.send(&request(5, &STANDARD.encode(TABLE)));
    let EngineMessage::ErrorReply(reply) = client.recv() else {
        panic!("platform refusal")
    };
    assert!(matches!(reply.error.code, ErrorCode::Unavailable));
}
