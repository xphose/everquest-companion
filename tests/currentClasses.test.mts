import { test } from 'node:test'
import assert from 'node:assert/strict'
import { currentClassFacts, currentClassesOf } from '../src/shared/currentClasses'
import type { ComboInterval } from '../src/shared/classCombo'
import type { PlayerLocation } from '../src/shared/playerLocation'

const logged: ComboInterval = {
  id: 'synthetic', startTs: 1, endTs: null, startLo: 1, startHi: 1, endLo: null, endHi: null,
  startReason: 'logStart', expectedSlots: 3, levelLo: 5, levelHi: 5, evidenceCount: 2, userLocked: false,
  slots: [
    { candidates: ['MAG'], confidence: 1, provenance: 'inferred', because: [] },
    { candidates: ['SHM'], confidence: 1, provenance: 'inferred', because: [] },
    { candidates: ['ENC', 'WIZ'], confidence: 0.4, provenance: 'inferred', because: [] }
  ]
}
const live = (changes: Partial<PlayerLocation> = {}): PlayerLocation => ({
  characterName: 'FixtureHero', zone: 'qeynos2', ns: 1, ew: 2, z: 3, heading: 0,
  sampledAt: 10_000, classes: ['MAG', 'SHM', 'ENC'], level: 10, ...changes
})

test('current classes and level use one observation without rewriting logged ambiguity', () => {
  const before = JSON.stringify(logged)
  const current = currentClassesOf(logged, currentClassFacts(live(), 'fixturehero', 10_000))
  assert.deepEqual(current.classes, ['ENC', 'MAG', 'SHM'])
  assert.equal(current.liveLevel, 10)
  assert.equal(current.source, 'live')
  assert.equal(current.combo.ambiguous, false)
  assert.equal(current.logged, logged)
  assert.equal(JSON.stringify(logged), before)
  assert.deepEqual(currentClassFacts(live({ classes: ['SHM', 'ENC', 'MAG'] }), 'FixtureHero', 10_000),
    currentClassFacts(live(), 'FixtureHero', 10_000))
})

test('stale, future, missing and wrong-character reads preserve the complete log fallback', () => {
  for (const player of [null, live({ sampledAt: 8_499 }), live({ sampledAt: 10_001 }), live({ characterName: 'OtherHero' })]) {
    const current = currentClassesOf(logged, currentClassFacts(player, 'FixtureHero', 10_000))
    assert.deepEqual(current.classes, ['MAG', 'SHM'])
    assert.deepEqual(current.combo.candidates, ['ENC', 'WIZ'])
    assert.equal(current.combo.ambiguous, true)
    assert.equal(current.source, 'log')
    assert.equal(current.liveLevel, undefined)
    assert.equal(current.logged, logged)
  }
  assert.equal(currentClassFacts(live(), undefined, 10_000).classKey, '')
})

test('level and class availability fall back independently without inventing a native fact', () => {
  for (const level of [undefined, 0, 126, 2.5, NaN]) {
    const current = currentClassesOf(logged, currentClassFacts(live({ level }), 'FixtureHero', 10_000))
    assert.equal(current.source, 'live')
    assert.equal(current.liveLevel, undefined)
  }
  const missingClasses = currentClassesOf(logged, currentClassFacts(live({ classes: undefined }), 'FixtureHero', 10_000))
  assert.equal(missingClasses.source, 'log')
  assert.equal(missingClasses.liveLevel, 10)
  const unknown = currentClassesOf(null, currentClassFacts(null, 'FixtureHero', 10_000))
  assert.deepEqual(unknown.classes, [])
  assert.equal(unknown.combo.ambiguous, true)
})
