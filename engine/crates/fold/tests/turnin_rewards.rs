use eqlog::event::Ev;
use eqlog::{Clock, Parser};
use fold::event::Event;
use fold::modules::turnins::TurnInsModule;
use fold::EqModule;
use serde_json::{json, Value};

fn offer(ts: i64, npc: &str) -> Value {
    json!({"kind":"offer","ts":ts,"npc":npc,"item":"Bone Chips","count":4})
}

fn xp(ts: i64, party: bool) -> Value {
    json!({"kind":"expGain","ts":ts,"party":party,"pct":0.086})
}

fn trade(ts: i64, npc: &str) -> Value {
    json!({"kind":"trade","ts":ts,"npc":npc})
}

fn feed(module: &mut TurnInsModule, values: Vec<Value>, live: bool) {
    let seq = module.snapshot()["seq"].as_i64().unwrap();
    for (index, mut value) in values.into_iter().enumerate() {
        value["seq"] = json!(seq + index as i64 + 1);
        module.on_event(&Event::from_value(value), live);
    }
}

fn rows(values: Vec<Value>) -> Value {
    let mut module = TurnInsModule::new();
    feed(&mut module, values, true);
    module.snapshot()["state"].clone()
}

#[test]
fn matching_trade_attaches_the_unique_solo_reward_and_preserves_stacked_counts() {
    assert_eq!(
        rows(vec![
            offer(1_000, "Quest Giver"),
            offer(1_500, "Quest Giver"),
            json!({"kind":"unknown","ts":2_000,"raw":"Faction credit"}),
            xp(3_000, false),
            trade(3_000, "Quest Giver"),
        ]),
        json!([{
            "npc":"Quest Giver", "ts":3_000, "items":["Bone Chips","Bone Chips"],
            "itemCounts":{"Bone Chips":8}, "experienceAt":3_000,
        }])
    );
}

#[test]
fn an_offer_can_wait_while_the_player_reads_but_reward_to_close_is_bounded() {
    for (close, expected) in [(65_000, Some(60_000)), (65_001, None), (59_999, None)] {
        let state = rows(vec![
            offer(1_000, "Quest Giver"),
            xp(60_000, false),
            trade(close, "Quest Giver"),
        ]);
        assert_eq!(state[0]["experienceAt"].as_i64(), expected);
        assert_eq!(state[0].get("experienceAt").is_some(), expected.is_some());
    }
}

#[test]
fn absent_party_xp_or_xp_before_an_offer_does_not_become_reward_evidence() {
    for values in [
        vec![offer(1_000, "Quest Giver"), trade(2_000, "Quest Giver")],
        vec![
            offer(1_000, "Quest Giver"),
            xp(2_000, true),
            trade(3_000, "Quest Giver"),
        ],
        vec![
            xp(1_000, false),
            offer(2_000, "Quest Giver"),
            trade(3_000, "Quest Giver"),
        ],
        vec![
            offer(2_000, "Quest Giver"),
            xp(1_000, false),
            trade(3_000, "Quest Giver"),
        ],
        vec![
            offer(1_000, "Quest Giver"),
            json!({"kind":"expGain","ts":2_000}),
            trade(3_000, "Quest Giver"),
        ],
    ] {
        let state = rows(values);
        assert_eq!(state.as_array().unwrap().len(), 1);
        assert!(state[0].get("experienceAt").is_none(), "{state}");
    }
}

#[test]
fn duplicate_experience_and_further_offers_make_reward_attribution_ambiguous() {
    for interruption in [
        xp(2_100, false),
        xp(2_100, true),
        offer(2_100, "Quest Giver"),
    ] {
        let state = rows(vec![
            offer(1_000, "Quest Giver"),
            xp(2_000, false),
            interruption,
            trade(3_000, "Quest Giver"),
        ]);
        assert!(state[0].get("experienceAt").is_none());
    }
}

#[test]
fn combat_and_other_reward_sources_invalidate_the_pending_attribution() {
    for kind in [
        "damage",
        "miss",
        "resist",
        "death",
        "playerDeath",
        "cc",
        "ccWake",
        "charm",
        "uncharm",
        "specialAttack",
        "poisonProc",
        "mitigation",
        "castBegin",
        "castInterrupted",
        "castFizzle",
        "castResumed",
        "otherCastBegin",
        "heal",
        "healUnstated",
        "group",
        "campStart",
        "purchase",
        "itemMerge",
        "itemMergeFailed",
    ] {
        for before_xp in [true, false] {
            let mut middle = vec![json!({"kind":kind,"ts":2_000}), xp(2_000, false)];
            if !before_xp {
                middle.reverse();
            }
            let mut values = vec![offer(1_000, "Quest Giver")];
            values.extend(middle);
            values.push(trade(3_000, "Quest Giver"));
            let state = rows(values);
            assert!(state[0].get("experienceAt").is_none(), "{kind}: {state}");
        }
    }
}

#[test]
fn a_recent_kill_before_the_offer_cannot_lend_its_delayed_xp_to_a_trade() {
    for (offer_at, expected) in [(6_000, None), (6_001, Some(6_002))] {
        let state = rows(vec![
            json!({"kind":"death","ts":1_000}),
            offer(offer_at, "Quest Giver"),
            xp(6_002, false),
            trade(6_003, "Quest Giver"),
        ]);
        assert_eq!(state[0]["experienceAt"].as_i64(), expected);
    }
}

