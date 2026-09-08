import test from 'node:test'
import assert from 'node:assert/strict'
import { classesFromMask, readActiveClasses } from '../src/main/playerLocation/activeClasses.ts'
import { samplePlayer } from '../src/main/playerLocation/sample.ts'
import { locationFixture } from './playerLocationFixture.mts'

function classFixture() {
  const location = locationFixture()
  const owner = 0x61000000n
  const descriptor = location.base + 0x9a8968n
  const manager = owner + 0x2f78n
  const inactiveNode = 0x62000000n
  const activeNode = 0x62000100n
  const profile = 0x63000000n
  const pointer = (value: bigint): Buffer => {
    const bytes = Buffer.alloc(8)
    bytes.writeBigUInt64LE(value)
    return bytes
  }
  const rootBytes = pointer(owner)
  const ownerBytes = pointer(descriptor)
  const descriptorBytes = Buffer.alloc(8)
  descriptorBytes.writeInt32LE(0x2f68, 4)
  const managerBytes = Buffer.alloc(12)
  managerBytes.writeBigUInt64LE(inactiveNode)
  managerBytes.writeUInt32LE(0, 8)
  const inactiveBytes = Buffer.alloc(32)
  inactiveBytes.writeUInt32LE(7)
  inactiveBytes.writeBigUInt64LE(0x64000000n, 8)
  inactiveBytes.writeBigUInt64LE(activeNode, 0x18)
  const activeBytes = Buffer.alloc(32)
  activeBytes.writeUInt32LE(0)
  activeBytes.writeBigUInt64LE(profile, 8)
  const maskBytes = Buffer.alloc(4)
  // Independent literal class bits: SHM=10, MAG=13, ENC=14. No profile constants build the bytes.
  maskBytes.writeUInt32LE(0x6400)
  const segments = [
    { at: location.base + 0xf0c4b0n, bytes: rootBytes },
    { at: owner + 8n, bytes: ownerBytes }, { at: descriptor, bytes: descriptorBytes },
    { at: manager, bytes: managerBytes }, { at: inactiveNode, bytes: inactiveBytes },
    { at: activeNode, bytes: activeBytes }, { at: profile + 0x2748n, bytes: maskBytes }
  ]
  const reads: { address: bigint; size: number }[] = []
  const read = (address: bigint, size: number): Buffer | null => {
    reads.push({ address, size })
    const segment = segments.find(item => address >= item.at && address + BigInt(size) <= item.at + BigInt(item.bytes.length))
    if (!segment) return location.read(address, size)
    const offset = Number(address - segment.at)
    return Buffer.from(segment.bytes.subarray(offset, offset + size))
  }
  return { ...location, owner, descriptor, manager, inactiveNode, activeNode, profile,
    rootBytes, ownerBytes, descriptorBytes, managerBytes, inactiveBytes, activeBytes, maskBytes, segments, read, reads }
}

test('active classes follow the selected profile type, not the first saved profile or learned classes', () => {
  const fixture = classFixture()
  assert.deepEqual(readActiveClasses(fixture.read, fixture.base), ['SHM', 'MAG', 'ENC'])
  assert.equal(fixture.reads.some(value => value.address === 0x64000000n + 0x2748n), false)
  assert.ok(fixture.reads.length < 40)
  assert.ok(fixture.reads.every(value => value.size <= 8))
  const result = samplePlayer(fixture.read, fixture.base)
  assert.equal(result.state, 'live')
  if (result.state === 'live') assert.deepEqual(result.location.classes, ['SHM', 'MAG', 'ENC'])
})

test('class mask mapping accepts complete pairs and trios in native ID order', () => {
  assert.deepEqual(classesFromMask(0x2400), ['SHM', 'MAG'])
  assert.deepEqual(classesFromMask(0x4400), ['SHM', 'ENC'])
  assert.deepEqual(classesFromMask(0x18002), ['WAR', 'BST', 'BER'])
  for (const mask of [0, 0x2000, 0x6401, 0x26400, 0x1fffe, -1, 0.5, Infinity, NaN]) {
    assert.equal(classesFromMask(mask), undefined)
  }
})

