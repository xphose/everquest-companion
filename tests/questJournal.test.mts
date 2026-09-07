import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { QuestJournalCatalogEntry } from '../src/shared/questJournal/catalog.ts'
import type { ItemStatBlock } from '../src/shared/itemStats.ts'
import type { ProgressState } from '../src/shared/types.ts'
import { detailJournal, queryJournal, type JournalModelInput } from '../src/main/questJournal/model.ts'
import { exactOutputFile, journalFiles, type JournalFiles } from '../src/main/questJournal/files.ts'
import { createQuestJournalService, type JournalWorld } from '../src/main/questJournal/service.ts'
import { achievementCompletion, finalTrade, supplementInventory } from '../src/main/questJournal/progress.ts'
import { compareRewards, recommend } from '../src/main/questJournal/recommend.ts'
import { applyMutation, sanitizeProgress, sanitizeQuery, validateMutation } from '../src/main/questJournal/validate.ts'

const source = { url: 'https://www.eqlwiki.com/wiki/Test', snapshotAt: '2026-09-06' }
const npc = { name: 'Test NPC', zone: 'Test Zone', sourceUrl: source.url }
const entry: QuestJournalCatalogEntry = {
  id: 'Test quest', name: 'Test quest', page: 'Test quest', source, minLevel: 10,
  classes: ['All'], relatedZones: ['Test Zone'], startZone: 'Test Zone', giver: npc.name,
  expReward: false, pickupLocations: [npc], relatedNpcs: [], referencedItems: [], rewards: [{ name: 'Reward', sourceUrl: source.url }],
  guide: { source, notes: [], steps: [
    { id: 'pickup', kind: 'pickup', text: 'Speak to the NPC', locations: [npc], manualOnly: true },
    { id: 'collect', kind: 'collect', text: 'Collect three tokens', locations: [npc], items: [{ name: 'Token', quantity: 3 }], manualOnly: false },
    { id: 'turnin', kind: 'turn-in', text: 'Return three tokens', locations: [npc], items: [{ name: 'Token', quantity: 3 }], manualOnly: true }
  ] }
}

function input(): JournalModelInput {
  return {
    catalog: [entry], progress: { version: 1, quests: {} }, observed: [], inventory: null, claims: [], worn: [], turnins: [], completedSky: new Set(),
    context: { characterId: 'Ada@test', characterName: 'Ada', level: 15, classes: ['Paladin'], profileSource: 'detected',
      readiness: 'ready', inventory: { state: 'missing' }, achievements: { state: 'missing' }, refreshedAt: 1234, tasksTruncated: false }
  }
}

test('missing evidence is unknown, and tracking or holding a reward cannot accept or complete a quest', () => {
  const data = input()
  data.inventory = { reward: 1, token: 1 }
  data.progress.quests[entry.id] = { tracked: true, steps: {} }
  const result = detailJournal(data, entry.id)
  assert.equal(result.row?.state, 'unknown')
  assert.equal(result.row?.tracked, true)
  assert.equal(result.steps[1].held, 1)
  assert.equal(result.steps[1].complete, false)
})

test('exact quantities make a verified final turn-in ready without checking pickup guidance', () => {
  const data = input()
  data.inventory = { token: 3 }
  const result = detailJournal(data, entry.id)
  assert.equal(result.row?.state, 'ready')
  assert.equal(result.steps[0].complete, false)
  assert.equal(result.steps[1].source, 'inventory')
  assert.equal(result.steps[2].complete, false)
  assert.equal(result.nextStep, 'Return three tokens')
})

test('same-name variants and unverified reference lists never infer readiness', () => {
  const data = input()
  const variant = structuredClone(entry)
  variant.guide!.steps[1].items![0].variant = 'distinct inscription'
  data.catalog = [variant]
  data.inventory = { token: 50 }
  assert.equal(detailJournal(data, entry.id).row?.state, 'unknown')
  assert.equal(detailJournal(data, entry.id).steps[1].source, 'unknown')
  delete variant.guide
  variant.referencedItems = [{ name: 'Token', sources: [npc] }]
  assert.equal(detailJournal(data, entry.id).row?.state, 'unknown')
})

