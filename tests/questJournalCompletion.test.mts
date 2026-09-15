import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { QuestJournalCatalogEntry } from '../src/shared/questJournal/catalog'
import type { ProgressState, TurnInEvent } from '../src/shared/types'
import { getQuestJournalCatalog } from '../src/main/questJournal/catalog'
import { detailJournal, queryJournal, type JournalModelInput } from '../src/main/questJournal/model'
import { createQuestJournalService } from '../src/main/questJournal/service'
import { rewardedFinalTrades } from '../src/main/questJournal/progress'

const source = { url: 'https://example.test/quest', snapshotAt: '2026-09-01' }
const npc = { name: 'Test Keeper', zone: 'Test Zone', sourceUrl: source.url }
const entry: QuestJournalCatalogEntry = {
  id: 'Test hand-in', name: 'Test hand-in', page: 'Test hand-in', source,
  classes: [], relatedZones: [], expReward: true, pickupLocations: [], relatedNpcs: [], referencedItems: [], rewards: [],
  guide: { source, notes: [], steps: [
    { id: 'collect', kind: 'collect', text: 'Collect tokens', locations: [], manualOnly: false, items: [{ name: 'Token', quantity: 4 }] },
    { id: 'return', kind: 'turn-in', text: 'Return four tokens', locations: [npc], manualOnly: true, items: [{ name: 'Token', quantity: 4 }] }
  ] }
}
type RewardedTrade = TurnInEvent & { experienceAt?: number }
const trade: RewardedTrade = { ts: 10000, experienceAt: 9000, npc: npc.name, items: ['Token'], itemCounts: { Token: 4 } }
function input(): JournalModelInput {
  return { catalog: [entry], progress: { version: 1, quests: {} }, observed: [], inventory: null,
    claims: [], worn: [], turnins: [trade], completedSky: new Set(),
    context: { characterId: 'test_fixture', profileSource: 'unknown', classes: [], readiness: 'ready',
      inventory: { state: 'missing' }, achievements: { state: 'missing' }, refreshedAt: 20000, tasksTruncated: false } }
}

test('an untracked exact final hand-in with experience completes without a named task message or progress write', () => {
  const model = input()
  const detail = detailJournal(model, entry.id)
  assert.equal(detail.row?.tracked, false)
  assert.equal(detail.row?.state, 'completed')
  assert.match(detail.row!.stateLabel, /hand-in and experience/u)
  assert.match(detail.evidence.join(' '), /experience awarded during that trade/u)
  assert.equal(detail.steps[1].source, 'log')
  assert.deepEqual(model.progress.quests, {})
  assert.equal(queryJournal(model, { state: 'todo' }).total, 0)
  assert.equal(queryJournal(model, { state: 'completed' }).total, 1)
  assert.equal(queryJournal(model, { state: 'all' }).total, 1)
  model.progress.quests[entry.id] = { tracked: true, steps: {} }
  assert.equal(queryJournal(model, { state: 'tracked' }).rows[0].state, 'completed')
})

test('wrong NPC, wrong count, extra items, missing/stale/future reward and missing XP metadata never complete', () => {
  const rejected: RewardedTrade[] = [
    { ...trade, npc: 'Other Keeper' }, { ...trade, itemCounts: { Token: 3 } },
    { ...trade, itemCounts: { Token: 5 } }, { ...trade, itemCounts: { Token: 4, Other: 1 } },
    { ...trade, experienceAt: undefined }, { ...trade, experienceAt: 4999 },
    { ...trade, experienceAt: 10001 }, { ...trade, experienceAt: NaN }
  ]
  for (const candidate of rejected) assert.equal(rewardedFinalTrades([entry], [candidate]).size, 0)
  assert.equal(rewardedFinalTrades([{ ...entry, expReward: false }], [trade]).size, 0)
  assert.equal(rewardedFinalTrades([{ ...entry, guide: undefined }], [trade]).size, 0)
  const model = input()
  model.turnins = []; model.inventory = { token: 4 }
  assert.equal(detailJournal(model, entry.id).row?.state, 'ready')
})

