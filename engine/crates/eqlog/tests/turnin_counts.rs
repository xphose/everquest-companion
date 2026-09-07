use eqlog::event::{Ev, Key, Kind};
use eqlog::{Clock, Parser};

#[test]
fn the_real_offer_retains_its_stated_quantity() {
    let parser = Parser::new(Clock::new(eqlog::Tz::UTC), None, None);
    let fixture = include_str!("../../../../tests/fixtures/w15-sphinx-claw-variant.log");
    let line = fixture
        .lines()
        .find(|line| line.contains("You offered 1 Sphinx Claw"))
        .unwrap();
    let mut event = Ev::new();
    assert!(parser.parse_event(line, 1, &mut event));
    let (_, payload) = event.done();
    assert_eq!(payload.kind(), Kind::Offer);
    assert_eq!(payload.str(Key::Item), Some("Sphinx Claw"));
    assert_eq!(payload.str(Key::Npc), Some("Dason Goldblade"));
    assert_eq!(payload.int(Key::Count), Some(1));
}

#[test]
fn synthetic_quantities_exercise_the_existing_numeric_offer_field() {
    let parser = Parser::new(Clock::new(eqlog::Tz::UTC), None, None);
    for (quantity, expected) in [
        ("4", Some(4)),
        ("1,024", Some(1024)),
        ("0", None),
        ("99999999999999999999999", None),
    ] {
        let raw = format!(
            "[Sat Aug 01 01:46:43 2026] You offered {quantity} Sphinx Claw to Dason Goldblade."
        );
        let mut event = Ev::new();
        assert!(parser.parse_event(&raw, 1, &mut event));
        let (_, payload) = event.done();
        assert_eq!(payload.int(Key::Count), expected);
        assert_eq!(
            payload.kind(),
            if expected.is_some() {
                Kind::Offer
            } else {
                Kind::Unknown
            }
        );
    }
}