test('manual collection correction can override a stale export without changing completion', () => {
  const data = input()
  data.inventory = { token: 30 }
  data.progress.quests[entry.id] = { steps: { collect: false } }
  const result = detailJournal(data, entry.id)
  assert.equal(result.row?.state, 'unknown')
  assert.equal(result.steps[1].source, 'manual')
  assert.equal(result.steps[1].complete, false)
  data.progress = applyMutation(data.progress, { characterId: 'Ada@test', action: 'step', id: entry.id, stepId: 'collect', value: null })
  assert.equal(detailJournal(data, entry.id).steps[1].source, 'inventory')
  assert.equal(detailJournal(data, entry.id).row?.state, 'ready')
})

test('duplicate requirement names sum their quantities rather than reusing the same token', () => {
  const data = input()
  const changed = structuredClone(entry)
  changed.guide!.steps[1].items = [{ name: 'Token', quantity: 2 }, { name: 'Token', quantity: 2 }]
  data.catalog = [changed]
  data.inventory = { token: 3 }
  const step = detailJournal(data, entry.id).steps[1]
  assert.equal(step.required, 4)
  assert.equal(step.held, 3)
  assert.equal(step.complete, false)
})

test('an exact final trade records the hand-in but never proves quest success', () => {
  const full = { ts: 1, npc: npc.name, items: ['Token', 'Token', 'Token'] }
  assert.equal(finalTrade(entry, [full]), full)
  assert.equal(finalTrade(entry, [{ ...full, npc: 'Other NPC' }]), undefined)
  assert.equal(finalTrade(entry, [{ ...full, items: ['Token'] }]), undefined)
  const counted = { ...full, items: ['Token'], itemCounts: { Token: 3 } }
  assert.equal(finalTrade(entry, [counted]), counted)
  const variant = structuredClone(entry)
  variant.guide!.steps[2].items![0].variant = 'one particular token'
  assert.equal(finalTrade(variant, [full]), undefined)
  const data = input()
  data.turnins = [full]
  const detail = detailJournal(data, entry.id)
  assert.equal(detail.row?.state, 'unknown')
  assert.match(detail.row!.stateLabel, /outcome unknown/u)
  assert.equal(detail.steps[2].source, 'log')
  assert.match(detail.nextStep!, /not confirmed/u)
})

test('hand-in history selects the latest matching trade regardless of input order', () => {
  const older = { ts: 100, npc: npc.name, items: ['Token', 'Token', 'Token'] }
  const newer = { ...older, ts: 300 }
  const unrelated = { ...older, ts: 400, npc: 'Other NPC' }
  assert.equal(finalTrade(entry, [newer, older, unrelated]), newer)
})

test('a new task assignment does not reuse a completed prior run’s hand-in', () => {
  const data = input()
  data.turnins = [{ ts: 100, npc: npc.name, items: ['Token', 'Token', 'Token'] }]
  data.observed = [{ name: entry.name, assignedAt: 200, completedAt: 110, cycleStatus: 'assigned' }]
  const result = detailJournal(data, entry.id)
  assert.equal(result.row?.state, 'active')
  assert.equal(result.row?.stateLabel, 'Task activity recorded')
  assert.equal(result.steps[1].complete, false)
  assert.equal(result.steps[2].complete, false)
  assert.equal(result.nextStep, 'Collect three tokens')
  assert.ok(result.evidence.some((line) => /Previous hand-in.*1970-01-01T00:00:00.100Z/u.test(line)))
  data.turnins.push({ ts: 250, npc: npc.name, items: ['Token', 'Token', 'Token'] })
  assert.equal(detailJournal(data, entry.id).steps[2].source, 'log')
})

test('manual active repeat suppresses old hand-in promotion while current inventory can still make it ready', () => {
  const data = input()
  data.turnins = [{ ts: 100, npc: npc.name, items: ['Token', 'Token', 'Token'] }]
  data.progress.quests[entry.id] = { status: 'active', steps: {} }
  const result = detailJournal(data, entry.id)
  assert.equal(result.row?.state, 'active')
  assert.equal(result.steps[1].complete, false)
  assert.equal(result.steps[2].complete, false)
  assert.equal(result.nextStep, 'Collect three tokens')
  data.inventory = { token: 3 }
  assert.equal(detailJournal(data, entry.id).row?.state, 'ready')
  assert.equal(detailJournal(data, entry.id).steps[2].complete, false)
})