test('same-requirement quests stay ambiguous across the whole catalog, even with incomplete reward metadata', () => {
  const duplicate = { ...entry, id: 'Other quest', name: 'Other quest', expReward: false }
  assert.equal(rewardedFinalTrades([entry, duplicate], [trade]).size, 0)
  const variant = structuredClone(entry)
  variant.guide!.steps[1].items![0].variant = 'unique inscription'
  assert.equal(rewardedFinalTrades([variant], [trade]).size, 0)
  assert.equal(rewardedFinalTrades([entry, { ...variant, id: 'Variant quest' }], [trade]).size, 0)
})

test('manual state and newer task cycles suppress historical reward evidence; a later repeat hand-in completes', () => {
  const model = input()
  model.progress.quests[entry.id] = { status: 'active', steps: {} }
  assert.equal(detailJournal(model, entry.id).row?.state, 'active')
  model.progress.quests = {}
  model.observed = [{ name: entry.name, completedAt: 10000, assignedAt: 11000, lastObservedAt: 11000, cycleStatus: 'assigned' }]
  assert.equal(detailJournal(model, entry.id).row?.state, 'active')
  model.turnins.push({ ...trade, ts: 13000, experienceAt: 12000 } as RewardedTrade)
  assert.equal(detailJournal(model, entry.id).row?.state, 'completed')
  model.observed = [{ name: entry.name, failedAt: 14000, lastObservedAt: 14000, cycleStatus: 'failed' }]
  assert.equal(detailJournal(model, entry.id).row?.state, 'unknown')
  model.observed = [{ name: entry.name, completedAt: 15000, lastObservedAt: 15000, cycleStatus: 'completed' }]
  assert.equal(detailJournal(model, entry.id).row?.state, 'completed')
})

test('recovered active baselines preserve repeat runs until a subsequent rewarded hand-in', () => {
  const model = input()
  model.progress.recovery = { [entry.id]: { questId: entry.id, name: entry.name, state: 'active', source: 'task-window',
    confidence: 'confirmed', recoveredAt: 11000, evidence: ['Synthetic current task capture'] } }
  assert.equal(detailJournal(model, entry.id).row?.state, 'active')
  model.turnins.push({ ...trade, ts: 13000, experienceAt: 12000 } as RewardedTrade)
  assert.equal(detailJournal(model, entry.id).row?.state, 'completed')
})

test('service startup archives automatic completion separately and restores it after the log is gone', async () => {
  const model = input()
  let progress: ProgressState = { inventory: {}, completedQuests: [] }
  const start = () => createQuestJournalService({
    world: () => ({ characterId: 'test_fixture', character: null, readiness: 'ready', token: 'test' }), catalog: () => model.catalog,
    snapshot: async module => module === 'tasks' ? { v: 1, tasks: [], truncated: false } : module === 'turnins' ? model.turnins : [],
    files: () => ({ inventory: null, claims: [], worn: [], inventoryStatus: { state: 'missing' }, achievementsStatus: { state: 'missing' } }),
    now: () => 20000, getProgress: () => progress,
    setProgress: (_id, next) => { progress = next }
  })
  for (const service of [start(), start()]) {
    const result = await service.query({ state: 'completed' })
    assert.equal(result.rows[0]?.id, entry.id)
    assert.equal(result.rows[0]?.tracked, false)
    assert.deepEqual(progress.questJournal?.quests, {}, 'Observation must not write manual completion')
    model.turnins = []
  }
})

test('Froglock guide preserves source quantities, faction and recipient without speculative coordinates or rewards', () => {
  const catalog = getQuestJournalCatalog()
  const frog = catalog.find(row => row.id === 'Froglock Tadpole Fleshies')!
  assert.ok(frog.expReward)
  assert.deepEqual(frog.guide?.steps.at(-1)?.items, [{ name: 'Froglok Tadpole Flesh', quantity: 4 }])
  assert.equal(frog.guide?.steps.at(-1)?.locations[0].name, 'Zulort')
  assert.equal(frog.guide?.steps.at(-1)?.locations[0].zone, 'Oggok')
  assert.equal(frog.guide?.steps.at(-1)?.locations[0].loc, undefined)
  assert.ok(frog.guide?.notes.some(note => note.includes('higher than Indifferent')))
  assert.deepEqual(frog.rewards, [])
  const result = rewardedFinalTrades(catalog, [{ ...trade, npc: 'Zulort', items: ['Froglok Tadpole Flesh'], itemCounts: { 'Froglok Tadpole Flesh': 4 } }])
  assert.deepEqual([...result.keys()], [frog.id])
})
