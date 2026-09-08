# Utility spell preparation: supported client evidence

Character names in this document are anonymized as `Samplehero`.

Read-only analysis on 2026-09-08 of the installed EverQuest Legends client with
SHA-256 `f1c6ab2f07a5d08e62bb936061fd01049fa7b64ce8ddac50c57009162088a9f9`.
Addresses below are module-relative RVAs. No command was executed to establish
these findings, and no process memory was modified.

## Commands and timing

- `/memspellslot <gem> <spellID>` (`0x2525e0`) accepts a one-based gem in the
  command's 1–14 range and checks actual unlocked entitlement. Numeric IDs avoid
  the name form's case-insensitive first-prefix ambiguity. ID `0` forgets a gem.
- `/memspellset <index>` (`0x2523d0`) accepts indices 1–60 and supplies a whole
  fourteen-slot request to the native batch memorizer. A name argument instead
  resolves the first partial name in numeric order; generated buttons use indices.
- Memorization is asynchronous. Initialization (`0x5220d0`), update (`0x522440`),
  start (`0x523070`) and duration calculation (`0x301b00`) depend on character,
  spell and pending work. There is no verified constant delay after which casting
  is safe. Consecutive `/memspellslot` commands replace the pending batch; they
  are not a verified queue.
- `/autoinventory` (`0x252b50`) takes no arguments and attempts to place the item
  on the cursor in inventory. It can fail when inventory is full (string 5290).
  Holding an item can also block opening the spellbook (string 3345).

The workflow therefore separates **Load Prep**, individually pressed utility
buttons, and **Restore Combat**. Live gem observations establish readiness.
Cast/recovery pauses govern only the already-memorized utility cast and its
subsequent inventory action. A fizzle, interruption, missing reagent, inadequate
mana or full inventory can still require user action.

## Persistent spell sets

The normal loader (`0x2bf8c0`) and save paths (`0x2bf589`, `0x2c1754`) use the
active character LO INI's `[SpellLoadouts]` section:

```ini
[SpellLoadouts]
SpellLoadout1.inuse=1
SpellLoadout1.name=EQC Preparation
SpellLoadout1.slot1=211
SpellLoadout1.slot2=-1
```

Records are numbered 1–60 and slot fields 1–14. Complete managed records contain
all sixteen fields (`inuse`, `name`, fourteen slots); omitted example fields
above are illustrative only. `inuse` is saved as `1` or `0`. Names are limited to
23 ASCII bytes for restart-safe persistence: the loader passes capacity 24 to
the truncating copy helper (`0x5c1790`). A missing name defaults to `Unnamed`.

Crucially, **`-1` skips a slot; it does not empty it.** Missing slot values default
to `-1`. A return set cannot clear a utility spell from an originally empty gem.
Preparation consequently replaces only already-occupied unlocked gems, with
positive, owned, currently usable return spell IDs. Locked and untouched slots
are `-1` in the generated requests. This also avoids preliminary unmemorization
examining a positive entry before the later unlocked-slot check (`0x51fcf5`).
Duplicate spell IDs in a batch favor the later position and must not be generated.

Settings getters merge `defaults.ini` first, then the character INI (global
filename initialization `0x64b94`, string RVA `0x974958`; getters `0x5d6ea0`,
`0x5d6970`, `0x5d6de0`). Allocation must reserve indices defined in either source,
including partial or inactive personal records. Matching a name is not ownership.
The native UI may reuse an exact matching name, otherwise the first free record;
managed definitions need independent field ownership and conflict detection.
The native save skips records without the dirty flag (`0x2bf5d1`, `0x2c1765`)
and writes only `inuse` for an inactive record (`0x2bf600`–`0x2bf608`,
`0x2c179a`). It does not manufacture sixty canonical empty records. Inactive
records can retain old names and slot fields and are not automatically reclaimed.

The loader scans these fields directly; no additional registration or checksum
was found. INI data is cached, so file definitions are written while the client
is fully stopped and are loaded on its next launch. The real Samplehero settings
recorded a preparation installation at 2026-09-08 19:29:42 UTC. A subsequent
game screenshot showed all five buttons on Hotbar 3, page 1: Load Prep,
Make Supplies, Make Drink, Make Food, and Restore Combat. The current live gems
still matched the captured combat baseline. The agent did not press these
buttons; their native execution remains separate from the verified file and
visible-button installation.

## Spell selection evidence

Owned spells are joined to the installed `spells_us.txt` and filtered by the
current observed classes and level. Effect identities are checked against
[EQEmu's primary spell definitions](https://github.com/EQEmu/EQEmu/blob/master/common/spdat.h).
Item summoning uses effect 32 with an item ID and a self target; food and drink
are independent spell families. Utility selection does not treat a larger spell
ID as stronger, infer spell ownership from a class, or invent ability/AA IDs.

Temporary gem observations must not replace the saved combat baseline or cause
the normal combat macro updater to retire bindings. Restoring the baseline is a
separate operation from restoring an INI backup: the former is an in-game spell
set button, the latter reverses a companion file installation while EQ is closed.

## Verification

The integrated macro changes passed type checking, lint, 4,532 unit tests
(one additional test skipped), and both the existing macro and new preparation
end-to-end workflows. The preparation E2E exercises temporary/partial gems,
class invalidation, captured-baseline retention, queued versus written receipts,
atomic spell-set/social writes, personal/default record preservation, and an
exact backup restoration. A read-only live check used Samplehero's level 10,
SHM/MAG/ENC classes, 62 owned spells and 12 unlocked gems; its in-process
temporary layout and return matched exactly without changing game files.
