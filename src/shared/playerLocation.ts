/** A fresh observation of the local player. Positions use the game's /loc axes. */
export interface PlayerLocation {
  characterName: string
  zone: string
  ns: number
  ew: number
  z: number
  /** EverQuest heading units, in [0, 512). */
  heading: number
  sampledAt: number
}

export type PlayerLocationResult =
  | { state: 'live'; location: PlayerLocation }
  | { state: 'not-running' | 'not-in-world' | 'unsupported' | 'unavailable' | 'ambiguous'; reason: string }
