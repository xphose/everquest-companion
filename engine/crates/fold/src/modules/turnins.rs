//! Completed NPC trades retain offered items and narrowly attributed solo experience.
//! Reward evidence is temporal, not a quest verdict. A matching trade must close the pending offer.

use crate::event::Event;
use crate::EqModule;
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::BTreeMap;

const REWARD_WINDOW_MS: i64 = 5_000;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnInRow {
    ts: i64,
    npc: String,
    items: Vec<String>,
    item_counts: BTreeMap<String, i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    experience_at: Option<i64>,
}

struct PendingOffer {
    npc: String,
    items: Vec<String>,
    item_counts: BTreeMap<String, i64>,
    last_at: i64,
    reward_eligible: bool,
    experience_at: Option<i64>,
}

impl PendingOffer {
    fn add(&mut self, item: String, count: i64) {
        // Further offers after a reward pulse make the transaction attribution ambiguous.
        self.reward_eligible &= self.experience_at.is_none();
        let quantity = self.item_counts.entry(item.clone()).or_default();
        *quantity = quantity.saturating_add(count);
        self.items.push(item);
    }

    fn observe(&mut self, ev: &Event) {
        self.reward_eligible &= !interrupts_reward(ev.kind());
        // Derived heartbeat events have a finer clock than log seconds and do not order a trade.
        if matches!(ev.kind(), "offer" | "expGain" | "trade") {
            self.reward_eligible &= ev.ts() >= self.last_at;
            self.last_at = ev.ts();
        }
        if ev.kind() == "expGain" {
            self.reward_eligible &=
                ev.has("party") && !ev.bool("party") && self.experience_at.is_none();
            self.experience_at = Some(ev.ts());
        }
    }

    fn reward_at(&self, trade_at: i64) -> Option<i64> {
        self.experience_at
            .filter(|at| self.reward_eligible && within_reward_window(*at, trade_at))
    }
}

fn within_reward_window(from: i64, to: i64) -> bool {
    to.checked_sub(from)
        .is_some_and(|elapsed| (0..=REWARD_WINDOW_MS).contains(&elapsed))
}

fn is_combat(kind: &str) -> bool {
    matches!(
        kind,
        "damage"
            | "miss"
            | "resist"
            | "death"
            | "playerDeath"
            | "cc"
            | "ccWake"
            | "charm"
            | "uncharm"
            | "specialAttack"
            | "poisonProc"
            | "mitigation"
            | "castBegin"
            | "castInterrupted"
            | "castFizzle"
            | "castResumed"
            | "otherCastBegin"
            | "heal"
            | "healUnstated"
    )
}

fn interrupts_reward(kind: &str) -> bool {
    is_combat(kind)
        || matches!(
            kind,
            "group"
                | "zone"
                | "sessionStart"
                | "offlineGap"
                | "campStart"
                | "purchase"
                | "itemMerge"
                | "itemMergeFailed"
        )
}

#[derive(Default)]
pub struct TurnInsModule {
    turn_ins: Vec<TurnInRow>,
    pending_offer: Option<PendingOffer>,
    recent_interruption_at: Option<i64>,
    seq: i64,
    /// The announce cursor — see [`crate::announce`]. `pending_offer` is not published state: a
    /// handed-over item is a half-formed group nobody can read until the trade closes it.
    announce: crate::announce::Announce,
}

impl TurnInsModule {
    pub fn new() -> Self {
        Self::default()
    }

    fn offer(&mut self, ev: &Event) {
        let npc = ev.str("npc").unwrap_or_default().to_string();
        let item = ev.str("item").unwrap_or_default().to_string();
        let count = ev.int("count").unwrap_or(1).max(0);
        match self.pending_offer.as_mut() {
            Some(open) if open.npc == npc => open.add(item, count),
            _ => {
                let reward_eligible = self.pending_offer.is_none()
                    && !self
                        .recent_interruption_at
                        .is_some_and(|at| ev.ts() < at || within_reward_window(at, ev.ts()));
                self.pending_offer = Some(PendingOffer {
                    npc,
                    items: vec![item.clone()],
                    item_counts: BTreeMap::from([(item, count)]),
                    last_at: ev.ts(),
                    reward_eligible,
                    experience_at: None,
                })
            }
        }
    }
}

impl EqModule for TurnInsModule {
    fn id(&self) -> &'static str {
        "turnins"
    }

    fn reset(&mut self) {
        self.turn_ins.clear();
        self.pending_offer = None;
        self.recent_interruption_at = None;
        self.seq = 0;
        self.announce.reset();
    }

    fn on_event(&mut self, ev: &Event, _live: bool) {
        self.seq = ev.seq();
        if is_combat(ev.kind()) {
            self.recent_interruption_at = Some(ev.ts());
        }
        if let Some(open) = self.pending_offer.as_mut() {
            open.observe(ev);
        }
        match ev.kind() {
            // Character rebirth. A half-formed offer group goes with it.
            "epoch" => {
                self.turn_ins.clear();
                self.pending_offer = None;
                self.recent_interruption_at = None;
                self.announce.changed(self.seq);
            }
            "zone" | "sessionStart" | "offlineGap" => {
                self.pending_offer = None;
                self.recent_interruption_at = None;
            }
            // An offer publishes nothing: it opens or extends the pending group, which is not in
            // `snapshot()`. Handing items to an NPC and walking away leaves the ledger as it was.
            "offer" => self.offer(ev),
            "trade" => {
                let npc = ev.str("npc").unwrap_or_default();
                if let Some(open) = self.pending_offer.take() {
                    if open.npc == npc {
                        let experience_at = open.reward_at(ev.ts());
                        self.turn_ins.push(TurnInRow {
                            ts: ev.ts(),
                            npc: open.npc,
                            items: open.items,
                            item_counts: open.item_counts,
                            experience_at,
                        });
                        self.announce.changed(self.seq);
                    }
                }
            }
            _ => {}
        }
    }

    /// Moves on the trade that CLOSED a group, not on every line that passed by. See `announce`.
    fn published_seq(&self) -> Option<i64> {
        Some(self.announce.cursor())
    }

    fn snapshot(&self) -> Value {
        json!({ "seq": self.seq, "state": self.turn_ins })
    }
}
