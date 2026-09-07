// Keep individual Sky tests addressable without asserting completion of their class parent page.
import type { PoskyData, PoskyQuest, PoskyItem } from '../../shared/types'
import type { QuestJournalCatalogEntry, QuestJournalReferencedItem } from '../../shared/questJournal/catalog'
import { parseStatsBlock } from '../../shared/itemStats'
import { renameItemName } from '../../shared/itemRenames'
import { correctSkyQuestReward } from '../../shared/skyQuestRewards'
import { skyQuestPage, wikiPageUrl } from '../../shared/wiki'
import { itemKey, type ItemDbEntry } from '../itemsDb'
import type { CatalogLocationIndex } from './catalogLocations'

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
      ...context.locations.drops(name, context.items.get(itemKey(name))?.dropsFrom ?? []),
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
  return {
    id: `posky:${quest.className}::${quest.name}`,
    name: quest.name,
    page,
    source: { url, snapshotAt: context.snapshotAt },
    startZone: 'Plane of Sky',
    giver: quest.giver,
    classes: [quest.className],
    relatedZones: ['Plane of Sky'],
    expReward: false,
    pickupLocations: quest.giver ? context.locations.npc(quest.giver, 'Plane of Sky') : [],
    relatedNpcs: [],
    referencedItems: quest.items.map((item) => skyItem(item, url, context)),
    rewards: quest.reward ? [{
      name: renameItemName(quest.reward),
      sourceUrl: wikiPageUrl(quest.rewardPage ?? quest.reward) ?? '',
      stats: quest.rewardStats ? parseStatsBlock(quest.rewardStats) : reward?.stats
    }] : []
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
