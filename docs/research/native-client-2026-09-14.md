# Native reader: September 14, 2026 client

This build was independently inspected on September 15 using its PE headers and
executable instructions, then checked with bounded read-only observations of the
current player. No game function was called. Private paths, character identities,
game files, spell layouts, and memory dumps are not repository data.

## Exact executable identity

| Fact | Value |
| --- | --- |
| SHA-256 | `8016b33fdf7546139f749db5f6790f777589f7b1ac35e504afd6c92d4f82f62a` |
| File size | `15,535,224` bytes |
| PE machine / optional magic | `0x8664` / `0x20b` |
| PE timestamp / image size | `0x6aa86299` / `0x16c8000` |

The disk size and full SHA-256 select an immutable profile. Its mapped PE identity
must also match before player fields are read. An old process with a newly patched
file, or an unregistered future build, remains unsupported.

## Verified layout

All addresses below are image-relative RVAs unless described as member offsets.

| Field | RVA or offset |
| --- | --- |
| Player / world / character globals | `0xf0e360` / `0xf0de50` / `0xf0e4b0` |
| Character / character-zone descriptors | `0x9a9968` / `0x9a9970` |
| Spell manager global | `0xf94118` |
| Player zone ID, DWORD member | `0x204` |
| Player level, byte member | `0x214` |

The level update writes the selected profile's DWORD at `0x2768` at `0x20b89d`,
calls its level getter at `0x20b905`, loads the player global at `0x20b90b`, and
writes the returned byte to `player + 0x214` at `0x20b912`. Independent read-only
checks of both level fields agreed. The former `0x32c` and `0x4bc` fields are not
used for this build, even if they contain plausible numbers.

The map path at `0x3b5cd9` loads the player global and reads zone member `0x204`
at `0x3b5ce0`. It loads the world global and calls the zone lookup at `0x6e6700`,
which masks the ID with `0x7fff` and indexes the table at `0x30`. The inverse lookup
at `0x6e68a0` compares record short names at `0x10` and returns IDs at `0x0c`.
The native map path at `0x3b6250` retains position members `0x74/0x78/0x7c` and
heading `0x94`. Name comparison at `0x3287e2` uses `0xb8`; the effect path at
`0xf4f29` retains player type `0x139`.

The character constructor at `0x2f2f2b` and `0x2f2f36` references the descriptors
above and stores them at owner members `0x8` and `0x2818`. Their displacements
remain `0x2f68` and `0x758`. The selected-profile getter at `0x695e40` retains
manager current type `0x8`, list type `0x0`, first profile `0x8`, and next list
`0x18`. Active class eligibility at `0x5211bc` reads mask `0x2748`; class IDs
remain `1..16`. The serializer at `0x6d49a0` retains spellbook `0xb0`, count
`0x460`, and stride `0x8`; memorized gems begin at `0x23b0` at `0x6d4afa`.

The entitlement function at `0xe9560` retains the special-profile check `0x27fc`,
effect key `326`, and base eight slots. Helpers `0x107260`, `0x10b4f0`, and
`0x109fe0` retain the existing cache, readiness, bucket, contribution, and linked
node layouts. Memorization at `0x520d45` calls this entitlement function; its gem
array bound remains `0x12`. The character-zone member stays `0x2810`; its player
link at `0x10` is checked against the player global at `0xe9680`. The spell-manager
load at `0xe96ab` retains maximum spell ID at `0x64`.

The effect loop at `0xf4e02` retains profile effect header `0xa0`, count `0xa8`,
record stride `0xa0`, spell ID `0x6c`, and remaining ticks `0x78`. The decrement
is at `0xf4f5c`. Buff windows still select 62 regular and 30 short effects.
Existing bounds, repeated reads, and owner/profile/world coherence checks apply.

## Validation

Two fresh observations through the production sampler and Macros model returned
coherent classes, level, spellbook, memorized gems, unlocked slots, and buffs.
The installed client spell table resolved all observed owned spells, and the
Macros context supplied known, available, filled, and empty counts with generated
suggestions. Observations retained the same player identity with advancing sample
timestamps. These checks read game files and memory without changing settings.
The bundled native worker then passed two fresh observations through the normal
profile registry and completed cooperative shutdown with exit code zero.

Synthetic regression fixtures cover this build and both predecessors, including
misleading old level and zone values, changing levels and gems, exact fingerprint
selection, and disk/mapped-image mismatch. A new patch requires a new independent
audit; this profile does not authorize reusing offsets for unknown builds.
