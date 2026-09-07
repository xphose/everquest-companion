// Keep individual Sky tests addressable without asserting completion of their class parent page.
import type { PoskyData, PoskyQuest, PoskyItem } from '../../shared/types'
import type { QuestJournalCatalogEntry, QuestJournalReferencedItem } from '../../shared/questJournal/catalog'
import { parseStatsBlock } from '../../shared/itemStats'
import { renameItemName } from '../../shared/itemRenames'
import { correctSkyQuestReward } from '../../shared/skyQuestRewards'
import { skyQuestPage, wikiPageUrl } from '../../shared/wiki'
import { zoneShortNameFromCatalog } from '../../shared/zones'
import { itemKey, type ItemDbEntry } from '../itemsDb'
import type { CatalogLocationIndex } from './catalogLocations'
import { buildSkyQuestJournalGuide } from './catalogSkyGuide'

interface SkyContext {
  snapshotAt: string
  items: Map<string, ItemDbEntry>
  locations: CatalogLocationIndex
}

function skyItem(item: PoskyItem, sourceUrl: string, context: SkyContext): QuestJournalReferencedItem {
  const name = renameItemName(item.name)
  return {
    name,
    sources: [
      ...context.locations.drops(name, context.items.get(itemKey(name))?.dropsFrom ?? [])
        .filter((location) => zoneShortNameFromCatalog(location.zone) === 'airplane'),
      ...item.who.flatMap((who) => context.locations.npc(who, 'Plane of Sky').map((location) => ({
        ...location,
        sourceUrl: location.page ? location.sourceUrl : sourceUrl,
        note: [location.note, item.where].filter(Boolean).join(' · ') || undefined
      })))
    ]
  }
}

function skyEntry(raw: PoskyQuest, context: SkyContext): QuestJournalCatalogEntry {
  const quest = correctSkyQuestReward(raw)
  const page = skyQuestPage(quest.className) ?? quest.source
  const url = wikiPageUrl(page) ?? ''
  const reward = quest.reward ? context.items.get(itemKey(renameItemName(quest.reward))) : undefined
  const source = { url, snapshotAt: context.snapshotAt }
  const pickupLocations = quest.giver ? context.locations.npc(quest.giver, 'Plane of Sky') : []
  const referencedItems = quest.items.map((item) => skyItem(item, url, context))
  const guide = buildSkyQuestJournalGuide({ quest, source, pickupLocations, referencedItems })
  return {
    id: `posky:${quest.className}::${quest.name}`,
    name: quest.name,
    page,
    source,
    startZone: 'Plane of Sky',
    giver: quest.giver,
    classes: [quest.className],
    relatedZones: ['Plane of Sky'],
    expReward: false,
    pickupLocations,
    relatedNpcs: [],
    referencedItems,
    rewards: quest.reward ? [{
      name: renameItemName(quest.reward),
      sourceUrl: wikiPageUrl(quest.rewardPage ?? quest.reward) ?? '',
      stats: quest.rewardStats ? parseStatsBlock(quest.rewardStats) : reward?.stats
    }] : [],
    ...(guide ? { guide } : {})
  }
}

export function buildSkyQuestJournalEntries(
  sky: PoskyData | undefined,
  items: Map<string, ItemDbEntry>,
  locations: CatalogLocationIndex
): QuestJournalCatalogEntry[] {
  if (!sky) return []
  const context = { snapshotAt: sky.scrapedAt, items, locations }
  return sky.quests.map((quest) => skyEntry(quest, context))
}
