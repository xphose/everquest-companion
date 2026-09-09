import { currentPlayerLocation } from './currentPlayer'
import type { PlayerLocationResult } from './playerLocation'

export interface GameConnectionStatus {
  state: 'checking' | 'closed' | 'waiting' | 'connected' | 'other-character' | 'unsupported' | 'ambiguous' | 'unknown'
  label: string
  detail: string
  tone: 'neutral' | 'success' | 'warning'
}

export const CHECKING_GAME: GameConnectionStatus = {
  state: 'checking', label: 'Checking game', detail: 'Checking whether EverQuest is running.', tone: 'neutral'
}
export const GAME_DEPENDENCIES = 'Live position, classes, level, buffs and spell-aware macros need a character in the world. Offline browsing stays available. Macro file installation waits until EverQuest fully exits.'

/** A display-only projection, never authority for writing game files or enabling live actions. */
export function gameConnection(result: PlayerLocationResult | undefined, characterName: string | undefined, now: number): GameConnectionStatus {
  if (!result) return CHECKING_GAME
  if (result.state === 'live') {
    if (!currentPlayerLocation(result, undefined, now)) return {
      state: 'unknown', label: 'Game status unknown', detail: 'The live observation has expired. Checking again.', tone: 'warning'
    }
    if (!currentPlayerLocation(result, characterName, now)) return {
      state: 'other-character', label: 'Other character in game', detail: 'EverQuest is running with a different character. Select that character to use live features.', tone: 'warning'
    }
    return { state: 'connected', label: 'In game', detail: 'EverQuest is running and your character is in the world.', tone: 'success' }
  }
  switch (result.state) {
    case 'not-running': return { state: 'closed', label: 'Game closed', detail: 'EverQuest is not running. Open it and enter the world for live features.', tone: 'neutral' }
    case 'not-in-world': return { state: 'waiting', label: 'Game running', detail: 'Enter the world or finish zoning to resume live features.', tone: 'neutral' }
    // The same state also covers an unsupported OS before any process can be observed.
    case 'unsupported': return { state: 'unsupported', label: 'Live read unsupported', detail: result.reason, tone: 'warning' }
    case 'ambiguous': return { state: 'ambiguous', label: 'Multiple games found', detail: result.reason, tone: 'warning' }
    case 'unavailable': return { state: 'unknown', label: 'Game status unknown', detail: `${result.reason} Checking again automatically.`, tone: 'warning' }
  }
}
