import type { QuestJournalCatalogEntry } from '../../shared/questJournal/catalog'
import type { QuestJournalObservedTask } from '../../shared/questJournal/journal'
import type { ProgressState, TurnInEvent } from '../../shared/types'
import type { JournalServiceDeps, JournalWorld } from './service'
import { assertJournalRevision, sameJournalWorld } from './service'
import { emptyHistory, eventTime, mergeHandInHistory, mergeTaskHistory, sanitizeTask } from './history'
import { rewardedFinalTrades } from './progress'
import { record, safeId, sanitizeProgress } from './validate'
import { nameKey } from './identity'

export function taskRows(value: unknown): { rows: QuestJournalObservedTask[]; truncated: boolean } {
  const state = record(value)
  if (state?.v !== 1 || !Array.isArray(state.tasks)) throw new Error('Task observations are unavailable from this engine.')
  return { rows: state.tasks.slice(0, 4096).flatMap(raw => sanitizeTask(raw) ?? []), truncated: state.truncated === true }
}

function validTrade(raw: unknown): raw is TurnInEvent {
  const row = record(raw)
  if (!row || !eventTime(row.ts) || !itemName(row.npc)) return false
  if (!Array.isArray(row.items) || row.items.length > 100 || !row.items.every(itemName)) return false
  const counts = record(row.itemCounts)
  if (row.itemCounts !== undefined && !counts) return false
  return !counts || (Object.keys(counts).length <= 100 && Object.entries(counts).every(([name, count]) =>
    itemName(name) && typeof count === 'number' && Number.isSafeInteger(count) && count > 0 && count <= 1000000))
}

function itemName(value: unknown): value is string {
  return safeId(value) && safeId(nameKey(value))
}

export function validJournalTrades(value: unknown[]): TurnInEvent[] {
  return value.slice(-10000).filter(validTrade)
}

export interface JournalHistoryService {
  reconcile: (world: JournalWorld, tasks: QuestJournalObservedTask[], turnins: TurnInEvent[], catalog: readonly QuestJournalCatalogEntry[]) => ProgressState
  observe: () => Promise<void>
  error: (world: JournalWorld) => string | undefined
  stop: () => void
}

export function createJournalHistory(deps: JournalServiceDeps): JournalHistoryService {
  let failed: { world: JournalWorld; message: string } | undefined
  let stopped = false
  const current = (world: JournalWorld): void => {
    if (stopped) throw new Error('Quest history recording has stopped.')
    if (!sameJournalWorld(world, deps.world())) throw new Error('The active character or engine changed. Refresh the journal.')
  }
  const error = (world: JournalWorld): string | undefined => failed && sameJournalWorld(failed.world, world) ? failed.message : undefined
  const reconcile: JournalHistoryService['reconcile'] = (world, tasks, turnins, catalog) => {
    current(world)
    if (!world.characterId) return { inventory: {}, completedQuests: [] }
    // No await between this fresh read and the write: manual changes and recovered records survive.
    const stored = deps.getProgress(world.characterId)
    if (world.readiness !== 'ready') return stored
    const journal = sanitizeProgress(stored.questJournal)
    const history = structuredClone(journal.history ?? emptyHistory())
    mergeTaskHistory(history, tasks)
    mergeHandInHistory(history, rewardedFinalTrades(catalog, validJournalTrades(turnins)))
    if (JSON.stringify(history) === JSON.stringify(journal.history ?? emptyHistory())) return stored
    const next = { ...stored, questJournal: { ...journal, history } }
    current(world)
    try {
      deps.setProgress(world.characterId, next)
      failed = undefined
      return next
    } catch {
      failed = { world, message: 'Quest history could not be saved on this computer. New observations may be lost when the app closes. Check available disk space and try Refresh.' }
      return stored
    }
  }
  return {
    reconcile, error, stop: () => { stopped = true },
    observe: async () => {
      const world = deps.world()
      const revision = deps.observationRevision?.()
      if (!world.characterId || world.readiness !== 'ready') return
      const [tasks, turnins] = await Promise.allSettled(['tasks', 'turnins'].map(deps.snapshot))
      current(world)
      assertJournalRevision(deps, revision)
      let rows: QuestJournalObservedTask[] = []
      let observationsUnavailable = tasks.status === 'rejected' || turnins.status === 'rejected'
      if (tasks.status === 'fulfilled') {
        try { rows = taskRows(tasks.value).rows } catch { observationsUnavailable = true }
      }
      const trades = turnins.status === 'fulfilled' && Array.isArray(turnins.value) ? turnins.value as TurnInEvent[] : []
      reconcile(world, rows, trades, deps.catalog())
      const failure = error(world)
      if (failure) throw new Error(failure)
      if (observationsUnavailable) throw new Error('Some quest observations are unavailable; saved history remains available.')
    }
  }
}
