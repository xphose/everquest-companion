import { createContext } from 'react'
import type { PlayerLocation } from '../../../../shared/playerLocation'
import type { ComboClasses } from '../../../../shared/levelUnlocks'
import type { StatedLevel } from './useStatedLevel'

/** Leveling's display-only override. Timestamped charts and other consumers keep their logged
 * profile; the caller supplies an identity-checked fresh native observation. */
export const LevelingCurrentClasses = createContext<ComboClasses | null>(null)

export function currentLevelingProfile(logged: StatedLevel, player: PlayerLocation | null): { level: StatedLevel; classes: ComboClasses | null } {
  const level = player?.level
  return {
    level: level === undefined ? logged : { level, cue: 'Live', title: 'Current level read from the active game character.' },
    classes: player?.classes ? { resolved: [...player.classes], candidates: [], ambiguous: false } : null
  }
}
