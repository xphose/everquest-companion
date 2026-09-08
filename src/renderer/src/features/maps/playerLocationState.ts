import type { PlayerLocation, PlayerLocationResult } from '../../../../shared/playerLocation'

export const LOCATION_MAX_AGE_MS = 1500

/** A stalled request, character switch, or clock jump must never leave a live-looking dot. */
export function currentPlayerLocation(
  result: PlayerLocationResult,
  characterName: string | undefined,
  now: number
): PlayerLocation | null {
  if (result.state !== 'live') return null
  const location = result.location
  const age = now - location.sampledAt
  if (!Number.isFinite(age) || age < 0 || age > LOCATION_MAX_AGE_MS) return null
  if (characterName && location.characterName.toLowerCase() !== characterName.toLowerCase()) return null
  return location
}

export function locationOnMap(location: PlayerLocation | null, zone: string | undefined): PlayerLocation | null {
  return location?.zone === zone ? location : null
}
