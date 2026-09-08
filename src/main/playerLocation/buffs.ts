import type { PlayerLocation } from '../../shared/playerLocation'
import { PLAYER_BUFF_SLOTS, PLAYER_SONG_SLOTS, type PlayerActiveBuff } from '../../shared/playerBuffs'
import { LEGENDS_PROFILE as P, exactRead, readableAddress, type MemoryRead } from './profile'
import { readSpellManager } from './spells'

const OBSERVED_SLOTS = PLAYER_BUFF_SLOTS + PLAYER_SONG_SLOTS

function readEffects(read: MemoryRead, address: bigint): Buffer {
  const result = Buffer.alloc(OBSERVED_SLOTS * P.effectBytes)
  for (let offset = 0; offset < result.length; offset += 4096) {
    const length = Math.min(4096, result.length - offset)
    exactRead(read, address + BigInt(offset), length).copy(result, offset)
  }
  return result
}

function decodeBuffs(bytes: Buffer, maximumId: number): PlayerActiveBuff[] | null {
  const buffs: PlayerActiveBuff[] = []
  for (let index = 0; index < OBSERVED_SLOTS; index++) {
    const offset = index * P.effectBytes
    const spellId = bytes.readInt32LE(offset + P.effectSpellId)
    if (spellId === 0) continue // Native effect constructor/clear writes zero, independently of duration.
    if (spellId < 1 || spellId > maximumId) return null
    const ticks = bytes.readInt32LE(offset + P.effectRemainingTicks)
    const kind = index < PLAYER_BUFF_SLOTS ? 'buff' : 'song'
    const slot = kind === 'buff' ? index + 1 : index - PLAYER_BUFF_SLOTS + 1
    buffs.push({ spellId, slot, kind, ...(ticks >= 0 ? { remainingMs: ticks * 6000 } : {}) })
  }
  return buffs
}

/**
 * Only the supported current player's 62 long and 30 short effects, excluding the final record.
 * Two complete raw passes, stable header and spell manager reject loading/fade/reallocation races.
 * The surrounding reader rechecks active owner/profile/class and player identity after this read.
 * At most 14 reads / 29,496 bytes, each <=4096 bytes. No timer is inferred for negative sentinels.
 */
export function readProfileBuffs(read: MemoryRead, base: bigint, profile: bigint): Pick<PlayerLocation, 'activeBuffs'> {
  try {
    const manager = readSpellManager(read, base)
    if (!manager) return {}
    const headerAddress = profile + BigInt(P.effectsHeader)
    const header = exactRead(read, headerAddress, 16)
    const address = header.readBigUInt64LE()
    // A different table shape is unknown, never a truncation reported as an authoritative list.
    if (!readableAddress(address) || header.readInt32LE(8) !== P.effectsCount || header.readInt32LE(12) !== P.effectsCount) return {}
    const bytes = readEffects(read, address)
    const activeBuffs = decodeBuffs(bytes, manager.maximumId)
    if (!activeBuffs || !bytes.equals(readEffects(read, address))) return {}
    if (!header.equals(exactRead(read, headerAddress, 16))) return {}
    const final = readSpellManager(read, base)
    if (final?.pointer !== manager.pointer || final.maximumId !== manager.maximumId) return {}
    return { activeBuffs }
  } catch {
    // A partial read must not clear previously displayed effects as if a complete empty table arrived.
    return {}
  }
}
