import test from 'node:test'
import assert from 'node:assert/strict'
import type { PlayerLocation, PlayerLocationResult } from '../src/shared/playerLocation'
import type { ProgressState } from '../src/shared/types'
import { createQuestJournalService, type JournalWorld } from '../src/main/questJournal/service'

const character = { name: 'Wayfinder', server: 'test', logPath: 'eqlog_Wayfinder_test.txt' }
const location: PlayerLocation = { characterName: character.name, zone: 'akanon', ns: 1138,
  ew: -969, z: 3, heading: 150, level: 10, sampledAt: 10_000 }

function harness() {
  let stored: ProgressState = { inventory: {}, completedQuests: [] }
  let world: JournalWorld = { characterId: 'wayfinder_test', character, token: '1:1', readiness: 'ready' }
  let read: () => Promise<PlayerLocationResult> = async () => ({ state: 'live', location })
  const service = createQuestJournalService({
    world: () => world, now: () => 10_000,
    catalog: () => [{ id: 'level-ten', name: 'Level ten quest', page: 'Level ten quest',
      source: { url: 'https://www.eqlwiki.com/wiki/Test', snapshotAt: '2026-09-06' }, minLevel: 10,
      classes: ['All'], relatedZones: [], expReward: false, pickupLocations: [], relatedNpcs: [], referencedItems: [], rewards: [] }],
    files: () => ({ inventoryStatus: { state: 'missing' }, achievementsStatus: { state: 'missing' }, inventory: null, claims: [], worn: [] }),
    getProgress: () => stored, setProgress: (_id, value) => { stored = value },
    snapshot: async module => module === 'character' ? { character, level: { level: 5, ts: 1, source: 'levelup' } }
      : module === 'tasks' ? { v: 1, tasks: [], truncated: false } : module === 'combo' ? null : [],
    livePlayer: () => read()
  })
  return { service, query: () => service.query({}),
    publish: (result: PlayerLocationResult) => { read = async () => result },
    reader: (next: typeof read) => { read = next },
    world: (next: Partial<JournalWorld>) => { world = { ...world, ...next } } }
}

test('a live level replaces the old log level for the journal and quest recommendations', async () => {
  const h = harness()
  const result = await h.query()
  assert.equal(result.context.level, 10)
  assert.equal(result.context.levelSource, 'live')
  assert.equal(result.context.profileSource, 'detected')
  assert.equal(result.rows[0].recommendation.fit, 'suitable')
  assert.equal((await h.service.detail({ characterId: 'wayfinder_test', id: 'level-ten' })).context.level, 10)
  for (const level of [11, 9]) {
    h.publish({ state: 'live', location: { ...location, level } })
    const updated = await h.query()
    assert.equal(updated.context.level, level)
    assert.equal(updated.rows[0].recommendation.fit, level < 10 ? 'later' : 'suitable')
  }
})

test('manual class corrections keep level automatic; explicit level corrections remain until reset', async () => {
  const h = harness()
  const change = (value: { level?: number; classes: string[] }) => h.service.mutate({ characterId: 'wayfinder_test', action: 'profile', ...value })
  assert.equal((await change({ classes: ['Wizard'] })).ok, true)
  assert.equal((await h.query()).context.level, 10)
  assert.equal((await h.query()).context.levelSource, 'live')
  assert.equal((await change({ level: 20, classes: ['Wizard'] })).ok, true)
  h.publish({ state: 'live', location: { ...location, level: 11 } })
  assert.equal((await h.query()).context.level, 20)
  assert.equal((await h.query()).context.levelSource, 'manual')
  assert.equal((await change({ classes: [] })).ok, true)
  assert.equal((await h.query()).context.level, 11)
})

test('stale, invalid, missing and other-character levels fall back to labeled log evidence', async () => {
  const h = harness()
  const invalid: PlayerLocationResult[] = [
    { state: 'not-running', reason: 'Game closed' },
    ...[{ characterName: 'Other' }, { sampledAt: 8499 }, { sampledAt: 10001 }, { sampledAt: NaN },
      { level: undefined }, { level: 0 }, { level: 126 }, { level: 10.5 }].map(change =>
      ({ state: 'live' as const, location: { ...location, ...change } }))
  ]
  for (const result of invalid) {
    h.publish(result)
    assert.equal((await h.query()).context.level, 5)
    assert.equal((await h.query()).context.levelSource, 'log')
  }
  h.reader(async () => { throw new Error('Reader unavailable') })
  assert.equal((await h.query()).context.level, 5)
})

test('the live level is independent of log readiness and refuses a character switch mid-read', async () => {
  const h = harness()
  h.world({ readiness: 'unavailable' })
  assert.equal((await h.query()).context.level, 10)
  h.reader(async () => {
    h.world({ characterId: 'other_test', character: { ...character, name: 'Other', logPath: 'eqlog_Other_test.txt' } })
    return { state: 'live', location }
  })
  await assert.rejects(h.query, /active character or engine changed/)
})

test('a catalog-only journal never starts the native reader', async () => {
  const h = harness()
  h.world({ characterId: null, character: null })
  let called = false
  h.reader(async () => { called = true; return { state: 'live', location } })
  assert.equal((await h.query()).context.level, undefined)
  assert.equal(called, false)
})
