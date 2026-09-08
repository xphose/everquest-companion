import type { PlayerLocation } from '../../../../shared/playerLocation'
export { currentPlayerLocation, LOCATION_MAX_AGE_MS } from '../../../../shared/currentPlayer'

export function locationOnMap(location: PlayerLocation | null, zone: string | undefined): PlayerLocation | null {
  return location?.zone === zone ? location : null
}
