//! Positive sentence shapes come from committed Legends logs, not invented quest APIs.

use eqlog::event::{Ev, Key, Kind};
use eqlog::{Clock, Parser};

const ASSIGNED: &str = include_str!("../../../../tests/fixtures/p1-unbound-pet.log");
const UPDATED: &str = include_str!("../../../../tests/fixtures/e2e-deep-link.log");
const NAME: &str = "Potential of the Void - Lord Nagafen - Weekly";

fn parser() -> Parser {
    Parser::new(Clock::new(eqlog::Tz::America__New_York), None, None)
}

#[test]
fn real_task_statements_keep_their_name_instant_and_observed_change() {
    let parser = parser();
    for (fixture, marker, change) in [
        (ASSIGNED, "You have been assigned the task '", "assigned"),
        (UPDATED, "Your task '", "updated"),
    ] {
        let raw = fixture.lines().find(|line| line.contains(marker)).unwrap();
        let mut event = Ev::new();
        assert!(parser.parse_event(raw, 17, &mut event));
        let (json, payload) = event.done();
        assert_eq!(payload.kind(), Kind::TaskActivity);
        assert_eq!(payload.str(Key::Name), Some(NAME));
        assert_eq!(payload.str(Key::Change), Some(change));
        assert_eq!(payload.seq(), 17);
        assert!(payload.ts() > 0);
        assert_eq!(payload.raw(), raw);
        let value: serde_json::Value = serde_json::from_str(json).unwrap();
        assert_eq!(value["kind"], "taskActivity");
        assert_eq!(value["change"], change);
        assert!(value.get("completed").is_none());
    }
}

#[test]
fn chat_and_unverified_outcomes_never_become_task_activity() {
    let parser = parser();
    for message in [
        "Someone tells you, 'You have been assigned the task 'Fake'.'",
        "Someone says, 'Your task 'Fake' has been updated.'",
        "You have been assigned the task ''.",
        "Your task '   ' has been updated.",
        "You have been assigned the task 'Fake'. trailing text",
        "Your task 'Fake' has been completed.",
        "You have completed the task 'Fake'.",
        "Your task 'Fake' has been removed.",
        "Your task 'Fake' has failed.",
        "Someone says, 'Task 'Fake' Completed'",
        "Task 'Fake' Completed.",
        "The task '' has been removed.",
    ] {
        let raw = format!("[Wed Aug 05 20:26:16 2026] {message}");
        let mut event = Ev::new();
        assert!(parser.parse_event(&raw, 1, &mut event));
        assert_eq!(event.done().1.kind(), Kind::Unknown, "{message}");
    }
}

#[test]
fn client_templates_define_terminal_forms_without_claiming_live_log_evidence() {
    // These are synthetic log lines built from actual client strings, not recorded gameplay.
    let templates = include_str!("../../../../tests/fixtures/task-strings.eqstr.txt");
    let parser = parser();
    for (id, change) in [
        ("3471", "updated"),
        ("3472", "assigned"),
        ("3473", "removed"),
        ("6003", "completed"),
        ("6004", "failed"),
    ] {
        let template = templates
            .lines()
            .find_map(|line| line.strip_prefix(&format!("{id} ")))
            .unwrap();
        let message = template.replace("%1", NAME);
        let raw = format!("[Wed Aug 05 20:26:16 2026] {message}");
        let mut event = Ev::new();
        assert!(parser.parse_event(&raw, 1, &mut event));
        let (_, payload) = event.done();
        assert_eq!(payload.kind(), Kind::TaskActivity, "{message}");
        assert_eq!(payload.str(Key::Change), Some(change));
        assert_eq!(payload.str(Key::Name), Some(NAME));
    }
}
