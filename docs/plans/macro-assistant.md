# Macro assistant

The Macros view builds useful EverQuest socials for the selected character and keeps
managed macros aligned with the active classes, learned spells and memorized gems.
The user presses the resulting hotbuttons in EverQuest. The companion configures
them; it does not run rotations or send game commands.

## Experience

- A live character strip shows level, selected classes, known spells, filled gems and
  independently verified available spell slots. Empty unlocked slots count toward the
  budget; occupied locked slots never make a cast ready.
- Solo, Group and Pet support presets order the same evidence-backed suggestions.
- Recommended macros explain their purpose and show the exact five-or-fewer lines.
  Ready macros can join the managed set. Learned spells that need memorizing can be
  selected for planning, but their commands are only generated after memorization.
- Useful roles include direct damage, self/target/pet healing, pet control, crowd
  control, debuffs, buffs, summoning and basic navigation/character-export utilities.
  A pet opener combines pet attack with damage. Self Buffs combines up to four
  memorized buff lines after targeting yourself, within the five-line limit.
- Spell upgrades compare owned ranks within a verified spell line. The app never
  treats level eligibility as proof of ownership or a larger spell ID as an upgrade.
- Existing socials are audited for broken syntax, empty gem references and pauses
  shorter than the selected spell's cast and recovery time. Personal macros are
  suggestions only; they are not silently adopted or rewritten.
- The managed set has a clear preview, destination bar/page, automatic updates,
  pending/applied/conflict status and a reversible last-application backup.
  Each Queue click acknowledges acceptance. Queued updates explain that the player
  must leave the companion open, fully exit EverQuest, and wait for the saved result
  before relaunching. Completion distinguishes a new write from an unchanged plan;
  only a real write supplies a new saved timestamp. A persistent status panel and
  a dismissible acknowledgement show the result and the next step. Conflicts never
  claim that all selected macros were installed.
  Starter selections follow a role across class and gem changes; individual spell
  choices retain their selected family. Up to twelve macros fit on a hotbar page.
- A spell-loadout plan shows the gem budget for the selected macros. Several macros
  can share one spell slot. It keeps required spells in their current unlocked gems,
  uses empty unlocked gems first, and names any non-required spell a suggestion would
  replace. If the required spells exceed available slots, it reports the shortfall.
  The player memorizes the suggested spells in game; the companion detects the result.

## Evidence and application

The supported client exposes a current-profile spellbook and memorized gem array.
Both are optional read-only observations behind the same executable guard as live
position/classes. The native array's eighteen slots include capacity beyond the
verified `/cast` command range of 1 through 14. A separate read of the client slot
entitlement supplies `unlockedSpellSlots`; a usable binding must be in both sets.
Neither occupancy nor array length establishes entitlement. Unknown entitlement
blocks cast readiness and speculative loadout assignments. Full-name casting uses
unquoted names, with numeric fallback when prefix matching would be ambiguous.
Self-target sequences use the observed character name. This client does not accept
`myself` as a `/target` keyword; missing character identity blocks those sequences.
The installed spells_us.txt supplies names, class
levels, cast/recovery times, mana, targets and effects. Its large parse runs off the
main thread and is cached by source identity.

Normal socials use the observed character INI format, with 10 pages of 12 socials,
five command lines per social, and E0..E119 hotbutton references. Each managed macro
has a stable identity and a saved prior field snapshot. Updates only change empty
slots or unchanged slots previously owned by this feature. Orphan hotbar references
also reserve their social slots. User edits produce a conflict.

The current game retains settings in memory and rewrites them at exit. INI updates
are therefore queued while EverQuest runs and applied automatically only after a
fresh observation proves the matching client is absent. The companion remains open
to perform that work. A missing/ambiguous character configuration or uncertain game
presence blocks writing. A class switch updates the queued plan; it does not leave
obsolete managed class macros indefinitely.

Before application, re-read and compare the target file, create a byte-for-byte
backup in the companion's private data folder, then replace atomically. Restoration
must not overwrite later user changes. Keep hotbutton placement explicit (initial
default: Hotbar 4, page 1) and never move or replace an occupied personal button.

## Validation

Pure tests cover spell ownership, classes, level, rank changes, gem reorder,
unlocked/locked/empty slots, shared-spell budgets, loadout shortfalls, five-line limits,
pauses, incomplete observations, INI preservation, duplicates,
managed conflicts, retirement and idempotence. Service tests cover active-character
changes, queued latest-plan replacement, no writes while running/uncertain, closed
client application, backups and restore conflicts. End-to-end tests use isolated
game folders and controlled native observations; a final check uses the real
character's visible Macros view without casting or changing gameplay.

The independent E2E client rows include Legends target type 51 (friendly or self),
observed in installed healing and buff rows and corroborated by the wiki's
[Strengthen](https://eqlwiki.com/Strengthen) and
[Minor Healing](https://eqlwiki.com/Minor_Healing) target descriptions.

The slot-aware feature passed merged typecheck, lint and 4,456 unit tests on
2026-09-08, with one skipped. The macro E2E covers unlocked empty slots, an occupied
locked slot, a new unlock, unknown entitlement, a visible missing-spell assignment,
shared-spell budgeting and an exact capacity shortfall, followed by the full
native-to-file flow: queued rank/gem changes while unmounted, uncertain process
states, post-exit application, preservation of personal fields, and exact restore.
The final serial run passed all four E2E specs: macros, gear-auto-classes,
maps-player and quest-journal-level (191.7 seconds).

A read-only check of the supported installed client verified 12 unlocked slots,
12 filled slots and eight distinct required spells for eight selected macros.
All required spells were already memorized; the proposed loadout preserved every
current gem. Character configuration hashes were unchanged by the check.

Development restart regression: overlapping watch builds could clear a hashed
chunk before the newly restarted Electron process loaded it. Main/preload output
now survives subsequent `serve` builds. Actual Vite bundle tests verify retention
between generations and ordinary production cleanup; a fresh dev launch also
includes the spell metadata worker and starts without the missing-module error.

Post-relaunch verification on 2026-09-08: all eight selected macros were visible on
the configured hotbar. A fresh native profile produced the same commands already
on disk, with no INI plan changes or conflicts. Each managed social and hotbutton
reference matched, and the ten personal socials from the pre-install backup were
preserved. The latest manual queue had completed as an unchanged plan.

Feedback stores an optional typed completion receipt (`written`, `unchanged`, or
`restored`) for compatibility with older saved results. A check timestamp never
replaces the timestamp of the last actual write. Each successful manual Queue
click receives its own acknowledgement; polling does not repeat it, and a newer
completion, error, or character switch clears obsolete feedback. The merged
feedback change passed typecheck, lint and 4,470 unit tests, with one skipped.
The targeted Macros E2E passed (64.8 seconds), including repeated Queue clicks,
visible pending instructions, a completed write with timestamp and destination,
background application, personal-field preservation, and exact backup restoration.
