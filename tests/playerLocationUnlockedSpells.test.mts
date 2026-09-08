import test from 'node:test'
import assert from 'node:assert/strict'
import { samplePlayer } from '../src/main/playerLocation/sample.ts'
import { observeUnlockedSpellSlots } from '../src/main/playerLocation/unlockedSpells.ts'
import { entitlementFixture } from './playerLocationEntitlementFixture.mts'

const slots = (count: number) => Array.from({ length: count }, (_, index) => index + 1)

function observed(fixture: ReturnType<typeof entitlementFixture>) {
  const observation = observeUnlockedSpellSlots(fixture.read, fixture.base, fixture.owner, fixture.profile)
  return observation?.unchanged() ? observation.slots : undefined
}

test('native effect 326 grants twelve unlocked slots independently of all eighteen empty gems', () => {
  const fixture = entitlementFixture()
  fixture.table(true, [{ first: 4n }])
  fixture.table(false, [])
  for (let offset = 0; offset < fixture.gems.length; offset += 8) fixture.gems.writeInt32LE(-1, offset)
  const result = samplePlayer(fixture.read, fixture.base)
  assert.equal(result.state, 'live')
  if (result.state === 'live') {
    assert.deepEqual(result.location.unlockedSpellSlots, slots(12))
    assert.deepEqual(result.location.memorizedSpells, Array.from({ length: 18 }, () => null))
    assert.deepEqual(result.location.classes, ['SHM', 'MAG', 'ENC'])
  }
})

test('all three cache contributions count; absent keys and ready null tables add zero', () => {
  for (const additional of [0n, 4n, 10n]) {
    const fixture = entitlementFixture()
    fixture.table(true, [{ effect: 393, first: 1000n }, { subtype: 1, first: 1000n }, { first: additional }])
    fixture.table(false, [])
    assert.deepEqual(observed(fixture), slots(8 + Number(additional)))
  }
  const combined = entitlementFixture()
  combined.table(true, [{ first: 2n }])
  combined.table(false, [{ first: 1n, second: 1n }])
  assert.deepEqual(observed(combined), slots(12))
  const empty = entitlementFixture()
  assert.deepEqual(observed(empty), slots(8))
  const missing = entitlementFixture()
  missing.table(true, [{ effect: 393, first: 1000n }, { subtype: 1, first: 1000n }])
  missing.table(false, [{ effect: 393, first: 1000n }])
  assert.deepEqual(observed(missing), slots(8))
})

test('occupied locked gems remain distinct and cache updates allow unlock increases and decreases', () => {
  const fixture = entitlementFixture()
  const item = fixture.table(true, [{ first: 0n }])
  for (const count of [8, 9, 12, 8]) {
    item.nodes[0].writeBigInt64LE(BigInt(count - 8), 16)
    const result = samplePlayer(fixture.read, fixture.base)
    assert.equal(result.state, 'live')
    if (result.state === 'live') {
      assert.deepEqual(result.location.unlockedSpellSlots, slots(count))
      assert.equal(result.location.memorizedSpells?.[17], 2230)
    }
  }
})

test('native lookup uses the first exact compound key and never reads unreachable duplicate nodes', () => {
  const fixture = entitlementFixture()
  const item = fixture.table(true, [{ first: 4n }, { first: 9n }])
  assert.deepEqual(observed(fixture), slots(12))
  assert.equal(fixture.reads.some(read => read.address === item.at + 0x1040n), false)
})

test('unready, special, misidentified and unreadable entitlement omit only slots', () => {
  const changes = [
    (f: ReturnType<typeof entitlementFixture>) => { f.cache[8] = 0 },
    (f: ReturnType<typeof entitlementFixture>) => { f.cache[8] = 2 },
    (f: ReturnType<typeof entitlementFixture>) => { f.cache[0x38] = 0 },
    (f: ReturnType<typeof entitlementFixture>) => { f.special.writeUInt32LE(1) },
    (f: ReturnType<typeof entitlementFixture>) => { f.zoneDescriptor.writeBigUInt64LE(0n) },
    (f: ReturnType<typeof entitlementFixture>) => { f.descriptor.writeInt32LE(0x750, 4) },
    (f: ReturnType<typeof entitlementFixture>) => { f.zonePlayer.writeBigUInt64LE(f.player + 8n) }
  ]
  for (const change of changes) {
    const fixture = entitlementFixture()
    change(fixture)
    const result = samplePlayer(fixture.read, fixture.base)
    assert.equal(result.state, 'live')
    if (result.state === 'live') {
      assert.equal('unlockedSpellSlots' in result.location, false)
      assert.deepEqual(result.location.classes, ['SHM', 'MAG', 'ENC'])
      assert.deepEqual(result.location.spellbook, [17, 94, 1504, 2230])
    }
  }
  const fixture = entitlementFixture()
  const read = (at: bigint, size: number) => at === fixture.zone + 0x1a8n ? Buffer.alloc(size - 1) : fixture.read(at, size)
  const result = samplePlayer(read, fixture.base)
  assert.equal(result.state, 'live')
  if (result.state === 'live') {
    assert.equal('unlockedSpellSlots' in result.location, false)
    assert.ok(result.location.memorizedSpells)
  }
})

