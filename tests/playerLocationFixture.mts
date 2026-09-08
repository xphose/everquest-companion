import type { MemoryRead } from '../src/main/playerLocation/profile.ts'

// Synthetic bytes at the documented build's offsets, with an independently stated answer.
// No process dumps, game files, account data or other players' information enter the fixture.
export function locationFixture() {
  const base = 0x140000000n
  const player = 0x30000000n
  const world = 0x40000000n
  const zoneEntry = 0x50000000n
  const image = Buffer.alloc(4096)
  image.writeUInt16LE(0x5a4d)
  image.writeUInt32LE(0xf8, 0x3c)
  image.writeUInt32LE(0x4550, 0xf8)
  image.writeUInt16LE(0x8664, 0xfc)
  image.writeUInt32LE(0x6a983aba, 0x100)
  image.writeUInt16LE(240, 0x10c)
  image.writeUInt16LE(0x20b, 0x110)
  image.writeUInt32LE(0x16c6000, 0x148)
  const playerBytes = Buffer.alloc(0x5a0)
  playerBytes.writeFloatLE(1109.5, 0x74)
  playerBytes.writeFloatLE(-963.25, 0x78)
  playerBytes.writeFloatLE(30.9375, 0x7c)
  playerBytes.writeFloatLE(450.375, 0x94)
  playerBytes.write('Wayfinder', 0xb8, 'ascii')
  playerBytes.writeUInt8(10, 0x4bc)
  playerBytes.writeUInt32LE(55, 0x59c)
  const worldBytes = Buffer.alloc(0x30 + 1001 * 8)
  worldBytes.writeBigUInt64LE(zoneEntry, 0x30 + 55 * 8)
  const zoneBytes = Buffer.alloc(0x50)
  zoneBytes.writeUInt32LE(55, 0x0c)
  zoneBytes.write('akanon', 0x10, 'ascii')
  const playerRoot = Buffer.alloc(8)
  playerRoot.writeBigUInt64LE(player)
  const worldRoot = Buffer.alloc(8)
  worldRoot.writeBigUInt64LE(world)
  const segments = [
    { at: base, bytes: image }, { at: player, bytes: playerBytes },
    { at: world, bytes: worldBytes }, { at: zoneEntry, bytes: zoneBytes },
    { at: base + 0xf0c360n, bytes: playerRoot }, { at: base + 0xf0be50n, bytes: worldRoot }
  ]
  const reads: { address: bigint; size: number }[] = []
  const read: MemoryRead = (address, size) => {
    reads.push({ address, size })
    const segment = segments.find(value => address >= value.at && address + BigInt(size) <= value.at + BigInt(value.bytes.length))
    if (!segment) return null
    const offset = Number(address - segment.at)
    return Buffer.from(segment.bytes.subarray(offset, offset + size))
  }
  return { base, player, world, zoneEntry, image, playerBytes, worldBytes, zoneBytes, playerRoot, worldRoot, read, reads }
}
