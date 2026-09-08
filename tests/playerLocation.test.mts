import test from 'node:test'
import assert from 'node:assert/strict'
import { samplePlayer } from '../src/main/playerLocation/sample.ts'
import { matchesMappedImage, exactRead, MemoryReadError, readableAddress } from '../src/main/playerLocation/profile.ts'
import { locationFixture } from './playerLocationFixture.mts'

test('the verified profile reads /loc axes, heading and the zone short name', () => {
  const fixture = locationFixture()
  assert.equal(matchesMappedImage(fixture.read, fixture.base), true)
  assert.deepEqual(samplePlayer(fixture.read, fixture.base, () => 1234), {
    state: 'live', location: { characterName: 'Wayfinder', zone: 'akanon', ns: -963.25,
      ew: 1109.5, z: 30.9375, heading: 450.375, sampledAt: 1234 }
  })
  assert.ok(fixture.reads.every(value => value.size <= 4096))
})

test('mapped PE identity rejects other builds and malformed headers before player reads', () => {
  for (const offset of [0, 0x3c, 0xf8, 0xfc, 0x100, 0x10c, 0x110, 0x148]) {
    const fixture = locationFixture()
    fixture.image.writeUInt32LE(0, offset)
    assert.equal(matchesMappedImage(fixture.read, fixture.base), false, `PE field ${offset}`)
    assert.ok(fixture.reads.every(value => value.address < fixture.base + 4096n))
  }
})

test('character selection and loading return no stale location for null or invalid roots', () => {
  for (const root of ['playerRoot', 'worldRoot'] as const) {
    for (const pointer of [0n, 1n, 0xffff800000000000n]) {
      const fixture = locationFixture()
      fixture[root].writeBigUInt64LE(pointer)
      const result = samplePlayer(fixture.read, fixture.base)
      assert.equal(result.state, 'not-in-world')
      assert.equal('location' in result, false)
    }
  }
})

test('invalid player data, non-player types, names and zone metadata never produce a marker', () => {
  const invalid = [
    (f: ReturnType<typeof locationFixture>) => f.playerBytes.writeFloatLE(NaN, 0x74),
    (f: ReturnType<typeof locationFixture>) => f.playerBytes.writeFloatLE(Infinity, 0x78),
    (f: ReturnType<typeof locationFixture>) => f.playerBytes.writeFloatLE(1_000_001, 0x7c),
    (f: ReturnType<typeof locationFixture>) => f.playerBytes.writeFloatLE(-1, 0x94),
    (f: ReturnType<typeof locationFixture>) => f.playerBytes.writeFloatLE(512, 0x94),
    (f: ReturnType<typeof locationFixture>) => f.playerBytes.writeUInt8(1, 0x139),
    (f: ReturnType<typeof locationFixture>) => f.playerBytes.fill(65, 0xb8, 0xf8),
    (f: ReturnType<typeof locationFixture>) => f.playerBytes.writeUInt8(0, 0xb8),
    (f: ReturnType<typeof locationFixture>) => f.playerBytes.writeUInt8(255, 0xb8),
    (f: ReturnType<typeof locationFixture>) => f.playerBytes.writeUInt32LE(1001, 0x59c),
    (f: ReturnType<typeof locationFixture>) => f.playerBytes.writeUInt32LE(0, 0x59c),
    (f: ReturnType<typeof locationFixture>) => f.zoneBytes.writeUInt32LE(54, 0x0c),
    (f: ReturnType<typeof locationFixture>) => f.zoneBytes.write('../map', 0x10),
    (f: ReturnType<typeof locationFixture>) => f.zoneBytes.fill(65, 0x10)
  ]
  for (const corrupt of invalid) {
    const fixture = locationFixture()
    corrupt(fixture)
    assert.equal(samplePlayer(fixture.read, fixture.base).state, 'not-in-world')
  }
})

test('zone flags are masked while the resolved entry still has to match the zone ID', () => {
  const fixture = locationFixture()
  fixture.playerBytes.writeUInt32LE(0x8000 + 55, 0x59c)
  assert.equal(samplePlayer(fixture.read, fixture.base).state, 'live')
})

test('changing player, world, zone, entry or character during sampling rejects the frame', () => {
  const changes = [
    (f: ReturnType<typeof locationFixture>) => f.playerRoot.writeBigUInt64LE(0n),
    (f: ReturnType<typeof locationFixture>) => f.worldRoot.writeBigUInt64LE(0n),
    (f: ReturnType<typeof locationFixture>) => f.playerBytes.writeUInt32LE(56, 0x59c),
    (f: ReturnType<typeof locationFixture>) => f.worldBytes.writeBigUInt64LE(0n, 0x30 + 55 * 8),
    (f: ReturnType<typeof locationFixture>) => f.playerBytes.write('Changedxx', 0xb8),
    (f: ReturnType<typeof locationFixture>) => f.playerBytes.writeUInt8(1, 0x139)
  ]
  for (const change of changes) {
    const fixture = locationFixture()
    const read = (address: bigint, size: number) => {
      const bytes = fixture.read(address, size)
      if (address === fixture.zoneEntry + 0xcn) change(fixture)
      return bytes
    }
    assert.equal(samplePlayer(read, fixture.base).state, 'not-in-world')
  }
})

test('movement during a sample is allowed; a new read observes the new position', () => {
  const fixture = locationFixture()
  const read = (address: bigint, size: number) => {
    const bytes = fixture.read(address, size)
    if (address === fixture.zoneEntry + 0xcn) fixture.playerBytes.writeFloatLE(-970, 0x78)
    return bytes
  }
  const first = samplePlayer(read, fixture.base)
  const next = samplePlayer(read, fixture.base)
  assert.equal(first.state, 'live')
  assert.equal(next.state, 'live')
  if (first.state === 'live' && next.state === 'live') {
    assert.equal(first.location.ns, -963.25)
    assert.equal(next.location.ns, -970)
  }
})

test('partial reads, impossible pointers and overlarge lengths are never interpreted', () => {
  assert.throws(() => exactRead(() => Buffer.alloc(3), 0x10000n, 4), MemoryReadError)
  assert.throws(() => exactRead(() => null, 0x10000n, 4), MemoryReadError)
  for (const address of [0n, -1n, 0x800000000000n]) assert.equal(readableAddress(address), false)
  for (const length of [0, -1, 0.5, 4097, Infinity, NaN]) assert.equal(readableAddress(0x10000n, length), false)
  assert.equal(readableAddress(0x7fffffffffffn, 2), false)
})
