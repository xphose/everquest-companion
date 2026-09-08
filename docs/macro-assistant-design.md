# Macro assistant planning contract

The pure planner produces social text for review. It never executes commands, sends chat,
changes a character's spell gems, or writes an INI file. The runtime supplies fresh,
same-character observations; stale memory must not be passed as a current `MacroPlayer`.

`src/shared/macros.ts` contains the public types and bounded selection validators.
`macros/planner.ts` exports `planMacros(input, selections)`, `macros/compiler.ts` exports
`compileMacro(name, steps, input)`, and `macros/audit.ts` exports
`auditMacro(name, lines, input)`. `macros/loadout.ts` exports
`planMacroLoadout(input, recipes, selections)` for read-only memorization guidance.

## Evidence and selection

- A spell must occur in the observed spellbook and the runtime client table. A selected
  class must be able to use it at the observed level. Catalog presence alone proves neither
  ownership nor access. Undefined spellbook/gems mean unavailable; empty arrays mean known empty.
- `unlockedSpellSlots` is an optional independent observation of one-based gem indices.
  The castable set is its intersection with the verified client command bound, 1–14.
  Empty unlocked gems contribute capacity; occupied locked gems do not contribute
  readiness. Missing or malformed entitlement never falls back to occupied counts.
- `spellLineKey` and `parseSpellRank` define families and rank order. Numerical spell IDs
  never rank power. Across unrelated families the default prefers a castable memorized
  family, then a stable name; this is not a claim that an alphabetically first spell is stronger.
- A selected family stays selected across class changes, level changes, learned ranks, and
  gem reordering. It becomes unavailable instead of silently switching to another family.
  The highest castable memorized rank remains ready while an owned higher rank is offered
  as an upgrade. Memorizing the higher rank causes the recipe to regenerate.
- `macroSelectionKey(recipe.selection)` equals the recipe ID. Selections choose managed
  recipes; an empty selection list authorizes **no installations**. The planner still returns
  recommendations for unselected roles. The writer must match selections, not install the
  whole recommendation list.

Solo ordering starts with personal healing and damage; group ordering starts with healing,
mez and debuffs; pet ordering starts with summoning, the pet opener and pet healing. Every
class can receive location and inventory-export utilities without invented ability or AA IDs.
Pet actions require an owned eligible summon/charm effect, and their descriptions state that
the player needs an existing pet. The planner does not claim a pet is currently present.

Utility recommendations retain every eligible spell family: choosing Summon Food does not
hide Summon Drink, and choosing one cure does not hide other cure families. Item summons
cast once and then attempt `/autoinventory`. Additional verified roles include cures,
root, snare, lull, invisibility, vision, water breathing, levitation, Gate and runes.
Beastlord warders use the separately identified summon effect 106. Classification follows
actual owned spells and class-level eligibility for any observed class combination, with
whole-effect checks for new utility roles. Unsupported target/effect combinations remain
unclassified; this does not implement Bard twisting or assume unavailable melee/AA skills.

