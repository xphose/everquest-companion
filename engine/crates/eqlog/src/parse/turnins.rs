//! NPC offers retain the stated quantity; a trade-complete sentence closes the offer group.

use super::{world::WorldRes, Ctx};
use crate::event::{Ev, Key, Kind};
use crate::jsstr::js_trim;

pub fn classify_turn_in(r: &WorldRes, c: &Ctx, out: &mut Ev) -> bool {
    if c.text.contains("offered") {
        if let Some(m) = r.offer.captures(c.text) {
            let Ok(count) = m[1].replace(',', "").parse::<i64>() else {
                return false;
            };
            if count <= 0 {
                return false;
            }
            out.begin(Kind::Offer);
            out.envelope(c.seq, c.ts, c.raw);
            out.s(Key::Item, js_trim(&m[2]));
            out.s(Key::Npc, js_trim(&m[3]));
            out.i(Key::Count, count);
            return true;
        }
    }
    if c.text.contains("complete the trade") {
        if let Some(m) = r.trade_done.captures(c.text) {
            out.begin(Kind::Trade);
            out.envelope(c.seq, c.ts, c.raw);
            out.s(Key::Npc, js_trim(&m[1]));
            return true;
        }
    }
    false
}
