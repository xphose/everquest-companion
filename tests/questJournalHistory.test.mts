import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { QuestJournalObservedTask } from '../src/shared/questJournal/journal'
import { historyFixture, historyQuest, historyTrade, taskId, taskName, deferred } from './questHistoryFixture.mts'

test('automatic background history survives service recreation with empty, older and unavailable snapshots', async () => {
  const h = historyFixture()
  h.data.tasks = [{ name: taskName, assignedAt: 12000, cycleStatus: 'assigned' }]
  h.data.turnins = [historyTrade]
  await h.start().observeHistory()
  assert.deepEqual(h.data.modules, ['tasks', 'turnins'], 'closed-panel recorder asks only for quest evidence')
  assert.equal(h.data.writes, 1)
  assert.deepEqual(h.data.saved.get('example_test')?.questJournal?.quests, {}, 'automatic evidence is separate from user statements')
  h.data.tasks = []; h.data.turnins = []
  for (const readiness of ['ready', 'loading', 'unavailable'] as const) {
    h.data.world.readiness = readiness
    const service = h.start()
    const result = await service.query({ state: 'all' })
    assert.equal(result.rows.find(row => row.id === historyQuest.id)?.state, 'completed')
    assert.equal(result.rows.find(row => row.id === taskId)?.state, 'active')
    assert.equal(h.data.writes, 1)
  }
  h.data.world.readiness = 'ready'
  h.data.tasks = [{ name: taskName, removedAt: 1000, cycleStatus: 'removed' }]
  h.data.failedModules.add('turnins')
  const result = await h.start().query({ state: 'all' })
  assert.equal(result.rows.find(row => row.id === taskId)?.state, 'active')
  assert.equal(result.rows.find(row => row.id === historyQuest.id)?.state, 'completed')
  assert.equal(h.data.writes, 1, 'old replay cannot regress or rewrite history')
})

test('new repeat activity supersedes completion without erasing its event history or completing new steps', async () => {
  const h = historyFixture()
  const service = h.start()
  h.data.tasks = [{ name: historyQuest.name, completedAt: 10000, cycleStatus: 'completed' }]
  h.data.turnins = [historyTrade]
  await service.observeHistory()
  h.data.tasks = [{ name: historyQuest.name, assignedAt: 20000, cycleStatus: 'assigned' }]
  h.data.turnins = []
  await service.observeHistory()
  h.data.tasks = []
  const detail = await h.start().detail({ characterId: 'example_test', id: historyQuest.id })
  assert.equal(detail.row?.state, 'active')
  assert.ok(detail.steps.every(step => !step.complete))
  assert.match(detail.evidence.join(' '), /Previous completion/u)
  const history = h.data.saved.get('example_test')?.questJournal?.history
  assert.equal(history?.tasks['task:four copper tokens'].completedAt, 10000)
  assert.equal(history?.rewardedHandIns[historyQuest.id].completedAt, 10000)
})

test('same-second transitions preserve served log order, including removal after successful completion', async () => {
  const h = historyFixture()
  const service = h.start()
  const states: [QuestJournalObservedTask, string][] = [
    [{ name: taskName, completedAt: 1000, cycleStatus: 'completed' }, 'completed'],
    [{ name: taskName, assignedAt: 1000, completedAt: 1000, cycleStatus: 'assigned' }, 'active'],
    [{ name: taskName, assignedAt: 1000, completedAt: 1000, cycleStatus: 'completed' }, 'completed'],
    [{ name: taskName, completedAt: 1000, removedAt: 1000, lastChange: 'removed', cycleStatus: 'completed' }, 'completed']
  ]
  for (const [task, state] of states) {
    h.data.tasks = [task]
    await service.observeHistory()
    h.data.tasks = []
    const row = (await h.start().query({ search: taskName })).rows[0]
    assert.equal(row.state, state)
  }
})

test('a saved hand-in cannot finish a repeat assigned, failed or removed during that same second', async () => {
  for (const cycleStatus of ['assigned', 'failed', 'removed'] as const) {
    const h = historyFixture()
    h.data.tasks = [{ name: historyQuest.name, completedAt: 10000, cycleStatus: 'completed' }]
    h.data.turnins = [historyTrade]
    await h.start().observeHistory()
    h.data.tasks = [{ name: historyQuest.name, assignedAt: 10000, completedAt: 10000,
      [cycleStatus + 'At']: 10000, lastObservedAt: 10000, cycleStatus }]
    await h.start().observeHistory()
    const live = await h.start().detail({ characterId: 'example_test', id: historyQuest.id })
    assert.equal(live.row?.state, cycleStatus === 'assigned' ? 'active' : 'unknown')
    assert.ok(live.steps.every(step => !step.complete), 'the still-replayed same-second trade cannot complete repeat steps')
    h.data.tasks = []; h.data.turnins = []
    const saved = await h.start().detail({ characterId: 'example_test', id: historyQuest.id })
    assert.equal(saved.row?.state, cycleStatus === 'assigned' ? 'active' : 'unknown')
    assert.ok(saved.steps.every(step => !step.complete))
    assert.equal(h.data.saved.get('example_test')?.questJournal?.history?.rewardedHandIns[historyQuest.id].completedAt, 10000)
  }
})

