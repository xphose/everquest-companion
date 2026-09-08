import { spellFixture } from './playerLocationSpellFixture.mts'

/** Independent literal offsets from the client, never generated from the production profile. */
export function buffFixture() {
  const fixture = spellFixture()
  const effects = 0x65000000n
  const header = Buffer.alloc(16)
  header.writeBigUInt64LE(effects)
  header.writeInt32LE(93, 8)
  header.writeInt32LE(93, 12)
  const bytes = Buffer.alloc(93 * 160)
  const set = (index: number, spellId: number, remainingTicks = 12) => {
    bytes.writeInt32LE(spellId, index * 160 + 0x6c)
    bytes.writeInt32LE(remainingTicks, index * 160 + 0x78)
  }
  fixture.maximum.writeInt32LE(100_000)
  fixture.segments.push({ at: fixture.profile + 0xa0n, bytes: header }, { at: effects, bytes })
  return { ...fixture, effects, header, bytes, set }
}
