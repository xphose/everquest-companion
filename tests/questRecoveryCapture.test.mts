import { test } from 'node:test'
import assert from 'node:assert/strict'
import { acquireGameWindow, isEverQuestWindow, type GameWindowSource } from '../src/main/questJournal/recovery/gameWindow.ts'

interface Picture { empty: boolean; label: string }
const ready: Picture = { empty: false, label: 'original game' }
const empty: Picture = { empty: true, label: 'empty game image' }
const source = (thumbnail = ready, id = 'window:42:0', name = 'EverQuest Legends'): GameWindowSource<Picture> => ({ id, name, thumbnail })

function reader(sequence: (GameWindowSource<Picture>[] | Error)[]) {
  let reads = 0
  const waits: number[] = []
  const deps = {
    readSources: (): Promise<GameWindowSource<Picture>[]> => {
      const next = sequence[reads++] ?? []
      return next instanceof Error ? Promise.reject(next) : Promise.resolve(next)
    },
    isEmpty: (picture: Picture): boolean => picture.empty,
    wait: (milliseconds: number): Promise<void> => { waits.push(milliseconds); return Promise.resolve() }
  }
  return { deps, waits, get reads() { return reads } }
}

test('a temporarily omitted game appears on a fresh read without capturing any desktop source', async () => {
  const r = reader([[source(ready, 'screen:0:0')], [source()]])
  assert.equal(await acquireGameWindow(r.deps), ready)
  assert.equal(r.reads, 2)
  assert.deepEqual(r.waits, [350])
})

test('an empty game image can recover only under the same source identity', async () => {
  const r = reader([[source(empty)], [source()]])
  assert.equal(await acquireGameWindow(r.deps), ready)
  assert.equal(r.reads, 2)
  assert.deepEqual(r.waits, [350])
})

test('missing windows and transient capture failures exhaust exactly three reads and two waits', async () => {
  for (const sequence of [[[], [], []], [new Error('capture busy'), [], new Error('capture busy')], [[source(empty)], [source(empty)], [source(empty)]]]) {
    const r = reader(sequence)
    await assert.rejects(acquireGameWindow(r.deps), /temporarily unavailable to capture or minimized/u)
    assert.equal(r.reads, 3)
    assert.deepEqual(r.waits, [350, 350])
  }
})

test('more than one game fails immediately even when only one thumbnail is usable', async () => {
  const r = reader([[source(), source(empty, 'window:43:0')], [source()]])
  await assert.rejects(acquireGameWindow(r.deps), /More than one EverQuest window/u)
  assert.equal(r.reads, 1)
  assert.deepEqual(r.waits, [])
})

test('a replacement game is rejected after an empty frame and an intervening omission', async () => {
  const r = reader([[source(empty)], [], [source(ready, 'window:43:0')]])
  await assert.rejects(acquireGameWindow(r.deps), /window changed during capture/u)
  assert.equal(r.reads, 3)
  assert.deepEqual(r.waits, [350, 350])
})

test('capture-call failures can recover and a successful image never triggers another read', async () => {
  const retry = reader([new Error('capture busy'), [source()], [source(ready, 'window:43:0')]])
  assert.equal(await acquireGameWindow(retry.deps), ready)
  assert.equal(retry.reads, 2)
  assert.deepEqual(retry.waits, [350])
  const immediate = reader([[source()], [source(ready, 'window:43:0')]])
  assert.equal(await acquireGameWindow(immediate.deps), ready)
  assert.equal(immediate.reads, 1)
  assert.deepEqual(immediate.waits, [])
})

test('title recognition keeps the existing anchored game semantics and excludes companion windows', () => {
  for (const title of ['EverQuest', ' EverQuest Legends ', 'EverQuest - Ada', 'EverQuest Legends: Ada', 'EverQuest – Ada']) assert.equal(isEverQuestWindow(title), true, title)
  for (const title of ['EverQuest Companion', 'EverQuest - Companion', 'EverQuest Legends - companion recovery', 'Not EverQuest', 'EverQuest2', 'EverQuest Legends Guide', 'EverQuest -']) assert.equal(isEverQuestWindow(title), false, title)
})
