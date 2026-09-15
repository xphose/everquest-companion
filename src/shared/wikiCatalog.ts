import type { ItemKnowledge, MobData, QuestData } from './types'
import type { QuestJournalWalkthrough } from './questJournal/catalog'
import { validCatalogData, validJournalMetadata } from './wikiCatalogValidation'

/** Structurally identical to ItemDbFile without importing the main-process graph. */
export interface WikiCatalogItems {
  scrapedAt: string
  source: string
  count: number
  items: Record<string, Partial<Omit<ItemKnowledge, 'cached' | 'page'>> & { page: string }>
}

/** One atomic reference snapshot. Never contains character state or curated guides. */
export interface WikiCatalogPack {
  schemaVersion: 1
  baseFingerprint: string
  generation: string
  /** Completed reconciliation watermark, not the last attempted request. */
  checkedAt: string
  items: WikiCatalogItems
  mobs: MobData
  quests: QuestData
  metadata: {
    snapshotAt: string
    levelNotes: Record<string, string>
    walkthroughs: Record<string, QuestJournalWalkthrough>
  }
}

export interface WikiRefreshStatus {
  state: 'idle' | 'checking' | 'downloading' | 'ready' | 'error'
  activeUpdatedAt: string
  lastCheckedAt: string | null
  nextCheckAt: string | null
  pendingUpdatedAt: string | null
  completedPages?: number
  totalPages?: number
  error?: string
  autoCheckDays: 1
}

export interface WikiCatalogRendererData {
  generation: string
  mobs: MobData
  quests: QuestData
}

export function wikiRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function wikiStamp(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value))
}

/** Fail closed before a downloaded/cached pack reaches any consumer. */
export function validateWikiCatalogPack(value: unknown, baseFingerprint?: string): value is WikiCatalogPack {
  if (!wikiRecord(value) || value.schemaVersion !== 1 || !wikiStamp(value.checkedAt)) return false
  if (typeof value.baseFingerprint !== 'string' || !/^[a-zA-Z0-9._-]{1,128}$/.test(value.baseFingerprint)) return false
  if (baseFingerprint !== undefined && value.baseFingerprint !== baseFingerprint) return false
  if (typeof value.generation !== 'string' || !/^[a-zA-Z0-9._-]{1,128}$/.test(value.generation)) return false
  return validCatalogData(value) && validJournalMetadata(value.metadata)
}
