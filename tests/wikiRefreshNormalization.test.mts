import test from 'node:test'
import assert from 'node:assert/strict'
import { matchWikiBatch, advanceWikiBatch } from '../src/main/wikiRefresh/updateBatch'
import { readWikiCheckpoint } from '../src/main/wikiRefresh/updateCheckpoint'
import { runWikiRefresh, type WikiRefreshCheckpoint } from '../src/main/wikiRefresh/update'
import type { WikiCatalogPack } from '../src/shared/wikiCatalog'

const date = '2026-09-01T00:00:00Z'
const base: WikiCatalogPack = {
  schemaVersion: 1, baseFingerprint: 'test', generation: 'test', checkedAt: date,
  items: { scrapedAt: date, source: 'test', count: 0, items: {} },
  mobs: { scrapedAt: date, source: 'test', mobs: [] },
  quests: { scrapedAt: date, source: 'test', quests: [] },
  metadata: { snapshotAt: date, levelNotes: {}, walkthroughs: {} }
}
const page = (title: string) => ({ title, revisions: [{ slots: { main: { content: 'Plain reference prose.' } } }] })
const checkpoint = (titles: string[]): WikiRefreshCheckpoint => ({
  schemaVersion: 1, baseFingerprint: 'test', baseGeneration: 'test', watermark: date,
  mode: 'incremental', phase: 'download', cursor: {}, nextIndex: 0, titles, pages: {}
})

test('normalized title aliases can return fewer unique pages while case-sensitive pages remain distinct', () => {
  const requested = [':Test Region', 'Test Region', 'Test region']
  const data = { query: { normalized: [{ from: ':Test Region', to: 'Test Region' }], pages: [page('Test Region'), page('Test region')] } }
  const matched = matchWikiBatch(data, requested)
  assert.deepEqual(matched.titles, ['Test Region', 'Test Region', 'Test region'])
  const progress = checkpoint(requested)
  advanceWikiBatch(progress, requested.length, matched)
  assert.deepEqual(progress.titles, ['Test Region', 'Test region'])
  assert.equal(progress.nextIndex, 2)
})

test('normalization never excuses missing, unexpected, duplicated or conflicting response pages', () => {
  const requested = [':Test Region', 'Test Region', 'Other Region']
  const normalized = [{ from: ':Test Region', to: 'Test Region' }]
  for (const pages of [
    [page('Test Region')], [page('Test Region'), page('Unexpected')],
    [page('Test Region'), page('Test Region'), page('Other Region')]
  ]) assert.throws(() => matchWikiBatch({ query: { normalized, pages } }, requested))
  assert.throws(() => matchWikiBatch({ query: { normalized: [
    { from: 'Test  Region', to: 'Test Region' }, { from: 'Test  Region', to: 'Other Region' }
  ], pages: [] } }, ['Test  Region']), /conflicting/)
})

test('runtime persists canonical normalization and resumes without skipping a remaining page', async () => {
  const initial = checkpoint(['Test  Region', 'Test Region', 'Other Region'])
  let calls = 0
  let saved: WikiRefreshCheckpoint | undefined
  const result = await runWikiRefresh({ base, checkpoint: initial,
    sleep: async () => { /* synthetic clock */ },
    fetch: async () => {
      calls++
      return Response.json({ query: {
        normalized: [{ from: 'Test  Region', to: 'Test Region' }],
        pages: [page('Test Region'), page('Other Region')]
      } })
    }, onCheckpoint: (value) => { saved = structuredClone(value) }
  })
  assert.equal(calls, 1)
  assert.deepEqual(saved?.titles, ['Test Region', 'Other Region'])
  assert.equal(saved?.nextIndex, 2)
  assert.equal(Object.keys(saved?.pages ?? {}).length, 2)
  assert.ok(readWikiCheckpoint(saved, base))
  assert.equal(result.metadata.snapshotAt, date)
})

test('a colon-prefixed redirect resolves to the API-normalized target without duplicate catalog entries', async () => {
  const initial = checkpoint(['Old reference'])
  let saved: WikiRefreshCheckpoint | undefined
  let calls = 0
  const result = await runWikiRefresh({ base, checkpoint: initial,
    sleep: async () => { /* synthetic clock */ },
    fetch: async () => {
      calls++
      if (calls === 1) return Response.json({ query: { pages: [{ title: 'Old reference', revisions: [{ slots: { main: { content: '#REDIRECT [[:Test Region]]' } } }] }] } })
      return Response.json({ query: { normalized: [{ from: ':Test Region', to: 'Test Region' }], pages: [page('Test Region')] } })
    }, onCheckpoint: (value) => { saved = structuredClone(value) }
  })
  assert.equal(calls, 2)
  assert.equal(saved?.nextIndex, 2)
  assert.ok(readWikiCheckpoint(saved, base))
  assert.deepEqual(result.mobs.mobs, [])
})