test('entitlement table corruption, incomplete reads, cycles and excessive chains fail closed', () => {
  const changes = [
    (f: ReturnType<typeof entitlementFixture>, t: ReturnType<ReturnType<typeof entitlementFixture>['table']>) => t.header.writeUInt32LE(0, 8),
    (f: ReturnType<typeof entitlementFixture>, t: ReturnType<ReturnType<typeof entitlementFixture>['table']>) => t.header.writeUInt32LE(4097, 8),
    (f: ReturnType<typeof entitlementFixture>, t: ReturnType<ReturnType<typeof entitlementFixture>['table']>) => t.header.writeBigUInt64LE(1n),
    (f: ReturnType<typeof entitlementFixture>, t: ReturnType<ReturnType<typeof entitlementFixture>['table']>) => t.buckets.writeBigUInt64LE(1n, t.bucket),
    (f: ReturnType<typeof entitlementFixture>, t: ReturnType<ReturnType<typeof entitlementFixture>['table']>) => t.nodes[0].writeBigUInt64LE(t.at + 0x1000n, 24),
    (f: ReturnType<typeof entitlementFixture>, t: ReturnType<ReturnType<typeof entitlementFixture>['table']>) => { t.nodes[0].writeUInt32LE(326); t.nodes[0].writeBigInt64LE(-1n, 16) },
    (f: ReturnType<typeof entitlementFixture>, t: ReturnType<ReturnType<typeof entitlementFixture>['table']>) => { t.nodes[0].writeUInt32LE(326); t.nodes[0].writeBigInt64LE(0x7fffffffffffffffn, 16) }
  ]
  for (const change of changes) {
    const fixture = entitlementFixture()
    const item = fixture.table(true, [{ effect: 393 }])
    change(fixture, item)
    assert.equal(observed(fixture), undefined)
  }
  const excessive = entitlementFixture()
  excessive.table(true, Array.from({ length: 33 }, () => ({ effect: 393 })))
  assert.equal(observed(excessive), undefined)
  const incomplete = entitlementFixture()
  const item = incomplete.table(true, [{ first: 4n }])
  const read = (at: bigint, size: number) => at === item.at + 0x1000n ? Buffer.alloc(size - 1) : incomplete.read(at, size)
  assert.equal(observeUnlockedSpellSlots(read, incomplete.base, incomplete.owner, incomplete.profile), undefined)
})

test('cache identity, ready flags, special state and raw values are reread across the spellbook sample', () => {
  type Fixture = ReturnType<typeof entitlementFixture>
  type Table = ReturnType<Fixture['table']>
  const changes = [
    (f: Fixture, t: Table) => t.nodes[0].writeBigInt64LE(5n, 16),
    (f: Fixture, t: Table) => t.nodes[0].writeUInt32LE(393),
    (f: Fixture, t: Table) => t.buckets.writeBigUInt64LE(0n, t.bucket),
    (f: Fixture) => { f.cache[8] = 0 },
    (f: Fixture) => f.cache.writeBigUInt64LE(0n, 0x30),
    (f: Fixture) => f.special.writeUInt32LE(1)
  ]
  for (const change of changes) {
    const fixture = entitlementFixture()
    const item = fixture.table(true, [{ first: 4n }])
    const read = (at: bigint, size: number) => {
      const bytes = fixture.read(at, size)
      if (at === fixture.profile + 0xb0n) change(fixture, item)
      return bytes
    }
    const result = samplePlayer(read, fixture.base)
    assert.equal(result.state, 'live')
    if (result.state === 'live') {
      assert.equal('unlockedSpellSlots' in result.location, false)
      assert.deepEqual(result.location.classes, ['SHM', 'MAG', 'ENC'])
      assert.ok(result.location.spellbook)
    }
  }
})

test('entitlement plus coherence reread has a fixed keyed-lookup budget, including worst bounded collisions', () => {
  const fixture = entitlementFixture()
  fixture.table(true, [{ first: 4n }])
  fixture.table(false, [])
  assert.deepEqual(observed(fixture), slots(12))
  assert.equal(fixture.reads.length, 28)
  assert.equal(fixture.reads.reduce((sum, read) => sum + read.size, 0), 244)
  const worst = entitlementFixture()
  for (const item of [true, false]) worst.table(item, Array.from({ length: 32 }, () => ({ effect: 393 })))
  assert.deepEqual(observed(worst), slots(8))
  assert.equal(worst.reads.length, 154)
  assert.equal(worst.reads.reduce((sum, read) => sum + read.size, 0), 5300)
  assert.ok(worst.reads.every(read => read.size <= 48))
})

test('owner or selected profile changes during entitlement verification cannot escape the final profile guard', () => {
  for (const ownerChange of [true, false]) {
    const fixture = entitlementFixture()
    let readyReads = 0
    const read = (at: bigint, size: number) => {
      const bytes = fixture.read(at, size)
      if (at === fixture.zone + 0x1a8n && ++readyReads === 2) {
        if (ownerChange) fixture.ownerRoot.writeBigUInt64LE(0n)
        else fixture.segments.find(segment => segment.at === fixture.owner + 0x2f78n)!.bytes.writeUInt32LE(1, 8)
      }
      return bytes
    }
    const result = samplePlayer(read, fixture.base)
    assert.equal(result.state, 'live')
    if (result.state === 'live') {
      assert.equal('classes' in result.location, false)
      assert.equal('spellbook' in result.location, false)
      assert.equal('unlockedSpellSlots' in result.location, false)
    }
  }
})
