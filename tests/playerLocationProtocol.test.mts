import test from 'node:test'
import assert from 'node:assert/strict'
import { parseLocationReply } from '../src/main/playerLocation/protocol.ts'

const LOCATION = {
  characterName: 'Wayfinder', zone: 'akanon', ns: 1138, ew: -969, z: 3,
  heading: 450, sampledAt: 1234
}

test('location protocol preserves valid current levels and accepts position-only observations', () => {
  const bare = { id: 1, result: { state: 'live', location: LOCATION } }
  assert.deepEqual(parseLocationReply(bare), bare)
  for (const level of [1, 10, 11, 9, 125]) {
    const reply = { id: 2, result: { state: 'live', location: { ...LOCATION, level } } }
    assert.deepEqual(parseLocationReply(reply), reply)
  }
})

test('location protocol rejects invalid optional levels when present', () => {
  for (const level of [0, 126, 255, -1, 10.5, NaN, Infinity, '10', null, undefined]) {
    const reply = { id: 2, result: { state: 'live', location: { ...LOCATION, level } } }
    assert.equal(parseLocationReply(reply), null)
  }
})
