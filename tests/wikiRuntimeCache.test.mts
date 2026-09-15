import assert from 'node:assert/strict'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { WikiCache } from '../src/main/wikiRefresh/persistence'
import { bundledWikiCatalog } from '../src/main/referenceData'
import { validateWikiCatalogPack } from '../src/shared/wikiCatalog'
import { fixture, pack, STAMP } from './wikiRuntimeFixtures.mts'

test('the shipped catalogs validate and fingerprint their actual content', () => {
  const bundled = bundledWikiCatalog()
  assert.equal(validateWikiCatalogPack(bundled, bundled.baseFingerprint), true)
  assert.match(bundled.baseFingerprint, /^[a-f0-9]{64}$/)
  assert.equal(bundledWikiCatalog().baseFingerprint, bundled.baseFingerprint)
})

test('updates stage atomically for next launch and cannot alter a pinned file', (t) => {
  const f = fixture(); t.after(f.cleanup)
  const oldPath = f.cache.packPath(f.base.generation)
  const before = readFileSync(oldPath, 'utf8')
  const updated = pack('two', '2026-09-16T12:00:00.000Z')
  updated.items.items['test charm'].summary = 'Updated evidence'
  f.cache.stage(updated, f.base)
  assert.equal(f.cache.readState().activeGeneration, 'one')
  assert.equal(f.cache.readState().pendingGeneration, 'two')
  assert.equal(readFileSync(oldPath, 'utf8'), before)
  assert.equal(f.base.items.items['test charm'].summary, undefined)
  const resumed = new WikiCache(f.directory, f.base.baseFingerprint).activate(f.base)
  assert.equal(resumed.pack.items.items['test charm'].summary, 'Updated evidence')
  assert.equal(f.cache.readState().pendingGeneration, undefined)
  assert.equal(f.cache.readState().activeGeneration, 'two')
})

test('a no-change check keeps a newer watermark without a restart notice', (t) => {
  const f = fixture(); t.after(f.cleanup)
  const watermark = { ...f.base, generation: 'checked', checkedAt: '2026-09-16T12:00:00.000Z' }
  f.cache.stage(watermark, f.base)
  assert.equal(f.cache.latest(f.base).checkedAt, watermark.checkedAt)
  assert.equal(f.cache.readState().pendingUpdatedAt, undefined)
  assert.equal(f.cache.activate(f.base).pack.metadata.snapshotAt, STAMP)
})

test('damaged pending data falls back to the previous good generation', (t) => {
  const f = fixture(); t.after(f.cleanup)
  f.cache.stage(pack('two'), f.base)
  writeFileSync(f.cache.packPath('two'), '{"broken":')
  assert.equal(f.cache.activate(f.base).pack.generation, 'one')
  assert.equal(f.cache.readState().pendingGeneration, undefined)
})

test('damaged manifest or active cache uses bundled data and never rewrites its pathname', (t) => {
  const f = fixture(); t.after(f.cleanup)
  const damagedPath = f.cache.packPath('one')
  writeFileSync(damagedPath, 'damaged')
  writeFileSync(join(f.directory, 'state.json'), '{')
  const recovered = f.cache.activate(f.base)
  assert.equal(readFileSync(damagedPath, 'utf8'), 'damaged')
  assert.equal(recovered.pack.items.items['test charm'].page, 'Test Charm')
  assert.notEqual(recovered.path, damagedPath)
})

test('new application data invalidates an incompatible older pack', (t) => {
  const f = fixture(); t.after(f.cleanup)
  f.cache.stage(pack('two'), f.base)
  const baseline = { ...pack('new-bundled'), baseFingerprint: 'new-baseline' }
  const next = new WikiCache(f.directory, baseline.baseFingerprint)
  assert.equal(next.activate(baseline).pack.generation, 'new-bundled')
})

test('generation collisions and malformed packs cannot replace last good data', (t) => {
  const f = fixture(); t.after(f.cleanup)
  const collision = pack()
  collision.items.items['test charm'].summary = 'Different contents'
  assert.throws(() => f.cache.stage(collision, f.base), /collision/)
  assert.throws(() => f.cache.stage({ ...pack('bad'), metadata: null }, f.base), /validation/)
  assert.deepEqual(f.cache.readPack('one'), f.base)
})

test('checkpoint persistence is separate from character progress', (t) => {
  const f = fixture(); t.after(f.cleanup)
  const progressPath = join(f.directory, 'everquest-companion-progress.json')
  const progress = '{"characters":{"TestHero":{"journal":{"complete":["Test Errand"]}}}}'
  writeFileSync(progressPath, progress)
  f.cache.saveCheckpoint({ schemaVersion: 1, pending: ['Test Keeper'] })
  assert.deepEqual(new WikiCache(f.directory, f.base.baseFingerprint).checkpoint(), { schemaVersion: 1, pending: ['Test Keeper'] })
  f.cache.stage(pack('two'), f.base)
  assert.equal(readFileSync(progressPath, 'utf8'), progress)
})

test('retention bounds repeated daily packs and preserves pinned, pending, and previous data', (t) => {
  const f = fixture(); t.after(f.cleanup)
  f.cache.stage(pack('two'), f.base)
  const active = f.cache.activate(f.base).pack
  writeFileSync(join(f.directory, 'unrelated.txt'), 'leave alone')
  for (let i = 0; i < 20; i++) {
    f.cache.stage(pack(`daily-${i}`), active)
    f.cache.prune(active.generation)
  }
  assert.deepEqual(f.cache.readPack('one'), f.base)
  assert.deepEqual(f.cache.readPack('two'), active)
  assert.equal(f.cache.latest(active).generation, 'daily-19')
  assert.equal(readdirSync(f.directory).filter((name) => /^[a-f0-9]{64}\.json$/.test(name)).length, 3)
  assert.equal(readFileSync(join(f.directory, 'unrelated.txt'), 'utf8'), 'leave alone')
})

test('writers reject data that would exceed the same limit enforced by readers', (t) => {
  const f = fixture(); t.after(f.cleanup)
  const limited = new WikiCache(f.directory, f.base.baseFingerprint, 128)
  assert.throws(() => limited.savePack(pack('oversized')), /size limit/)
  assert.throws(() => limited.saveCheckpoint({ text: 'x'.repeat(129) }), /size limit/)
  assert.equal(f.cache.readState().activeGeneration, 'one')
  assert.deepEqual(f.cache.readPack('one'), f.base)
})
