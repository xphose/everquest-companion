import type { ClassAbbr } from './classCombo'

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
  sampledAt: number
}

export type PlayerLocationResult =
  | { state: 'live'; location: PlayerLocation }
  | { state: 'not-running' | 'not-in-world' | 'unsupported' | 'unavailable' | 'ambiguous'; reason: string }
