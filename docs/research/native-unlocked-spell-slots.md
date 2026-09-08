# Current unlocked spell slots

Verified read-only on 2026-09-08 against the existing supported executable SHA256
`f1c6ab2f07a5d08e62bb936061fd01049fa7b64ce8ddac50c57009162088a9f9`.
All existing disk fingerprint, mapped image, local-player and active-profile guards apply.
These facts were established from the installed executable's command, UI and memorization
paths, then checked using bounded local-player memory reads. No game command was executed.

`PlayerLocation.unlockedSpellSlots?: number[]` contains sorted, unique, one-based native gem
indices, bounded to 1–18. Omission means entitlement could not be verified. The protocol can
represent an empty set and future noncontiguous masks; this particular client's ordinary
profile check proves a contiguous set with at least eight slots. This field is independent
of `memorizedSpells`: an unlocked slot may be empty, and stored gem capacity may include a
spell in a locked slot. Consumers must separately respect the verified `/cast` limit of 14.

## Evidence that this is entitlement

The native function at RVA `0x0e9520` takes the character-zone object and a zero-based gem
index. For an ordinary active profile, it adds the three cached contributions for effect
326, subtype 0. It permits indices below eight; for later indices it requires
`index - 8 < additionalSlots`. This establishes contiguous unlocks directly, without any
class, level, occupied-gem or array-capacity inference.

The cast-window refresh routine beginning at RVA `0x3bb380` calls that function at
`0x3bb519` to show or hide each gem control and its holder. Occupancy and recast checks
are separate. The gem tooltip path also calls it at `0x3bbc7a`. The spellbook memorization
routine beginning at `0x51fc80` calls it at `0x51fcf5`, skipping a disallowed gem before
memorization. These callers establish that the result gates usable gem slots.

## Verified object and cache layout

The character-zone object is the existing character owner plus `0x2810`. Its descriptor
at +8 must equal image RVA `0x9a8970`, with signed displacement `0x758` at descriptor +4.
Consequently its profile manager at +`0x10 + 0x758` is the same owner +`0x2f78` manager
already validated by the active-profile reader. The zone object's pointer at +`0x10` must
also equal the current local-player root. The active profile's DWORD at +`0x27fc` must be
zero. The client has permissive missing/special-profile fallback branches; the reader
reports unknown for those branches, preserving independently valid map/classes/spells.

The effect-cache object is character-zone +`0x1a0`. Its readiness bytes at +8 and +`0x38`
must both be exactly 1. Native helpers `0x109780` and `0x106a00` respectively refresh their
cache when it is not ready; the companion never calls these functions or refreshes it.
The three lookup paths are `0x106a00`, `0x10ac90` and `0x109780`.

The item-effect table pointer is cache +`0x30`; the other-effect table pointer is cache +0.
Each table has a bucket-array pointer at +0 and a DWORD bucket count at +8. Only bucket
`326 % bucketCount` is visited. Item nodes have effect ID +0, subtype +8, signed 64-bit
contribution +`0x10`, and next pointer +`0x18`. Other nodes have the same compound key,
signed contributions at +`0x10` and +`0x18`, and next pointer +`0x28`.

Native keyed lookups `0x6812e0`/`0x681350` and `0x681550` return zero for a null table or
an absent compound key. They stop at the first exact key: collisions and other subtypes
continue through the chain, while later duplicate keys are unreachable and not summed.
The reader follows those semantics. It rejects invalid pointers, partial reads, bucket
counts outside 1–4,096, cycles and paths exceeding 32 nodes per lookup. The combined
signed contribution must lie between 0 and 10, keeping the result within native capacity.

## Coherence, read budget and live check

Every raw entitlement byte actually read is captured privately and reread after the
spellbook/gem sample. This includes both readiness flags, table headers, selected bucket
pointers, visited nodes, descriptor, special-profile state and local-player identity.
A change omits only entitlement. The final owner/profile/class check runs after this
verification, so a profile swap cannot mix old entitlement with a new profile. No full
effect table or other entity is scanned.

The measured ordinary cache shape (one matching item node, empty other bucket) uses
28 memory reads totaling 244 bytes, including the complete consistency reread. At the
allowed worst case of 32 nodes in both selected buckets, the bound is 154 reads totaling
5,300 bytes. No individual entitlement read exceeds 48 bytes. Unit tests pin both budgets.

Two independent live probes found ready caches, an ordinary profile and four additional
slots from the item cache, with zero from the other cache. Two subsequent samples through
the bundled production worker both returned exactly slots 1–12. The first complete worker
reply took 39 ms including startup; the second took another 6 ms. These are local observed
timings, not a latency guarantee. Synthetic fixtures contain no game binaries, memory dumps,
player identifiers or private spell selections.
