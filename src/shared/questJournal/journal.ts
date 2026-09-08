import type { QuestJournalCatalogEntry } from './catalog'
import type { RecoveryRecord } from './recovery'

export type QuestJournalState = 'active' | 'completed' | 'ready' | 'unknown'
export type QuestJournalFilter = 'all' | 'tracked' | QuestJournalState

export interface QuestJournalQuery {
  search?: string
  state?: QuestJournalFilter
  zone?: string
  className?: string
  level?: number
  sort?: 'recommended' | 'name'
  offset?: number
  limit?: number
}

export interface QuestJournalFileState {
  state: 'available' | 'missing' | 'error'
  updatedAt?: string
  message?: string
  refreshSuggested?: boolean
}

export interface QuestJournalContext {
  characterId: string | null
  characterName?: string
  characterServer?: string
  level?: number
  /** Where the character level came from; log observations may predate the current session. */
  levelSource?: 'live' | 'log' | 'manual'
  classes: string[]
  /** Display names inferred from gameplay; /who and user statements are not estimates. */
  inferredClasses?: string[]
  profileSource: 'detected' | 'manual' | 'unknown'
  zone?: string
  readiness: 'ready' | 'loading' | 'unavailable'
  message?: string
  inventory: QuestJournalFileState
  achievements: QuestJournalFileState
  refreshedAt: number
  tasksTruncated: boolean
}

export interface QuestJournalRecommendation {
  fit: 'suitable' | 'later' | 'other-class' | 'unknown'
  reasons: string[]
}

export interface QuestJournalRow {
  id: string
  name: string
  state: QuestJournalState
  stateLabel: string
  tracked: boolean
  minLevel?: number
  startZone?: string
  recommendation: QuestJournalRecommendation
  rewardNames: string[]
  hasGuide: boolean
}

export interface QuestJournalQueryResult {
  context: QuestJournalContext
  rows: QuestJournalRow[]
  total: number
  offset: number
  limit: number
  zones: string[]
  classes: string[]
}

export interface QuestJournalObservedTask {
  name: string
  assignedAt?: number
  updatedAt?: number
  completedAt?: number
  removedAt?: number
  failedAt?: number
  lastChange?: 'assigned' | 'updated' | 'completed' | 'removed' | 'failed'
  lastObservedAt?: number
  cycleStatus?: 'observed' | 'assigned' | 'completed' | 'removed' | 'failed'
}

export interface QuestJournalStepProgress {
  id: string
  text: string
  complete: boolean
  source: 'manual' | 'inventory' | 'log' | 'unknown'
  held?: number
  required?: number
}

export interface QuestJournalRewardComparison {
  reward: string
  worn: string
  slot: string
  stats: { label: string; reward: number; worn: number; delta: number }[]
  note: string
}

export interface QuestJournalDetailResult {
  context: QuestJournalContext
  row: QuestJournalRow | null
  entry?: QuestJournalCatalogEntry
  steps: QuestJournalStepProgress[]
  observed?: QuestJournalObservedTask
  recovered?: RecoveryRecord
  evidence: string[]
  comparisons: QuestJournalRewardComparison[]
  manual: QuestJournalManual
  nextStep?: string
  inventoryRefreshSuggested: boolean
}

export interface QuestJournalManual {
  tracked?: boolean
  status?: 'active' | 'completed'
  steps: Record<string, boolean>
}

export interface QuestJournalProfile {
  level?: number
  classes: string[]
}

/** User statements only. Observation and inventory never write completion flags. */
export interface QuestJournalProgress {
  version: 1
  quests: Record<string, QuestJournalManual>
  profile?: QuestJournalProfile
  recovery?: Record<string, RecoveryRecord>
}

export type QuestJournalMutation = { characterId: string } & (
  | { action: 'track'; id: string; value: boolean }
  | { action: 'status'; id: string; value: 'active' | 'completed' | 'unknown' }
  | { action: 'step'; id: string; stepId: string; value: boolean | null }
  | { action: 'profile'; level?: number; classes: string[] }
)

export type QuestJournalMutationResult = { ok: true } | { ok: false; error: string }

export interface QuestJournalDetailRequest {
  characterId: string | null
  id: string
}
