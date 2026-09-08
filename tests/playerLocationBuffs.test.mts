import test from 'node:test'
import assert from 'node:assert/strict'
import { readProfileBuffs } from '../src/main/playerLocation/buffs.ts'
import { samplePlayer } from '../src/main/playerLocation/sample.ts'
import { buffFixture } from './playerLocationBuffFixture.mts'

test('active self buffs are independent of book/gems and preserve both window boundaries', () => {
  const f = buffFixture()
  f.set(0, 74089, 3561)
  f.set(61, 201, 0)
  f.set(62, 202, 3)
  f.set(91, 203, 5)
  f.set(92, 999999, 400) // Final native record is outside both player buff windows.
  const result = samplePlayer(f.read, f.base)
  assert.equal(result.state, 'live')
  if (result.state !== 'live') return
  assert.deepEqual(result.location.activeBuffs, [
    { spellId: 74089, slot: 1, kind: 'buff', remainingMs: 21_366_000 },
    { spellId: 201, slot: 62, kind: 'buff', remainingMs: 0 },
    { spellId: 202, slot: 1, kind: 'song', remainingMs: 18_000 },
    { spellId: 203, slot: 30, kind: 'song', remainingMs: 30_000 }
  ])
  assert.equal(result.location.spellbook?.includes(74089), false)
})

test('verified empty table is authoritative while a missing or partial read is unknown', () => {
  const f = buffFixture()
  f.bytes.writeInt32LE(-4, 0x78) // An empty slot does not become active because of leftover timing.
  assert.deepEqual(readProfileBuffs(f.read, f.base, f.profile), { activeBuffs: [] })
  for (const broken of [f.profile + 0xa0n, f.effects, f.effects + 4096n, f.effects + 12288n]) {
    for (const partial of [false, true]) {
      const read = (at: bigint, size: number) => at === broken ? (partial ? Buffer.alloc(size - 1) : null) : f.read(at, size)
      const result = samplePlayer(read, f.base)
      assert.equal(result.state, 'live')
      if (result.state === 'live') {
        assert.equal('activeBuffs' in result.location, false)
        assert.deepEqual(result.location.classes, ['SHM', 'MAG', 'ENC'])
        assert.ok(result.location.spellbook?.length)
      }
    }
  }
})

test('timer decrements and zero retain identity; negative sentinels never invent permanence', () => {
  const f = buffFixture()
  for (const ticks of [12, 11, 0, -1, -2, -4, -2147483648, 2147483647]) {
    f.set(4, 301, ticks)
    assert.deepEqual(readProfileBuffs(f.read, f.base, f.profile), {
      activeBuffs: [{ spellId: 301, slot: 5, kind: 'buff', ...(ticks >= 0 ? { remainingMs: ticks * 6000 } : {}) }]
    })
  }
  f.set(4, 0)
  assert.deepEqual(readProfileBuffs(f.read, f.base, f.profile), { activeBuffs: [] })
})

test('unsupported container shapes, pointers and active IDs omit the complete observation', () => {
  const invalid = [
    (f: ReturnType<typeof buffFixture>) => f.header.writeInt32LE(0, 8),
    (f: ReturnType<typeof buffFixture>) => f.header.writeInt32LE(92, 8),
    (f: ReturnType<typeof buffFixture>) => f.header.writeInt32LE(94, 8),
    (f: ReturnType<typeof buffFixture>) => f.header.writeInt32LE(0x7fffffff, 12),
    (f: ReturnType<typeof buffFixture>) => f.header.writeInt32LE(92, 12),
    (f: ReturnType<typeof buffFixture>) => f.header.writeBigUInt64LE(0n),
    (f: ReturnType<typeof buffFixture>) => f.header.writeBigUInt64LE(0x800000000000n),
    (f: ReturnType<typeof buffFixture>) => f.set(91, -1),
    (f: ReturnType<typeof buffFixture>) => f.set(91, 100001),
    (f: ReturnType<typeof buffFixture>) => f.spellRoot.writeBigUInt64LE(0n),
    (f: ReturnType<typeof buffFixture>) => f.maximum.writeInt32LE(0)
  ]
  for (const change of invalid) {
    const f = buffFixture()
    f.set(0, 74089)
    change(f)
    assert.deepEqual(readProfileBuffs(f.read, f.base, f.profile), {})
  }
})

test('fade, timer, allocation and spell-manager races cannot publish mixed or stale buffs', () => {
  const changes = [
    (f: ReturnType<typeof buffFixture>) => f.set(0, 0),
    (f: ReturnType<typeof buffFixture>) => f.set(0, 302),
    (f: ReturnType<typeof buffFixture>) => f.set(0, 301, 11),
    (f: ReturnType<typeof buffFixture>) => f.header.writeBigUInt64LE(0x66000000n),
    (f: ReturnType<typeof buffFixture>) => f.header.writeInt32LE(92, 8),
    (f: ReturnType<typeof buffFixture>) => f.maximum.writeInt32LE(99999),
    (f: ReturnType<typeof buffFixture>) => f.spellRoot.writeBigUInt64LE(0n)
  ]
  for (const change of changes) {
    const f = buffFixture()
    f.set(0, 301)
    const read = (at: bigint, size: number) => {
      const bytes = f.read(at, size)
      if (at === f.effects + 12288n) change(f)
      return bytes
    }
    assert.deepEqual(readProfileBuffs(read, f.base, f.profile), {})
  }
})

test('owner, class and selected profile changes omit buffs while map can remain valid', () => {
  const changes = [
    (f: ReturnType<typeof buffFixture>) => f.ownerRoot.writeBigUInt64LE(0n),
    (f: ReturnType<typeof buffFixture>) => f.mask.writeUInt32LE(0x2400),
    (f: ReturnType<typeof buffFixture>) => f.segments.find(s => s.at === 0x62000000n)!.bytes.writeBigUInt64LE(0x67000000n, 8)
  ]
  for (const change of changes) {
    const f = buffFixture()
    f.set(0, 301)
    const read = (at: bigint, size: number) => {
      const bytes = f.read(at, size)
      if (at === f.effects + 12288n) change(f)
      return bytes
    }
    const result = samplePlayer(read, f.base)
    assert.equal(result.state, 'live')
    if (result.state === 'live') assert.equal('activeBuffs' in result.location, false)
  }
})

test('buff observation including coherence checks has a fixed read and byte budget', () => {
  const f = buffFixture()
  assert.deepEqual(readProfileBuffs(f.read, f.base, f.profile), { activeBuffs: [] })
  assert.equal(f.reads.length, 14)
  assert.equal(f.reads.reduce((sum, read) => sum + read.size, 0), 29_496)
  assert.ok(f.reads.every(read => read.size <= 4096))
  const arrayReads = f.reads.filter(read => read.address >= f.effects && read.address < f.effects + BigInt(f.bytes.length))
  assert.deepEqual(arrayReads.map(read => read.size), [4096, 4096, 4096, 2432, 4096, 4096, 4096, 2432])
  assert.ok(arrayReads.every(read => read.address + BigInt(read.size) <= f.effects + 92n * 160n))
})
