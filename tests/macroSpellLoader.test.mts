import assert from 'node:assert/strict'
import test from 'node:test'
import { utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createMacroSpellLoader } from '../src/main/macros/spellLoader.ts'
import { macroFixture, DAMAGE } from './macroServiceFixture.mts'

test('spell worker cache keys the installation, file stat and sorted owned ID set', async (t) => {
  const f = await macroFixture(t)
  const path = join(f.root, 'spells_us.txt')
  await writeFile(path, 'bounded test source')
  const calls: number[][] = []
  const load = createMacroSpellLoader(async (_path, ids) => { calls.push(ids); return [DAMAGE] })
  await load(f.root, [94, 17])
  await load(f.root, [17, 94, 94])
  assert.deepEqual(calls, [[17, 94]])
  await load(f.root, [94])
  assert.deepEqual(calls, [[17, 94], [94]])
  await utimes(path, new Date(20_000), new Date(20_000))
  await load(f.root, [94])
  assert.equal(calls.length, 3)
  await writeFile(path, 'a different length')
  await load(f.root, [94])
  assert.equal(calls.length, 4)
  await assert.rejects(load(f.root, [-1]), /Invalid/)
})

test('a failed spell worker is evicted so the same observation can retry', async (t) => {
  const f = await macroFixture(t)
  await writeFile(join(f.root, 'spells_us.txt'), 'source')
  let count = 0
  const load = createMacroSpellLoader(async () => { if (++count === 1) throw new Error('read failed'); return [DAMAGE] })
  await assert.rejects(load(f.root, [94]), /read failed/)
  assert.deepEqual(await load(f.root, [94]), [DAMAGE])
  assert.equal(count, 2)
})