test('inventory supplements only later kept loot and consumes exact trade quantities', () => {
  const inventory = { token: 4 }
  const loot = [
    { ts: 9, item: 'Token', count: 20 },
    { ts: 10, item: 'Token', count: 20 },
    { ts: 11, item: 'Token', count: 2 },
    { ts: 12, item: 'Token', count: 10, disposition: 'sold' as const },
    { ts: 12, item: 'Token', count: 1, disposition: 'destroyed' as const }
  ]
  const trades = [{ ts: 13, npc: npc.name, items: ['Token'], itemCounts: { Token: 3 } }]
  assert.deepEqual(supplementInventory(inventory, 10, loot, trades), { token: 2 })
  assert.deepEqual(inventory, { token: 4 })
  assert.equal(supplementInventory(null, 10, loot, trades), null)
})

test('post-export combines invalidate all uncertain older tiers and cannot leave a false ready count', () => {
  const loot = [{ ts: 12, item: 'Token', created: 'Token +1', disposition: 'combined' as const }]
  assert.deepEqual(supplementInventory({ token: 3, 'token +1': 1, other: 2 }, 10, loot, []), { other: 2 })
})

test('new unknown quests start with pickup guidance and active quests advance to collecting', () => {
  const data = input()
  assert.equal(detailJournal(data, entry.id).nextStep, 'Speak to the NPC')
  data.observed = [{ name: entry.name, cycleStatus: 'assigned' }]
  assert.equal(detailJournal(data, entry.id).nextStep, 'Collect three tokens')
})

test('achievement imports are limited to individual Sky quests and exclude bypass grants', () => {
  const sky = { ...entry, id: 'posky:Paladin::Test quest', classes: ['Paladin'] }
  const claim = { className: 'Paladin', item: 'Reward', grant: 'quest' as const }
  assert.equal(achievementCompletion(sky, [claim]), true)
  assert.equal(achievementCompletion(entry, [claim]), false)
  assert.equal(achievementCompletion(sky, [{ ...claim, grant: 'confirm' }]), false)
  assert.equal(achievementCompletion(sky, [{ ...claim, grant: 'token' }]), false)
  assert.equal(achievementCompletion(sky, [{ ...claim, item: 'Another reward' }]), false)
})

test('the verified Beastlord weapon-pair achievement alias is scoped to one exact Sky test', () => {
  const sky = { ...entry, id: 'posky:Beastlord::Beastlord Test of Claw', classes: ['Beastlord'], rewards: [{ name: 'Windhowl', sourceUrl: source.url }] }
  const claim = { className: 'Beastlord', item: 'Windhowl and Spirit Render', grant: 'quest' as const }
  assert.equal(achievementCompletion(sky, [claim]), true)
  assert.equal(achievementCompletion({ ...sky, id: 'posky:Beastlord::Other quest' }, [claim]), false)
  assert.equal(achievementCompletion(sky, [{ ...claim, item: 'Spirit Render' }]), false)
})

test('observed task lifecycle distinguishes failed/removed from completion and repeated assignments', () => {
  const data = input()
  data.observed = [{ name: 'Unknown task', completedAt: 100, lastChange: 'removed', cycleStatus: 'completed' }]
  assert.equal(queryJournal(data, { search: 'Unknown task' }).rows[0].state, 'completed')
  data.observed[0].cycleStatus = 'removed'
  assert.equal(queryJournal(data, { search: 'Unknown task' }).rows[0].state, 'unknown')
  data.observed[0].cycleStatus = 'assigned'
  assert.equal(queryJournal(data, { search: 'Unknown task' }).rows[0].state, 'active')
  assert.equal(detailJournal(data, 'task:unknown task').observed?.completedAt, 100)
})

test('existing Sky progress imports only its explicit per-character quest ID and allows a repeat run', () => {
  const data = input()
  const sky = { ...entry, id: 'posky:Paladin::Test quest' }
  data.catalog = [entry, sky]
  data.completedSky.add(sky.id)
  assert.equal(detailJournal(data, entry.id).row?.state, 'unknown')
  assert.equal(detailJournal(data, sky.id).row?.state, 'completed')
  data.progress.quests[sky.id] = { status: 'active', steps: {} }
  assert.equal(detailJournal(data, sky.id).row?.state, 'active')
})

