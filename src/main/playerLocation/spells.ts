import type { PlayerLocation } from '../../shared/playerLocation'
import { LEGENDS_PROFILE, exactRead, pointerAt, readableAddress, type MemoryRead, type LocationProfile } from './profile'

export type ObservedSpells = Pick<PlayerLocation, 'spellbook' | 'memorizedSpells'>

interface SpellManager {
  pointer: bigint
  maximumId: number
}

export function readSpellManager(read: MemoryRead, base: bigint, P: LocationProfile = LEGENDS_PROFILE): SpellManager | null {
  const pointer = pointerAt(read, base + P.spellManagerRva)
  if (!readableAddress(pointer)) return null
  const maximumId = exactRead(read, pointer + BigInt(P.maximumSpellId), 4).readInt32LE()
  return maximumId >= 1 ? { pointer, maximumId } : null
}

function readEntries(read: MemoryRead, address: bigint, count: number, P: LocationProfile): Buffer {
  const result = Buffer.alloc(count * P.spellEntryBytes)
  for (let offset = 0; offset < result.length; offset += 4096) {
    const length = Math.min(4096, result.length - offset)
    exactRead(read, address + BigInt(offset), length).copy(result, offset)
  }
  return result
}

function decodeEntries(bytes: Buffer, maximumId: number, P: LocationProfile): (number | null)[] | null {
  const result: (number | null)[] = []
  for (let offset = 0; offset < bytes.length; offset += P.spellEntryBytes) {
    const id = bytes.readInt32LE(offset)
    if (id === -1) result.push(null)
    else if (id >= 1 && id <= maximumId) result.push(id)
    else return null
  }
  return result
}

function ownedSpellbook(entries: (number | null)[]): number[] {
  const ids = new Set<number>()
  for (const id of entries) if (id !== null) ids.add(id)
  return [...ids]
}

/**
 * Complete fixed arrays only. Three bounded reads cover the book, one covers the gems, and
 * both raw arrays must agree on a second pass. Metadata is compared but never interpreted.
 * The surrounding active-profile reader validates the selected profile and class mask again.
 */
export function readProfileSpells(read: MemoryRead, base: bigint, profile: bigint, P: LocationProfile = LEGENDS_PROFILE): ObservedSpells {
  try {
    const manager = readSpellManager(read, base, P)
    if (!manager) return {}
    const bookAddress = profile + BigInt(P.spellbook)
    const gemAddress = profile + BigInt(P.memorizedSpells)
    const bookBytes = readEntries(read, bookAddress, P.spellbookSlots, P)
    const gemBytes = readEntries(read, gemAddress, P.memorizedSpellSlots, P)
    const book = decodeEntries(bookBytes, manager.maximumId, P)
    const memorizedSpells = decodeEntries(gemBytes, manager.maximumId, P)
    if (!book || !memorizedSpells) return {}
    const spellbook = ownedSpellbook(book)
    const owned = new Set(spellbook)
    if (memorizedSpells.some(id => id !== null && !owned.has(id))) return {}
    if (!bookBytes.equals(readEntries(read, bookAddress, P.spellbookSlots, P))) return {}
    if (!gemBytes.equals(readEntries(read, gemAddress, P.memorizedSpellSlots, P))) return {}
    const final = readSpellManager(read, base, P)
    if (final?.pointer !== manager.pointer || final.maximumId !== manager.maximumId) return {}
    return { spellbook, memorizedSpells }
  } catch {
    // An unreadable or changing book is unknown, never an empty owned-spell list.
    return {}
  }
}
