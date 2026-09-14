import type { OverlayConfig, OverlayKind } from '../shared/types'
import { DEFAULT_TOAST_CONFIG } from '../shared/toast'
import { DEFAULT_ALERT_BANNER_CONFIG } from '../shared/alertBanner'
import { DEFAULT_CON_CARD_CONFIG } from '../shared/conCard'

/** Per-kind defaults. Sizes/positions live in overlayLayout.ts; `bounds` stays undefined here so
 *  a first open is placed by that layout and every later open uses what the user left. */
export const DEFAULT_OVERLAY_CONFIG: Record<OverlayKind, OverlayConfig> = {
  adventure: { open: false, locked: false, bgAlpha: 0.72, bounds: undefined, drill: null },
  fight: { open: false, locked: false, bgAlpha: 0.72, bounds: undefined, drill: null },
  overall: { open: false, locked: false, bgAlpha: 0.72, bounds: undefined, drill: null },
  events: { open: false, locked: false, bgAlpha: 0.72, bounds: undefined, drill: null },
  // The HEALING pair (Task #59). Same knobs as the damage meters.
  'heal-fight': { open: false, locked: false, bgAlpha: 0.72, bounds: undefined, drill: null },
  'heal-overall': { open: false, locked: false, bgAlpha: 0.72, bounds: undefined, drill: null },
  // The CELEBRATION TOAST (docs/plans/celebration-toasts.md). `locked: true` is the resting
  // state that makes it a notifier rather than a window: locked = click-through, and the
  // overlay flips capture on only while a card is actually on screen. Unlocking is how you
  // reposition it (Preferences → Overlays), exactly as with the meters.
  //
  // THE ONE KIND THAT DEFAULTS ON (owner, 2026-08-05: "it should be on by default"). Every
  // meter is a window you go and get when you want numbers; this one is a card that appears for
  // a few seconds when something worth cheering happens and is INVISIBLE and click-through the
  // rest of the time — so an install that never mentions it is better with it than without.
  // Stores written by the first toast build carry `open: false` from that default and are
  // corrected once, by migration 8→9 (storeMigrations.ts).
  toast: {
    open: true,
    locked: true,
    bgAlpha: 0.72,
    bounds: undefined,
    drill: null,
    toast: { ...DEFAULT_TOAST_CONFIG }
  },
  // The BUFF/TIMER bars (JOS-89, docs/plans/buff-timer-overlay.md).
  //
  // DEFAULT OFF, AND IT SHIPS WITH NO MIGRATION — that combination is the design, not an
  // omission. The owner's direction is to build it now and validate correctness internally
  // before promoting it, and a default only ever supplies the value for an ABSENT key:
  // `overlays.buffs` has never been written by any build, so every existing store reads
  // `open: false` here and every upgrading user gets it off for free. Adding a migration is
  // precisely the thing that would turn it ON — see migrateToV9, the one time this repo did
  // flip a stored default, whose comment says it is a one-time correction and never a policy
  // that the app may re-enable things.
  buffs: { open: false, locked: false, bgAlpha: 0.72, bounds: undefined, drill: null },
  // The DEBUFF/TIMER bars — the second half of the JOS-119 split.
  //
  // THE SPLIT NEEDS NO MIGRATION, AND THAT IS THE POINT. `overlays.buffs` KEEPS ITS KEY, so an
  // existing install's stored buffs window — its bounds, its open flag, its alpha, its text scale
  // — carries over byte for byte and lands on the window that still draws that user's buffs.
  // `overlays.debuffs` has never been written by any build, so every upgrading store reads the
  // default below and gets the new window OFF for free. A migration is precisely the thing that
  // could turn something on (see migrateToV9, the one time this repo flipped a stored default, and
  // its comment saying that was a one-time correction and never a policy), so there is none: the
  // schema version is untouched at 11 and a store written by this build round-trips through the
  // previous one unchanged.
  //
  // Its content moved rather than appeared: before this split the buffs window drew debuffs and
  // mez holds too. Nobody LOSES a row — the rows are in a window that ships off, which is the same
  // internal-validation stance JOS-89 shipped under and the owner's direction for this one.
  debuffs: { open: false, locked: false, bgAlpha: 0.72, bounds: undefined, drill: null },
  // The XP / PROGRESS read (JOS-195).
  //
  // DEFAULT OFF, NO MIGRATION — the third time this file has said it, and for the third time it is
  // the design rather than an omission. `overlays.xp` has never been written by any build, so every
  // existing store reads this default and every upgrading user gets the window off for free; a
  // migration is precisely the thing that could turn something on (migrateToV9 is the one time this
  // repo flipped a stored default, and its comment says that was a one-time correction and never a
  // policy). The schema version is untouched and a store written by this build round-trips through
  // the previous one unchanged.
  //
  // `xpRows`, `xpSlice` and `xpBasis` are ABSENT here on purpose rather than spelled out: absent is
  // what each one's default MEANS (every row; the current zone this session — JOS-288 moved that
  // from `session`; the elapsed hour), those meanings live beside the code that reads them, and
  // writing them here would be a second copy of all three.
  xp: { open: false, locked: false, bgAlpha: 0.72, bounds: undefined, drill: null },
  // RESPAWN CLOCKS (JOS-194). Default off, no migration — the fourth restatement of the same
  // policy, and the argument above holds verbatim: `overlays.respawn` has never been written by
  // any build, so every existing store reads this default and gets the window off for free.
  respawn: { open: false, locked: false, bgAlpha: 0.72, bounds: undefined, drill: null },
  // THE ALERT BANNER (JOS-378). `locked: true` is the resting state that makes it a notifier
  // rather than a window — the celebration toast's arrangement, and for the same reason: locked
  // is click-through, and the overlay flips capture on only while a line is actually on screen.
  //
  // DEFAULT OFF, NO MIGRATION — the fifth restatement of the policy above, and this time it is an
  // explicit owner ruling (2026-08-15) rather than an inference: the overlay does not ship
  // enabled, it lives in Preferences → Overlays beside the other kinds, and the user turns it on.
  // `overlays.alertBanner` has never been written by any build, so every existing store reads this
  // default and gets the window off for free. A migration is precisely the thing that could turn
  // something on (migrateToV9 is the one time this repo flipped a stored default, and its comment
  // says that was a one-time correction and never a policy), so there is none.
  // prettier-ignore
  alertBanner: { open: false, locked: true, bgAlpha: 0.72, bounds: undefined, drill: null, alertBanner: { ...DEFAULT_ALERT_BANNER_CONFIG } },
  // THE CON CARD (JOS-383). `locked: true` for the banner's reason: locked is click-through, and
  // the overlay flips capture on only while a card is actually on screen.
  //
  // DEFAULT **ON**, AND STILL NO MIGRATION — which is why this entry breaks the run of five above
  // rather than continuing it. The policy those restatements defend is "a migration never turns
  // something on"; a DEFAULT decides the value of an ABSENT key, and `overlays.conCard` has never
  // been written by any build, so every store on earth reads this line and gets the card. Nothing
  // is rewritten, nothing stored is reinterpreted, and a user who switches it off writes a `false`
  // no future step is allowed to overrule (the 8 -> 9 step's promise, kept). The owner's ruling
  // (2026-08-16) is that this one ships on: it answers a question the player just asked by typing
  // `/con`, which is exactly what the alert banner's "text over the game nobody asked for" is not.
  // prettier-ignore
  conCard: { open: true, locked: true, bgAlpha: 0.72, bounds: undefined, drill: null, conCard: { ...DEFAULT_CON_CARD_CONFIG } }
}

