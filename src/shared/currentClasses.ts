import { isClassAbbr, type ClassAbbr, type ComboInterval } from './classCombo'
import { currentPlayerClasses, currentPlayerLocation } from './currentPlayer'
import { comboClassesOf, type ComboClasses } from './levelUnlocks'
import type { PlayerLocation } from './playerLocation'

/** Current native facts never replace timestamped log intervals or user corrections to history. */
export interface CurrentClassFacts {
  classKey: string
  level?: number
}

export interface CurrentClasses {
  classes: ClassAbbr[]
  combo: ComboClasses
  source: 'live' | 'log'
  logged: ComboInterval | null
  liveLevel?: number
}

/** The same identity-checked observation supplies classes and level. Native class ordering is
 * an active set, not evidence of primary/secondary slots, so normalize it for stable displays. */
export function currentClassFacts(
  player: PlayerLocation | null, characterName: string | undefined, now: number
): CurrentClassFacts {
  const result = player ? { state: 'live' as const, location: player } : undefined
  const current = characterName ? currentPlayerLocation(result, characterName, now) : null
  const classes = currentPlayerClasses(result, characterName, now)
  const level = current?.level
  return {
    classKey: classes ? [...classes].sort().join('/') : '',
    level: level !== undefined && Number.isInteger(level) && level >= 1 && level <= 125 ? level : undefined
  }
}

/** Preserve log ambiguity and provenance verbatim when a complete native set is unavailable. */
export function currentClassesOf(logged: ComboInterval | null, facts: CurrentClassFacts): CurrentClasses {
  const combo = facts.classKey
    ? { resolved: facts.classKey.split('/').filter(isClassAbbr), candidates: [], ambiguous: false }
    : comboClassesOf(logged)
  return {
    classes: combo.resolved, combo, source: facts.classKey ? 'live' : 'log',
    logged, liveLevel: facts.level
  }
}
