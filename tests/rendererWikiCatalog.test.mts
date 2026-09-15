import { test } from 'node:test'
import assert from 'node:assert/strict'
import { installReferenceData } from '../src/renderer/src/lib/referenceData'
import { wikiRefreshMessage } from '../src/renderer/src/lib/wikiCatalogStatus'
import type { WikiRefreshStatus } from '../src/shared/wikiCatalog'
import type { GearRow } from '../src/shared/planner/gear'

const STAMP = '2030-01-15T12:00:00.000Z'
const STATUS: WikiRefreshStatus = { state: 'idle', activeUpdatedAt: STAMP, lastCheckedAt: null, nextCheckAt: null, pendingUpdatedAt: null, autoCheckDays: 1 }

test('all renderer indexes start from the installed mob and quest snapshot', async () => {
  installReferenceData({ generation: 'synthetic-refresh',
    mobs: { scrapedAt: STAMP, source: 'synthetic fixture', mobs: [{ page: 'Test Scout', name: 'test scout', zones: ['The Feerrott'], drops: ['Test Cap'], loc: [{ ns: 12, ew: 34 }] }] },
    quests: { scrapedAt: STAMP, source: 'synthetic fixture', quests: [{ page: 'Test Errand', name: 'Test Errand', giver: 'test scout', rewards: [{ name: 'Test Cap' }] }] }
  })
  // These dynamic imports mirror the boot boundary, before their singleton indexes capture data.
  const { searchMobs } = await import('../src/renderer/src/features/mobs/mobSearch')
  const { sourcesFor } = await import('../src/renderer/src/lib/itemSources')
  const { gearAcquisitions, GEAR_ACQUISITION_SNAPSHOTS } = await import('../src/renderer/src/features/gear/gearAcquisitionData')
  assert.equal(searchMobs('test scout')[0].entry.loc?.[0].ns, 12)
  assert.equal(searchMobs('Clurg').length, 0, 'no bundled rows mixed into the active snapshot')
  assert.equal(sourcesFor('test cap')[0].mob, 'test scout')
  const row: GearRow = { key: 'test cap', name: 'Test Cap', searchKey: 'test cap', slots: ['HEAD'], classes: ['ALL'], races: ['ALL'], flags: [], quest: false, playerCrafted: false, stats: {}, effects: [] }
  const sources = gearAcquisitions([row]).get('test cap')!
  assert.deepEqual(new Set(sources.map(source => source.kind)), new Set(['drop', 'quest']))
  assert.equal(sources.find(source => source.kind === 'quest')?.name, 'Test Errand')
  assert.deepEqual(GEAR_ACQUISITION_SNAPSHOTS, { mobs: STAMP, quests: STAMP })
  assert.throws(() => installReferenceData({ generation: 'later', mobs: { scrapedAt: STAMP, source: '', mobs: [] }, quests: { scrapedAt: STAMP, source: '', quests: [] } }), /before opening/,
    'an already used snapshot cannot change partway through a session')
})

test('status copy never presents a completed download as already active', () => {
  assert.match(wikiRefreshMessage(STATUS), /first automatic wiki check/)
  assert.match(wikiRefreshMessage({ ...STATUS, lastCheckedAt: STAMP }), /last wiki check/)
  assert.match(wikiRefreshMessage({ ...STATUS, state: 'ready', pendingUpdatedAt: STAMP }), /Restart Companion/)
  assert.match(wikiRefreshMessage({ ...STATUS, state: 'downloading', completedPages: 2, totalPages: 10 }), /2 of 10/)
  assert.match(wikiRefreshMessage({ ...STATUS, state: 'error' }), /current data is still available; we will retry automatically/)
})
