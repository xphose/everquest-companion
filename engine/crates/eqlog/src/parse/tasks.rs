//! Assignment/update forms have recorded log samples. Terminal forms come from the installed
//! client's eqstr_us.txt templates; their live emission to the log has not yet been observed.

use super::Ctx;
use crate::event::{Ev, Key, Kind};
use crate::jsstr::js_trim;

/// Exact template boundaries prevent quoted player chat from becoming task state.
pub fn classify_task_activity(c: &Ctx, out: &mut Ev) -> bool {
    let forms = [
        ("You have been assigned the task '", "'.", "assigned"),
        ("Your task '", "' has been updated.", "updated"),
        ("The task '", "' has been removed.", "removed"),
        ("Task '", "' Completed", "completed"),
        ("Task '", "' Failed.", "failed"),
    ];
    let activity = forms.iter().find_map(|(prefix, suffix, change)| {
        c.text
            .strip_prefix(prefix)?
            .strip_suffix(suffix)
            .map(|name| (name, *change))
    });
    let Some((name, change)) = activity else {
        return false;
    };
    let name = js_trim(name);
    if name.is_empty() {
        return false;
    }
    out.begin(Kind::TaskActivity);
    out.envelope(c.seq, c.ts, c.raw);
    out.s(Key::Name, name);
    out.s(Key::Change, change);
    true
}
