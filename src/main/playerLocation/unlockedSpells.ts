import { LEGENDS_PROFILE, exactRead, MemoryReadError, pointerAt, readableAddress, type MemoryRead, type LocationProfile, type ProfileAddress } from './profile'

const MAX_BUCKETS = 4096
const MAX_BUCKET_NODES = 32
interface EntitlementObservation { slots: number[]; unchanged(): boolean }

/** Remember only the self-player cache data actually read. Its raw bytes must still agree
 * after the surrounding spellbook/profile sample, even if the active profile did not change. */
function watchedReader(read: MemoryRead): { read: MemoryRead; unchanged: () => boolean } {
  const observed: { at: bigint; bytes: Buffer }[] = []
  return {
    read: (at, size) => {
      const bytes = exactRead(read, at, size)
      observed.push({ at, bytes: Buffer.from(bytes) })
      return bytes
    },
    unchanged: () => {
      try { return observed.every(({ at, bytes }) => bytes.equals(exactRead(read, at, bytes.length))) } catch { return false }
    }
  }
}

function effectTable(read: MemoryRead, table: bigint, item: boolean, P: LocationProfile): bigint[] {
  // The client's lookup explicitly returns zero for a null table or an absent effect key.
  if (table === 0n) return [0n, 0n]
  const layout = item ? { size: 32, next: 24 } : { size: 48, next: 40 }
  const header = exactRead(read, table, 12)
  const count = header.readUInt32LE(8)
  const buckets = header.readBigUInt64LE()
  if (count < 1 || count > MAX_BUCKETS || !readableAddress(buckets)) throw new MemoryReadError()
  const bucket = P.additionalSpellSlotsEffect % count
  let node = pointerAt(read, buckets + BigInt(bucket * 8))
  const visited = new Set<bigint>()
  while (node !== 0n) {
    if (visited.size >= MAX_BUCKET_NODES || visited.has(node)) throw new MemoryReadError()
    visited.add(node)
    const bytes = exactRead(read, node, layout.size)
    if (bytes.readUInt32LE() === P.additionalSpellSlotsEffect && bytes.readUInt32LE(8) === 0) {
      // Native lookup stops at the first exact compound key; no other bucket is visited.
      return [bytes.readBigInt64LE(16), item ? 0n : bytes.readBigInt64LE(24)]
    }
    node = bytes.readBigUInt64LE(layout.next)
  }
  return [0n, 0n]
}

function entitledSlots(read: MemoryRead, base: bigint, owner: bigint, selected: ProfileAddress): number[] | undefined {
  const { address: profile, layout: P } = selected
  const zone = owner + BigInt(P.characterZone)
  const descriptor = pointerAt(read, zone + 8n)
  if (descriptor !== base + P.characterZoneDescriptorRva) return undefined
  const displacement = exactRead(read, descriptor + 4n, 4).readInt32LE()
  if (displacement !== P.characterZoneDisplacement) return undefined
  const player = pointerAt(read, base + P.playerRva)
  if (!readableAddress(player) || pointerAt(read, zone + 16n) !== player) return undefined
  // The client has permissive fallback branches for missing/special profiles; those are not
  // evidence of ordinary local-player entitlement and therefore remain unknown here.
  if (exactRead(read, profile + BigInt(P.profileSpecial), 4).readUInt32LE() !== 0) return undefined
  const cache = zone + BigInt(P.effectCache)
  if (exactRead(read, cache + BigInt(P.effectCacheReady), 1)[0] !== 1 ||
    exactRead(read, cache + BigInt(P.itemEffectCacheReady), 1)[0] !== 1) return undefined
  const item = effectTable(read, pointerAt(read, cache + BigInt(P.itemEffectTable)), true, P)
  const other = effectTable(read, pointerAt(read, cache), false, P)
  const additional = [...item, ...other].reduce((sum, value) => sum + value, 0n)
  if (additional < 0n || additional > BigInt(P.memorizedSpellSlots - P.baseSpellSlots)) return undefined
  return Array.from({ length: P.baseSpellSlots + Number(additional) }, (_, index) => index + 1)
}

export function observeUnlockedSpellSlots(read: MemoryRead, base: bigint, owner: bigint, profile: bigint | ProfileAddress): EntitlementObservation | undefined {
  try {
    const watched = watchedReader(read)
    const selected = typeof profile === 'bigint' ? { address: profile, layout: LEGENDS_PROFILE } : profile
    const slots = entitledSlots(watched.read, base, owner, selected)
    return slots ? { slots, unchanged: watched.unchanged } : undefined
  } catch {
    return undefined
  }
}
