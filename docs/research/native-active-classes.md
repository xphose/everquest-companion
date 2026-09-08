# Current active classes from the supported Legends client

Verified on 2026-09-08 for SHA256
`f1c6ab2f07a5d08e62bb936061fd01049fa7b64ce8ddac50c57009162088a9f9`.
The existing disk fingerprint and mapped PE identity guards apply before this reader runs.

The earlier log-based inference missed a third active class that the game displayed. The new
optional `PlayerLocation.classes` reports the complete current set, in native class-ID order.
The array does not describe primary/secondary/tertiary slot ordering. Missing data remains
unknown; it never means an empty selection.

## Evidence for the layout

The independently inspected client's spell eligibility path at RVA `0x520106` resolves the
current character profile via the accessor at RVA `0x6948e0`, then passes its DWORD at offset
`0x2748` into the class-sensitive spell formatter at RVA `0x1faf70`. That formatter tests bits
1 through 16 against the spell's class requirements. The caller uses an active-class eligibility
failure message when the result is empty. The separate class membership getter at RVA
`0x6d4bb0` tests a class-ID bit in the same profile field. This establishes the field's active
meaning independently of the observed byte value; it is not a class-level history table.

The current-profile accessor follows the manager's list and selects the node whose type equals
the manager's current type, then returns that node's first profile. The reader mirrors only
those factual pointer relationships, with a maximum of eight visited list nodes and cycle
detection. Saved profiles that do not match the active type are not read for class data.

| Value | Verified layout |
| --- | --- |
| Local character owner | Image RVA `0xf0c4b0` |
| Owner's virtual-base descriptor pointer | Owner + `0x08` |
| Exact descriptor for this client owner | Image RVA `0x9a8968` |
| Descriptor displacement | Signed DWORD at +`0x04`, expected `0x2f68` |
| Profile manager | Owner + `0x10` + displacement |
| Manager list head / active type | Pointer at +`0x00` / DWORD at +`0x08` |
| List node type / first profile / next node | DWORD +`0x00` / pointer +`0x08` / pointer +`0x18` |
| Active class mask | Profile DWORD +`0x2748`; bit zero unused |

The class-name table at image RVA `0xc7ded0` independently confirms IDs 1 through 16 as
WAR, CLR, PAL, RNG, SHD, DRU, MNK, BRD, ROG, SHM, NEC, WIZ, MAG, ENC, BST, BER.
Two read-only live observations resolved the same three active classes shown in the game UI.
No private dump, executable bytes, disassembly, player identity or screenshot is committed.

## Read limits and failure behavior

All reads use the existing read-only process handle, after executable selection. No game
function is invoked, no game input is generated, and there is no entity enumeration. The owner
layout, active type, list head, selected node, profile pointer and mask must agree across two
complete reads. The character owner root is checked again before returning, and the surrounding
player sample retains its own name, type, player-pointer and zone coherence checks.

The mask must contain exactly two or three known class bits. An unsupported descriptor,
invalid mask, missing profile, partial read or concurrent change omits `classes` while a valid
position and level can still be returned. The mask is observed afresh each time, so switching
or removing a class cannot accumulate stale selections.

The fixed profile roots and existing current-profile structure were cross-checked with the
[public September client profile research](https://github.com/ChrisTitusTech/plazmic-legends/blob/main/docs/research/legends-2026-09-02-profile.md).
The active-mask offset and its semantic use were independently established from the installed
matching executable. A client patch requires new verification; offsets are never scanned or
guessed at runtime.
