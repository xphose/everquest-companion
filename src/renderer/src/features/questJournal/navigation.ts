import type { QuestJournalLocation } from '../../../../shared/questJournal/catalog'
import type { MobLoc } from '../../../../shared/mobTypes'
import { zoneShortNameFromCatalog } from '../../../../shared/zones'
import { mapFromLoc } from '../maps/mapGeometry'
import type { MapFocus } from '../maps/mapFocus'
import type { MobTarget } from '../mobs/mobTarget'

export interface JournalNavigation {
  openLoot: (name: string) => void
  openMob: (target: MobTarget) => void
  openMap: (target: MapFocus) => void
}

export function journalMapFocus(location: QuestJournalLocation, at?: MobLoc): MapFocus | null {
  const zone = zoneShortNameFromCatalog(location.zone)
  if (!zone) return null
  // Map jumps are two-dimensional. Do not turn an absent source elevation into a floor claim.
  const point = at ? mapFromLoc({ ...at, z: at.z ?? 0 }) : null
  return { zone, at: point ? { x: point.x, y: point.y } : null, label: `${location.name} · ${location.zone ?? zone}` }
}

export function journalMobTarget(location: QuestJournalLocation): MobTarget {
  return {
    mob: location.name,
    ...(location.page ? { entry: {
      name: location.name, page: location.page, level: location.level,
      zones: location.zone ? [location.zone] : undefined, loc: location.loc
    } } : {})
  }
}

export function locationText(loc: MobLoc): string {
  return `${loc.ns}, ${loc.ew}${loc.z === undefined ? '' : `, ${loc.z}`}`
}
