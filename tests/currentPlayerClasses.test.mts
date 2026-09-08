import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { PlayerLocationResult } from '../src/shared/playerLocation'
import { currentPlayerClasses, LOCATION_MAX_AGE_MS } from '../src/shared/currentPlayer'

function live(classes: unknown, changes = {}): PlayerLocationResult {
  return { state: 'live', location: { characterName: 'Ada', zone: 'qeynos2', ns: 1, ew: 2, z: 3,
    heading: 0, sampledAt: 10_000, ...{ classes }, ...changes } }
}

test('complete native selections include a newly selected third class and later switches', () => {
  assert.deepEqual(currentPlayerClasses(live(['MAG', 'SHM']), 'ada', 10_000), ['MAG', 'SHM'])
  assert.deepEqual(currentPlayerClasses(live(['MAG', 'SHM', 'ENC']), 'Ada', 10_100), ['MAG', 'SHM', 'ENC'])
  assert.deepEqual(currentPlayerClasses(live(['PAL', 'MNK', 'ENC']), 'Ada', 10_200), ['PAL', 'MNK', 'ENC'])
})

test('missing, malformed, duplicate, or oversized class observations leave fallback detection available', () => {
  for (const value of [undefined, null, [], ['MAG'], ['MAG', 'unknown'], ['MAG', 'MAG'], ['MAG', 'SHM', 'ENC', 'PAL'], 'MAG']) {
    assert.equal(currentPlayerClasses(live(value), 'Ada', 10_000), null)
  }
  assert.equal(currentPlayerClasses(undefined, 'Ada', 10_000), null)
  assert.equal(currentPlayerClasses({ state: 'unavailable', reason: 'loading' }, 'Ada', 10_000), null)
})

test('native classes require the selected character and a current observation', () => {
  const sample = live(['MAG', 'SHM', 'ENC'])
  assert.equal(currentPlayerClasses(sample, undefined, 10_000), null)
  assert.equal(currentPlayerClasses(sample, 'Bob', 10_000), null)
  assert.equal(currentPlayerClasses(sample, 'Ada', 9_999), null)
  assert.equal(currentPlayerClasses(sample, 'Ada', 10_001 + LOCATION_MAX_AGE_MS), null)
  assert.equal(currentPlayerClasses(live(['MAG', 'SHM'], { sampledAt: NaN }), 'Ada', 10_000), null)
  assert.deepEqual(currentPlayerClasses(sample, 'Ada', 10_000 + LOCATION_MAX_AGE_MS), ['MAG', 'SHM', 'ENC'])
})
