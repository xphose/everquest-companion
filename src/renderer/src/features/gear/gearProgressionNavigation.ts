import type { GearAcquisition } from '@shared/gearAcquisition'
import { zoneShortNameFromCatalog } from '../../../../shared/zones'
import { mapFromLoc } from '../maps/mapGeometry'
import type { MapFocus } from '../maps/mapFocus'

/** A source can name a zone without a camp; never invent coordinates for that case. */
export function gearMapFocus(source: GearAcquisition | undefined): MapFocus | null {
  const zone = zoneShortNameFromCatalog(source?.zone)
  if (!source || !zone) return null
  const point = source.loc ? mapFromLoc({ ...source.loc, z: source.loc.z ?? 0 }) : null
  return { zone, at: point ? { x: point.x, y: point.y } : null,
    label: `${source.name} · ${source.zone ?? zone}`, source: 'gear' }
}
