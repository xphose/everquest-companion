import test from 'node:test'
import assert from 'node:assert/strict'
import { LEGENDS_PROFILE, matchesMappedImage } from '../src/main/playerLocation/profile.ts'
import { LEGENDS_20260908_PROFILE, LEGENDS_20260914_PROFILE, profileForFingerprint } from '../src/main/playerLocation/profiles.ts'
import { createLocationSampler } from '../src/main/playerLocation/reader.ts'
import { samplePlayer } from '../src/main/playerLocation/sample.ts'
import { september14Fixture } from './playerLocationSeptember14Fixture.mts'

test('September 14 exact fingerprint and mapped identity select the newly verified layout', () => {
  const profile = profileForFingerprint(15_535_224n, '8016b33fdf7546139f749db5f6790f777589f7b1ac35e504afd6c92d4f82f62a')
  assert.equal(profile, LEGENDS_20260914_PROFILE)
  assert.ok(Object.isFrozen(profile))
  const fixture = september14Fixture()
  assert.equal(matchesMappedImage(fixture.read, fixture.base, LEGENDS_20260914_PROFILE), true)
  assert.equal(matchesMappedImage(fixture.read, fixture.base, LEGENDS_20260908_PROFILE), false)
  assert.equal(matchesMappedImage(fixture.read, fixture.base, LEGENDS_PROFILE), false)
})

test('September 14 reads current classes, book, gems, slots and buffs with the moved level and zone', () => {
  const fixture = september14Fixture()
  const result = samplePlayer(fixture.read, fixture.base, () => 103, LEGENDS_20260914_PROFILE)
  assert.equal(result.state, 'live')
  if (result.state !== 'live') return
  assert.deepEqual(result.location, {
    characterName: 'Trailrunner', zone: 'akanon', ns: 217.75, ew: -681.5, z: 93.25,
    heading: 87.25, level: 19, classes: ['PAL', 'ROG', 'SHM'], sampledAt: 103,
    spellbook: [46, 57, 68, 79],
    memorizedSpells: [57, null, null, 46, ...Array<null>(13).fill(null), 79],
    unlockedSpellSlots: Array.from({ length: 10 }, (_, index) => index + 1),
    activeBuffs: [{ spellId: 700, slot: 1, kind: 'buff', remainingMs: 30_000 }]
  })
  assert.ok(fixture.requests.some(request => request.address === fixture.player + 0x214n && request.size === 1))
  assert.ok(fixture.requests.some(request => request.address === fixture.player + 0x204n && request.size === 4))
  assert.ok(fixture.requests.every(request => !fixture.obsolete.has(request.address)))
  assert.ok(fixture.requests.every(request => request.size <= 4096))
  assert.ok(fixture.requests.length < 140)
})

test('September 14 rejects a mapped predecessor before reading player memory', () => {
  const fixture = september14Fixture()
  const executable = 'C:\\Games\\Synthetic\\eqgame.exe'
  const sampler = createLocationSampler({
    matchingProcesses: () => [91],
    openPlayerProcess: () => ({ imagePath: () => executable, imageBase: () => fixture.base, read: fixture.read, close() { /* Synthetic memory. */ } })
  }, { executable: () => executable, fingerprint: { select: () => LEGENDS_20260914_PROFILE, close() { /* Synthetic fingerprint. */ } } })
  fixture.image.writeUInt32LE(0x6a9f67b3, 0x100)
  fixture.image.writeUInt32LE(0x16c7000, 0x148)
  assert.equal(sampler.read('root').state, 'unsupported')
  assert.ok(fixture.requests.every(request => request.address < fixture.base + 4096n))
  sampler.close()
})

test('September 14 observes changing levels and gem order without retaining old facts', () => {
  const fixture = september14Fixture()
  for (const level of [20, 18, 125, 0, 126, 255]) {
    fixture.playerBytes.writeUInt8(level, 0x214)
    fixture.gems.writeInt32LE(level % 2 === 0 ? 46 : 57, 0)
    const result = samplePlayer(fixture.read, fixture.base, () => 104, LEGENDS_20260914_PROFILE)
    assert.equal(result.state, 'live')
    if (result.state !== 'live') continue
    assert.equal(result.location.level, level >= 1 && level <= 125 ? level : undefined)
    assert.equal(result.location.memorizedSpells?.[0], level % 2 === 0 ? 46 : 57)
    assert.deepEqual(result.location.classes, ['PAL', 'ROG', 'SHM'])
    assert.equal(result.location.unlockedSpellSlots?.length, 10)
  }
})
