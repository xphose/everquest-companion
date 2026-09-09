// Acquisition evidence is catalog knowledge, not a promise of availability or solo safety.
import type { ClassAbbr } from './classCombo'
import { itemBaseName } from './itemStats'
import type { MobLoc } from './mobTypes'
import type { GearRow } from './planner/gear'
import { zoneKey, zoneShortNameFromCatalog } from './zones'

export interface GearAcquisition {
  id: string
  kind: 'drop' | 'quest'
  name: string
  page?: string
  zone?: string
  loc?: MobLoc
  /** NPC level for drops; explicit minimum to begin for quests. Neither is equip level. */
  minLevel?: number
  maxLevel?: number
  /** Absent means unknown or unrestricted; unresolved wording stays in requirements. */
  classes?: ClassAbbr[]
  requirements: string[]
  evidence: 'catalog'
}

/** Structural counterpart of the existing singleton item-source index. */
export interface GearDropSource {
  mob: string
  mobPage?: string
  levelText?: string
  zones: string[]
  loc?: MobLoc[]
}

export type GearAcquisitionIndex = ReadonlyMap<string, readonly GearAcquisition[]>
export type GearAcquisitionEffort = 'easier' | 'near-level' | 'harder' | 'unknown'

/** Same suffix/case boundary as itemKey and the shared item-source singleton. */
export function gearAcquisitionItemKey(name: string): string {
  return itemBaseName(name).toLowerCase()
}

/** Read only a whole numeric level or interval. Prose, lists and reversed ranges stay unknown. */
export function parseAcquisitionLevels(text?: string): { minLevel?: number; maxLevel?: number } {
  const match = /^(\d+)\s*(?:[-–—]\s*(\d+))?$/.exec(text?.trim() ?? '')
  if (!match) return {}
  const minLevel = Number(match[1])
  const maxLevel = Number(match[2] ?? match[1])
  if (!Number.isSafeInteger(minLevel) || !Number.isSafeInteger(maxLevel)) return {}
  return minLevel > 0 && maxLevel >= minLevel ? { minLevel, maxLevel } : {}
}

/** A conservative NPC-level comparison, not a con-color formula or a clear-time estimate. */
export function acquisitionEffort(source: GearAcquisition, level: number): GearAcquisitionEffort {
  if (source.kind === 'quest' || !Number.isFinite(level) || level < 1) return 'unknown'
  if (source.maxLevel === undefined || !Number.isSafeInteger(source.maxLevel) || source.maxLevel < 1) return 'unknown'
  if (source.maxLevel <= level - 5) return 'easier'
  return source.maxLevel > level ? 'harder' : 'near-level'
}

/** Drops can be pursued above your level. Quest gates use only explicit, readable eligibility. */
export function acquisitionAvailable(
  source: GearAcquisition,
  classes: readonly ClassAbbr[],
  level: number
): boolean {
  if (source.kind !== 'quest') return true
  if (source.minLevel !== undefined && (!Number.isFinite(level) || level < source.minLevel)) return false
  return source.classes === undefined || source.classes.some((cls) => classes.includes(cls))
}

/** Identity includes the zone and pin so separate camps never collapse into a single location. */
export function acquisitionId(kind: GearAcquisition['kind'], name: string, zone = '', loc?: MobLoc): string {
  const coordinate = loc ? `${loc.ns},${loc.ew},${loc.z ?? ''}` : ''
  return [kind, name.trim().toLowerCase(), acquisitionZoneKey(zone), coordinate].join('|')
}

function acquisitionZoneKey(zone: string): string {
  return zoneShortNameFromCatalog(zone) ?? zoneKey(zone)
}

export function mergeGearAcquisitions(...lists: (readonly GearAcquisition[])[]): GearAcquisition[] {
  const out = new Map<string, GearAcquisition>()
  for (const list of lists) {
    for (const source of list) if (!out.has(source.id)) out.set(source.id, source)
  }
  return [...out.values()]
}

function dropAt(source: GearDropSource, zone?: string, loc?: MobLoc): GearAcquisition {
  const requirements: string[] = []
  if (source.levelText && parseAcquisitionLevels(source.levelText).minLevel === undefined) {
    requirements.push(`NPC level is unclear: ${source.levelText}`)
  }
  if (source.zones.length > 1 && source.loc?.length) {
    requirements.push('Spawn coordinates are not tied to a specific zone in the catalog.')
  }
  return {
    id: acquisitionId('drop', source.mobPage ?? source.mob, zone, loc),
    kind: 'drop', name: source.mob, page: source.mobPage, zone, loc,
    ...parseAcquisitionLevels(source.levelText), requirements, evidence: 'catalog'
  }
}

function dropAcquisitions(source: GearDropSource): GearAcquisition[] {
  const zones = [...new Set(source.zones)]
  if (zones.length === 1 && source.loc?.length) return source.loc.map((loc) => dropAt(source, zones[0], loc))
  return zones.length ? zones.map((zone) => dropAt(source, zone)) : [dropAt(source)]
}

function itemDrops(row: GearRow, sources: readonly GearDropSource[]): GearAcquisition[] {
  const drops = sources.flatMap(dropAcquisitions)
  // A matched NPC only owns its stated zones; a page may supply a missing acquisition edge.
  for (const wiki of row.wikiSources ?? []) {
    if (!wiki.mob.trim() || wikiSourceCovered(wiki, sources)) continue
    drops.push(dropAt({ mob: wiki.mob, zones: wiki.zone ? [wiki.zone] : [] }, wiki.zone))
  }
  return drops
}

function wikiSourceCovered(wiki: { mob: string; zone?: string }, sources: readonly GearDropSource[]): boolean {
  const matches = sources.filter((source) => source.mob.trim().toLowerCase() === wiki.mob.trim().toLowerCase())
  if (wiki.zone === undefined) return matches.length > 0
  const zone = acquisitionZoneKey(wiki.zone)
  return matches.some((source) => source.zones.some((name) => acquisitionZoneKey(name) === zone))
}

/** Joins existing inversions; never scans the mob loot graph again. Missing sources stay empty. */
export function buildGearAcquisitionIndex(
  rows: readonly GearRow[],
  dropIndex: ReadonlyMap<string, readonly GearDropSource[]>,
  questRewards: GearAcquisitionIndex
): GearAcquisitionIndex {
  const out = new Map<string, readonly GearAcquisition[]>()
  for (const row of rows) {
    const key = gearAcquisitionItemKey(row.key)
    out.set(key, mergeGearAcquisitions(itemDrops(row, dropIndex.get(key) ?? []), questRewards.get(key) ?? []))
  }
  return out
}

export { buildQuestRewardIndex } from './gearAcquisitionQuests'
