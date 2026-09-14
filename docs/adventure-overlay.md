# Adventure overlay

An always-on-top Map and Quests workspace for players using one screen. It opens
from the app's Overlay menu and a configurable keyboard shortcut. Searching,
tracking a quest, reading its next step, and finding a quest location stay inside
this window.

## Interaction

- Map and Quests are tabs in one movable, resizable window. Keep navigation and
  the return to the quest within this workspace.
- Opening or showing the overlay never takes keyboard focus automatically.
  Clicking an unlocked search field is the user's request to type there.
- Pinning makes the content click-through. A reachable header control unlocks
  it again. Polls and game-presence changes must not change focusability.
- Remember the chosen bounds, open state, pin state, and appearance using the
  existing overlay configuration. Clamp remembered bounds to current displays.
- Offer a configurable show/hide shortcut, initially Ctrl+Shift+Space. Report a
  registration conflict and keep the menu available. Release old registrations
  when the shortcut changes or the app exits.
- Measure the smallest useful layout with its controls visible. This workspace
  has a larger minimum than a meter because search, a map, and quest details
  require more space. Other overlays retain their existing geometry rules.

## Map

Reuse the normal map's geometry, search, coordinate conversion, source credits,
live player marker, current-zone following, centering, and clickable zone labels.
The compact presentation must leave useful drawing space when search is open.
Search spans NPCs and locations from the existing installed-map and catalog data.

Live observations retain their executable-version, character-identity and freshness
checks. A stale location is withheld rather than presented as current. A deliberate
map pick or search target remains selected until the user returns to the current
zone or centers on the player. Do not infer unknown NPC positions or draw an
unverified walking route through the zone.

## Quests

Use the journal's existing query, detail, and mutation services. There is one
per-character progress store shared by the app and overlay. Tracked, active, and
search views provide access to quest details without opening the main window.

Show the recorded next action, objective progress, relevant locations, and rewards.
Keep observed progress distinct from explicit manual checkmarks, and allow manual
corrections to be undone. Missing guides, locations, or inventory observations
must be stated honestly. A source minimum level is not a promise of a safe fight.

Quest map buttons use the existing journal-to-map coordinate conversion. Known
coordinates focus the location; a zone-only record opens that zone with a clear
explanation. Neither action leaves the Adventure overlay.

Refresh from character and inventory notifications and a bounded periodic check.
Reject stale replies after a character switch, recover after a same-character
rebuild, and preserve selections and expanded details when facts are unchanged.

## Implementation boundaries

The `adventure` overlay uses a separate renderer entry with the normal app theme
and shared map components. Existing meters keep their lightweight, MUI-free entry.
A dedicated preload exposes only the map, journal, current-character, engine and
own-window operations this workspace needs; it does not load the full app bridge.

Use the existing overlay lifecycle, hardened web preferences, guarded focus policy,
presence behavior, bounds storage and notification delivery. Do not introduce game
input, memory writes, new data scraping, or a second journal completion model.

All fixtures are synthetic. Keep personal identifiers, raw exports, local paths,
diagnostics and screenshots outside tracked source and history.

## Verification

Exercise the actual separate window in an isolated Electron test: open and close,
pin and unlock, search, live zone and stale-position changes, shared quest tracking,
quest-to-map navigation, small-window layout, stable updates, and shortcut behavior.
Verify existing map/journal/overlay behavior where the integration changes it.
