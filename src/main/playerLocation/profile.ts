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
  ew: 0x74,
  ns: 0x78,
  z: 0x7c,
  heading: 0x94,
  name: 0xb8,
  type: 0x139,
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
