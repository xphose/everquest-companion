# Automatic quest completion

Tracking is a display preference. It must never determine whether the journal
recognizes a completed quest. Main journal and Adventure read the same evidence.

Named task completion messages retain their existing interpretation. For older
NPC hand-in quests, a closed trade alone does not establish success. Completion
requires a source-verified final NPC and exact item quantities, an experience
reward stated by the quest source, and experience observed within that trade.
If several quests match the same final requirements, the trade is ambiguous and
must not mark all of them complete. Item possession and prose mentions are not
completion evidence or machine-readable requirements.

The engine's optional `experienceAt` field records one solo experience event
after an offer and no more than five seconds before its matching trade closes.
Combat, competing transactions, party experience, session boundaries and invalid
timestamp order invalidate attribution. The offer itself may stay open while the
player reads. Trades without this evidence retain their previous representation.

The journal derives completion from these observations for every eligible quest,
including untracked quests and hand-ins replayed when the app starts. It does not
write an inferred result into the user's manual completion flags. Newer repeat
task activity, recovery evidence and explicit manual corrections retain their
existing precedence. Show the basis as a hand-in with experience, distinct from
an explicit named task-completion message.

The ordinary to-do filter excludes completed quests. Completed and explicit All
views remain available; an existing explicit All preference keeps its meaning.

The regression fixture uses the verified four-item Zulort hand-in sequence with
synthetic timestamps, public NPC/item names and the shared fixture scrubber.
Private log originals, character names and local paths remain outside Git.

## Source coverage

Do not promise a universal completion ledger. The official [Task System
documentation](https://www.everquest.com/news/imported-eq-enus-50720) describes
Quest History but warns that older quests may fall outside that system. The
[NPC journal](https://www.everquest.com/news/imported-eq-enus-50616) records
dialogue, which alone does not prove completion. Achievement evidence must identify
the specific quest; merely owning a reward is insufficient.

Reading client memory can expose history received by the client, not records that
remain only on a server or were never recorded. No complete Legends quest-history
API has been verified. This change replays available log evidence; it does not add
a memory-based history reader or a separate permanent completion archive. Missing
log evidence cannot be recovered without another independently verified source.
