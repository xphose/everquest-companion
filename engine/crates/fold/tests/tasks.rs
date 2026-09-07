use eqlog::event::Ev;
use eqlog::{Clock, Parser};
use fold::event::Event;
use fold::modules::tasks::{TasksModule, MAX_TASKS};
use fold::{registered, ClusterDeps, EqModule};
use serde_json::{json, Value};

fn activity(seq: i64, ts: i64, name: &str, change: &str) -> Event<'static> {
    Event::from_json(
        &json!({ "kind": "taskActivity", "seq": seq, "ts": ts, "raw": "",
            "name": name, "change": change })
        .to_string(),
    )
    .unwrap()
}

fn state(module: &TasksModule) -> Value {
    module.snapshot()["state"].clone()
}

#[test]
fn observed_updates_do_not_invent_acceptance_or_completion() {
    let mut module = TasksModule::new();
    module.on_event(&activity(1, 100, "Weekly", "updated"), false);
    assert_eq!(
        state(&module),
        json!({"v":1, "tasks":[{"name":"Weekly","updatedAt":100,"lastChange":"updated","lastObservedAt":100,"cycleStatus":"observed"}], "truncated":false})
    );
    module.on_event(&activity(2, 200, "WEEKLY", "assigned"), true);
    module.on_event(&activity(3, 300, "weekly", "updated"), true);
    module.on_event(&activity(4, 400, "weekly", "assigned"), true);
    assert_eq!(
        state(&module)["tasks"],
        json!([{"name":"Weekly","assignedAt":400,"updatedAt":300,"lastChange":"assigned","lastObservedAt":400,"cycleStatus":"assigned"}])
    );
}

#[test]
fn repeated_or_older_evidence_and_unrelated_events_do_not_announce() {
    let mut module = TasksModule::new();
    module.on_event(&activity(1, 100, "Weekly", "assigned"), false);
    let cursor = module.published_seq();
    module.on_event(&activity(2, 100, "Weekly", "assigned"), true);
    module.on_event(&activity(3, 99, "Weekly", "assigned"), true);
    module.on_event(&activity(4, 200, "Weekly", "unverified"), true);
    module.on_event(&activity(5, 200, "", "assigned"), true);
    module.on_event(
        &Event::from_json(r#"{"kind":"unknown","seq":100,"ts":200,"raw":""}"#).unwrap(),
        true,
    );
    assert_eq!(module.published_seq(), cursor);
    module.on_event(&activity(101, 201, "Weekly", "updated"), true);
    assert!(module.published_seq().unwrap() > 101);
}

#[test]
fn rows_are_sorted_by_casefolded_identity_and_epochs_clear_them() {
    let mut module = TasksModule::new();
    module.on_event(&activity(1, 10, "Zebra", "updated"), true);
    module.on_event(&activity(2, 20, "apple", "assigned"), true);
    assert_eq!(state(&module)["tasks"][0]["name"], "apple");
    let previous = module.published_seq();
    module.on_event(
        &Event::from_json(r#"{"kind":"epoch","seq":3,"ts":30,"raw":""}"#).unwrap(),
        false,
    );
    assert_eq!(state(&module), json!({"v":1,"tasks":[],"truncated":false}));
    assert!(module.published_seq() > previous);
    module.reset();
    assert_eq!(module.snapshot()["seq"], 0);
    assert_eq!(module.published_seq(), Some(0));
}

#[test]
fn the_retention_bound_is_reported_without_losing_existing_rows() {
    let mut module = TasksModule::new();
    for index in 0..MAX_TASKS {
        module.on_event(
            &activity(index as i64, 10, &format!("Task {index}"), "assigned"),
            false,
        );
    }
    module.on_event(&activity(5000, 20, "Over capacity", "assigned"), true);
    assert_eq!(state(&module)["tasks"].as_array().unwrap().len(), MAX_TASKS);
    assert_eq!(state(&module)["truncated"], true);
    let cursor = module.published_seq();
    module.on_event(&activity(5001, 30, "Another excess task", "assigned"), true);
    assert_eq!(module.published_seq(), cursor);
    module.on_event(&activity(5002, 40, "Task 0", "updated"), true);
    assert_eq!(state(&module)["tasks"][0]["updatedAt"], 40);
    module.reset();
    assert_eq!(state(&module)["truncated"], false);
}

#[test]
fn registered_module_folds_real_assignment_and_update_sentences() {
    let parser = Parser::new(Clock::new(eqlog::Tz::America__New_York), None, None);
    let mut registry = registered(ClusterDeps::default());
    let mut module = TasksModule::new();
    for (seq, fixture, marker) in [
        (
            1,
            include_str!("../../../../tests/fixtures/p1-unbound-pet.log"),
            "You have been assigned the task '",
        ),
        (
            2,
            include_str!("../../../../tests/fixtures/e2e-deep-link.log"),
            "Your task '",
        ),
    ] {
        let raw = fixture.lines().find(|line| line.contains(marker)).unwrap();
        let mut parsed = Ev::new();
        assert!(parser.parse_event(raw, seq, &mut parsed));
        let event = Event::from_json(parsed.done().0).unwrap();
        module.on_event(&event, false);
        registry.dispatch(&event, false, &mut Vec::new());
    }
    let snapshot = registry
        .snapshot_of("tasks")
        .expect("the task module is registered");
    assert_eq!(snapshot, module.snapshot());
    let rows = state(&module);
    let task = &rows["tasks"][0];
    assert_eq!(
        task["name"],
        "Potential of the Void - Lord Nagafen - Weekly"
    );
    assert!(task["assignedAt"].as_i64().unwrap() < task["updatedAt"].as_i64().unwrap());
    assert!(task.get("completedAt").is_none());
}

#[test]
fn completion_and_failure_survive_cleanup_but_repeat_assignments_start_a_new_cycle() {
    let mut module = TasksModule::new();
    module.on_event(&activity(1, 100, "Weekly", "completed"), true);
    module.on_event(&activity(2, 100, "Weekly", "removed"), true);
    assert_eq!(state(&module)["tasks"][0]["cycleStatus"], "completed");
    module.on_event(&activity(3, 100, "Weekly", "assigned"), true);
    assert_eq!(state(&module)["tasks"][0]["cycleStatus"], "assigned");
    module.on_event(&activity(4, 100, "Weekly", "removed"), true);
    assert_eq!(state(&module)["tasks"][0]["cycleStatus"], "removed");
    assert_eq!(state(&module)["tasks"][0]["completedAt"], 100);
    module.on_event(&activity(5, 100, "Weekly", "assigned"), true);
    module.on_event(&activity(6, 100, "Weekly", "failed"), true);
    module.on_event(&activity(7, 100, "Weekly", "removed"), true);
    assert_eq!(state(&module)["tasks"][0]["cycleStatus"], "failed");
    assert_eq!(state(&module)["tasks"][0]["lastChange"], "removed");
    assert_eq!(state(&module)["tasks"][0]["failedAt"], 100);
}

#[test]
fn the_launch_boundary_keeps_its_primary_statement_and_discards_beta_history() {
    let mut folded = fold::Fold::new(registered(ClusterDeps::default()), 100);
    folded.on_primary(&activity(1, 99, "Weekly", "completed"), false);
    folded.on_primary(&activity(2, 100, "Weekly", "assigned"), false);
    let state = folded.registry.snapshot_of("tasks").unwrap()["state"].clone();
    assert_eq!(state["tasks"][0]["assignedAt"], 100);
    assert!(state["tasks"][0].get("completedAt").is_none());
    assert_eq!(state["tasks"][0]["cycleStatus"], "assigned");
}
