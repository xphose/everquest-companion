import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { ComboSnap, ComboSlot } from '../src/shared/classCombo'
import type { ProgressState } from '../src/shared/types'
import { createQuestJournalService } from '../src/main/questJournal/service'
import { interval, slot } from './comboFixtures.mjs'

/** Service seam: parser/inference fixtures own how slots are learned; this tests how the journal
 * reads that published evidence, including user corrections and unresolved candidate sets. */
function harness(slots: ComboSlot[]) {
  let stored: ProgressState = { inventory: {}, completedQuests: [] }
  let combo: ComboSnap = { ready: true, intervals: [], current: interval('ci1', 1, null, { slots }) }
  const character = { name: 'Ada', server: 'test', logPath: 'eqlog_Ada_test.txt' }
  const service = createQuestJournalService({
    world: () => ({ characterId: 'Ada@test', character, token: '1:1', readiness: 'ready' }),
    catalog: () => [], now: () => 100,
    files: () => ({ inventoryStatus: { state: 'missing' }, achievementsStatus: { state: 'missing' }, inventory: null, claims: [], worn: [] }),
    getProgress: () => stored, setProgress: (_id, value) => { stored = value },
    snapshot: async (module) => {
      if (module === 'character') return { character, level: { level: 15, ts: 1, source: 'who' } }
      if (module === 'combo') return combo
      return module === 'tasks' ? { v: 1, tasks: [], truncated: false } : []
    }
  })
  return { service, context: async () => (await service.query({})).context,
    setSlots: (next: ComboSlot[]) => { combo = { ...combo, current: interval('ci2', 2, null, { slots: next }) } } }
}

test('journal automatically includes resolved gameplay classes and labels only inferred classes', async () => {
  const h = harness([slot(['MAG']), slot(['DRU']), slot(['CLR', 'PAL'])])
  const context = await h.context()
  assert.deepEqual(context.classes, ['Magician', 'Druid'])
  assert.deepEqual(context.inferredClasses, context.classes)
  assert.equal(context.profileSource, 'detected')
  assert.equal(context.level, 15)
})

test('who and user class statements stay authoritative in a mixed profile', async () => {
  const h = harness([slot(['PAL'], 'who'), slot(['MNK'], 'user'), slot(['ENC'])])
  assert.deepEqual((await h.context()).classes, ['Paladin', 'Monk', 'Enchanter'])
  assert.deepEqual((await h.context()).inferredClasses, ['Enchanter'])
  h.setSlots([slot(['PAL'], 'who'), slot(['ROG'], 'who'), slot(['BER'], 'who')])
  const stated = await h.context()
  assert.deepEqual(stated.classes, ['Paladin', 'Rogue', 'Berserker'])
  assert.deepEqual(stated.inferredClasses, [])
})

test('ambiguous and empty slots never become selected classes', async () => {
  const h = harness([slot(['CLR', 'PAL']), slot([])])
  assert.deepEqual((await h.context()).classes, [])
  assert.deepEqual((await h.context()).inferredClasses, [])
})

test('manual level preserves inferred class labels; manual classes and reset retain their authority', async () => {
  const h = harness([slot(['MAG']), slot(['DRU'])])
  assert.equal((await h.service.mutate({ characterId: 'Ada@test', action: 'profile', classes: [], level: 20 })).ok, true)
  const mixed = await h.context()
  assert.equal(mixed.profileSource, 'manual')
  assert.equal(mixed.level, 20)
  assert.deepEqual(mixed.inferredClasses, ['Magician', 'Druid'])
  assert.equal((await h.service.mutate({ characterId: 'Ada@test', action: 'profile', classes: ['PAL', 'MNK'] })).ok, true)
  const manual = await h.context()
  assert.deepEqual(manual.classes, ['Paladin', 'Monk'])
  assert.deepEqual(manual.inferredClasses, [])
  h.setSlots([slot(['ROG'], 'who'), slot(['BER'])])
  assert.deepEqual((await h.context()).classes, ['Paladin', 'Monk'])
  assert.equal((await h.service.mutate({ characterId: 'Ada@test', action: 'profile', classes: [] })).ok, true)
  const detected = await h.context()
  assert.deepEqual(detected.classes, ['Rogue', 'Berserker'])
  assert.deepEqual(detected.inferredClasses, ['Berserker'])
  assert.equal(detected.profileSource, 'detected')
})
