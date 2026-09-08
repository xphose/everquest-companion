import { isClassAbbr, MAX_COMBO_SLOTS, type ClassAbbr } from './classCombo'
import type { PlayerLocation, PlayerLocationResult } from './playerLocation'

export const LOCATION_MAX_AGE_MS = 1500

/** A stalled request, character switch, or clock jump cannot remain a current observation. */
export function currentPlayerLocation(
  result: PlayerLocationResult | undefined, characterName: string | undefined, now: number
): PlayerLocation | null {
  if (result?.state !== 'live') return null
  const location = result.location
  const age = now - location.sampledAt
  if (!Number.isFinite(age) || age < 0 || age > LOCATION_MAX_AGE_MS) return null
  if (characterName && location.characterName.toLowerCase() !== characterName.toLowerCase()) return null
  return location
}

/** Native classes describe the complete current selection. A partial or invalid list cannot
 * replace log inference, and a character must be selected before applying any class filter. */
export function currentPlayerClasses(
  result: PlayerLocationResult | undefined, characterName: string | undefined, now: number
): ClassAbbr[] | null {
  if (!characterName) return null
  const location = currentPlayerLocation(result, characterName, now)
  const classes = location && 'classes' in location ? location.classes : undefined
  if (!Array.isArray(classes) || classes.length < 2 || classes.length > MAX_COMBO_SLOTS ||
    !classes.every(isClassAbbr) || new Set(classes).size !== classes.length) return null
  return classes
}
