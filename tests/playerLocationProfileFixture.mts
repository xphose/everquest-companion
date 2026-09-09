import { entitlementFixture } from './playerLocationEntitlementFixture.mts'

/** A deliberately relocated synthetic image. No production profile constructs its addresses. */
export function relocatedProfileFixture(build: 'synthetic' | 'september' = 'synthetic') {
  const fixture = entitlementFixture()
  const september = build === 'september'
  fixture.image.writeUInt32LE(september ? 0x6a9f67b3 : 0x12345678, 0x100)
  fixture.image.writeUInt32LE(september ? 0x16c7000 : 0x1700000, 0x148)
  if (september) {
    fixture.playerBytes.writeUInt8(37, 0x32c)
    fixture.playerBytes.writeUInt8(8, 0x4bc)
    fixture.playerBytes.writeUInt32LE(55, 0x358)
    fixture.playerBytes.writeUInt32LE(2, 0x59c)
    fixture.playerBytes.write('Mapwalker', 0xb8, 'ascii')
    fixture.playerBytes.writeFloatLE(217.75, 0x74)
    fixture.playerBytes.writeFloatLE(-681.5, 0x78)
    fixture.playerBytes.writeFloatLE(93.25, 0x7c)
    fixture.playerBytes.writeFloatLE(87.25, 0x94)
    fixture.mask.writeUInt32LE(0x1044)
    for (const [index, id] of [[0, 46], [4, 57], [512, 68], [1119, 79]]) fixture.book.writeInt32LE(id, index * 8)
    for (const [index, id] of [[0, 57], [3, 46], [17, 79]]) fixture.gems.writeInt32LE(id, index * 8)
  }
  fixture.table(true, [{ first: september ? 1n : 2n }])
  fixture.table(false, [{ first: 1n, second: september ? 0n : 1n }])
  const effects = 0x65000000n
  const header = Buffer.alloc(16)
  header.writeBigUInt64LE(effects)
  header.writeInt32LE(93, 8)
  header.writeInt32LE(93, 12)
  const buffs = Buffer.alloc(93 * 160)
  buffs.writeInt32LE(september ? 700 : 94, 0x6c)
  buffs.writeInt32LE(september ? 5 : 7, 0x78)
  fixture.segments.push({ at: fixture.profile + 0xa0n, bytes: header }, { at: effects, bytes: buffs })
  const relocated = new Map(september ? [
    [0xf0d360n, 0xf0c360n], [0xf0ce50n, 0xf0be50n], [0xf0d4b0n, 0xf0c4b0n],
    [0xf93118n, 0xf92118n], [0x9a996cn, 0x9a896cn], [0x9a9974n, 0x9a8974n]
  ] : [
    [0x101010n, 0xf0c360n], [0x202020n, 0xf0be50n], [0x303030n, 0xf0c4b0n],
    [0x404040n, 0xf92118n], [0x505054n, 0x9a896cn], [0x606064n, 0x9a8974n]
  ])
  const oldAddresses = new Set([...relocated.values()].map(offset => fixture.base + offset))
  const requests: { address: bigint; size: number }[] = []
  const read = (address: bigint, size: number): Buffer | null => {
    requests.push({ address, size })
    if (oldAddresses.has(address)) return null
    const offset = relocated.get(address - fixture.base)
    const bytes = fixture.read(offset === undefined ? address : fixture.base + offset, size)
    if (!bytes) return null
    if (address === fixture.owner + 8n) bytes.writeBigUInt64LE(fixture.base + (september ? 0x9a9968n : 0x505050n))
    if (address === fixture.zone + 8n) bytes.writeBigUInt64LE(fixture.base + (september ? 0x9a9970n : 0x606060n))
    return bytes
  }
  return { ...fixture, read, requests, oldAddresses }
}