The pet opener combines `/pet attack` with one selected damage family. Self buffs select up to
four distinct memorized, eligible buff families that target self or single target, preceded
by targeting yourself. Individual buff families are also offered independently. Spell target
and effect classification is deliberately a small allowlist; unsupported AE or ambiguous effects
are not guessed. Effect/target identities are grounded in
[EQEmu's spell definitions](https://github.com/EQEmu/EQEmu/blob/master/common/spdat.h) and the
client table field map documented in `src/main/resist/spellsUsParse.ts`.
Legends target 51 is handled separately as friendly target or self, verified against installed
Strengthen/Spirit of Wolf rows and the [Strengthen page](https://eqlwiki.com/Strengthen). It is
eligible for beneficial heals/buffs and self-buff sequences, never hostile damage/debuff roles.

## Compilation and audit

The inspected Legends client accepts numeric `/cast` bindings only for gems 1–14, despite an
18-entry profile capacity. Its name lookup consumes an unquoted, case-insensitive prefix and
uses the first matching gem. Name mode therefore requires known metadata for every occupied
castable gem and one unique prefix match; otherwise compilation uses the actual numeric gem.
Names containing command punctuation or unsupported text also use a numeric binding.
All binding, family-choice and readiness decisions also require independently verified
slot entitlement. Name lookup remains conservative about prefix collisions with other
occupied controls, including locked ones, and falls back to an unlocked numeric gem.

## Spell-loadout budget

The loadout planner deduplicates required spell IDs across selected macros. It preserves
already memorized requirements at their exact unlocked positions, allocates missing
requirements to unlocked empty slots first, then explicitly proposes replacements of
non-required spells. Remaining current spells stay in place. This produces at most one
assignment per available castable gem, with no compressed indices or invented slots.

A plan that exceeds capacity reports its required count, shortfall and omitted spells;
it never labels the whole selection ready. Unknown entitlement or unsupported selected
requirements produce an unavailable plan. A proposed assignment does not grant macro
readiness, enqueue commands for a future layout, or memorize a spell. Actual gem changes
must arrive through the normal fresh same-character observation before commands update.

## Timing and readiness

A combined `/pause N, /cast ...` line pauses **after** its cast. The compiler rounds cast time
plus recovery plus a stated 0.2-second scheduling margin up to tenths. Repeated uses of the same
spell additionally reserve its reuse cooldown; unrelated spells do not inherit that cooldown.
It rejects waits beyond 600 tenths and recipes exceeding five commands. Labels are limited to
15 printable ASCII characters and command lines to 240, conservative bounds compatible with
the writer. Blocked recipes return no executable-looking partial command sequence.

Readiness means verified bindings and compilable text. It does not imply the character currently
has enough mana, reagents, a valid target, or an expired cooldown. The recipe reports total mana,
planned waits, required spells, missing memorization, and reasons for any blocked state.

## Adventure preparation

Preparation is a separate package compiled against an explicitly proposed temporary layout.
The user chooses up to four owned self-usable utility spells; a Food and Drink preset selects
the two independent summon families when available. Already memorized utilities retain their
gems. Missing utilities replace occupied unlocked gems, starting at the highest available
position, and record the original spell IDs for restoration. Empty gems are deliberately
excluded from replacements because native spell sets cannot restore emptiness with `-1`.

The package uses one native batch button to load the changed gems, an individual utility
button for each spell, and one batch button to restore the changed gems. If all chosen spells
are already memorized, only the utility buttons are needed. Untouched positions remain `-1`
in both set requests. Utility buttons use uniquely verified full spell names across both
layouts; a numeric fallback would cast a different combat spell if pressed before loading.
Ordinary unmemorized macro readiness is not relaxed to enable this separate package.
When Food and Drink are both selected, a Make Supplies shortcut joins their two cast/stow
sequences into four lines. Individual food and drink buttons remain available for restocking
one item. Four selected utility spells plus the optional shortcut and two swap buttons need
at most seven hotbuttons.

The captured combat baseline remains stable through intermediate empty gems and temporary
utility observations. Current class, ownership, level, entitlement and spell metadata changes
invalidate incompatible preparation. The companion observes readiness but does not press
Load, Use or Restore, and does not guess a memorization pause. See
[the native command and persistence evidence](macro-preparation-client-evidence.md).

Preparation is queued for the observed character settings file and a separate configurable
hotbar/page (default 3/1). The runtime allocates spell sets and socials together, preserves
personal records, and writes a backed-up atomic package only after the game is fully stopped.
Existing combat macro selections are included without being replaced by temporary bindings.
The user keeps the companion open, exits EverQuest, waits for Saved, then relaunches.
An unchanged package receives an Already up to date receipt instead of a new-save or restart
claim. Receipts identify the captured package so canceling a pending replacement cannot be
reported as successfully installing it. The last write time and last check time are distinct.

Recommendations are recalculated from current class, level, spellbook and unlocked-gem
observations. A captured preparation package requires explicit rebuilding after incompatible
changes, and temporary gems cannot be captured as a new combat baseline. This keeps class
changes automatic in the suggestions while retaining the player's known return setup.

The audit preserves personal macro text and returns line-numbered advice: missing command
slashes (including the observed `/pause 30, cast 1` shape), internal empty lines, invalid pause
syntax, noncastable/empty gems, uncertain gem metadata, unmemorized or ambiguous names, and
waits shorter than known cast/recovery time. A separate `/pause` after a cast counts toward
that wait. Unknown occupied-gem metadata yields uncertainty rather than a false claim that
the named spell is absent.

`tests/macroPlanner.test.mts` uses authored metadata, including deliberately unordered IDs,
to test class switches, ownership, rank upgrades, retained manual families, gem reordering,
name-prefix collisions, missing data, playstyles, both combined recipes, limits, and audits.