test('class selection changes and decreases are fresh observations, never accumulated classes', () => {
  const fixture = classFixture()
  assert.deepEqual(readActiveClasses(fixture.read, fixture.base), ['SHM', 'MAG', 'ENC'])
  fixture.maskBytes.writeUInt32LE(0x2400)
  assert.deepEqual(readActiveClasses(fixture.read, fixture.base), ['SHM', 'MAG'])
  fixture.maskBytes.writeUInt32LE(0x4400)
  assert.deepEqual(readActiveClasses(fixture.read, fixture.base), ['SHM', 'ENC'])
})

test('unknown owner layouts, absent profile roots and invalid masks omit classes without hiding location', () => {
  const changes = [
    (f: ReturnType<typeof classFixture>) => f.rootBytes.writeBigUInt64LE(0n),
    (f: ReturnType<typeof classFixture>) => f.ownerBytes.writeBigUInt64LE(f.descriptor + 8n),
    (f: ReturnType<typeof classFixture>) => f.descriptorBytes.writeInt32LE(0x2f70, 4),
    (f: ReturnType<typeof classFixture>) => f.managerBytes.writeBigUInt64LE(0n),
    (f: ReturnType<typeof classFixture>) => f.managerBytes.writeUInt32LE(999, 8),
    (f: ReturnType<typeof classFixture>) => f.activeBytes.writeBigUInt64LE(0n, 8),
    (f: ReturnType<typeof classFixture>) => f.maskBytes.writeUInt32LE(0x1fffe)
  ]
  for (const change of changes) {
    const fixture = classFixture()
    change(fixture)
    const result = samplePlayer(fixture.read, fixture.base)
    assert.equal(result.state, 'live')
    if (result.state === 'live') assert.equal('classes' in result.location, false)
  }
})

test('cycles and overlong profile lists have a fixed read bound', () => {
  const fixture = classFixture()
  fixture.inactiveBytes.writeBigUInt64LE(fixture.inactiveNode, 0x18)
  assert.equal(readActiveClasses(fixture.read, fixture.base), undefined)
  assert.ok(fixture.reads.length < 15)
  fixture.reads.length = 0
  for (let index = 0; index < 9; index++) {
    const bytes = Buffer.alloc(32)
    bytes.writeUInt32LE(7)
    bytes.writeBigUInt64LE(0x65000000n + BigInt((index + 1) * 0x100), 0x18)
    fixture.segments.push({ at: 0x65000000n + BigInt(index * 0x100), bytes })
  }
  fixture.managerBytes.writeBigUInt64LE(0x65000000n)
  assert.equal(readActiveClasses(fixture.read, fixture.base), undefined)
  assert.ok(fixture.reads.length < 25)
  assert.equal(fixture.reads.some(value => value.address === 0x65000800n), false)
})

test('owner, selected type, profile pointer and mask changes during a read reject the class observation', () => {
  const changes = [
    (f: ReturnType<typeof classFixture>) => f.rootBytes.writeBigUInt64LE(0n),
    (f: ReturnType<typeof classFixture>) => f.managerBytes.writeUInt32LE(7, 8),
    (f: ReturnType<typeof classFixture>) => f.activeBytes.writeBigUInt64LE(0x66000000n, 8),
    (f: ReturnType<typeof classFixture>) => f.maskBytes.writeUInt32LE(0x2400)
  ]
  for (const change of changes) {
    const fixture = classFixture()
    const read = (address: bigint, size: number) => {
      const bytes = fixture.read(address, size)
      if (address === fixture.profile + 0x2748n) change(fixture)
      return bytes
    }
    assert.equal(readActiveClasses(read, fixture.base), undefined)
  }
})

test('partial or failed class reads omit classes and leave the map available', () => {
  const fixture = classFixture()
  for (const unavailable of [() => null, () => Buffer.alloc(3), () => { throw new Error('Read failed') }]) {
    const read = (address: bigint, size: number) => address === fixture.profile + 0x2748n ? unavailable() : fixture.read(address, size)
    const result = samplePlayer(read, fixture.base)
    assert.equal(result.state, 'live')
    if (result.state === 'live') assert.equal('classes' in result.location, false)
  }
})

test('changing the local player during a class read rejects the whole frame', () => {
  const fixture = classFixture()
  const read = (address: bigint, size: number) => {
    const bytes = fixture.read(address, size)
    if (address === fixture.profile + 0x2748n) fixture.playerBytes.write('Changedxx', 0xb8)
    return bytes
  }
  assert.equal(samplePlayer(read, fixture.base).state, 'not-in-world')
})