test('unchanged snapshots and repeated reads do not rewrite the store; manual changes retain automatic history', async () => {
  const h = historyFixture()
  const service = h.start()
  h.data.tasks = [{ name: taskName, assignedAt: 20000, cycleStatus: 'assigned' }]
  h.data.turnins = [historyTrade]
  for (let i = 0; i < 3; i++) { await service.observeHistory(); await service.query({}); }
  assert.equal(h.data.writes, 1)
  const history = structuredClone(h.data.saved.get('example_test')?.questJournal?.history)
  h.data.tasks = []; h.data.turnins = []
  for (const mutation of [
    { action: 'track', id: taskId, value: true },
    { action: 'status', id: historyQuest.id, value: 'active' },
    { action: 'step', id: historyQuest.id, stepId: 'collect', value: true }
  ]) assert.deepEqual(await service.mutate({ characterId: 'example_test', ...mutation }), { ok: true })
  assert.deepEqual(h.data.saved.get('example_test')?.questJournal?.history, history)
  const detail = await service.detail({ characterId: 'example_test', id: historyQuest.id })
  assert.equal(detail.row?.state, 'active', 'a saved correction remains authoritative')
  assert.equal(detail.steps[0].source, 'manual')
  assert.equal((await service.query({ state: 'tracked' })).rows[0].id, taskId)
})

test('a character, server, path or engine switch during an awaited read cannot persist old evidence', async () => {
  for (const change of ['characterId', 'server', 'logPath', 'token'] as const) {
    const h = historyFixture()
    h.data.turnins = [historyTrade]
    const gate = deferred(); h.data.gate = gate.promise
    const read = h.start().observeHistory()
    h.data.world = structuredClone(h.data.world)
    if (change === 'characterId' || change === 'token') h.data.world[change] = 'other'
    else h.data.world.character![change] = 'other'
    gate.resolve()
    await assert.rejects(read, /changed/u)
    assert.equal(h.data.saved.size, 0)
  }
  const h = historyFixture()
  h.data.turnins = [historyTrade]
  await h.start().observeHistory()
  h.data.world = { characterId: 'other_test', character: { name: 'Other', server: 'test', logPath: '/synthetic/eqlog_Other_test.txt' }, readiness: 'unavailable', token: 'two' }
  assert.equal((await h.start().query({ state: 'completed' })).total, 0)
})

test('same-second stale query awaiting native data cannot overwrite a newer background task cycle', async () => {
  for (const completedFirst of [false, true]) {
    const h = historyFixture()
    const first: QuestJournalObservedTask = { name: taskName, assignedAt: 1000, completedAt: 1000, cycleStatus: completedFirst ? 'completed' : 'assigned' }
    h.data.tasks = [first]
    const gate = deferred()
    h.deps.livePlayer = async () => { await gate.promise; return { state: 'unavailable', reason: 'Synthetic native read' } }
    const oldQuery = h.start().query({})
    await new Promise<void>(resolve => setImmediate(resolve))
    h.data.tasks = [{ ...first, cycleStatus: completedFirst ? 'assigned' : 'completed' }]
    h.data.revision++
    await h.start().observeHistory()
    gate.resolve()
    const fresh = await oldQuery
    assert.equal(fresh.rows.find(row => row.id === taskId)?.state, completedFirst ? 'active' : 'completed')
    assert.equal(h.data.saved.get('example_test')?.questJournal?.history?.tasks[taskId].latest.cycleStatus, completedFirst ? 'assigned' : 'completed')
    assert.equal(h.data.writes, 1)
  }
})

test('fresh manual and recovery records written during a read are merged immediately before saving', async () => {
  const h = historyFixture()
  h.data.turnins = [historyTrade]
  const gate = deferred(); h.data.gate = gate.promise
  const reading = h.start().observeHistory()
  const recovery = { questId: historyQuest.id, name: historyQuest.name, state: 'active' as const, source: 'task-window' as const,
    confidence: 'confirmed' as const, recoveredAt: 15000, evidence: ['Synthetic task capture'] }
  h.data.saved.set('example_test', { inventory: { token: 3 }, completedQuests: ['other'], questJournal: { version: 1,
    quests: { [historyQuest.id]: { tracked: true, steps: { collect: false } } }, recovery: { [historyQuest.id]: recovery } } })
  gate.resolve(); await reading
  const stored = h.data.saved.get('example_test')!
  assert.deepEqual(stored.inventory, { token: 3 })
  assert.deepEqual(stored.completedQuests, ['other'])
  assert.deepEqual(stored.questJournal?.recovery?.[historyQuest.id], { ...recovery, objectives: undefined })
  assert.equal(stored.questJournal?.quests[historyQuest.id].tracked, true)
  assert.equal((await h.start().query({ search: historyQuest.name })).rows[0].state, 'active')
})

test('failed writes are reported without a saved claim and recover on the next read; shutdown blocks pending writes', async () => {
  const h = historyFixture()
  h.data.turnins = [historyTrade]; h.data.failSave = true
  const service = h.start()
  await assert.rejects(service.observeHistory(), /could not be saved/u)
  const failed = await service.query({})
  assert.equal(failed.context.historySaving, 'error')
  assert.match(failed.context.message!, /could not be saved/u)
  assert.equal(h.data.saved.size, 0)
  h.data.failSave = false
  assert.equal((await service.query({})).context.historySaving, 'automatic')
  assert.equal(h.data.writes, 1)
  const gate = deferred(); h.data.gate = gate.promise
  h.data.tasks = [{ name: taskName, assignedAt: 20000 }]
  const pending = service.observeHistory()
  service.stopHistory(); gate.resolve()
  await assert.rejects(pending, /stopped/u)
  assert.equal(h.data.writes, 1)
})

test('a malformed task module does not prevent saving a verified trade from the independent module', async () => {
  const h = historyFixture()
  h.data.turnins = [historyTrade]; h.data.invalidTasks = true
  await assert.rejects(h.start().observeHistory(), /observations are unavailable/u)
  assert.equal(h.data.saved.get('example_test')?.questJournal?.history?.rewardedHandIns[historyQuest.id].completedAt, 10000)
})
