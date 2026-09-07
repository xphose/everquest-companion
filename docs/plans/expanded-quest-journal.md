# Expanded quest journal

## Player outcome

The journal should answer what to do next: which quests suit this character, where to
start them, which monsters or items are involved, where to finish them, and what their
rewards change. Tracking should happen automatically from readable game evidence.
Manual corrections are optional; the player should not maintain a duplicate checklist.

## Evidence and progress

- The Rust engine is the only log parser. The tasks module records assignment, update,
  completion, failure, and removal separately, including repeat-task cycles.
- Assignment and update patterns have recorded gameplay fixtures. Terminal patterns
  come from the installed Legends client's `eqstr_us.txt`; their emission into a live
  log still requires verification. String-table tests are not gameplay recordings.
- A completed task remains historical evidence after removal. A new assignment starts
  a new attempt, even when messages share a one-second timestamp.
- Inventory can establish possession of distinguishable ingredients and quantities.
  Possession alone does not establish quest acceptance or completion. Ambiguous item
  variants need additional evidence.
- Closed NPC trades retain quantities. Automatic quest completion needs an identified
  final hand-in and sufficient corroborating evidence; a trade is not itself success.
- Achievement imports reuse the existing guarded Sky completion rules. A class-unlock
  grant must not masquerade as completion of every quest in the chain.
- Imported files must match the active character. The existing output registry's
  newest-file fallback is unsuitable for journal progress.
- Character identity, log path, and engine generation are checked across asynchronous
  reads. Progress cannot be written for an absent or switched character.
- Missing history is unknown. Neither an empty log nor a missing export means a quest
  has never been started or completed.

## Quest knowledge

The bundled directory joins the existing wiki quest catalog, individual Sky tests,
NPC locations, item sources, and reward stats. Coordinates retain their zone and the
game's `/loc` order. Multi-zone NPC pages without per-point zone attribution do not
produce guessed map pins.

Structured walkthroughs have separate pickup, collection, prerequisite, and final
turn-in steps. A quest giver is not assumed to be the final recipient. Quantities,
same-name variants, faction requirements, and possible reward outcomes remain explicit.
Unstructured item references in wiki prose are not converted into required items.

Readable source walkthroughs supplement structured guides. Every guide retains its
source and snapshot date. Source coverage and automation coverage are separate facts.

## Recommendations

Show reasons instead of an opaque score: known minimum level, monster levels, reward
class restrictions, and concrete comparisons with current equipment. The minimum
level to obtain a quest does not promise a safe solo encounter. Unknown race, faction,
deity, or class restrictions must remain unknown. Worn equipment comparisons require
a matching character inventory export and expose its freshness.

## Application boundary

Electron main joins static knowledge, readable output files, engine snapshots, and
saved user corrections. The renderer requests filtered, ranked, paginated rows and a
detail record for one quest. It presents those results without a second log fold or
client-side domain ranking. Queries are refreshed only while the journal is mounted;
mutations carry the expected character id.

## Acceptance checks

1. Browse and search without an active character, with honest missing-data states.
2. Detect task assignment/update from recorded log fixtures and terminal patterns from
   their explicitly identified client string templates.
3. Preserve completion across task removal and distinguish repeated task attempts.
4. Read only matching-character exports, including guarded historical Sky completion.
5. Automatically advance distinguishable item requirements and suggest the next step.
6. Show different pickup and turn-in NPCs, source-backed coordinates, rewards, and
   level/difficulty distinctions.
7. Keep optional corrections across restart and isolate every character's progress.
8. Preserve search and selection when navigating to an item or NPC and returning.
9. Verify keyboard controls, narrow-window layout, empty/error states, and real IPC in
   headless Electron. Run typecheck, lint, unit tests, and the affected Rust suites.

## Remaining data boundary

The installed client's `/outputfile` help does not list an active-task export. Historical
quests whose events were never logged and whose completion has no readable achievement
cannot be reconstructed from these inputs. NPC journal files, when enabled by the game,
record dialogue rather than an authoritative active/completed quest list. Complete
automatic coverage must be demonstrated per source; it is not implied by catalog size.
