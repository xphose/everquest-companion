import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readGearInventory } from '../src/renderer/src/features/gear/readGearInventory'
import { NO_OWNERSHIP } from '../src/shared/planner/ownership'
import type { CharacterRef } from '../src/shared/types'
const first: CharacterRef = { name: 'Synthetic', server: 'Fixture', logPath: 'synthetic-character.log' }
const second: CharacterRef = { ...first, name: 'Different' }
const drain = async (): Promise<void> => { for (let index = 0; index < 8; index++) await Promise.resolve() }

test('a character switch before inventory starts reads no exports for the old identity', async () => {
  let reads = 0
  await assert.rejects(readGearInventory('synthetic_fixture', { getCharacter: async () => second,
    plannerInventory: async () => { reads++; return null }, gearOwnership: async () => { reads++; return NO_OWNERSHIP } }), /Character changed before/)
  assert.equal(reads, 0)
})

test('a character switch during an export pair discards both channels', async () => {
  let checks = 0
  await assert.rejects(readGearInventory('synthetic_fixture', { getCharacter: async () => checks++ === 0 ? first : second,
    plannerInventory: async () => null, gearOwnership: async () => NO_OWNERSHIP }), /Character changed during/)
})

test('a failed channel does not allow another read to overlap its still-running counterpart', async () => {
  let release: (() => void) | undefined
  let settled = false
  const result = readGearInventory('synthetic_fixture', { getCharacter: async () => first,
    plannerInventory: async () => { throw new Error('synthetic failure') },
    gearOwnership: () => new Promise(resolve => { release = () => resolve(NO_OWNERSHIP) }) }).catch(error => { settled = true; throw error })
  const refused = assert.rejects(result, /Inventory reading failed/)
  await drain()
  assert.equal(settled, false)
  release!(); await refused
})

test('the current character can read an honestly missing export', async () => {
  assert.deepEqual(await readGearInventory('synthetic_fixture', { getCharacter: async () => first,
    plannerInventory: async () => null, gearOwnership: async () => NO_OWNERSHIP }), [null, NO_OWNERSHIP])
})
