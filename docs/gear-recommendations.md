# Gear recommendations

Gear has three views: **Recommended**, **My gear**, and **Browse all**.
Recommended starts with one useful next step. My gear explains what to keep,
improve, or investigate. Browse all preserves the item search, filters, comparison,
and wish list controls.

## Automatic refresh

While Gear is visible, current character facts are checked every two seconds.
Inventory watcher events refresh exported equipment immediately, with a thirty-second
backup check to recover from missed events or a temporary read failure. Returning to
the window, restoring its visibility, or opening Recommended triggers a fresh check.

The refresh status reports the last successful check separately from changes to the
recommendations. Recompute advice when its inputs change; preserve the existing data
references, expanded cards, scroll position, and explicit planning choices when they
do not. Coalesce concurrent refresh requests and reject responses from an earlier
character session. Stop timers and subscriptions when the view unmounts.

Equipment observations come from the character's existing inventory export. New
`/outputfile inventory` exports are picked up automatically. The check timestamp
describes local observations; catalog scrape dates describe the item and source data.

## Recommendation contract

- Follow the active character's classes and exact level. Five-level bands are a
  planning aid; selecting a band must name the exact preview level being evaluated.
- Prefer a useful, obtainable improvement over a large theoretical number. Offer
  easier alternatives when the sources support that comparison.
- Explain benefits in ordinary words. Scores order suggestions; they are not damage,
  healing, mitigation, effective health, or a measured percentage improvement.
- Compare the proposed replacement with the rest of the equipment. Repeated haste
  and focus effects must not earn their full value repeatedly. Spell focus applies
  only to eligible spells, using the shared focus rules.
- Keep missing facts missing. An absent inventory export is not an empty character;
  an unknown source is not an easy camp. Ordinary native export rows can establish
  base tier zero without a printed suffix, as documented in
  [inventory upgrade tiers](research/inventory-upgrade-tiers.md). Unrelated missing
  tier metadata remains unknown.
- Keep manual planning separate from observed facts. Potential mode describes a
  hypothetical item tier, with acquisition and upgrade costs still visible.

The first version is an explained recommendation heuristic, not a proof of a
globally optimal equipment set. AA choices, stance and invocation interactions,
encounter mechanics, and unquantified effects cannot be converted into invented
stat gains. Any omitted contribution belongs in the detailed limitations.
Offhand weapon choices, changes between weapon skill types, and Any Slot
replacements currently require manual comparison. The planner does not optimize
those interactions or claim that each independent suggestion forms an optimal set.

## Acquisition evidence

Use the existing item-to-mob index and the item page's drop sources. Quest rewards
must come from explicit reward links; an item mentioned in a quest may instead be
an ingredient. A quest's minimum level is eligibility, not its combat difficulty.

NPC level comparisons are difficulty estimates. They do not establish solo safety,
travel access, a drop probability, or time to obtain the item. Preserve alternative
sources and unresolved restrictions. Pin coordinates only when their zone is
unambiguous. **Show me where** opens the source's known map or location; it does not
move the character or promise a path through unexplored terrain.

## Upgrades and effects

Use `itemUpgrade.ts` and `planner/gearScale.ts` for stat scaling. Do not replace the
verified scaler with a simplified percentage formula. An export names whole tiers
but does not expose fractional progress, so replacement comparisons and merge costs
must respect that uncertainty.

Only spare whole items can count toward duplicate merges. Exclude equipped items,
socket contents, and extracted effects; reserve any copy that will become the host.
Do not turn unknown mote balances or unverified mote values into a spending plan.
Motes also improve spells, so gear advice must acknowledge that competing use.

Exaltation advice uses the existing socket, class intersection, extraction, and
haste-transfer rules. A proposed transfer must name its donor and the required
donor/host tier. Moving an effect removes it from its donor. See the community
[Exaltations reference](https://eqlwiki.com/Exaltations) and
[upgrade reference](https://eqlwiki.com/index.php/Item_Upgrade_System).

## Patch maintenance

The corpus scrape dates and the date of a verified rule are different facts. A
recent patch note does not make the older item corpus current. Keep narrow,
source-backed corrections separate from raw scraped fields, with regression tests.

The [July 29 update](https://www.everquestlegends.com/patch-notes/eql-update-notes-7-29-2026)
states that difficulty sets a minimum drop tier, not an exact tier. The
[September 1 update](https://www.everquestlegends.com/patch-notes/eql-update-notes-9-01-2026)
changes particular equipment restrictions. The
[September 9 update](https://www.everquestlegends.com/patch-notes/eql-update-notes-9-09-2026)
changes indoor instance rewards and respawning through Dungeon Crawls. Recheck
these rules when refreshing the data; never infer new item values from a patch
that only says an item was improved.

Live observations, exports, and configuration stay local. Tests use synthetic
characters and isolated installations. Repository paths, game paths, identities,
screenshots, logs, and Git metadata follow the public privacy rules in `AGENTS.md`.
