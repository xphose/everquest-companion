import { relocatedProfileFixture } from './playerLocationProfileFixture.mts'

/** Synthetic September 14 image with literal verified addresses and misleading old fields. */
export function september14Fixture() {
  const fixture = relocatedProfileFixture('september')
  fixture.image.writeUInt32LE(0x6aa86299, 0x100)
  fixture.image.writeUInt32LE(0x16c8000, 0x148)
  fixture.playerBytes.writeUInt8(19, 0x214)
  fixture.playerBytes.writeUInt8(5, 0x32c)
  fixture.playerBytes.writeUInt32LE(55, 0x204)
  fixture.playerBytes.writeUInt32LE(2, 0x358)
  fixture.playerBytes.fill(0, 0xb8, 0xf8)
  fixture.playerBytes.write('Trailrunner', 0xb8, 'ascii')
  fixture.mask.writeUInt32LE(0x608)
  const relocated = new Map([
    [0xf0e360n, 0xf0d360n], [0xf0de50n, 0xf0ce50n],
    [0xf0e4b0n, 0xf0d4b0n], [0xf94118n, 0xf93118n]
  ])
  const obsolete = new Set([
    ...fixture.oldAddresses,
    ...[...relocated.values()].map(offset => fixture.base + offset),
    fixture.player + 0x32cn, fixture.player + 0x358n,
    fixture.player + 0x4bcn, fixture.player + 0x59cn
  ])
  const requests: { address: bigint; size: number }[] = []
  const read = (address: bigint, size: number): Buffer | null => {
    requests.push({ address, size })
    if (obsolete.has(address)) return null
    const offset = relocated.get(address - fixture.base)
    return fixture.read(offset === undefined ? address : fixture.base + offset, size)
  }
  return { ...fixture, read, requests, obsolete }
}
