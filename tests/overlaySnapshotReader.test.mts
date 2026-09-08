import assert from 'node:assert/strict'
import test from 'node:test'
import { OverlaySnapshotReader, type OverlaySnapshot } from '../src/renderer/src/overlay/overlaySnapshotReader'
import { observeOverlayModule } from '../src/renderer/src/overlay/useOverlayModule'
import { observeOverlayCombat } from '../src/renderer/src/overlay/useOverlayCombat'
import { MODULE_WORLD_CHANGED, type ModuleChanged, type ModuleSnapshot } from '../src/shared/types'
import type { CombatSnapshot, SnapshotOpts } from '../src/shared/combat'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }
function fixture() {
  const reads: ReturnType<typeof deferred<OverlaySnapshot<string> | null>>[] = []
  const updates: { value: string | null; rebuilt: boolean }[] = []
  let retry: (() => void) | undefined
  const reader = new OverlaySnapshotReader<string>({
    read: () => { const next = deferred<OverlaySnapshot<string> | null>(); reads.push(next); return next.promise },
    receive: (value, rebuilt) => updates.push({ value, rebuilt }),
    retry: (run) => { assert.equal(retry, undefined); retry = run; return () => { retry = undefined } }
  })
  const fireRetry = () => { const run = retry; retry = undefined; assert.ok(run); run() }
  return { reader, reads, updates, fireRetry, retrying: () => Boolean(retry) }
}

test('cursor bursts coalesce into one follow-up and duplicate cursors cost no reads', async () => {
  const f = fixture()
  f.reader.reset(); await settle()
  for (const seq of [2, 5, 3, 5]) f.reader.request(seq)
  assert.equal(f.reads.length, 1)
  f.reads[0].resolve({ seq: 1, state: 'first' }); await settle()
  assert.equal(f.reads.length, 2)
  f.reads[1].resolve({ seq: 5, state: 'latest' }); await settle()
  for (const seq of [1, 4, 5]) f.reader.request(seq)
  await settle()
  assert.equal(f.reads.length, 2)
  assert.deepEqual(f.updates, [{ value: null, rebuilt: true }, { value: 'first', rebuilt: true }, { value: 'latest', rebuilt: false }])
  f.reader.dispose()
})

test('a character/world reset clears immediately and rejects an old in-flight reply before accepting lower new cursors', async () => {
  const f = fixture()
  f.reader.reset(); await settle()
  f.reads[0].resolve({ seq: 90, state: 'old character' }); await settle()
  f.reader.request(91); await settle()
  f.reader.reset(); f.reader.request(1); await settle()
  assert.equal(f.updates.at(-1)?.value, null)
  assert.equal(f.reads.length, 2, 'Reset does not overlap the old request')
  f.reads[1].resolve({ seq: 91, state: 'late old character' }); await settle()
  assert.equal(f.reads.length, 3)
  assert.ok(!f.updates.some((update) => update.value === 'late old character'))
  f.reads[2].resolve({ seq: 1, state: 'new character' }); await settle()
  assert.deepEqual(f.updates.at(-1), { value: 'new character', rebuilt: true })
  f.reader.dispose()
})

test('null and rejected reads clear stale rows and recover through bounded retries without false drop flashes', async () => {
  const f = fixture()
  f.reader.reset(); await settle()
  f.reads[0].resolve({ seq: 8, state: 'buff active' }); await settle()
  f.reader.request(9); await settle()
  f.reads[1].resolve(null); await settle()
  assert.deepEqual(f.updates.at(-1), { value: null, rebuilt: true })
  assert.equal(f.retrying(), true)
  for (let i = 0; i < 20; i++) f.reader.request()
  await settle()
  assert.equal(f.reads.length, 2, 'Nudges cannot bypass retry backoff')
  f.fireRetry(); await settle()
  f.reads[2].reject(new Error('Unavailable')); await settle()
  assert.equal(f.retrying(), true)
  f.fireRetry(); await settle()
  f.reads[3].resolve({ seq: 1, state: 'recovered' }); await settle()
  assert.deepEqual(f.updates.at(-1), { value: 'recovered', rebuilt: true })
  f.reader.request(2); await settle()
  f.reads[4].resolve({ seq: 2, state: 'buff gone' }); await settle()
  assert.deepEqual(f.updates.at(-1), { value: 'buff gone', rebuilt: false }, 'Ordinary removal remains a flashable update')
  f.reader.dispose()
})

