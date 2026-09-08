// An independently implemented reader of documented binary facts, never a signature scanner.
// Profile provenance: https://github.com/ChrisTitusTech/plazmic-legends/blob/main/docs/research/legends-2026-09-02-profile.md
// Verified against the installed executable and one live local-player sample on 2026-09-08.
// An updated game must acquire a separately verified profile before any player offsets are used.
export const LEGENDS_PROFILE = {
  sha256: 'f1c6ab2f07a5d08e62bb936061fd01049fa7b64ce8ddac50c57009162088a9f9',
  fileSize: 15_528_056,
  machine: 0x8664,
  timestamp: 0x6a983aba,
  imageSize: 0x16c6000,
  optionalMagic: 0x20b,
  playerRva: 0xf0c360n,
  worldRva: 0xf0be50n,
  // Current-profile class mask: verified active spell eligibility path, then two live reads.
  // The descriptor and its displacement identify this build's local character owner layout.
  characterRva: 0xf0c4b0n,
  characterDescriptorRva: 0x9a8968n,
  characterDescriptor: 0x08,
  descriptorDisplacement: 0x04,
  profileManagerBias: 0x10,
  profileManagerDisplacement: 0x2f68,
  profileCurrentType: 0x08,
  profileListType: 0x00,
  profileListFirst: 0x08,
  profileListNext: 0x18,
  classMask: 0x2748,
  // Verified spellbook export, profile serializer and gem assignment paths for this build.
  spellbook: 0xb0,
  spellbookSlots: 0x460,
  memorizedSpells: 0x23b0,
  memorizedSpellSlots: 0x12,
  spellEntryBytes: 8,
  spellManagerRva: 0xf92118n,
  maximumSpellId: 0x64,
  // Native current-profile effects and both player buff windows; see docs/research/native-player-buffs.md.
  effectsHeader: 0xa0,
  effectsCount: 93,
  effectBytes: 0xa0,
  effectSpellId: 0x6c,
  effectRemainingTicks: 0x78,
  // Actual gem entitlement: the same effect-cache check gates UI visibility and memorization.
  characterZone: 0x2810,
  characterZoneDescriptorRva: 0x9a8970n,
  characterZoneDisplacement: 0x758,
  profileSpecial: 0x27fc,
  effectCache: 0x1a0,
  effectCacheReady: 0x08,
  itemEffectCacheReady: 0x38,
  itemEffectTable: 0x30,
  additionalSpellSlotsEffect: 326,
  baseSpellSlots: 8,
  // Verified against the in-game Ak'Anon map: native X is /loc NS, native Y is /loc EW.
  // The map's axis swap and negation are applied later by mapFromLoc, once.
  ns: 0x74,
  ew: 0x78,
  z: 0x7c,
  heading: 0x94,
  name: 0xb8,
  type: 0x139,
  // Verified against the current player's in-game level on this exact client build.
  level: 0x4bc,
  zoneId: 0x59c,
  zoneTable: 0x30,
  zoneEntryId: 0x0c,
  zoneShortName: 0x10
} as const

export type LocationProfile = typeof LEGENDS_PROFILE

/** The only remote-memory primitive. A partial read is always failure. */
export type MemoryRead = (address: bigint, size: number) => Buffer | null

export function readableAddress(address: bigint, size = 1): boolean {
  return Number.isInteger(size) && size > 0 && size <= 4096 &&
    address >= 0x10000n && address + BigInt(size) <= 0x800000000000n
}

export class MemoryReadError extends Error {
  constructor() {
    super('The game location could not be read. It may be loading or closing.')
  }
}

export function exactRead(read: MemoryRead, address: bigint, size: number): Buffer {
  if (!readableAddress(address, size)) throw new MemoryReadError()
  const value = read(address, size)
  if (value?.length !== size) throw new MemoryReadError()
  return value
}

export function pointerAt(read: MemoryRead, address: bigint): bigint {
  return exactRead(read, address, 8).readBigUInt64LE()
}

/** Check the loaded image too: an old running process can outlive a patched disk image. */
export function matchesMappedImage(read: MemoryRead, base: bigint): boolean {
  const dos = exactRead(read, base, 64)
  if (dos.readUInt16LE() !== 0x5a4d) return false
  const offset = dos.readUInt32LE(0x3c)
  if (offset < 64 || offset > 4096 - 88) return false
  const pe = exactRead(read, base + BigInt(offset), 88)
  return pe.readUInt32LE() === 0x4550 &&
    pe.readUInt16LE(4) === LEGENDS_PROFILE.machine &&
    pe.readUInt32LE(8) === LEGENDS_PROFILE.timestamp &&
    pe.readUInt16LE(20) >= 64 &&
    pe.readUInt16LE(24) === LEGENDS_PROFILE.optionalMagic &&
    pe.readUInt32LE(80) === LEGENDS_PROFILE.imageSize
}
