# Macro assistant

The Macros view builds useful EverQuest socials for the selected character and keeps
managed macros aligned with the active classes, learned spells and memorized gems.
The user presses the resulting hotbuttons in EverQuest. The companion configures
them; it does not run rotations or send game commands.

## Experience

- A live character strip shows level, selected classes, known spells and filled gems.
- Solo, Group and Pet support presets order the same evidence-backed suggestions.
- Recommended macros explain their purpose and show the exact five-or-fewer lines.
  Ready macros can join the managed set. Learned spells that need memorizing say so.
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
  Starter selections follow a role across class and gem changes; individual spell
  choices retain their selected family. Up to twelve macros fit on a hotbar page.

## Evidence and application

The supported client exposes a current-profile spellbook and memorized gem array.
Both are optional read-only observations behind the same executable guard as live
position/classes. Only occupied gems 1 through 14 are verified `/cast` bindings;
the native array's eighteen slots include capacity beyond that command's range.
Empty capacity does not prove that a gem slot is unlocked. Full-name casting uses
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
five-line limits, pauses, incomplete observations, INI preservation, duplicates,
managed conflicts, retirement and idempotence. Service tests cover active-character
changes, queued latest-plan replacement, no writes while running/uncertain, closed
client application, backups and restore conflicts. End-to-end tests use isolated
game folders and controlled native observations; a final check uses the real
character's visible Macros view without casting or changing gameplay.

The independent E2E client rows include Legends target type 51 (friendly or self),
observed in installed healing and buff rows and corroborated by the wiki's
[Strengthen](https://eqlwiki.com/Strengthen) and
[Minor Healing](https://eqlwiki.com/Minor_Healing) target descriptions.

Merged verification on 2026-09-08: typecheck and lint passed; 4,419 unit tests
passed with one skipped. The macros, gear-auto-classes, maps-player and
quest-journal-level E2E specs passed. The macro spec covers the full native-to-file
path, a queued rank/gem update while the view is unmounted, uncertain process
states, post-exit application, preservation of personal fields, and exact restore.
