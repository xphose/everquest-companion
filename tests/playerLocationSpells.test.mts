import test from 'node:test'
import assert from 'node:assert/strict'
import { samplePlayer } from '../src/main/playerLocation/sample.ts'
import { locationFixture } from './playerLocationFixture.mts'

function spellFixture() {
  const location = locationFixture()
  const owner = 0x61000000n, node = 0x62000000n, profile = 0x63000000n, manager = 0x64000000n
  const pointer = (value: bigint): Buffer => {
    const bytes = Buffer.alloc(8)
    bytes.writeBigUInt64LE(value)
    return bytes
  }
  const descriptor = Buffer.alloc(8)
  descriptor.writeInt32LE(0x2f68, 4)
  const profileManager = Buffer.alloc(12)
  profileManager.writeBigUInt64LE(node)
  const nodeBytes = Buffer.alloc(16)
  nodeBytes.writeBigUInt64LE(profile, 8)
  const mask = Buffer.alloc(4)
  mask.writeUInt32LE(0x6400)
  const maximum = Buffer.alloc(4)
  maximum.writeInt32LE(5000)
  const book = Buffer.alloc(1120 * 8)
  const gems = Buffer.alloc(18 * 8)
  for (const bytes of [book, gems]) {
    for (let at = 0; at < bytes.length; at += 8) {
      bytes.writeInt32LE(-1, at)
      bytes.writeInt32LE(1, at + 4)
    }
  }
  book.writeInt32LE(17, 0)
  book.writeInt32LE(94, 4 * 8)
  book.writeInt32LE(1504, 512 * 8)
  book.writeInt32LE(2230, 1119 * 8)
  gems.writeInt32LE(94, 0)
  gems.writeInt32LE(17, 3 * 8)
  gems.writeInt32LE(2230, 17 * 8)
  const ownerRoot = pointer(owner), spellRoot = pointer(manager)
  const segments = [
    { at: location.base + 0xf0c4b0n, bytes: ownerRoot },
    { at: owner + 8n, bytes: pointer(location.base + 0x9a8968n) },
    { at: location.base + 0x9a8968n, bytes: descriptor },
    { at: owner + 0x2f78n, bytes: profileManager }, { at: node, bytes: nodeBytes },
    { at: profile + 0x2748n, bytes: mask },
    { at: location.base + 0xf92118n, bytes: spellRoot }, { at: manager + 0x64n, bytes: maximum },
    { at: profile + 0xb0n, bytes: book }, { at: profile + 0x23b0n, bytes: gems }
  ]
  const reads: { address: bigint; size: number }[] = []
  const read = (address: bigint, size: number): Buffer | null => {
    reads.push({ address, size })
    const segment = segments.find(value => address >= value.at && address + BigInt(size) <= value.at + BigInt(value.bytes.length))
    if (!segment) return location.read(address, size)
    const offset = Number(address - segment.at)
    return Buffer.from(segment.bytes.subarray(offset, offset + size))
  }
  return { ...location, profile, manager, ownerRoot, spellRoot, maximum, book, gems, mask, read, reads }
}

test('verified spellbook array covers its last slot and preserves all eighteen gem positions and holes', () => {
  const fixture = spellFixture()
  const result = samplePlayer(fixture.read, fixture.base)
  assert.equal(result.state, 'live')
  if (result.state !== 'live') return
  assert.deepEqual(result.location.spellbook, [17, 94, 1504, 2230])
  assert.deepEqual(result.location.memorizedSpells, [94, null, null, 17, ...Array.from({ length: 13 }, () => null), 2230])
  assert.ok(fixture.reads.every(value => value.size <= 4096))
  const bookReads = fixture.reads.filter(value => value.address >= fixture.profile + 0xb0n && value.address < fixture.profile + 0x23b0n)
  assert.deepEqual(bookReads.map(value => value.size), [4096, 4096, 768, 4096, 4096, 768])
})

test('book ownership is a unique set while gem duplicates and exact positions remain intact', () => {
  const fixture = spellFixture()
  fixture.book.writeInt32LE(94, 10 * 8)
  fixture.gems.writeInt32LE(94, 8)
  const result = samplePlayer(fixture.read, fixture.base)
  assert.equal(result.state, 'live')
  if (result.state === 'live') {
    assert.deepEqual(result.location.spellbook, [17, 94, 1504, 2230])
    assert.equal(result.location.memorizedSpells?.[0], 94)
    assert.equal(result.location.memorizedSpells?.[1], 94)
  }
})