#[test]
fn competing_npcs_cannot_inherit_the_reward_and_an_empty_trade_cannot_reuse_it() {
    let state = rows(vec![
        offer(1_000, "First Giver"),
        offer(1_100, "Other Giver"),
        xp(2_000, false),
        trade(3_000, "Other Giver"),
        trade(3_100, "Other Giver"),
    ]);
    assert_eq!(state.as_array().unwrap().len(), 1);
    assert!(state[0].get("experienceAt").is_none());
    assert_eq!(
        rows(vec![
            offer(1_000, "First Giver"),
            xp(2_000, false),
            trade(3_000, "Other Giver"),
            trade(3_100, "First Giver"),
        ]),
        json!([])
    );
}

#[test]
fn boundaries_and_reset_drop_unfinished_reward_evidence() {
    for kind in ["epoch", "zone", "sessionStart", "offlineGap"] {
        assert_eq!(
            rows(vec![
                offer(1_000, "Quest Giver"),
                xp(2_000, false),
                json!({"kind":kind,"ts":2_500}),
                trade(3_000, "Quest Giver"),
            ]),
            json!([]),
            "{kind}"
        );
    }
    let mut module = TurnInsModule::new();
    feed(
        &mut module,
        vec![offer(1_000, "Quest Giver"), xp(2_000, false)],
        true,
    );
    module.reset();
    feed(&mut module, vec![trade(3_000, "Quest Giver")], true);
    assert_eq!(module.snapshot()["state"], json!([]));
    assert_eq!(module.published_seq(), Some(0));
}

#[test]
fn derived_heartbeat_timestamps_do_not_override_the_log_clock_order() {
    let state = rows(vec![
        offer(1_000, "Quest Giver"),
        json!({"kind":"buffExpired","ts":2_999}),
        xp(2_000, false),
        trade(4_000, "Quest Giver"),
    ]);
    assert_eq!(state[0]["experienceAt"], 2_000);
    let backwards_offer = rows(vec![
        offer(3_000, "Quest Giver"),
        offer(1_000, "Quest Giver"),
        xp(2_000, false),
        trade(4_000, "Quest Giver"),
    ]);
    assert!(backwards_offer[0].get("experienceAt").is_none());
}

#[test]
fn pending_xp_publishes_nothing_until_the_completed_trade_and_epoch_clears_it() {
    let mut module = TurnInsModule::new();
    feed(
        &mut module,
        vec![offer(1_000, "Quest Giver"), xp(2_000, false)],
        true,
    );
    assert_eq!(module.snapshot()["state"], json!([]));
    assert_eq!(module.published_seq(), Some(0));
    feed(&mut module, vec![trade(3_000, "Quest Giver")], true);
    let completed_cursor = module.published_seq().unwrap();
    assert!(completed_cursor > module.snapshot()["seq"].as_i64().unwrap());
    feed(
        &mut module,
        vec![xp(3_100, false), trade(3_200, "Quest Giver")],
        true,
    );
    assert_eq!(module.published_seq(), Some(completed_cursor));
    assert_eq!(module.snapshot()["state"].as_array().unwrap().len(), 1);
    feed(&mut module, vec![json!({"kind":"epoch","ts":4_000})], true);
    assert!(module.published_seq().unwrap() > module.snapshot()["seq"].as_i64().unwrap());
    assert_eq!(module.snapshot()["state"], json!([]));
}

#[test]
fn parsed_log_replay_and_live_append_derive_the_same_optional_evidence() {
    let parser = Parser::new(Clock::new(eqlog::Tz::UTC), None, None);
    let fixture = include_str!("../../../../tests/fixtures/quest-rewarded-handin.log");
    let replay_into = |module: &mut TurnInsModule, live: bool| {
        for (index, raw) in fixture.lines().enumerate() {
            let mut parsed = Ev::new();
            assert!(parser.parse_event(raw, index as i64 + 1, &mut parsed));
            let (_, payload) = parsed.done();
            module.on_event(&Event::typed(payload), live);
        }
    };
    let mut replay = TurnInsModule::new();
    let mut live = TurnInsModule::new();
    replay_into(&mut replay, false);
    replay_into(&mut live, true);
    assert_eq!(replay.snapshot(), live.snapshot());
    let row = &replay.snapshot()["state"][0];
    assert_eq!(row["experienceAt"], row["ts"]);
    assert!(row["experienceAt"].is_i64());
    assert_eq!(row["itemCounts"]["Froglok Tadpole Flesh"], 4);
    assert_eq!(row["npc"], "Zulort");
    replay.reset();
    replay_into(&mut replay, false);
    assert_eq!(
        replay.snapshot(),
        live.snapshot(),
        "replay replaces, never duplicates, evidence"
    );
}

#[test]
fn a_new_transaction_after_zoning_cannot_inherit_the_previous_zones_combat() {
    let state = rows(vec![
        json!({"kind":"death","ts":1_000}),
        offer(1_100, "First Giver"),
        json!({"kind":"zone","ts":2_000}),
        offer(2_100, "Quest Giver"),
        xp(3_000, false),
        trade(3_000, "Quest Giver"),
    ]);
    assert_eq!(state.as_array().unwrap().len(), 1);
    assert_eq!(state[0]["experienceAt"], 3_000);
}
