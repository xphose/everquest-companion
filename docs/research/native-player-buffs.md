# Native current-player buff observations

Independently inspected on 2026-09-08. These are binary-layout facts for the
installed Windows x64 Legends client, not offsets adopted from a different EQ
client. No commands were executed, input sent, game files changed, or process
memory written. Research scripts and raw process data remain outside the repo.

Supported executable SHA-256:
`f1c6ab2f07a5d08e62bb936061fd01049fa7b64ce8ddac50c57009162088a9f9`.
The existing on-disk fingerprint and mapped PE identity checks precede all reads.
Addresses below are RVAs relative to the executable image base.

## Current effects, distinct from learned or memorized spells

The reader follows the already verified local-character owner and selected
profile chain. The profile serializer references the literal `m_Effects` at
`0x6d3232`, reads the count at profile `+0xa8`, and invokes the array accessor
`0xe7a30` with profile `+0x98`. That accessor uses the data pointer at container
`+8` and the count at `+0x10`, computing each element address as `index * 0xa0`.
The same layout is used by the current-effect accessor at `0xee8c0`, which
resolves the selected profile through `0x6948e0`.

The effect's signed spell ID is at record `+0x6c`. The native constructor at
`0xe7570` clears it to zero (`0xe75d2`). Active-effect consumers, including
`0xf4ded`, require ID `1..spellManager.maximumId`; they do not test ownership in
the spellbook or occupancy of a gem. The reader requires zero for an empty slot
and validates positive IDs against the stable native spell manager. Other
negative IDs cause the observation to be omitted.

The supported live player table has count and capacity both 93. The reader
requires that exact observed shape; it does not truncate another shape and
claim completeness. Only the first 92 records are sampled. The final record
belongs to neither of the two buff windows and is deliberately excluded.

## Regular and short-duration window boundaries

The window constructor selects `BuffWindow` or `ShortDurationBuffWindow` from
its kind argument and initializes maximum displayed counts 62 and 30 at
`0x3b07f6..0x3b0806`. It obtains native start/end indices using `0xee910` and
`0xeea10` at `0x3b10d3` and following calls. For the 93-record player profile:

- Regular window: start zero, inclusive end `count - 32`, hence indices 0..61.
- Short window: start `count - 31`, inclusive end `count - 2`, hence 62..91.

The returned contract labels these windows `buff` and `song`, with a one-based
slot within each window. The `song` label identifies the native short-duration
window; it does not assert that every such effect was cast by a bard. No target,
pet, group-member, or other entity's effect array is enumerated.

## Remaining duration and limits

The signed remaining tick count is record `+0x78`. In the active-effect loop
`0xf4d10`, the client resolves this same profile/array, reads spell ID `+0x6c`,
tests remaining ticks at `0xf4e47`, and decrements positive ticks at `0xf4f2c`.
The caller gates that tick operation on elapsed milliseconds greater than
`0x1770` (6000) at `0x1034b6`, before calling it at `0x1034f1`.

The buff-window update packet path separately converts nonnegative remaining
ticks to milliseconds using `imul ..., 0x1770` at `0x3b2e7a` and following
instructions. That UI additionally maintains a fraction-of-tick countdown.
The native reader exposes only `ticks * 6000`: a current coarse duration, not
the UI's more precise countdown. Consumers must not remove an observed effect
solely because its remaining duration is zero; the effect may await removal.
Native pause rules also exist, so this duration is an observation rather than
a promise that an effect expires after that much wall-clock time.

Negative sentinels are intentionally not classified as permanent. In particular,
`0xf4e50` treats `-1` in conjunction with the spell's duration formula at `+0x1c`
(value 50), and the effect serializer at `0x6e61f7` treats `-4` separately.
An active ID with a negative timer therefore remains present with its duration
omitted. The API makes no permanence claim. Nonnegative signed 32-bit ticks
convert exactly within JavaScript's safe integer range.

## Contract and consistency

`PlayerLocation.activeBuffs?: PlayerActiveBuff[]`, where each entry has
`spellId`, `slot`, `kind: 'buff' | 'song'`, and optional `remainingMs`.
`[]` means the complete supported table was read and contained no active IDs.
An omitted field means the table was unsupported, unreadable, or changing.
No entries are accumulated between samples.

Both complete raw passes must agree. The data pointer/count/capacity header and
spell-manager pointer/maximum ID must also agree. The enclosing observation
rechecks selected profile, owner, class mask, and player identity; a profile
transition cannot attach old buffs to a new character. An isolated failed buff
read leaves an independently valid position and class observation usable.

The additional work is bounded to 14 remote read calls and 29,496 bytes,
including the second pass. Each read is at most 4096 bytes; transient buffers
are not saved or returned. The unit test asserts this exact budget and exclusion
of the final native record.

## Verification

Literal-offset fixtures cover both window boundaries, effects absent from the
spellbook, known-empty versus unreadable, timer changes and sentinels, partial
reads, invalid IDs/headers/pointers, container relocation, spell-manager changes,
and owner/profile/class transitions. Protocol tests cover bounds, sparse arrays,
duplicate positions and invalid optional duration values.

A bundled production worker returned the current self effect ID 74089 in regular
slot 1. Joining that ID to the installed `spells_us.txt` identifies
`Summon Bristly Boar`. Its remaining native ticks decreased between read-only
samples. The game's visible buff icon showed `5h`, consistent with the sampled
remaining duration; the icon's name was not exposed in the screenshot and was
not independently verified through an in-game tooltip. The bundled cold/warm
samples took approximately 40 ms / 6 ms on this PC.