test('query bounds, filters, deterministic ranking and unknown class restrictions stay main-side', () => {
  const data = input()
  data.catalog = Array.from({ length: 70 }, (_, i) => ({ ...entry, id: `q${i}`, name: `Quest ${String(i).padStart(2, '0')}` }))
  data.progress.quests.q69 = { tracked: true, steps: {} }
  assert.equal(queryJournal(data, { limit: 100000 }).rows.length, 50)
  assert.equal(queryJournal(data, {}).rows[0].id, 'q69')
  assert.equal(queryJournal(data, { state: 'tracked' }).total, 1)
  assert.equal(queryJournal(data, { zone: 'Other zone' }).total, 0)
  assert.equal(queryJournal(data, { level: 2 }).total, 0)
  assert.equal(queryJournal(data, { sort: 'name', offset: 60, limit: 5 }).rows[0].name, 'Quest 60')
  const restricted = { ...entry, classes: ['All (Evil)'] }
  data.catalog = [restricted]
  assert.equal(queryJournal(data, { className: 'Paladin' }).total, 1)
  assert.equal(recommend(restricted, { level: 15, classes: ['Paladin'] }).fit, 'unknown')
})

function stats(ac: number, classes: string[]): ItemStatBlock {
  return { ac, classes, slot: 'CHEST', flags: [], stats: [{ key: 'HP', value: '+20' }], saves: [], effects: [], exaltationSlots: [], extras: [] }
}

test('reward comparisons honor class and worn slot and never fill absent stats with zero', () => {
  const reward = { ...entry, rewards: [{ name: 'Reward', sourceUrl: source.url, stats: stats(15, ['PAL']) }] }
  const worn = [{ name: 'Old chest', slot: 'CHEST', stats: stats(10, ['PAL']) }, { name: 'Helm', slot: 'HEAD', stats: stats(100, ['PAL']) }]
  const compared = compareRewards(reward, worn, { classes: ['Paladin'] })
  assert.equal(compared.length, 1)
  assert.deepEqual(compared[0].stats[0], { label: 'AC', reward: 15, worn: 10, delta: 5 })
  assert.equal(compareRewards(reward, worn, { classes: ['Wizard'] }).length, 0)
  delete worn[0].stats.ac
  assert.equal(compareRewards(reward, worn, { classes: ['Paladin'] })[0].stats.some((s) => s.label === 'AC'), false)
})

test('validation bounds corrupted stores and rejects nonsensical mutations', () => {
  assert.equal(validateMutation({ characterId: 'none', action: 'track', id: 'q', value: true }), null)
  assert.equal(validateMutation({ characterId: 'Ada', action: 'profile', classes: ['Fake'], level: 10 }), null)
  assert.equal(validateMutation({ characterId: 'Ada', action: 'status', id: 'q', value: { toString: () => 'active' } }), null)
  assert.equal(validateMutation({ characterId: 'Ada', action: 'step', id: '__proto__', stepId: 'x', value: true }), null)
  const clean = sanitizeProgress({ quests: { q: { steps: { a: 'yes', b: true }, status: 'oops' } } })
  assert.deepEqual(clean.quests.q.steps, { b: true })
  assert.equal(clean.quests.q.status, undefined)
  assert.equal(sanitizeQuery({ limit: Infinity, offset: -99 }).offset, 0)
  const next = applyMutation(clean, { characterId: 'Ada', action: 'track', id: 'q', value: true })
  assert.equal(next.quests.q.tracked, true)
  assert.equal(next.quests.q.status, undefined)
})

function harness() {
  let world: JournalWorld = { characterId: 'Ada@test', character: { name: 'Ada', server: 'test', logPath: 'eqlog_Ada_test.txt' }, token: '1:1', readiness: 'ready' }
  const stores: Record<string, ProgressState> = {}
  let writes = 0
  let snapshot: (module: string) => Promise<unknown> = async (module) => {
    if (module === 'tasks') return { v: 1, tasks: [], truncated: false }
    if (module === 'character') return { character: world.character, level: { level: 15, ts: 1, source: 'who' } }
    return module === 'combo' ? { current: null } : []
  }
  const files: JournalFiles = { inventoryStatus: { state: 'missing' }, achievementsStatus: { state: 'missing' }, inventory: null, claims: [], worn: [] }
  const service = createQuestJournalService({
    world: () => world, catalog: () => [entry], files: () => files, now: () => 100,
    snapshot: (module) => snapshot(module),
    getProgress: (id) => stores[id] ?? { inventory: {}, completedQuests: [] },
    setProgress: (id, progress) => { stores[id] = progress; writes++ }
  })
  return { service, stores, files, writes: () => writes, setWorld: (next: JournalWorld) => { world = next },
    world: () => world, setSnapshot: (next: typeof snapshot) => { snapshot = next } }
}

