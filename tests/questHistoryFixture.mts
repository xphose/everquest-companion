import type { QuestJournalCatalogEntry } from '../src/shared/questJournal/catalog'
import type { QuestJournalObservedTask } from '../src/shared/questJournal/journal'
import type { ProgressState, TurnInEvent } from '../src/shared/types'
import { createQuestJournalService, type JournalServiceDeps, type JournalWorld } from '../src/main/questJournal/service'

const source = { url: 'https://example.test/quest-history', snapshotAt: '2026-09-01' }
export const historyQuest: QuestJournalCatalogEntry = {
  id: 'Four Copper Tokens', name: 'Four Copper Tokens', page: 'Four Copper Tokens', source,
  classes: [], relatedZones: [], expReward: true, pickupLocations: [], relatedNpcs: [], referencedItems: [], rewards: [],
  guide: { source, notes: [], steps: [
    { id: 'collect', kind: 'collect', text: 'Collect four copper tokens', locations: [], manualOnly: false, items: [{ name: 'Copper Token', quantity: 4 }] },
    { id: 'return', kind: 'turn-in', text: 'Return four copper tokens', locations: [{ name: 'Test Keeper', zone: 'Test Zone', sourceUrl: source.url }], manualOnly: true, items: [{ name: 'Copper Token', quantity: 4 }] }
  ] }
}
export const historyTrade: TurnInEvent = { ts: 10000, experienceAt: 9000, npc: 'Test Keeper', items: ['Copper Token'], itemCounts: { 'Copper Token': 4 } }
export const taskName = 'A Long Road Home'
export const taskId = 'task:a long road home'

export function historyFixture() {
  const data = {
    world: { characterId: 'example_test', character: { name: 'Example', server: 'test', logPath: '/synthetic/eqlog_Example_test.txt' }, readiness: 'ready', token: 'one' } as JournalWorld,
    saved: new Map<string, ProgressState>(), tasks: [] as QuestJournalObservedTask[], turnins: [] as TurnInEvent[],
    writes: 0, revision: 0, modules: [] as string[], failedModules: new Set<string>(), failSave: false,
    gate: undefined as Promise<void> | undefined, invalidTasks: false
  }
  const deps: JournalServiceDeps = {
    world: () => data.world, catalog: () => [historyQuest], observationRevision: () => data.revision, now: () => 50000,
    files: () => ({ inventory: null, claims: [], worn: [], inventoryStatus: { state: 'missing' }, achievementsStatus: { state: 'missing' } }),
    getProgress: id => data.saved.get(id) ?? { inventory: {}, completedQuests: [] },
    setProgress: (id, progress) => { if (data.failSave) throw new Error('Synthetic write failure'); data.writes++; data.saved.set(id, structuredClone(progress)) },
    snapshot: async module => {
      data.modules.push(module)
      const value = module === 'tasks' ? data.invalidTasks ? {} : { v: 1, tasks: structuredClone(data.tasks) }
        : module === 'turnins' ? structuredClone(data.turnins) : []
      if (data.gate) await data.gate
      if (data.failedModules.has(module)) throw new Error('Synthetic unavailable snapshot')
      return value
    }
  }
  return { data, deps, start: () => createQuestJournalService(deps) }
}

export function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}
