import assert from 'node:assert/strict'
import { test } from 'node:test'
import { setImmediate } from 'node:timers/promises'
import { WikiRefreshCadence, WIKI_CHECK_MS } from '../src/main/wikiRefresh/cadence'
import { clock, fixture, pack } from './wikiRuntimeFixtures.mts'

test('overdue launch checks once, open app repeats daily, restart retains the deadline', async (t) => {
  const f = fixture(); t.after(f.cleanup)
  const c = clock()
  let calls = 0
  const options = { cache: f.cache, activeUpdatedAt: f.base.metadata.snapshotAt, enabled: true, ...c,
    run: () => { calls++; return { promise: Promise.resolve(new Date(c.now()).toISOString()), stop() { /* No background handle in this fixture. */ } } } }
  const cadence = new WikiRefreshCadence(options)
  cadence.start()
  assert.equal(c.delay(), 0)
  c.fire(); await setImmediate()
  assert.equal(calls, 1)
  assert.equal(c.delay(), WIKI_CHECK_MS)
  c.advance(WIKI_CHECK_MS)
  c.fire(); await setImmediate()
  assert.equal(calls, 2)
  cadence.stop()
  c.advance(60_000)
  const restarted = new WikiRefreshCadence(options)
  restarted.start()
  assert.equal(c.delay(), WIKI_CHECK_MS - 60_000)
  restarted.stop()
})

test('manual and automatic requests share one worker and publish download progress', async (t) => {
  const f = fixture(); t.after(f.cleanup)
  const c = clock()
  let release!: () => void
  let calls = 0
  const cadence = new WikiRefreshCadence({ cache: f.cache, activeUpdatedAt: f.base.metadata.snapshotAt, enabled: true, ...c,
    run: (progress) => {
      calls++; progress({ state: 'downloading', completedPages: 4, totalPages: 8 })
      return { promise: new Promise<string>((resolve) => { release = () => resolve(new Date(c.now()).toISOString()) }), stop() { /* No background handle in this fixture. */ } }
    } })
  cadence.start()
  const first = cadence.refresh()
  const second = cadence.refresh()
  assert.equal(first, second)
  assert.equal(calls, 1)
  assert.equal(cadence.getStatus().completedPages, 4)
  assert.equal(cadence.getStatus().state, 'downloading')
  f.cache.stage(pack('two', '2026-09-16T12:00:00.000Z'), f.base)
  release()
  const status = await first
  assert.equal(status.state, 'ready')
  assert.equal(status.activeUpdatedAt, f.base.metadata.snapshotAt)
  assert.equal(status.pendingUpdatedAt, '2026-09-16T12:00:00.000Z')
  cadence.stop()
})

test('offline failures keep last good data, retry with bounded backoff, and survive restart', async (t) => {
  const f = fixture(); t.after(f.cleanup)
  const c = clock()
  const options = { cache: f.cache, activeUpdatedAt: f.base.metadata.snapshotAt, enabled: true, ...c,
    run: () => ({ promise: Promise.reject(new Error('Network unavailable')), stop() { /* No background handle in this fixture. */ } }) }
  const cadence = new WikiRefreshCadence(options)
  cadence.start()
  await cadence.refresh()
  assert.equal(cadence.getStatus().state, 'error')
  assert.equal(c.delay(), 15 * 60_000)
  assert.deepEqual(f.cache.readPack('one'), f.base)
  for (let i = 0; i < 12; i++) await cadence.refresh()
  assert.equal(c.delay(), WIKI_CHECK_MS)
  cadence.stop()
  const restarted = new WikiRefreshCadence(options)
  restarted.start()
  assert.equal(c.delay(), WIKI_CHECK_MS)
  restarted.stop()
})

test('stop cancels the current run without scheduling work after application exit', async (t) => {
  const f = fixture(); t.after(f.cleanup)
  const c = clock()
  let release!: () => void
  let stops = 0
  const cadence = new WikiRefreshCadence({ cache: f.cache, activeUpdatedAt: f.base.metadata.snapshotAt, enabled: true, ...c,
    run: () => ({ promise: new Promise<string>((resolve) => { release = () => resolve(new Date(c.now()).toISOString()) }), stop: () => { stops++; release() } }) })
  cadence.start()
  const pending = cadence.refresh()
  cadence.stop()
  await pending
  assert.equal(stops, 1)
  assert.equal(c.delay(), undefined)
  assert.equal(f.cache.readState().lastCheckedAt, undefined)
})

test('headless defaults never start network work, even for a manual request', async (t) => {
  const f = fixture(); t.after(f.cleanup)
  const c = clock()
  let calls = 0
  const cadence = new WikiRefreshCadence({ cache: f.cache, activeUpdatedAt: f.base.metadata.snapshotAt, enabled: false, ...c,
    run: () => { calls++; throw new Error('must not run') } })
  cadence.start()
  await cadence.refresh()
  assert.equal(calls, 0)
  assert.equal(c.delay(), undefined)
  cadence.stop()
})

test('an old resumed source watermark triggers an immediate catch-up check', async (t) => {
  const f = fixture(); t.after(f.cleanup)
  const c = clock()
  const oldStamp = '2026-09-10T12:00:00.000Z'
  const cadence = new WikiRefreshCadence({ cache: f.cache, activeUpdatedAt: f.base.metadata.snapshotAt, enabled: true, ...c,
    run: () => ({ promise: Promise.resolve(oldStamp), stop() { /* No background handle in this fixture. */ } }) })
  cadence.start()
  const result = await cadence.refresh()
  assert.equal(result.lastCheckedAt, oldStamp)
  assert.equal(c.delay(), 0)
  cadence.stop()
})
