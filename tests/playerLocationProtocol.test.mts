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

test('location protocol accepts complete class sets and rejects malformed optional classes', () => {
  for (const classes of [['SHM', 'MAG'], ['SHM', 'MAG', 'ENC']]) {
    const reply = { id: 3, result: { state: 'live', location: { ...LOCATION, classes } } }
    assert.deepEqual(parseLocationReply(reply), reply)
  }
  for (const classes of [[], ['MAG'], ['MAG', 'MAG'], ['MAG', 'UNKNOWN'], ['MAG', 'SHM', 'ENC', 'WAR'], 'MAG/SHM', null, undefined]) {
    assert.equal(parseLocationReply({ id: 3, result: { state: 'live', location: { ...LOCATION, classes } } }), null)
  }
})

test('spellbook and gem protocol accepts complete bounded arrays including empty capacity', () => {
  const memorizedSpells = Array.from({ length: 18 }, () => null as number | null)
  memorizedSpells[0] = 94
  memorizedSpells[17] = 17
  const reply = { id: 4, result: { state: 'live', location: { ...LOCATION, spellbook: [17, 94], memorizedSpells } } }
  assert.deepEqual(parseLocationReply(reply), reply)
  assert.ok(parseLocationReply({ id: 4, result: { state: 'live', location: { ...LOCATION, spellbook: [] } } }))
})

test('spell protocol rejects malformed IDs, duplicates, unbounded arrays and sparse slots', () => {
  for (const spellbook of [[0], [-1], [1.5], [NaN], [Infinity], [0x80000000], [17, 17], [null], ['17'], new Array(1), Array.from({ length: 1121 }, (_, i) => i + 1)]) {
    assert.equal(parseLocationReply({ id: 4, result: { state: 'live', location: { ...LOCATION, spellbook } } }), null)
  }
  for (const memorizedSpells of [[], new Array(18), Array.from({ length: 17 }, () => null), Array.from({ length: 19 }, () => null), Array.from({ length: 18 }, () => -1)]) {
    assert.equal(parseLocationReply({ id: 4, result: { state: 'live', location: { ...LOCATION, memorizedSpells } } }), null)
  }
})

test('unlocked gem protocol preserves exact sorted sets, including verified empty and sparse masks', () => {
  for (const unlockedSpellSlots of [[], [1, 3, 18], Array.from({ length: 18 }, (_, i) => i + 1)]) {
    const reply = { id: 5, result: { state: 'live', location: { ...LOCATION, unlockedSpellSlots } } }
    assert.deepEqual(parseLocationReply(reply), reply)
  }
})

test('unlocked gem protocol rejects malformed, unbounded and ambiguous slot sets', () => {
  for (const unlockedSpellSlots of [null, undefined, '12', 12, [0], [19], [-1], [1.5], [NaN], [Infinity], ['1'], [1, 1], [2, 1], new Array(1), Array.from({ length: 19 }, (_, i) => i + 1)]) {
    assert.equal(parseLocationReply({ id: 5, result: { state: 'live', location: { ...LOCATION, unlockedSpellSlots } } }), null)
  }
})
