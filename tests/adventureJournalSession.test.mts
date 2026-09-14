import assert from 'node:assert/strict'
import { test } from 'node:test'
import { adventureJournalSession, type AdventureJournalReading } from '../src/renderer/src/adventure/journalSession'
import type { QuestJournalQueryResult } from '../src/shared/questJournal/journal'

function result(id = 'hero_test', level = 1, refreshedAt = 1): QuestJournalQueryResult {
  return { context: { characterId: id, level, classes: ['Shaman', 'Paladin'], profileSource: 'detected', readiness: 'ready',
    inventory: { state: 'missing' }, achievements: { state: 'missing' }, refreshedAt, tasksTruncated: false },
  rows: [{ id: 'Test Quest', name: 'Test Quest', state: 'active', stateLabel: 'Active', tracked: true, rewardNames: [], hasGuide: true, recommendation: { fit: 'suitable', reasons: [] } }],
  total: 1, offset: 0, limit: 40, zones: [], classes: [] }
}
const flush = async (): Promise<void> => { await new Promise<void>((resolve) => setImmediate(resolve)) }

test('many simultaneous quest notifications keep one request and one follow-up', async () => {
  const deferred: ((value: { result: QuestJournalQueryResult; detail: null }) => void)[] = []
  const seen: AdventureJournalReading[] = []
  const session = adventureJournalSession({ read: () => new Promise(resolve => deferred.push(resolve)), publish: value => seen.push(value) })
  session.refresh()
  for (let n = 0; n < 50; n++) session.refresh()
  assert.equal(deferred.length, 1)
  deferred[0]({ result: result(), detail: null }); await flush()
  assert.equal(deferred.length, 2)
  deferred[1]({ result: result(), detail: null }); await flush()
  assert.equal(deferred.length, 2)
  assert.equal(seen.length, 1)
  session.stop()
})

test('new observations preserve fact references until level/classes/quest state really change', async () => {
  let next = result()
  const seen: AdventureJournalReading[] = []
  const session = adventureJournalSession({ read: async () => ({ result: next, detail: null }), publish: value => seen.push(value) })
  session.refresh(); await flush()
  const first = seen[0].result
  next = result('hero_test', 1, 500)
  session.refresh(); await flush()
  assert.equal(seen.length, 1)
  assert.equal(seen[0].result, first)
  next = result('hero_test', 2, 600)
  next.context.classes.push('Rogue')
  session.refresh(); await flush()
  assert.equal(seen.length, 2)
  assert.equal(seen[1].result?.context.level, 2)
  assert.deepEqual(seen[1].result?.context.classes, ['Shaman', 'Paladin', 'Rogue'])
  session.stop()
})

test('character switch drops a pending previous hero while same-character rebuild remains readable', async () => {
  const deferred: ((value: { result: QuestJournalQueryResult; detail: null }) => void)[] = []
  const seen: AdventureJournalReading[] = []
  const session = adventureJournalSession({ read: () => new Promise(resolve => deferred.push(resolve)), publish: value => seen.push(value) })
  session.refresh()
  session.character('second_test')
  deferred[0]({ result: result(), detail: null }); await flush()
  assert.equal(seen.some(value => value.result?.context.characterId === 'hero_test'), false)
  deferred[1]({ result: result('second_test'), detail: null }); await flush()
  session.character('second_test')
  deferred[2]({ result: result('second_test', 3), detail: null }); await flush()
  assert.equal(seen.at(-1)?.result?.context.level, 3)
  session.stop()
})

test('read failure stays honest and later success clears it without replacing unchanged facts', async () => {
  let fail = false
  const seen: AdventureJournalReading[] = []
  const session = adventureJournalSession({ read: async () => { if (fail) throw new Error('offline'); return { result: result(), detail: null } }, publish: value => seen.push(value) })
  session.refresh(); await flush()
  const first = seen[0].result
  fail = true; session.refresh(); await flush()
  assert.match(seen.at(-1)?.error ?? '', /Retrying automatically/)
  assert.equal(seen.at(-1)?.result, first)
  fail = false; session.refresh(); await flush()
  assert.equal(seen.at(-1)?.error, null)
  assert.equal(seen.at(-1)?.result, first)
  session.stop()
})

test('old search result and closed-window response cannot publish', async () => {
  const deferred: ((value: { result: QuestJournalQueryResult; detail: null }) => void)[] = []
  const seen: AdventureJournalReading[] = []
  const session = adventureJournalSession({ read: () => new Promise(resolve => deferred.push(resolve)), publish: value => seen.push(value) })
  session.refresh(); session.invalidate()
  deferred[0]({ result: result(), detail: null }); await flush()
  assert.equal(seen.length, 0)
  session.stop()
  deferred[1]({ result: result(), detail: null }); await flush()
  assert.equal(seen.length, 0)
  session.refresh()
  assert.equal(deferred.length, 2)
})
