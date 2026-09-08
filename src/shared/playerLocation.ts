import type { ClassAbbr } from './classCombo'
import type { PlayerActiveBuff } from './playerBuffs'
export type { PlayerActiveBuff } from './playerBuffs'

/** A fresh observation of the local player. Positions use the game's /loc axes. */
export interface PlayerLocation {
  characterName: string
  zone: string
  ns: number
  ew: number
  z: number
  /** EverQuest heading units, in [0, 512). */
  heading: number
  /** Current local-player level when the client exposes a valid observation. */
  level?: number
  /** Complete active class set, ordered by native class ID rather than loadout slot. */
  classes?: ClassAbbr[]
  /** Complete unique owned spellbook IDs; excludes disciplines and item effects. */
  spellbook?: number[]
  /** Eighteen native gem slots in order; null is empty capacity, not proof a slot is unlocked. */
  memorizedSpells?: (number | null)[]
  /** Verified unlocked gem indices, one-based and sorted. Empty unlocked gems remain usable;
   * omission means entitlement is unknown, independently of stored gem capacity/occupancy. */
  unlockedSpellSlots?: number[]
  /** Complete current self buffs/songs. [] is verified empty; omission means unavailable. */
  activeBuffs?: PlayerActiveBuff[]
  sampledAt: number
}

export type PlayerLocationResult =
  | { state: 'live'; location: PlayerLocation }
  | { state: 'not-running' | 'not-in-world' | 'unsupported' | 'unavailable' | 'ambiguous'; reason: string }
