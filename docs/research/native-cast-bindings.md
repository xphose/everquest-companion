# Native cast binding and projectile checks

For the supported client fingerprint recorded in [native-player-spells.md](native-player-spells.md), static reinspection confirmed:

- `/cast` handler RVA `0x24d410` subtracts one from numeric arguments and accepts indices 0–13. Both numeric and named paths call RVA `0x3b9440` with the same zero-based gem index. Normal casting reads the current profile's memorized entry at `0x23b0 + index * 8`; spellbook page position does not select the cast.
- Named lookup RVA `0x3b84a0` examines the first 14 gem controls and returns the first case-insensitive prefix match. It compares the whole supplied name, including internal spaces. Names are unquoted; the handler does not strip quotes.
- The social executor at RVA `0x103f13` recognizes `/pause`, parses its delay, finds the comma at `0x104030`, and dispatches the remainder through `0x293640`. That dispatcher removes leading whitespace and separates the command word while retaining the remaining argument text. Thus `/pause 45, /cast Example Ward` retains the full two-word spell name. No commands were executed for this check.

The authoritative [EQEmu target enum](https://github.com/EQEmu/EQEmu/blob/master/common/spdat.h) identifies target 1 (`ST_TargetOptional`) as targeted projectile spells. Its [target-type reference](https://github.com/EQEmu/eqemu-docs-v2/blob/main/docs/server/spells/target-types.md) labels type 1 Line of Sight and type 5 Single; area targets are separate values. The matching installed client's Flame Bolt row has target 1, negative CurrentHP effect 0, and zero duration. These facts support a direct-damage projectile recommendation; they do not establish a guaranteed hit, damage estimate, kill threshold, or automatic target choice.

Binding previews use current observed gems and verified unlocks. A personal social's numbered casts may change meaning after gems move even when its name stays the same. The audit reports that mismatch and leaves personal commands unchanged. No private game export, process dump, character identity, or local path is included here.
