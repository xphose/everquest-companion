import { spellFixture } from './playerLocationSpellFixture.mts'

interface Effect { effect?: number; subtype?: number; first?: bigint; second?: bigint }

/** Independent literal offsets from the checked client's entitlement function and hash lookup. */
export function entitlementFixture() {
  const fixture = spellFixture()
  const zone = fixture.owner + 0x2810n
  const cache = Buffer.alloc(0x39)
  cache[8] = 1
  cache[0x38] = 1
  const special = Buffer.alloc(4)
  const descriptor = Buffer.alloc(8)
  descriptor.writeInt32LE(0x758, 4)
  const zoneDescriptor = Buffer.alloc(8)
  zoneDescriptor.writeBigUInt64LE(fixture.base + 0x9a8970n)
  const zonePlayer = Buffer.alloc(8)
  zonePlayer.writeBigUInt64LE(fixture.player)
  fixture.segments.push(
    { at: zone + 8n, bytes: zoneDescriptor }, { at: zone + 16n, bytes: zonePlayer },
    { at: fixture.base + 0x9a8970n, bytes: descriptor },
    { at: fixture.profile + 0x27fcn, bytes: special }, { at: zone + 0x1a0n, bytes: cache }
  )
  function table(item: boolean, entries: Effect[]) {
    const at = item ? 0x68000000n : 0x69000000n
    const header = Buffer.alloc(12)
    const buckets = Buffer.alloc(67 * 8)
    const bucket = (326 % 67) * 8
    header.writeBigUInt64LE(at + 0x100n)
    header.writeUInt32LE(67, 8)
    buckets.writeBigUInt64LE(entries.length ? at + 0x1000n : 0n, bucket)
    cache.writeBigUInt64LE(at, item ? 0x30 : 0)
    fixture.segments.push({ at, bytes: header }, { at: at + 0x100n, bytes: buckets })
    const nodes = entries.map((entry, index) => {
      const bytes = Buffer.alloc(item ? 32 : 48)
      bytes.writeUInt32LE(entry.effect ?? 326)
      bytes.writeUInt32LE(entry.subtype ?? 0, 8)
      bytes.writeBigInt64LE(entry.first ?? 0n, 16)
      if (!item) bytes.writeBigInt64LE(entry.second ?? 0n, 24)
      bytes.writeBigUInt64LE(index + 1 < entries.length ? at + 0x1000n + BigInt((index + 1) * 64) : 0n, item ? 24 : 40)
      fixture.segments.push({ at: at + 0x1000n + BigInt(index * 64), bytes })
      return bytes
    })
    return { at, header, buckets, bucket, nodes }
  }
  return { ...fixture, zone, cache, special, descriptor, zoneDescriptor, zonePlayer, table }
}
