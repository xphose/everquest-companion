import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runWikiRefresh, type WikiRefreshCheckpoint } from '../src/main/wikiRefresh/update'
import { readWikiCheckpoint } from '../src/main/wikiRefresh/updateCheckpoint'
import { validateWikiCatalogPack, type WikiCatalogPack } from '../src/shared/wikiCatalog'
import { knownWikiPages, parseWikiPage } from '../src/main/wikiRefresh/parse'
const before = '2026-08-22T00:00:00Z'
const after = '2026-09-15T00:00:00Z'
const questText = `{| class="questTopTable"
! Quest Giver:
| [[Test Keeper]]
|-
! Minimum Level:
| 5 (fight is harder)
|}
== Reward ==
{{:Test Token}}
== Walkthrough ==
Bring two [[Test Token]] to the keeper. {{YouGainExperience}}`
function base(): WikiCatalogPack {
  return { schemaVersion: 1, baseFingerprint: 'synthetic', generation: 'bundled', checkedAt: before,
    items: { scrapedAt: before, source: 'synthetic', count: 1, items: { 'test token': { page: 'Test Token', quest: true } } },
    mobs: { scrapedAt: before, source: 'synthetic', mobs: [{ page: 'Test Keeper', name: 'Test Keeper', drops: ['Old Token'] }] },
    quests: { scrapedAt: before, source: 'synthetic', quests: [{ page: 'Test Errand', name: 'Test Errand', giver: 'Old Keeper' }] },
    metadata: { snapshotAt: before, levelNotes: {}, walkthroughs: {} }
  }
}
const revision = (title: string, text: string) => ({ title, revisions: [{ slots: { main: { content: text } } }] })
interface FakeOptions { changes?: string[]; pages?: Record<string, string | null>; oldest?: string; onRequest?: (p: URLSearchParams) => Response | undefined }
function wiki(options: FakeOptions = {}): { fetch: typeof fetch; calls: URLSearchParams[] } {
  const calls: URLSearchParams[] = []
  return { calls, fetch: async (url) => {
    const p = new URL(String(url)).searchParams
    calls.push(p)
    const override = options.onRequest?.(p)
    if (override) return override
    if (p.get('rclimit') === '1') return Response.json({ curtimestamp: after, query: { recentchanges: [{ title: 'Old', timestamp: options.oldest ?? '2026-06-01T00:00:00Z' }] } })
    if (p.get('list') === 'recentchanges') return Response.json({ query: { recentchanges: (options.changes ?? []).map((title) => ({ title })) } })
    if (p.get('list') === 'allpages') return Response.json({ query: { allpages: Object.keys(options.pages ?? {}).map((title) => ({ title })) } })
    const pages = (p.get('titles') ?? '').split('|').map((title) => {
      const text = options.pages?.[title]
      assert.notEqual(text, undefined, `unexpected requested page ${title}`)
      return text === null ? { title, missing: true } : revision(title, text!)
    })
    return Response.json({ query: { pages } })
  } }
}
const noSleep = async (): Promise<void> => { /* synthetic time: no network waits */ }

function bundledBase(): WikiCatalogPack {
  const bundled = { ...base(),
    items: JSON.parse(readFileSync(new URL('../src/main/data/items.json', import.meta.url), 'utf8')),
    mobs: JSON.parse(readFileSync(new URL('../src/renderer/src/data/eqlegends/mobs.json', import.meta.url), 'utf8')),
    quests: JSON.parse(readFileSync(new URL('../src/renderer/src/data/eqlegends/quests.json', import.meta.url), 'utf8')),
    metadata: JSON.parse(readFileSync(new URL('../src/main/data/questJournalMetadata.json', import.meta.url), 'utf8'))
  }
  // Generator-only extra provenance is deliberately outside the runtime pack projection.
  bundled.metadata = { snapshotAt: bundled.metadata.snapshotAt, levelNotes: bundled.metadata.levelNotes, walkthroughs: bundled.metadata.walkthroughs }
  return bundled
}

test('no changes advance only completed watermark; real bundled catalog also stays a no-op', async () => {
  for (const initial of [base(), bundledBase()]) {
    const source = wiki()
    assert.equal(validateWikiCatalogPack(initial), true)
    const result = await runWikiRefresh({ base: initial, fetch: source.fetch, sleep: noSleep })
    assert.equal(result.checkedAt, after)
    assert.notEqual(result.generation, initial.generation)
    assert.deepEqual(result.items, initial.items)
    assert.deepEqual(result.mobs, initial.mobs)
    assert.deepEqual(result.quests, initial.quests)
    assert.deepEqual(result.metadata, initial.metadata)
    assert.equal(source.calls.length, 2)
  }
})

