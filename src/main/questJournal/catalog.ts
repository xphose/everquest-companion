// Offline quest directory. The body-item index is deliberately distinct from curated steps:
// a prose mention is not a prerequisite, and owning a reward is not proof of completion.
import questsJson from '../../renderer/src/data/eqlegends/quests.json'
import mobsJson from '../../renderer/src/data/eqlegends/mobs.json'
import itemsJson from '../data/items.json'
import guidesJson from '../data/questJournalGuides.json'
import metadataJson from '../data/questJournalMetadata.json'
import skyJson from '../../renderer/src/data/eqlegends/posky.json'
import type { PoskyData, QuestData, QuestEntry } from '../../shared/types'
import type { MobData } from '../../shared/mobTypes'
import type {
  QuestJournalCatalogEntry, QuestJournalGuide, QuestJournalReward
} from '../../shared/questJournal/catalog'
import { renameItemName } from '../../shared/itemRenames'
import { wikiPageUrl } from '../../shared/wiki'
import { buildItemDbIndex, itemKey, type ItemDbFile, type ItemDbEntry } from '../itemsDb'
import { buildCatalogLocationIndex, type CatalogLocationIndex } from './catalogLocations'
import { buildSkyQuestJournalEntries } from './catalogSky'

export interface QuestJournalCatalogInput {
  quests: QuestData
  mobs: MobData
  items: ItemDbFile
  /** Generated at development time from the cached pages; no cache files ship at runtime. */
  levelNotes: Record<string, string>
  guides: Record<string, QuestJournalGuide>
  sky?: PoskyData
}

interface BuildContext {
  input: QuestJournalCatalogInput
  items: Map<string, ItemDbEntry>
  locations: CatalogLocationIndex
}

function rewardDetails(name: string, items: Map<string, ItemDbEntry>): QuestJournalReward {
  const renamed = renameItemName(name)
  const item = items.get(itemKey(renamed))
  return { name: renamed, stats: item?.stats, sourceUrl: wikiPageUrl(item?.page ?? renamed) ?? '' }
}

function catalogEntry(quest: QuestEntry, context: BuildContext): QuestJournalCatalogEntry {
  const { input, items, locations } = context
  const guide = input.guides[quest.page]
  return {
    id: quest.page,
    name: quest.name,
    page: quest.page,
    source: { url: wikiPageUrl(quest.page) ?? '', snapshotAt: input.quests.scrapedAt },
    startZone: quest.startZone,
    giver: quest.giver,
    minLevel: quest.minLevel,
    minLevelText: input.levelNotes[quest.page],
    classes: quest.classes ?? [],
    relatedZones: quest.relatedZones ?? [],
    expReward: quest.expReward ?? false,
    pickupLocations: quest.giver ? locations.npc(quest.giver, quest.startZone) : [],
    relatedNpcs: (quest.relatedNpcs ?? []).flatMap((name) => locations.npc(name)),
    referencedItems: (quest.requiredItems ?? []).map((name) => ({
      name: renameItemName(name),
      sources: locations.drops(name, items.get(itemKey(renameItemName(name)))?.dropsFrom ?? [])
    })),
    rewards: (quest.rewards ?? []).map((reward) => rewardDetails(reward.name, items)),
    ...(guide ? { guide } : {})
  }
}

function bundledInput(): QuestJournalCatalogInput {
  return {
    quests: questsJson,
    mobs: mobsJson,
    items: itemsJson as unknown as ItemDbFile,
    guides: guidesJson as Record<string, QuestJournalGuide>,
    levelNotes: metadataJson.levelNotes,
    sky: skyJson
  }
}

export function buildQuestJournalCatalog(input = bundledInput()): QuestJournalCatalogEntry[] {
  const context: BuildContext = {
    input,
    items: buildItemDbIndex(input.items),
    locations: buildCatalogLocationIndex(input.mobs.mobs)
  }
  return [
    ...input.quests.quests.map((quest) => catalogEntry(quest, context)),
    ...buildSkyQuestJournalEntries(input.sky, context.items, context.locations)
  ]
}

let bundledCatalog: QuestJournalCatalogEntry[] | undefined

export function getQuestJournalCatalog(): readonly QuestJournalCatalogEntry[] {
  bundledCatalog ??= buildQuestJournalCatalog()
  return bundledCatalog
}

export function findQuestJournalCatalogEntry(id: string): QuestJournalCatalogEntry | undefined {
  return getQuestJournalCatalog().find((entry) => entry.id === id)
}
