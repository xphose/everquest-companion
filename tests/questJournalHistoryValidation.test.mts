import assert from 'node:assert/strict'
import { test } from 'node:test'
import { emptyHistory, mergeTaskHistory, sanitizeHistory, sanitizeTask } from '../src/main/questJournal/history'
import { sanitizeProgress } from '../src/main/questJournal/validate'
import { migrateStoreData } from '../src/main/storeMigrations'
import { taskId, taskName } from './questHistoryFixture.mts'

test('malformed names, keys, event dates and unsupported state claims cannot become saved facts', () => {
  const latest = { name: taskName, assignedAt: 1000, cycleStatus: 'assigned' }
  for (const bad of [
    { ...latest, name: ' ' }, { ...latest, name: 'A'.repeat(301) }, { ...latest, assignedAt: Infinity },
    { ...latest, assignedAt: -1 }, { ...latest, assignedAt: NaN }, { ...latest, assignedAt: 8640000000000001 },
    { ...latest, cycleStatus: 'completed' }, { ...latest, lastChange: 'removed' },
    { ...latest, cycleStatus: 'invented' }, Object.assign(Object.create({ inherited: true }) as object, latest)
  ]) assert.equal(sanitizeTask(bad), undefined)
  const history = sanitizeHistory(JSON.parse(JSON.stringify({ version: 1, tasks: {
    [taskId]: { latest }, other: { latest }, constructor: { latest },
    'task:bad': { latest: { name: 'Bad', completedAt: 'yesterday', cycleStatus: 'completed' } }
  }, rewardedHandIns: {
    Valid: { completedAt: 10000, experienceAt: 9999 }, Future: { completedAt: 10000, experienceAt: 10001 },
    Stale: { completedAt: 10000, experienceAt: 4999 }, Negative: { completedAt: -1, experienceAt: -1 },
    prototype: { completedAt: 10000, experienceAt: 9999 }
  } })))
  assert.deepEqual(Object.keys(history.tasks), [taskId])
  assert.deepEqual(Object.keys(history.rewardedHandIns), ['Valid'])
  assert.deepEqual(sanitizeHistory({ version: 99, tasks: history.tasks }), emptyHistory())
  assert.deepEqual(sanitizeProgress({ version: 1, quests: { manual: { tracked: true, steps: {} } }, history }).history, history)
})

test('history capacity retains existing records and reports refused new names without erasing anything', () => {
  const history = emptyHistory()
  for (let i = 0; i < 5000; i++) history.tasks[`task:saved ${i}`] = { latest: { name: `Saved ${i}`, assignedAt: 1000 } }
  mergeTaskHistory(history, [{ name: 'New name', assignedAt: 2000 }, { name: 'Saved 1', completedAt: 3000, cycleStatus: 'completed' }])
  assert.equal(Object.keys(history.tasks).length, 5000)
  assert.equal(history.tasks['task:new name'], undefined)
  assert.equal(history.tasks['task:saved 1'].latest.completedAt, 3000)
  assert.equal(history.tasks['task:saved 2'].latest.assignedAt, 1000)
  assert.equal(history.capacityReached, true)
})

test('schema 14 upgrades journal history separately while keeping every existing field and character', () => {
  const before = {
    schemaVersion: 14, activeCharacter: 'example_test', graphics: { safeMode: 'off', opaqueOverlays: 'auto' },
    questJournalPreferences: { status: 'todo', zone: 'Test Zone', selectedQuest: 'A quest' },
    byCharacter: {
      example_test: { inventory: { token: 2 }, completedQuests: ['old'], questTurnIns: { old: [100] },
        achievementUnlocks: ['old-source'], customUnrelated: { keep: true },
        questJournal: { version: 1, quests: { 'A quest': { tracked: true, status: 'active', steps: { collect: false } } },
          profile: { level: 12, classes: ['Shaman'] }, recovery: { record: { evidence: ['Retained import'], recoveredAt: 10000 } } } },
      other_test: { inventory: {}, completedQuests: [], questJournal: { version: 1, quests: { Other: { tracked: true, steps: {} } } } },
      untouched_test: { inventory: {}, completedQuests: [] }
    }
  }
  const copy = structuredClone(before)
  const migrated = migrateStoreData(before)
  assert.deepEqual(migrated.applied, [15])
  assert.equal(migrated.to, 15)
  const expected = structuredClone(before) as Record<string, unknown>
  expected.schemaVersion = 15
  const characters = expected.byCharacter as Record<string, { questJournal?: Record<string, unknown> }>
  characters.example_test.questJournal!.history = emptyHistory()
  characters.other_test.questJournal!.history = emptyHistory()
  assert.deepEqual(migrated.data, expected)
  assert.deepEqual(before, copy, 'input remains unchanged')
  assert.equal(migrateStoreData(migrated.data).changed, false)
})