test('dispose cancels retries and drops pending answers; reset cancels backoff for a new world', async () => {
  const f = fixture()
  f.reader.reset(); await settle(); f.reads[0].resolve(null); await settle()
  f.reader.reset(); await settle()
  assert.equal(f.retrying(), false)
  assert.equal(f.reads.length, 2)
  const count = f.updates.length
  f.reader.dispose()
  f.reads[1].resolve({ seq: 4, state: 'late' }); await settle()
  f.reader.request()
  assert.equal(f.updates.length, count)
  assert.equal(f.reads.length, 2)
})

function listeners() {
  let changed: ((value: ModuleChanged) => void) | undefined
  let character: (() => void) | undefined
  return {
    onModuleChanged: (cb: (value: ModuleChanged) => void) => { changed = cb; return () => { changed = undefined } },
    onCharacter: (cb: () => void) => { character = cb; return () => { character = undefined } },
    cursor: (moduleId: string, seq = -1) => changed?.({ moduleId, seq }),
    character: () => character?.(),
    attached: () => Boolean(changed || character)
  }
}

test('module subscription accepts character and world resets, filters unrelated cursors, and detaches', async () => {
  const events = listeners()
  const reads: ReturnType<typeof deferred<ModuleSnapshot<string> | null>>[] = []
  const values: (string | null)[] = []
  const stop = observeOverlayModule<string>({
    ...events,
    getModuleSnapshot: <S>(id: string) => {
      assert.equal(id, 'buffs')
      const read = deferred<ModuleSnapshot<string> | null>(); reads.push(read)
      return read.promise as Promise<ModuleSnapshot<S> | null>
    }
  }, 'buffs', (value) => values.push(value))
  await settle()
  events.cursor('loot', 99); await settle()
  assert.equal(reads.length, 1)
  events.character(); reads[0].resolve({ seq: 99, state: 'old' }); await settle()
  reads[1].resolve({ seq: 1, state: 'new' }); await settle()
  events.cursor(MODULE_WORLD_CHANGED); await settle()
  assert.equal(values.at(-1), null)
  reads[2].resolve({ seq: 0, state: 'rebuilt' }); await settle()
  assert.ok(!values.includes('old'))
  assert.equal(values.at(-1), 'rebuilt')
  stop(); assert.equal(events.attached(), false)
})

test('combat nudges coalesce, world changes reject late replies, and every read preserves the chosen historical segment', async () => {
  const events = listeners()
  const reads: ReturnType<typeof deferred<CombatSnapshot>>[] = []
  const values: (CombatSnapshot | null)[] = []
  let activity: (() => void) | undefined
  const stop = observeOverlayCombat({
    ...events,
    onCombatActivity: (cb) => { activity = cb; return () => { activity = undefined } },
    getCombatSnapshot: (opts: SnapshotOpts) => {
      assert.deepEqual(opts, { selectedId: 'fight:historic', maxSegments: 30 })
      const read = deferred<CombatSnapshot>(); reads.push(read); return read.promise
    }
  }, 'fight:historic', (value) => values.push(value))
  try {
    await settle()
    activity?.(); activity?.(); activity?.()
    assert.equal(reads.length, 1)
    const first = { active: false } as CombatSnapshot
    reads[0].resolve(first); await settle()
    assert.equal(reads.length, 2)
    events.character()
    const late = { active: true } as CombatSnapshot
    reads[1].resolve(late); await settle()
    assert.equal(reads.length, 3)
    assert.ok(!values.includes(late))
    reads[2].resolve(first); await settle()
    events.cursor(MODULE_WORLD_CHANGED); await settle()
    assert.equal(values.at(-1), null)
    assert.equal(reads.length, 4)
  } finally { stop() }
  assert.equal(events.attached(), false)
  assert.equal(activity, undefined)
})

test('a delayed cursor beyond the current world cannot cause an unbounded read loop', async () => {
  const f = fixture()
  f.reader.reset(); await settle(); f.reader.request(90)
  f.reads[0].resolve({ seq: 1, state: 'new world' }); await settle()
  f.reads[1].resolve({ seq: 1, state: 'new world' }); await settle()
  assert.equal(f.reads.length, 2)
  assert.equal(f.retrying(), true)
  f.fireRetry(); await settle()
  f.reads[2].resolve({ seq: 90, state: 'caught up' }); await settle()
  assert.equal(f.retrying(), false)
  assert.equal(f.updates.at(-1)?.value, 'caught up')
  f.reader.dispose()
})