test('unrelated wiki edits and identical item refreshes do not announce data changes from ordering', async () => {
  const initial = bundledBase()
  const source = wiki({ changes: ['Unrelated Help'], pages: { 'Unrelated Help': 'Plain help page prose.' } })
  const result = await runWikiRefresh({ base: initial, fetch: source.fetch, sleep: noSleep })
  assert.equal(result.metadata.snapshotAt, initial.metadata.snapshotAt)
  assert.equal(result.items.scrapedAt, initial.items.scrapedAt)
  const synthetic = base()
  const text = '{{Itempage\n|itemname=Test Token\n|statsblock=QUEST ITEM\n}}'
  synthetic.items.items['test token'] = parseWikiPage('Test Token', text, knownWikiPages(synthetic)).item!
  const same = await runWikiRefresh({ base: synthetic, fetch: wiki({ changes: ['Test Token'], pages: { 'Test Token': text } }).fetch, sleep: noSleep })
  assert.equal(same.metadata.snapshotAt, synthetic.metadata.snapshotAt)
  assert.deepEqual(same.items.items['test token'], synthetic.items.items['test token'])
})

test('changed item stats, NPC drops and quest walkthrough publish as one validated pack', async () => {
  const initial = base()
  const source = wiki({ changes: ['Test Token', 'Test Keeper', 'Test Errand'], pages: {
    'Test Token': '{{Itempage\n|statsblock=QUEST ITEM<br>AC: 5\n}}',
    'Test Keeper': '{{Namedmobpage\n|name=Test Keeper\n|level=4\n|zone=[[Test Meadow]]\n|known_loot={{:Test Token}}\n}}',
    'Test Errand': questText
  } })
  const result = await runWikiRefresh({ base: initial, fetch: source.fetch, sleep: noSleep })
  assert.equal(result.items.items['test token'].stats?.ac, 5)
  assert.deepEqual(result.mobs.mobs[0].drops, ['Test Token'])
  assert.equal(result.quests.quests[0].giver, 'Test Keeper')
  assert.equal(result.metadata.levelNotes['Test Errand'], '5 (fight is harder)')
  assert.match(JSON.stringify(result.metadata.walkthroughs), /Bring two Test Token/)
  assert.deepEqual([result.items.scrapedAt, result.mobs.scrapedAt, result.quests.scrapedAt, result.metadata.snapshotAt], [after, after, after, after])
  assert.equal(initial.quests.quests[0].giver, 'Old Keeper')
})

test('partial response and malformed known pages cannot replace the previous catalog', async () => {
  for (const options of [
    { changes: ['Test Token'], pages: { 'Test Token': '{{Itempage}}' } },
    { changes: ['Test Keeper'], pages: { 'Test Keeper': 'unrecognized NPC template' } },
    { changes: ['Test Errand'], pages: { 'Test Errand': 'unrecognized quest format' } },
    { changes: ['Test Token'], onRequest: (p: URLSearchParams) => p.has('titles') ? Response.json({ query: { pages: [] } }) : undefined }
  ]) {
    const initial = base()
    const snapshot = structuredClone(initial)
    await assert.rejects(runWikiRefresh({ base: initial, fetch: wiki(options).fetch, sleep: noSleep }))
    assert.deepEqual(initial, snapshot)
  }
})

test('renamed item names shed stale aliases; redirects and explicit removals are resolved', async () => {
  const initial = base()
  initial.items.items['old name'] = { page: 'Test Token', name: 'Old Name', quest: true }
  const source = wiki({ changes: ['Test Token', 'Test Keeper', 'Old Alias'], pages: {
    'Test Token': '{{Itempage\n|itemname=New Name\n|statsblock=QUEST ITEM\n}}',
    'Test Keeper': null, 'Old Alias': '#REDIRECT [[Test Token]]'
  } })
  const result = await runWikiRefresh({ base: initial, fetch: source.fetch, sleep: noSleep })
  assert.equal(result.items.items['old name'], undefined)
  assert.equal(result.items.items['new name'].page, 'Test Token')
  assert.equal(result.items.items['old alias'].page, 'Test Token')
  assert.equal(result.mobs.mobs.length, 0)
})

test('quest redirects preserve saved page identity and parse prose targets without quest categories', async () => {
  const source = wiki({ changes: ['Test Errand'], pages: {
    'Test Errand': '#REDIRECT [[Renamed Errand]]',
    'Renamed Errand': '== Reward ==\n{{:Test Token}}\n== Walkthrough ==\nBring a Test Token.'
  } })
  const result = await runWikiRefresh({ base: base(), fetch: source.fetch, sleep: noSleep })
  assert.deepEqual(result.quests.quests.map((q) => q.page), ['Test Errand'])
  assert.match(JSON.stringify(result.metadata.walkthroughs), /Bring a Test Token/)
})

