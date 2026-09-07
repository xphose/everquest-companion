//! Task statements for the current character epoch. Historical completion survives a later
//! assignment; lastChange identifies a repeat run or removal without rewriting that history.

use crate::event::Event;
use crate::EqModule;
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::BTreeMap;

/// Bound distinct names while retaining already-observed rows. A refusal marks partial coverage.
pub const MAX_TASKS: usize = 4_096;

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskActivityRow {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub assigned_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub removed_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failed_at: Option<i64>,
    pub last_change: String,
    pub last_observed_at: i64,
    pub cycle_status: String,
}

impl TaskActivityRow {
    fn next_cycle_status(&self, change: &str) -> &str {
        match change {
            "assigned" => "assigned",
            "completed" => "completed",
            "failed" => "failed",
            "removed" if matches!(self.cycle_status.as_str(), "completed" | "failed") => {
                &self.cycle_status
            }
            "removed" => "removed",
            "updated" if self.cycle_status == "assigned" => "assigned",
            _ => "observed",
        }
    }

    fn instant(&mut self, change: &str) -> Option<&mut Option<i64>> {
        match change {
            "assigned" => Some(&mut self.assigned_at),
            "updated" => Some(&mut self.updated_at),
            "completed" => Some(&mut self.completed_at),
            "removed" => Some(&mut self.removed_at),
            "failed" => Some(&mut self.failed_at),
            _ => None,
        }
    }

    fn observe(&mut self, activity: &Activity) -> bool {
        let instant = self.instant(&activity.change).expect("a supported change");
        let changed = instant.is_none_or(|old| old < activity.ts);
        if changed {
            *instant = Some(activity.ts);
        }
        if activity.ts < self.last_observed_at {
            return changed;
        }
        // EQ timestamps have second resolution; distinct changes in one second follow log order.
        let latest_changed =
            self.last_change != activity.change || self.last_observed_at != activity.ts;
        self.cycle_status = self.next_cycle_status(&activity.change).to_owned();
        self.last_change.clone_from(&activity.change);
        self.last_observed_at = activity.ts;
        changed || latest_changed
    }
}

struct Activity {
    name: String,
    change: String,
    ts: i64,
    seq: i64,
}

impl Activity {
    fn from_event(ev: &Event) -> Option<Self> {
        let name = ev.str("name")?.trim();
        let change = ev.str("change")?;
        if name.is_empty()
            || !matches!(
                change,
                "assigned" | "updated" | "completed" | "removed" | "failed"
            )
        {
            return None;
        }
        Some(Self {
            name: name.to_owned(),
            change: change.to_owned(),
            ts: ev.ts(),
            seq: ev.seq(),
        })
    }
}

#[derive(Default)]
pub struct TasksModule {
    tasks: BTreeMap<String, TaskActivityRow>,
    truncated: bool,
    seq: i64,
    announce: crate::announce::Announce,
    /// A launch epoch is delivered after its primary; keep just that statement across the clear.
    latest: Option<Activity>,
}

impl TasksModule {
    pub fn new() -> Self {
        Self::default()
    }

    fn observe(&mut self, activity: &Activity) -> bool {
        let key = activity.name.to_lowercase();
        if self.tasks.len() >= MAX_TASKS && !self.tasks.contains_key(&key) {
            let changed = !self.truncated;
            self.truncated = true;
            return changed;
        }
        self.tasks
            .entry(key)
            .or_insert_with(|| TaskActivityRow {
                name: activity.name.clone(),
                ..TaskActivityRow::default()
            })
            .observe(activity)
    }

    fn epoch(&mut self, ev: &Event) -> bool {
        let before = std::mem::take(&mut self.tasks);
        let was_truncated = self.truncated;
        self.truncated = false;
        let boundary = self
            .latest
            .take()
            .filter(|activity| activity.seq == ev.seq() && activity.ts == ev.ts());
        if let Some(activity) = boundary {
            self.observe(&activity);
        }
        was_truncated || before != self.tasks
    }
}

impl EqModule for TasksModule {
    fn id(&self) -> &'static str {
        "tasks"
    }

    fn reset(&mut self) {
        self.tasks.clear();
        self.truncated = false;
        self.seq = 0;
        self.announce.reset();
        self.latest = None;
    }

    fn on_event(&mut self, ev: &Event, _live: bool) {
        self.seq = ev.seq();
        let changed = match ev.kind() {
            "epoch" => self.epoch(ev),
            "taskActivity" => match Activity::from_event(ev) {
                Some(activity) => {
                    let changed = self.observe(&activity);
                    self.latest = Some(activity);
                    changed
                }
                None => false,
            },
            _ => false,
        };
        if changed {
            self.announce.changed(self.seq);
        }
    }

    fn published_seq(&self) -> Option<i64> {
        Some(self.announce.cursor())
    }

    fn snapshot(&self) -> Value {
        let tasks: Vec<&TaskActivityRow> = self.tasks.values().collect();
        json!({ "seq": self.seq, "state": { "v": 1, "tasks": tasks, "truncated": self.truncated } })
    }
}
