# Full upgrade tiers in inventory exports

The native inventory exporter was independently inspected in the client with
SHA-256 `412ca5fd0be010bde1dd4df19a2b0a7217fe4e957eeed8280e9ca4f980f8f74f`.
An ordinary item at base tier is exported without a `+0` suffix. Treating every
missing suffix as unknown therefore hides valid equipment comparisons and omits
ordinary spare copies from merge XP totals.

The exporter at image-relative `0x422af0` obtains display names through
`0x6b9fd0`; equipment, bank, and container paths call that formatter. The ordinary
name path at `0x6b3b40` derives the full upgrade tier from the item's upgrade XP
using logarithm base two, then appends ` +%d` only for a positive tier. Its
Ornamentation and Exaltation branches are separate and do not establish the tier
of an ordinary host item.

`inventoryExportTier` applies that export-specific interpretation at the equipped
item and ownership folds. An ordinary unsuffixed name with a positive item ID is
full tier zero. Canonical explicit tiers `+0..+10` are accepted. Special names,
an unstated starred tier, malformed suffixes, or invalid unsuffixed records stay
unknown. Explicit tiers with the existing star decoration retain their stated
numeric tier; the star alone does not establish one.

The raw `parseItemName` result still records whether the suffix was actually
present. Manual planner entries, unrelated missing metadata, and raw loot names
do not acquire a default tier. Neither an export's missing suffix nor a stated
full tier reveals fractional progress toward the next tier. Existing comparison
bounds, merge-cost ranges, and exclusions for equipped items and socketed effects
remain unchanged.

Synthetic tests cover the export-to-equipment/ownership-to-advice pipeline,
positive tiers, unknown formats, special rows, spare-copy XP, and automatic
inventory watcher updates. Private before/after checks against a real export
confirmed that ordinary base equipment receives usable advice and base spare
copies contribute XP. No personal inventory, paths, character facts, or diagnostic
output is part of the repository evidence.
