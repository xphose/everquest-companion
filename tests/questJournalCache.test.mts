import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createJournalSnapshotCache } from '../src/main/questJournal/snapshotCache.ts'

test('quiet repeated reads and concurrent list/detail hydration share each module snapshot', async () => {
  const cache = createJournalSnapshotCache()
  let requests = 0
  const request = async () => { requests++; return { some: 'snapshot' } }
  const read = () => cache.read('loot', '1:2', request, () => '1:2')
  const [a, b] = await Promise.all([read(), read()])
  assert.equal(a, b)
  assert.equal(await read(), a)
  assert.equal(requests, 1)
})

test('a publication invalidates exactly that module and duplicate notices do not re-read', async () => {
  const cache = createJournalSnapshotCache()
  const calls = { loot: 0, tasks: 0 }
  const read = (module: keyof typeof calls) => cache.read(module, 'world', async () => ++calls[module], () => 'world')
  await Promise.all([read('loot'), read('tasks')])
  cache.changed('loot', 17)
  assert.equal(await read('loot'), 2)
  assert.equal(await read('tasks'), 1)
  cache.changed('loot', 17)
  assert.equal(await read('loot'), 2)
  assert.deepEqual(calls, { loot: 2, tasks: 1 })
})

test('failures are not cached and a later successful query retries', async () => {
  const cache = createJournalSnapshotCache()
  let attempts = 0
  const request = async () => {
    if (++attempts === 1) throw new Error('engine offline')
    return 'ready'
  }
  await assert.rejects(cache.read('tasks', 'world', request, () => 'world'), /offline/u)
  assert.equal(await cache.read('tasks', 'world', request, () => 'world'), 'ready')
  assert.equal(attempts, 2)
})

test('a stale reply cannot populate the new engine world or replace its snapshot', async () => {
  const cache = createJournalSnapshotCache()
  let world = 'old'
  let finish!: (value: unknown) => void
  const old = cache.read('loot', world, () => new Promise((resolve) => { finish = resolve }), () => world)
  world = 'new'
  cache.clear()
  const fresh = await cache.read('loot', world, async () => 'new snapshot', () => world)
  finish('old snapshot')
  await assert.rejects(old, /changed while reading/u)
  assert.equal(fresh, 'new snapshot')
  assert.equal(await cache.read('loot', world, async () => 'wrong', () => world), fresh)
})

test('publication during an in-flight read invalidates the reply and next query retries', async () => {
  const cache = createJournalSnapshotCache()
  let finish!: (value: unknown) => void
  const old = cache.read('tasks', 'world', () => new Promise((resolve) => { finish = resolve }), () => 'world')
  cache.changed('tasks', 12)
  finish('old')
  await assert.rejects(old, /changed while reading/u)
  assert.equal(await cache.read('tasks', 'world', async () => 'current', () => 'world'), 'current')
})
