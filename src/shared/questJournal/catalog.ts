import type { ItemStatBlock } from '../itemStats'
import type { MobLoc } from '../mobTypes'

/** The bundled source snapshot, not a claim that current game behavior was verified. */
export interface QuestJournalSource {
  url: string
  snapshotAt: string
  cachePageId?: number
  cacheSha256?: string
}

/** Coordinates exist only when a source identifies this NPC and its zone unambiguously. */
export interface QuestJournalLocation {
  name: string
  page?: string
  zone?: string
  level?: string
  loc?: MobLoc[]
  sourceUrl: string
  note?: string
}

/** An item mentioned by a quest page; NOT a verified requirement or an implied quantity. */
export interface QuestJournalReferencedItem {
  name: string
  sources: QuestJournalLocation[]
}

/** Possible outcomes from the reward section; a list does not promise every reward. */
export interface QuestJournalReward {
  name: string
  stats?: ItemStatBlock
  sourceUrl: string
}

export interface QuestJournalStepItem {
  name: string
  quantity: number
  /** Identically named pieces must remain distinct; counts alone cannot identify them. */
  variant?: string
}

export interface QuestJournalStep {
  id: string
  kind: 'pickup' | 'collect' | 'turn-in'
  text: string
  locations: QuestJournalLocation[]
  items?: QuestJournalStepItem[]
  /** Logs/inventory cannot reliably establish this step without the player's confirmation. */
  manualOnly: boolean
}

export interface QuestJournalGuide {
  source: QuestJournalSource
  notes: string[]
  steps: QuestJournalStep[]
}

export interface QuestJournalCatalogEntry {
  /** Wiki page identity, or `posky:Class::Name` for individual Sky tests. */
  id: string
  name: string
  page: string
  source: QuestJournalSource
  startZone?: string
  giver?: string
  /** Source's minimum to begin, NOT a safe solo level or an equipment requirement. */
  minLevel?: number
  minLevelText?: string
  /** Source wording, including unknown/faction/deity qualifications; not an eligibility enum. */
  classes: string[]
  relatedZones: string[]
  expReward: boolean
  pickupLocations: QuestJournalLocation[]
  relatedNpcs: QuestJournalLocation[]
  referencedItems: QuestJournalReferencedItem[]
  rewards: QuestJournalReward[]
  guide?: QuestJournalGuide
}
