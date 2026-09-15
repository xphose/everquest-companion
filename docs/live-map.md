# Live map navigation

Open **Maps** while EverQuest Legends is running. **Live location** is on by
default and shows your character as a green **You** dot. Position refreshes four
times per second while the tab is open. The reader discovers the game in the
installation selected in Preferences.

The map follows your current zone automatically. Picking a different map pins it;
**Current zone** resumes automatic zone selection. **Center on me** also enables
**Keep centered**. Dragging the map or fitting the whole zone releases centering
so you can browse. Live coordinates are not saved between sessions. The blue
`/loc` crosshair is a separate saved marker.

Only a fresh position belonging to the selected character and displayed map is
drawn. If the game closes, access fails, or a reading stops arriving, the live dot
disappears. Status appears beside **Live location**. Log-based zone selection and
manual map browsing remain available. Turn off **Live location** to stop polling;
this choice survives tab changes and restarts.

## Compatibility and implementation

The reader supports verified September 2, September 8, and September 14, 2026
x64 clients. Each build requires its exact file size, SHA-256, and mapped PE
identity. See the [September 8 profile](research/native-client-2026-09-08.md) and
[September 14 profile](research/native-client-2026-09-14.md) for identities and
verification. An unknown executable needs a newly verified compatibility profile.
Old offsets are never applied to a different version. This shared reader also
supplies current classes, level, spells, spell slots, and buffs to the app; an
unsupported game patch can therefore leave Macros information unknown.

The reader uses Windows query and read permissions only. It reads the local player
and that player's zone entry, without enumerating other players or NPCs. A worker
keeps process discovery and executable hashing outside Electron's main thread.
No arbitrary address, process, or file-path interface is exposed to the renderer.

The profile's factual offsets and executable identity were cross-checked against
[Plazmic Legends' September 2 client research](https://github.com/ChrisTitusTech/plazmic-legends/blob/main/docs/research/legends-2026-09-02-profile.md).
The Windows reader is independently implemented using this app's existing Koffi
dependency. Local read-only probes on September 8 matched the installed executable,
the logged character and zone, and changed coordinates after the user moved.

The tests cover coordinate orientation, stale and mismatched samples, zone
following, pinned maps, read failures, and the native reader's validation rules.
No private game log or memory dump is included in the repository.
