use fold::event::Event;
use fold::modules::turnins::TurnInsModule;
use fold::EqModule;
use serde_json::json;

#[test]
fn one_closed_trade_preserves_item_names_and_sums_quantities() {
    let mut module = TurnInsModule::new();
    for value in [
        json!({"kind":"offer","seq":1,"ts":1,"raw":"","npc":"Giver","item":"Bone Chips","count":4}),
        json!({"kind":"offer","seq":2,"ts":2,"raw":"","npc":"Giver","item":"Bone Chips","count":2}),
        json!({"kind":"offer","seq":3,"ts":3,"raw":"","npc":"Giver","item":"Other Item"}),
    ] {
        module.on_event(&Event::from_value(value), true);
    }
    assert_eq!(module.snapshot()["state"], json!([]));
    module.on_event(
        &Event::from_value(json!({"kind":"trade","seq":4,"ts":4,"raw":"","npc":"Giver"})),
        true,
    );
    assert_eq!(
        module.snapshot()["state"],
        json!([{
            "npc":"Giver","ts":4,"items":["Bone Chips","Bone Chips","Other Item"],
            "itemCounts":{"Bone Chips":6,"Other Item":1}
        }])
    );
    module.on_event(&Event::from_value(json!({"kind":"offer","seq":5,"ts":5,"raw":"","npc":"Giver","item":"Bone Chips","count":4})), true);
    module.on_event(
        &Event::from_value(json!({"kind":"trade","seq":6,"ts":6,"raw":"","npc":"Other NPC"})),
        true,
    );
    assert_eq!(module.snapshot()["state"].as_array().unwrap().len(), 1);
}
