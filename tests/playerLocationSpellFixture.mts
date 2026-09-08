import { locationFixture } from './playerLocationFixture.mts'

export function spellFixture() {
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
  return { ...location, owner, segments, profile, manager, ownerRoot, spellRoot, maximum, book, gems, mask, read, reads }
}
