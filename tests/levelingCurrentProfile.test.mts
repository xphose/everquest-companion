import assert from 'node:assert/strict'
import { test } from 'node:test'
import { currentLevelingProfile } from '../src/renderer/src/features/leveling/currentLevelingProfile'
import type { PlayerLocation } from '../src/shared/playerLocation'

const logged = { level: 5, cue: '/who', title: 'Recorded level' }
const player: PlayerLocation = { characterName: 'Example', level: 10, classes: ['MAG', 'SHM', 'ENC'],
  zone: 'befallen', ns: 0, ew: 0, z: 0, heading: 0, sampledAt: 1000 }

test('Leveling current profile follows native level and all classes without editing logged facts', () => {
  const before = structuredClone(logged)
  const result = currentLevelingProfile(logged, player)
  assert.equal(result.level.level, 10)
  assert.equal(result.level.cue, 'Live')
  assert.deepEqual(result.classes, { resolved: ['MAG', 'SHM', 'ENC'], candidates: [], ambiguous: false })
  assert.deepEqual(logged, before)
  assert.deepEqual(currentLevelingProfile(logged, null), { level: logged, classes: null })
  assert.equal(currentLevelingProfile(logged, { ...player, level: undefined }).level, logged)
  assert.deepEqual(currentLevelingProfile(logged, { ...player, classes: ['WAR', 'CLR'] }).classes?.resolved, ['WAR', 'CLR'])
  assert.deepEqual(player.classes, ['MAG', 'SHM', 'ENC'])
  assert.equal(currentLevelingProfile(logged, { ...player, classes: undefined }).classes, null)
})
