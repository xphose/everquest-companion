import assert from 'node:assert/strict'
import { test } from 'node:test'
import { startJournalHistoryRecorder } from '../src/main/questJournal/historyRecorder'
import { publishJournalObservations, subscribeJournalObservations } from '../src/main/questJournal/historyEvents'
import { createJournalSnapshotCache } from '../src/main/questJournal/snapshotCache'
import { deferred } from './questHistoryFixture.mts'

const tick = () => new Promise<void>(resolve => setImmediate(resolve))

test('background recording is immediate, quest-specific and coalesced; stop unsubscribes and errors stay handled', async () => {
  const gate = deferred()
  let calls = 0
  let active = 0
  let peak = 0
  let errors = 0
  const stop = startJournalHistoryRecorder(async () => {
    calls++; active++; peak = Math.max(active, peak)
    try { if (calls === 1) await gate.promise; else throw new Error('Synthetic read failure') }
    finally { active-- }
  }, subscribeJournalObservations, () => { errors++ })
  publishJournalObservations('tasks'); publishJournalObservations('turnins')
  await tick()
  assert.equal(calls, 1)
  for (let i = 0; i < 20; i++) publishJournalObservations('tasks')
  gate.resolve(); await tick()
  assert.equal(calls, 2)
  assert.equal(peak, 1)
  assert.equal(errors, 1)
  publishJournalObservations('loot'); publishJournalObservations('combo'); await tick()
  assert.equal(calls, 2)
  stop(); publishJournalObservations(); await tick()
  assert.equal(calls, 2)
})

test('quest observation revision spans later awaits and advances only for actual quest publication changes', () => {
  const cache = createJournalSnapshotCache()
  const before = cache.observationRevision()
  cache.changed('character', 1); cache.changed('loot', 2)
  assert.equal(cache.observationRevision(), before)
  cache.changed('tasks', 3); cache.changed('tasks', 3)
  assert.equal(cache.observationRevision(), before + 1)
  cache.changed('turnins', 3)
  assert.equal(cache.observationRevision(), before + 2)
  cache.clear()
  assert.equal(cache.observationRevision(), before + 3)
})
