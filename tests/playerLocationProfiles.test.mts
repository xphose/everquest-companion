import test from 'node:test'
import assert from 'node:assert/strict'
import { LEGENDS_PROFILE, matchesMappedImage, type LocationProfile } from '../src/main/playerLocation/profile.ts'
import { LEGENDS_20260908_PROFILE, LOCATION_PROFILES, knownProfileSize, profileForFingerprint } from '../src/main/playerLocation/profiles.ts'
import { samplePlayer } from '../src/main/playerLocation/sample.ts'
import { createLocationSampler } from '../src/main/playerLocation/reader.ts'
import type { LocationNative } from '../src/main/playerLocation/native.ts'
import { locationFixture } from './playerLocationFixture.mts'
import { relocatedProfileFixture } from './playerLocationProfileFixture.mts'

// Test-only values cannot enter the exact production fingerprint registry.
const RELOCATED: LocationProfile = Object.freeze({
  ...LEGENDS_PROFILE, sha256: '1'.repeat(64), fileSize: 16_000_000,
  timestamp: 0x12345678, imageSize: 0x1700000,
  playerRva: 0x101010n, worldRva: 0x202020n, characterRva: 0x303030n,
  spellManagerRva: 0x404040n, characterDescriptorRva: 0x505050n, characterZoneDescriptorRva: 0x606060n
})

test('the selected layout reaches position, classes, book, gems, entitlement and buffs', () => {
  const fixture = relocatedProfileFixture()
  assert.equal(matchesMappedImage(fixture.read, fixture.base), false)
  assert.equal(matchesMappedImage(fixture.read, fixture.base, RELOCATED), true)
  const result = samplePlayer(fixture.read, fixture.base, () => 81, RELOCATED)
  assert.equal(result.state, 'live')
  if (result.state !== 'live') return
  assert.deepEqual(result.location, {
    characterName: 'Wayfinder', zone: 'akanon', ns: 1109.5, ew: -963.25, z: 30.9375,
    heading: 450.375, level: 10, classes: ['SHM', 'MAG', 'ENC'], sampledAt: 81,
    spellbook: [17, 94, 1504, 2230],
    memorizedSpells: [94, null, null, 17, ...Array<null>(13).fill(null), 2230],
    unlockedSpellSlots: Array.from({ length: 12 }, (_, index) => index + 1),
    activeBuffs: [{ spellId: 94, slot: 1, kind: 'buff', remainingMs: 42_000 }]
  })
  assert.ok(fixture.requests.every(request => !fixture.oldAddresses.has(request.address)))
  assert.ok(fixture.requests.every(request => request.size <= 4096))
  assert.ok(fixture.requests.length < 140)
})

function samplerFor(fixture: ReturnType<typeof locationFixture>, select: () => LocationProfile | null) {
  const executable = 'C:\\Games\\Synthetic\\eqgame.exe'
  const native: LocationNative = {
    matchingProcesses: () => [91],
    openPlayerProcess: () => ({ imagePath: () => executable, imageBase: () => fixture.base, read: fixture.read, close() { /* Synthetic memory. */ } })
  }
  return createLocationSampler(native, { executable: () => executable, fingerprint: { select, close() { /* Synthetic fingerprint. */ } }, now: () => 81 })
}

test('interleaved samplers retain their selected build and a disk/mapped mismatch stops before player reads', () => {
  const relocated = relocatedProfileFixture()
  let selected = RELOCATED
  const newer = samplerFor(relocated, () => selected)
  const original = samplerFor(locationFixture(), () => LEGENDS_PROFILE)
  for (let count = 0; count < 3; count++) {
    assert.equal(newer.read('root').state, 'live')
    assert.equal(original.read('root').state, 'live')
  }
  selected = LEGENDS_PROFILE
  relocated.requests.length = 0
  assert.equal(newer.read('root').state, 'unsupported')
  assert.ok(relocated.requests.every(request => request.address < relocated.base + 4096n))
  selected = RELOCATED
  assert.equal(newer.read('root').state, 'live')
  newer.close()
  original.close()
})

test('the immutable registry requires both exact size and digest and rejects unknown builds', () => {
  assert.ok(Object.isFrozen(LOCATION_PROFILES))
  for (const profile of LOCATION_PROFILES) {
    assert.ok(Object.isFrozen(profile))
    assert.equal(knownProfileSize(BigInt(profile.fileSize)), true)
    assert.equal(profileForFingerprint(BigInt(profile.fileSize), profile.sha256), profile)
    assert.equal(profileForFingerprint(BigInt(profile.fileSize) + 1n, profile.sha256), null)
    assert.equal(profileForFingerprint(BigInt(profile.fileSize), '0'.repeat(64)), null)
  }
  assert.equal(knownProfileSize(BigInt(RELOCATED.fileSize)), false)
  assert.equal(profileForFingerprint(BigInt(RELOCATED.fileSize), RELOCATED.sha256), null)
})

test('the September build reads the moved player level and zone instead of plausible obsolete fields', () => {
  const fixture = relocatedProfileFixture('september')
  const sampler = samplerFor(fixture, () => LEGENDS_20260908_PROFILE)
  const result = sampler.read('root')
  assert.equal(result.state, 'live')
  if (result.state !== 'live') return
  assert.equal(result.location.level, 37)
  assert.equal(result.location.characterName, 'Mapwalker')
  assert.deepEqual([result.location.ns, result.location.ew, result.location.z, result.location.heading], [217.75, -681.5, 93.25, 87.25])
  assert.equal(result.location.zone, 'akanon')
  assert.deepEqual(result.location.classes, ['CLR', 'DRU', 'WIZ'])
  assert.deepEqual(result.location.spellbook, [46, 57, 68, 79])
  assert.equal(result.location.unlockedSpellSlots?.length, 10)
  assert.deepEqual(result.location.activeBuffs, [{ spellId: 700, slot: 1, kind: 'buff', remainingMs: 30_000 }])
  assert.ok(fixture.requests.some(request => request.address === fixture.player + 0x32cn && request.size === 1))
  assert.ok(fixture.requests.some(request => request.address === fixture.player + 0x358n && request.size === 4))
  assert.ok(fixture.requests.every(request => !fixture.oldAddresses.has(request.address)))
  assert.ok(fixture.requests.every(request => request.address !== fixture.player + 0x4bcn && request.address !== fixture.player + 0x59cn))
  sampler.close()
})

test('the September level observes increases and decreases while invalid bytes omit only level', () => {
  const fixture = relocatedProfileFixture('september')
  for (const level of [38, 36, 125, 0, 126, 255]) {
    fixture.playerBytes.writeUInt8(level, 0x32c)
    const result = samplePlayer(fixture.read, fixture.base, () => 91, LEGENDS_20260908_PROFILE)
    assert.equal(result.state, 'live')
    if (result.state !== 'live') continue
    assert.equal(result.location.level, level >= 1 && level <= 125 ? level : undefined)
    assert.deepEqual(result.location.classes, ['CLR', 'DRU', 'WIZ'])
    assert.equal(result.location.zone, 'akanon')
  }
})
