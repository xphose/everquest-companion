# Current spellbook and memorized gems

Verified on 2026-09-08 for the existing supported client SHA256
`f1c6ab2f07a5d08e62bb936061fd01049fa7b64ce8ddac50c57009162088a9f9`.
The disk fingerprint, mapped PE identity and current character-profile guards all apply.

`PlayerLocation.spellbook?: number[]` is the complete unique set of owned spellbook IDs,
in book order. It excludes disciplines and item effects. `memorizedSpells?: (number | null)[]`
contains eighteen native capacity slots without removing holes. Null means empty capacity;
it does not establish that the slot is unlocked or usable. Unknown observations omit both
fields. A verified empty book is an empty array. No loadout number or live recast state is
claimed by this reader.

## Independently verified layout

The spellbook export path at RVA `0x520b91` resolves the current profile through the existing
accessor and visits exactly `0x460` entries, beginning at profile + `0xb0` with an eight-byte
stride. The first signed DWORD is the spell ID. The profile serializer labels the same array
as spellbook entries and walks all 1,120 records at RVA `0x6d3390`.

The serializer's memorized section begins at RVA `0x6d34d8`, reads profile + `0x23b0` through
`0x2438` at the same eight-byte stride, and emits exactly `0x12` entries. The gem assignment
path at RVA `0x520e1b` independently bounds its slot index to eighteen and addresses the same
array. Empty entries are initialized with spell ID -1 and companion metadata 1. The reader
does not interpret the metadata, but compares it during coherence checks.

The spellbook export helper at RVA `0x51f2c1` rejects IDs below 1 and above the current spell
manager's maximum ID. That manager is rooted at image RVA `0xf92118`; its maximum signed ID
is at +`0x64`. The reader uses that exact bound rather than inventing a spell-ID ceiling.

Two bounded probes and two samples from the bundled production worker agreed on a complete
book and memorized slots, with every occupied gem represented in the owned book. There are
no game binaries, memory dumps, disassembly, player identifiers or spell selections in this
document or its fixtures.

## Coherence and bounds

Each book pass reads 4,096, 4,096 and 768 bytes. Each gem pass reads 144 bytes. Two complete
raw passes must agree; partial, corrupt, mismatched or changing arrays are omitted together.
The spell-manager pointer and maximum ID must also agree. The surrounding active-profile
reader rereads the selected profile and class mask after the spell read, preventing a new
spell selection from being published with old active classes. Existing local-player identity
and zone checks still gate the complete frame. Spell failures preserve valid classes, level
and map position.

## `/cast` syntax established without executing it

The command table associates `/cast` with RVA `0x24d410`. Numeric arguments are converted
to zero-based indices and bounded to slots 1 through 14. Non-digit arguments are passed
intact to the name lookup at RVA `0x3b84a0`, which scans the first fourteen gem controls.
Therefore names containing spaces are supported. The eighteen-slot profile capacity is not
the same as this command's fourteen-slot bound.

The name lookup strips the displayed gem-number prefix, then compares the provided argument
using a case-insensitive prefix comparison for the argument's full length. The first match
wins. A full spell name can still be ambiguous when another memorized spell name starts with
it. A compiler using names must check that ambiguity against occupied slots 1 through 14.
Use unquoted full names; quoted-name handling was not established, and these handlers do not
strip quotes themselves. No game input or cast was executed during this verification.

## `/target` self-targeting uses the actual player name

The same executable's `/target` command table entry at RVA `0xdc1220` points to handler
`0x24df10`. Its only special argument branch compares the localized string numbered 6632,
which the installed `eqstr_us.txt` defines as `Group`, then parses a group slot number. Its
usage string, numbered 13267, documents a name or a numbered group member.

Otherwise the handler tokenizes the argument and passes it to name lookup `0x332c30`.
That function first calls exact-name hash lookup `0x327940`, whose equality check reads the
entity name at +`0xb8`; a later fallback searches name prefixes. There is no `myself` keyword
branch. The string `Target myself` in the client string table is a key-binding label, not a
`/target` argument. Therefore self-targeting macro steps must use the validated full local
player name from the fresh observation. Missing or unsafe names cannot produce a ready
self-targeting sequence. This verification read only static client code and strings; it did
not execute a targeting command or enumerate live entities.
