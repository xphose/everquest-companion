# Native reader: September 8, 2026 client

This profile was independently verified on September 9 from the executable's PE
headers and instructions, followed by repeated read-only observations of the
current player's fields. No game functions are invoked. Personal observations,
paths, character identities, game files, and memory dumps are not repository data.

## Exact executable identity

| Fact | Value |
| --- | --- |
| SHA-256 | `412ca5fd0be010bde1dd4df19a2b0a7217fe4e957eeed8280e9ca4f980f8f74f` |
| File size | `15,534,712` bytes |
| PE machine / optional magic | `0x8664` / `0x20b` |
| PE timestamp / image size | `0x6a9f67b3` / `0x16c7000` |

The registry requires the exact size and full-file digest before opening player
memory, then checks the selected profile's mapped PE identity. Unknown builds and
a process whose image differs from its patched file remain unsupported. Every
read receives that selected immutable profile; selection is never global mutable
state. File replacement, path, size, or timestamp changes invalidate the cache.

## Verified changes

All addresses below are image-relative RVAs unless identified as member offsets.

| Field | RVA or offset |
| --- | --- |
| Player / world / character globals | `0xf0d360` / `0xf0ce50` / `0xf0d4b0` |
| Character / character-zone descriptors | `0x9a9968` / `0x9a9970` |
| Spell manager global | `0xf93118` |
| Player zone ID, DWORD member | `0x358` |
| Player level, byte member | `0x32c` |

The zone path at `0x3b6599` loads the player global; `0x3b65a0` reads its zone
member, and the world lookup at `0x6e6680` masks `0x7fff` and uses the zone table
at `0x30`. Repeated current-player observations agreed with the zone metadata.

The level update path validates the player identity, writes the selected
profile's DWORD level at `0x2768`, calls its level getter, loads the player
global at `0x20aa90`, and writes the returned byte to `player + 0x32c` at
`0x20aa97`. The profile parser independently identifies its `0x2768` field as
`level`. Repeated reads of both fields agreed. Production reads only the verified
player byte and accepts `1..125`; an invalid or unreadable byte omits level.

The existing position, heading, name, player type, zone table, selected class
profile, spellbook, gems, buff effects, and slot-entitlement layouts were checked
again for this image. Existing bounded reads and owner/profile/world coherence
guards remain in force. The older profile's values remain unchanged.

The entitlement path at `0xe9540` retains the special-profile check at `0x27fc`
and effect key `326`. Its cache and keyed-lookup helpers, the buff-window checks,
and the memorization gate were independently traced. The effect table at profile
`0xa0`, count at `0xa8`, record stride `0xa0`, spell ID at `0x6c`, and remaining
ticks at `0x78` agree with the effect loop at `0xf4d90`; the decrement is at
`0xf4fac`.

Two separate fresh observations through a bundle of the production native reader
returned coherent level, classes, spells, entitlement, and buffs. Their player
identity agreed while their sample timestamps advanced. Cooperative worker
shutdown completed successfully. The private observed values are not fixtures.

Synthetic fixtures exercise both builds, reject obsolete globals and plausible
old level/zone fields, cover interleaved selections and disk/mapped mismatch, and
verify that the selected layout reaches every dependent player surface. A future
patch requires its own verified profile; matching a filename or similar layout
does not establish support.
