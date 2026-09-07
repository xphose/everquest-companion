import type { MobEntry } from '../../shared/mobTypes'
import type { ItemDropSource } from '../../shared/types'
import type { QuestJournalLocation } from '../../shared/questJournal/catalog'
import { wikiPageUrl } from '../../shared/wiki'
import { zoneKey, zoneShortNameFromCatalog } from '../../shared/zones'
import { itemKey } from '../itemsDb'
import { renameItemName } from '../../shared/itemRenames'

const nameKey = (name: string): string => name.trim().toLowerCase().replace(/\s+/g, ' ')
const dropKey = (name: string): string => itemKey(renameItemName(name))

/** Only the existing curated zone alias table may equate different spellings. */
function sameZone(left: string, right: string): boolean {
  if (zoneKey(left) === zoneKey(right)) return true
  const resolved = zoneShortNameFromCatalog(left)
  return resolved !== null && resolved === zoneShortNameFromCatalog(right)
}

export interface CatalogLocationIndex {
  npc(name: string, zone?: string): QuestJournalLocation[]
  drops(item: string, itemSources: ItemDropSource[]): QuestJournalLocation[]
}

function addToIndex(index: Map<string, MobEntry[]>, key: string, mob: MobEntry): void {
  const rows = index.get(key) ?? []
  if (!rows.includes(mob)) rows.push(mob)
  index.set(key, rows)
}

/** Multi-zone pages have no per-point zone association: retain their zones, omit pins. */
function locationsFor(mob: MobEntry, zone?: string): QuestJournalLocation[] {
  const zones = zone ? (mob.zones ?? []).filter((entry) => sameZone(entry, zone)) : mob.zones ?? []
  const hasSingleZone = mob.zones?.length === 1
  return (zones.length ? zones : [undefined]).map((entry) => ({
    name: mob.name,
    page: mob.page,
    zone: entry,
    level: mob.level,
    sourceUrl: wikiPageUrl(mob.page) ?? '',
    ...(hasSingleZone && mob.loc?.length ? { loc: mob.loc } : {}),
    ...(!hasSingleZone && mob.loc?.length
      ? { note: 'The source lists several zones without assigning its coordinates to a zone.' }
      : {})
  }))
}

function unresolved(name: string, zone?: string): QuestJournalLocation[] {
  return [{ name, zone, sourceUrl: wikiPageUrl(name) ?? '', note: 'Exact NPC location is not resolved in the bundled catalog.' }]
}

function resolveNpc(byName: Map<string, MobEntry[]>, name: string, zone?: string): QuestJournalLocation[] {
  let matches = byName.get(nameKey(name)) ?? []
  if (zone) matches = matches.filter((mob) => mob.zones?.some((entry) => sameZone(entry, zone)))
  if (matches.length !== 1) return unresolved(name, zone)
  return locationsFor(matches[0], zone)
}

function uniqueLocations(rows: QuestJournalLocation[]): QuestJournalLocation[] {
  const seen = new Set<string>()
  return rows.filter((row) => {
    const key = `${nameKey(row.page ?? row.name)}|${zoneKey(row.zone)}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** Pure index; neither a missing NPC nor a missing item source triggers a network request. */
export function buildCatalogLocationIndex(mobs: MobEntry[]): CatalogLocationIndex {
  const byName = new Map<string, MobEntry[]>()
  const byDrop = new Map<string, MobEntry[]>()
  for (const mob of mobs) {
    addToIndex(byName, nameKey(mob.name), mob)
    addToIndex(byName, nameKey(mob.page), mob)
    for (const drop of mob.drops ?? []) addToIndex(byDrop, dropKey(drop), mob)
  }
  return {
    npc: (name, zone) => resolveNpc(byName, name, zone),
    drops: (item, itemSources) => uniqueLocations([
      ...(byDrop.get(dropKey(item)) ?? []).flatMap((mob) => locationsFor(mob)),
      ...itemSources.flatMap((source) => resolveNpc(byName, source.mob, source.zone))
    ])
  }
}
