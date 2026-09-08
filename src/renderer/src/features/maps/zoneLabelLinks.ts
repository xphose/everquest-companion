import type { ZoneShort } from '../../../../shared/maps'
import { ZONES, type ZoneEntry } from '../../../../shared/zones'

export interface ZoneLabelTarget { zone: ZoneShort; name: string }

// Exact catalog spellings only. Do not strip arbitrary suffixes or fuzzy-match POI text.
function key(text: string): string {
  return text.replace(/_/g, ' ').toLowerCase().replace(/[\s-]+/g, ' ').trim().replace(/^the /, '')
}

/** Resolve whole exit labels and bare zone names; ambiguity is checked before availability. */
export function zoneLabelResolver(available: readonly ZoneShort[], current: ZoneShort, catalog: readonly ZoneEntry[] = ZONES) {
  const entries = new Map<string, Map<ZoneShort, ZoneLabelTarget>>()
  const add = (name: string, target: ZoneLabelTarget) => {
    const folded = key(name)
    const matches = entries.get(folded) ?? new Map<ZoneShort, ZoneLabelTarget>()
    matches.set(target.zone, target)
    entries.set(folded, matches)
  }
  for (const entry of catalog) {
    for (const name of [entry.short, entry.name, ...(entry.aliases ?? []), ...(entry.mobCatalogNames ?? [])]) {
      add(name, { zone: entry.short, name: entry.name })
    }
  }
  for (const zone of available) add(zone, { zone, name: catalog.find(entry => entry.short === zone)?.name ?? zone })
  const installed = new Set(available)
  return (label: string): ZoneLabelTarget | null => {
    const name = label.replace(/_/g, ' ').trim().replace(/^to\s+/i, '')
    const matches = entries.get(key(name))
    if (matches?.size !== 1) return null
    const target = [...matches.values()][0]
    return target.zone !== current && installed.has(target.zone) ? target : null
  }
}
