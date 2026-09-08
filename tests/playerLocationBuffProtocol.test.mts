import test from 'node:test'
import assert from 'node:assert/strict'
import { parseLocationReply } from '../src/main/playerLocation/protocol.ts'

const location = { characterName: 'Wayfinder', zone: 'akanon', ns: 1138, ew: -969, z: 3, heading: 450, sampledAt: 1234 }
const reply = (activeBuffs: unknown) => ({ id: 8, result: { state: 'live', location: { ...location, activeBuffs } } })
const buff = { spellId: 74089, kind: 'buff', slot: 1, remainingMs: 6000 }

test('native buff protocol preserves known-empty, both slot ranges and unknown durations', () => {
  const complete = [
    ...Array.from({ length: 62 }, (_, index) => ({ spellId: index + 1, slot: index + 1, kind: 'buff' })),
    ...Array.from({ length: 30 }, (_, index) => ({ spellId: index + 1, slot: index + 1, kind: 'song', remainingMs: 0 }))
  ]
  for (const buffs of [[], [buff], complete, [{ ...buff, remainingMs: 0x7fffffff * 6000 }]]) {
    assert.deepEqual(parseLocationReply(reply(buffs)), reply(buffs))
  }
})

test('native buff protocol rejects malformed arrays, ambiguous positions and unknown fields', () => {
  for (const buffs of [null, undefined, {}, 1, 'buffs', new Array(1), [buff, buff], Array.from({ length: 93 }, () => buff),
    [{ ...buff, kind: 'pet' }], [{ ...buff, kind: 'song', slot: 31 }], [{ ...buff, permanent: true }]]) {
    assert.equal(parseLocationReply(reply(buffs)), null)
  }
})

test('native buff protocol validates every ID, slot and timer without numeric coercion', () => {
  for (const spellId of [0, -1, 0x80000000, 1.5, NaN, Infinity, null, undefined, '74089']) {
    assert.equal(parseLocationReply(reply([{ ...buff, spellId }])), null)
  }
  for (const slot of [0, -1, 63, 1.5, NaN, Infinity, null, undefined, '1']) {
    assert.equal(parseLocationReply(reply([{ ...buff, slot }])), null)
  }
  for (const remainingMs of [-1, 1.5, NaN, Infinity, null, undefined, '6000', 0x7fffffff * 6000 + 1]) {
    assert.equal(parseLocationReply(reply([{ ...buff, remainingMs }])), null)
  }
})