test('mutations are scoped, reject a stale expected character and preserve unrelated progress', async () => {
  const h = harness()
  h.stores['Ada@test'] = { inventory: { item: 3 }, completedQuests: ['Legacy'] }
  assert.equal((await h.service.mutate({ characterId: 'Other@test', action: 'track', id: entry.id, value: true })).ok, false)
  assert.equal(h.writes(), 0)
  assert.equal((await h.service.mutate({ characterId: 'Ada@test', action: 'track', id: entry.id, value: true })).ok, true)
  assert.deepEqual(h.stores['Ada@test'].inventory, { item: 3 })
  assert.deepEqual(h.stores['Ada@test'].completedQuests, ['Legacy'])
  assert.equal(h.stores['Other@test'], undefined)
})

test('no-character discovery works and no mutation can write under none', async () => {
  const h = harness()
  h.setWorld({ characterId: null, character: null, token: '1:1', readiness: 'unavailable' })
  const result = await h.service.query({})
  assert.equal(result.total, 1)
  assert.equal(result.context.characterId, null)
  assert.equal((await h.service.mutate({ characterId: 'none', action: 'track', id: entry.id, value: true })).ok, false)
  assert.equal((await h.service.mutate({ characterId: 'Ada@test', action: 'track', id: entry.id, value: true })).ok, false)
  assert.equal(h.writes(), 0)
})

test('asynchronous reads and writes reject replacement engine epochs even for the same character', async () => {
  const h = harness()
  let finish!: (value: unknown) => void
  const pending = new Promise((resolve) => { finish = resolve })
  h.setSnapshot(async (module) => module === 'tasks' ? pending : null)
  const query = h.service.query({})
  const mutation = h.service.mutate({ characterId: 'Ada@test', action: 'track', id: entry.id, value: true })
  h.setWorld({ ...h.world(), token: '2:2' })
  finish({ v: 1, tasks: [], truncated: false })
  await assert.rejects(query, /engine changed/u)
  assert.equal((await mutation).ok, false)
  assert.equal(h.writes(), 0)
})

test('engine unavailability leaves unknown observations explicit while profiles persist per character', async () => {
  const h = harness()
  h.setSnapshot(async () => { throw new Error('engine unavailable') })
  assert.equal((await h.service.query({})).context.readiness, 'unavailable')
  assert.equal((await h.service.mutate({ characterId: 'Ada@test', action: 'profile', level: 20, classes: ['PAL', 'MNK'] })).ok, true)
  const context = (await h.service.query({})).context
  assert.equal(context.profileSource, 'manual')
  assert.equal(context.level, 20)
  assert.deepEqual(context.classes, ['Paladin', 'Monk'])
})

test('exact output discovery never borrows another character, server or ambiguous legacy filename', () => {
  const root = mkdtempSync(join(tmpdir(), 'eqc-journal-'))
  try {
    const character = { name: 'Ada', server: 'test', logPath: 'eqlog_Ada_test.txt' }
    writeFileSync(join(root, 'Other_test-Inventory.txt'), 'wrong character')
    writeFileSync(join(root, 'Ada_other-Inventory.txt'), 'wrong server')
    writeFileSync(join(root, 'Ada-Inventory.txt'), 'ambiguous server')
    assert.equal(exactOutputFile(root, character, 'inventory'), null)
    writeFileSync(join(root, 'ADA_TEST-inventory.txt'), 'exact character')
    assert.equal(exactOutputFile(root, character, 'inventory')?.text, 'exact character')
    mkdirSync(join(root, 'Ada_test-Achievements.txt'))
    assert.throws(() => exactOutputFile(root, character, 'achievements'), /supported file/u)
    const loaded = journalFiles(root, character, { source: '', scrapedAt: '', count: 0, items: {} })
    assert.equal(loaded.inventoryStatus.state, 'error')
    assert.equal(loaded.inventory, null)
    assert.equal(loaded.achievementsStatus.state, 'error')
  } finally { rmSync(root, { recursive: true, force: true }) }
})