test('a completely empty readable spellbook is distinct from an unavailable observation', () => {
  const fixture = spellFixture()
  for (const bytes of [fixture.book, fixture.gems]) for (let at = 0; at < bytes.length; at += 8) bytes.writeInt32LE(-1, at)
  const result = samplePlayer(fixture.read, fixture.base)
  assert.equal(result.state, 'live')
  if (result.state === 'live') {
    assert.deepEqual(result.location.spellbook, [])
    assert.deepEqual(result.location.memorizedSpells, Array.from({ length: 18 }, () => null))
  }
})

test('invalid IDs, missing manager and unowned gems omit spell arrays without removing classes or location', () => {
  const invalid = [
    (f: ReturnType<typeof spellFixture>) => f.book.writeInt32LE(0),
    (f: ReturnType<typeof spellFixture>) => f.book.writeInt32LE(-2),
    (f: ReturnType<typeof spellFixture>) => f.book.writeInt32LE(5001),
    (f: ReturnType<typeof spellFixture>) => f.gems.writeInt32LE(5001),
    (f: ReturnType<typeof spellFixture>) => f.gems.writeInt32LE(2222),
    (f: ReturnType<typeof spellFixture>) => f.spellRoot.writeBigUInt64LE(0n),
    (f: ReturnType<typeof spellFixture>) => f.maximum.writeInt32LE(0)
  ]
  for (const change of invalid) {
    const fixture = spellFixture()
    change(fixture)
    const result = samplePlayer(fixture.read, fixture.base)
    assert.equal(result.state, 'live')
    if (result.state === 'live') {
      assert.deepEqual(result.location.classes, ['SHM', 'MAG', 'ENC'])
      assert.equal('spellbook' in result.location, false)
      assert.equal('memorizedSpells' in result.location, false)
    }
  }
})

test('partial later book blocks and failed gem reads never expose a partial owned set', () => {
  const fixture = spellFixture()
  for (const address of [fixture.profile + 0xb0n + 4096n, fixture.profile + 0x23b0n]) {
    const read = (at: bigint, size: number) => at === address ? Buffer.alloc(size - 1) : fixture.read(at, size)
    const result = samplePlayer(read, fixture.base)
    assert.equal(result.state, 'live')
    if (result.state === 'live') assert.equal('spellbook' in result.location, false)
  }
})

test('book, gem, metadata and spell-manager changes during reads omit the entire spell observation', () => {
  const changes = [
    (f: ReturnType<typeof spellFixture>) => f.book.writeInt32LE(777, 100 * 8),
    (f: ReturnType<typeof spellFixture>) => f.gems.writeInt32LE(17),
    (f: ReturnType<typeof spellFixture>) => f.book.writeInt32LE(2, 4),
    (f: ReturnType<typeof spellFixture>) => f.maximum.writeInt32LE(4999),
    (f: ReturnType<typeof spellFixture>) => f.spellRoot.writeBigUInt64LE(0n)
  ]
  for (const change of changes) {
    const fixture = spellFixture()
    const read = (at: bigint, size: number) => {
      const bytes = fixture.read(at, size)
      if (at === fixture.profile + 0x23b0n) change(fixture)
      return bytes
    }
    const result = samplePlayer(read, fixture.base)
    assert.equal(result.state, 'live')
    if (result.state === 'live') assert.equal('spellbook' in result.location, false)
  }
})

test('a class or profile change during book reads cannot mix old classes with new spells', () => {
  for (const change of [
    (f: ReturnType<typeof spellFixture>) => f.mask.writeUInt32LE(0x2400),
    (f: ReturnType<typeof spellFixture>) => f.ownerRoot.writeBigUInt64LE(0n)
  ]) {
    const fixture = spellFixture()
    const read = (at: bigint, size: number) => {
      const bytes = fixture.read(at, size)
      if (at === fixture.profile + 0x23b0n) change(fixture)
      return bytes
    }
    const result = samplePlayer(read, fixture.base)
    assert.equal(result.state, 'live')
    if (result.state === 'live') {
      assert.equal('classes' in result.location, false)
      assert.equal('spellbook' in result.location, false)
    }
  }
})
