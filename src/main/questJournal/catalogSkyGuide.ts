// Sky's structured item rows include the rune; never append it a second time.
import type { PoskyItem, PoskyQuest } from '../../shared/types'
import type {
  QuestJournalGuide, QuestJournalLocation, QuestJournalReferencedItem,
  QuestJournalSource, QuestJournalStep, QuestJournalStepItem
} from '../../shared/questJournal/catalog'
import { renameItemName } from '../../shared/itemRenames'
import { itemKey } from '../itemsDb'

interface SkyGuideInput {
  quest: PoskyQuest
  source: QuestJournalSource
  pickupLocations: QuestJournalLocation[]
  referencedItems: QuestJournalReferencedItem[]
}

const requirementKey = (name: string): string => itemKey(renameItemName(name))

function completeRequirements(quest: PoskyQuest): boolean {
  if (!quest.giver?.trim() || quest.items.length === 0) return false
  if (quest.items.some((item) => !item.name.trim() || !Number.isSafeInteger(item.count) || item.count <= 0)) return false
  return !quest.rune || quest.items.some((item) => requirementKey(item.name) === requirementKey(quest.rune ?? ''))
}

function stepItem(item: PoskyItem, index: number, items: PoskyItem[]): QuestJournalStepItem {
  const name = renameItemName(item.name)
  const key = requirementKey(name)
  const repeated = items.filter((other) => requirementKey(other.name) === key).length > 1
  // The separate Bixie God's Stinger catalog page documents the ordinary-loot name collision.
  const variant = key === 'bixie stinger'
    ? "Bixie God's Stinger (Plane of Sky)"
    : repeated ? item.page ?? `Source row ${index + 1}` : undefined
  return { name, quantity: item.count, ...(variant ? { variant } : {}) }
}

function collectStep(item: PoskyItem, index: number, input: SkyGuideInput): QuestJournalStep {
  const required = stepItem(item, index, input.quest.items)
  const where = item.where ? ` The quest table lists ${item.where}.` : ''
  return {
    id: `collect-${index + 1}`,
    kind: 'collect',
    text: `Collect ${required.quantity} × ${required.name}${required.variant ? ` (${required.variant})` : ''}.${where}`,
    locations: input.referencedItems[index].sources,
    items: [required],
    manualOnly: required.variant !== undefined
  }
}

/** The same recipient/ingredient contract as Sky's existing countTurnIns matcher. */
export function buildSkyQuestJournalGuide(input: SkyGuideInput): QuestJournalGuide | undefined {
  const { quest, source, pickupLocations } = input
  if (!completeRequirements(quest)) return undefined
  const items = quest.items.map(stepItem)
  const ingredients = items.map((item) => `${item.quantity} × ${item.name}`).join(', ')
  return {
    source,
    notes: ['The pickup location is a reference; collect the listed ingredients to prepare the hand-in.'],
    steps: [
      {
        id: 'pickup', kind: 'pickup', manualOnly: false,
        text: `Find ${quest.giver} in Plane of Sky for ${quest.name}.`,
        locations: pickupLocations
      },
      ...quest.items.map((item, index) => collectStep(item, index, input)),
      {
        id: 'turn-in', kind: 'turn-in', manualOnly: items.some((item) => item.variant !== undefined),
        text: `Hand ${ingredients} to ${quest.giver}${quest.reward ? ` for ${renameItemName(quest.reward)}` : ''}.`,
        locations: pickupLocations,
        items
      }
    ]
  }
}