test('recentchanges pagination includes move target and cannot silently accept repeated cursors', async () => {
  const source = wiki({ pages: { 'Test Token': null, 'New Token': '{{Itempage\n|statsblock=QUEST ITEM\n}}' },
    onRequest: (p) => {
      if (p.get('rclimit') !== '500') return undefined
      return p.has('rccontinue') ? Response.json({ query: { recentchanges: [] } }) : Response.json({ continue: { rccontinue: 'next', continue: '-||' }, query: { recentchanges: [{ title: 'Test Token', logtype: 'move', logparams: { target_title: 'New Token' } }] } })
    }
  })
  const result = await runWikiRefresh({ base: base(), fetch: source.fetch, sleep: noSleep })
  assert.ok(result.items.items['new token'])
  assert.equal(source.calls.filter((p) => p.get('rclimit') === '500').length, 2)
  const repeat = wiki({ onRequest: (p) => p.get('rclimit') === '500' ? Response.json({ continue: { rccontinue: 'same' }, query: { recentchanges: [] } }) : undefined })
  await assert.rejects(runWikiRefresh({ base: base(), fetch: repeat.fetch, sleep: noSleep }), /repeated/)
})

test('retention gap enumerates full namespace and resumes after interrupted content without skipping pages', async () => {
  const initial = base()
  const pages = { 'Test Token': '{{Itempage\n|statsblock=QUEST ITEM\n}}', 'Test Keeper': '{{Namedmobpage\n|name=Test Keeper\n}}', 'Test Errand': questText }
  let checkpoint: WikiRefreshCheckpoint | undefined
  const first = wiki({ oldest: '2026-09-01T00:00:00Z', pages, onRequest: (p) => { if (p.has('titles')) throw new Error('offline') } })
  await assert.rejects(runWikiRefresh({ base: initial, fetch: first.fetch, sleep: noSleep, onCheckpoint: (c) => { checkpoint = structuredClone(c) } }), /offline/)
  assert.equal(checkpoint?.mode, 'full')
  assert.equal(checkpoint?.phase, 'download')
  assert.equal(checkpoint?.nextIndex, 0)
  const second = wiki({ pages })
  await runWikiRefresh({ base: initial, checkpoint, fetch: second.fetch, sleep: noSleep })
  assert.equal(second.calls.length, 1)
  assert.equal(second.calls[0].get('prop'), 'revisions')
})

test('resumed incomplete recentchanges indexes remeasure retention before claiming completion', async () => {
  const initial = base()
  const checkpoint: WikiRefreshCheckpoint = { schemaVersion: 1, baseGeneration: initial.generation, baseFingerprint: initial.baseFingerprint,
    watermark: after, mode: 'incremental', phase: 'index', cursor: { rccontinue: 'old' }, titles: [], nextIndex: 0, pages: {} }
  const source = wiki({ oldest: '2026-09-01T00:00:00Z', pages: { 'Test Token': null, 'Test Keeper': null, 'Test Errand': null } })
  const result = await runWikiRefresh({ base: initial, checkpoint, fetch: source.fetch, sleep: noSleep })
  assert.ok(source.calls.some((p) => p.get('list') === 'allpages'))
  assert.equal(result.quests.quests.length, 0)
})

test('corrupt checkpoints cannot skip downloaded prefixes, title identities, or validation', () => {
  const initial = base()
  const checkpoint: WikiRefreshCheckpoint = { schemaVersion: 1, baseGeneration: initial.generation, baseFingerprint: initial.baseFingerprint,
    watermark: after, mode: 'incremental', phase: 'download', cursor: {}, titles: ['Test Token'], nextIndex: 1,
    pages: { 'Test Token': { title: 'Test Token', missing: true } } }
  assert.ok(readWikiCheckpoint(checkpoint, initial))
  for (const bad of [
    { ...checkpoint, pages: {} }, { ...checkpoint, titles: ['Test Token', 'Test_Token'] },
    { ...checkpoint, pages: { other: { title: 'Test Token', missing: true } } },
    { ...checkpoint, pages: { 'Test Token': { title: 'Other', missing: true } } },
    { ...checkpoint, pages: { 'Test Token': { title: 'Test Token', item: { page: 'Test Token', stats: 'bad' } } } },
    { ...checkpoint, phase: 'index' }, { ...checkpoint, baseGeneration: 'different' }
  ]) assert.equal(readWikiCheckpoint(bad, initial), undefined)
})

test('page identity preserves case after the first letter when one of two similar titles changes', async () => {
  const initial = base()
  initial.mobs.mobs.push({ page: 'Test keeper', name: 'Test keeper', drops: ['Other Token'] })
  for (const changes of [['Test Keeper'], ['Test Keeper', 'Test keeper']]) {
    const source = wiki({ changes, pages: {
      'Test Keeper': '{{Namedmobpage\n|name=Test Keeper\n|known_loot={{:New Token}}\n}}',
      'Test keeper': '{{Namedmobpage\n|name=Test keeper\n|known_loot={{:Other Token}}\n}}'
    } })
    const result = await runWikiRefresh({ base: initial, fetch: source.fetch, sleep: noSleep })
    assert.equal(result.mobs.mobs.length, 2)
    assert.deepEqual(result.mobs.mobs.find((mob) => mob.page === 'Test Keeper')?.drops, ['New Token'])
    assert.deepEqual(result.mobs.mobs.find((mob) => mob.page === 'Test keeper')?.drops, ['Other Token'])
    assert.equal(source.calls.at(-1)?.get('titles'), changes.join('|'))
  }
})
