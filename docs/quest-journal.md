# Quest journal

Open **Quest journal** in the sidebar. Search by quest, NPC, item, or zone; use the
status filter to see observed active tasks, completed quests, ready hand-ins, or
quests you chose to track. Tracking a quest pins it for convenience; it is not
required for automatic task detection.

The selected quest shows its next action, pickup location, monsters and item
sources, turn-in instructions, and rewards. Click a `/loc` button to open the
native map at that point. The map's Back button returns to the journal with your
search and selection preserved. Item and NPC links open the existing companion views.

## Connect your character

1. In EverQuest, type `/log on`. Select your character in the companion if needed.
2. Type `/outputfile inventory` to supply held items and equipped gear.
3. Type `/outputfile achievements` to supply supported historical completion evidence.

The journal discovers matching-character exports automatically and refreshes while
open. There is no quest-by-quest entry requirement. Inventory exports are snapshots;
the companion cannot make the game refresh them. Recorded loot, destroys, and NPC
trades update ingredient estimates after an export. Export inventory again after
selling or giving away items, combining gear, or when the displayed export is old.
Export achievements again to refresh historical evidence.

Level and classes come from the character log when available. **Character details
and profile correction** supplies an optional fallback; **Use detected profile**
returns to automatic detection. Filters change what you browse, not your character.

## Understand progress

- **Active** comes from observed task activity or an explicit correction.
- **Completed** requires a recorded task completion, a supported earned Sky quest
  achievement, existing Sky completion history, or an explicit correction.
- **Ready to turn in** means the available item evidence satisfies a structured
  guide's distinguishable requirements. Check the guide's faction and other conditions.
- **Progress unknown** means there is insufficient evidence. It does not mean you
  never started or finished the quest.

A closed NPC trade records a hand-in, not guaranteed success. Repeated assignments
start a new attempt; older hand-ins stay in history without completing the new steps.
Identically named item variants are kept separate when ordinary item counts cannot
distinguish them. Optional **Correct progress** controls can be reset to automatic
status or tracking at any time.

## Current coverage

The bundled August 2026 source snapshot includes 999 entries, readable walkthroughs
for 901 quests, and 99 structured guides: 95 individual Sky tests and four other
quests. The directory includes pickup coordinates for 776 entries and item stats
for rewards in 672 entries. Missing coordinates and final recipients are not guessed;
source walkthroughs remain available for quests without structured steps.

Recommendations explain minimum levels, known classes, NPC levels, and numeric
equipment differences. A minimum quest level is not a promise that the monsters are
safe to solo. Equipment comparisons use base item stats; they do not score sockets,
merge tiers, effects, or stat caps.

Task assignment/update parsing is covered by recorded game logs. Completion, removal,
and failure parsing matches the installed Legends client's exact string templates;
live emission of those terminal messages still needs verification. Tasks missing
from a log and unsupported historical completions cannot be recovered from these
inputs. The game client does not list an active-task `/outputfile` export.

This feature is implemented on the fork's development branch. It has not been
published as an upstream release.
