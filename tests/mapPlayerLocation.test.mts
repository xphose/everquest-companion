import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { PlayerLocationResult } from '../src/shared/playerLocation'
import { currentPlayerLocation, locationOnMap, LOCATION_MAX_AGE_MS } from '../src/renderer/src/features/maps/playerLocationState'
import { mapFromLoc } from '../src/renderer/src/features/maps/mapGeometry'

const observation: PlayerLocationResult = { state: 'live', location: {
  characterName: 'Primitive', zone: 'oasis', ns: 613, ew: 51, z: 0, heading: 0, sampledAt: 10000
} }

test('the live player lands on the independently documented Transan map landmark', () => {
  const location = currentPlayerLocation(observation, 'primitive', 10001)
  assert.ok(location)
  assert.deepEqual(mapFromLoc(location), { x: -51, y: -613, z: 0 })
  assert.equal(locationOnMap(location, 'oasis'), location)
  assert.equal(locationOnMap(location, 'akanon'), null)
  assert.equal(locationOnMap(location, undefined), null)
})

test('stale, future, invalid-time and different-character positions never render as live', () => {
  assert.equal(currentPlayerLocation(observation, 'Other', 10001), null)
  assert.equal(currentPlayerLocation(observation, 'Primitive', 9999), null)
  assert.equal(currentPlayerLocation(observation, 'Primitive', 10001 + LOCATION_MAX_AGE_MS), null)
  assert.equal(currentPlayerLocation(observation, 'Primitive', NaN), null)
  assert.ok(currentPlayerLocation(observation, 'Primitive', 10000 + LOCATION_MAX_AGE_MS))
})

test('lost game access clears a position for every non-live state', () => {
  for (const state of ['not-running', 'not-in-world', 'unsupported', 'unavailable', 'ambiguous'] as const) {
    assert.equal(currentPlayerLocation({ state, reason: 'Unavailable' }, 'Primitive', 10001), null)
  }
  assert.equal(locationOnMap(null, 'oasis'), null)
})
