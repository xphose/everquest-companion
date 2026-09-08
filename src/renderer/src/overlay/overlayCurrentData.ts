import type { PlayerLocation } from '../../../shared/playerLocation'
import { ZONES, zoneEntryFor } from '../../../shared/zones'

/** Native short names establish a base zone; only the matching logged zone can supply its tier. */
export function overlayCurrentZone(logZone: string, player: PlayerLocation | null): { zone: string; source: 'live' | 'log'; message: string } {
  const native = player ? ZONES.find((entry) => entry.short === player.zone) : undefined
  if (!native) return { zone: logZone, source: 'log', message: player ? 'Log zone · live zone name unavailable' : 'Log zone · live observation unavailable' }
  const sameBase = zoneEntryFor(logZone)?.short === native.short
  return { zone: sameBase ? logZone : native.name, source: 'live', message: sameBase && logZone !== native.name ? 'Live zone · tier from log' : 'Live zone' }
}
