/** Current effects on the local player, not spellbook ownership or memorized spells. */
export interface PlayerActiveBuff {
  spellId: number
  /** One-based position within its native buff window. */
  slot: number
  kind: 'buff' | 'song'
  /** Native remaining ticks converted to milliseconds, with six-second precision.
   * Omitted for unclassified negative duration sentinels; omission does not mean permanent. */
  remainingMs?: number
}

export const PLAYER_BUFF_SLOTS = 62
export const PLAYER_SONG_SLOTS = 30
export const MAX_BUFF_REMAINING_MS = 0x7fffffff * 6000

function integerBetween(value: unknown, minimum: number, maximum: number): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= minimum && value <= maximum
}

function validBuff(value: unknown): value is PlayerActiveBuff {
  if (!value || typeof value !== 'object') return false
  const buff = value as Record<string, unknown>
  if (Object.keys(buff).some(key => !['spellId', 'slot', 'kind', 'remainingMs'].includes(key))) return false
  if (buff.kind !== 'buff' && buff.kind !== 'song') return false
  const limit = buff.kind === 'buff' ? PLAYER_BUFF_SLOTS : PLAYER_SONG_SLOTS
  if (!integerBetween(buff.slot, 1, limit) || !integerBetween(buff.spellId, 1, 0x7fffffff)) return false
  return !('remainingMs' in buff) || integerBetween(buff.remainingMs, 0, MAX_BUFF_REMAINING_MS)
}

/** Complete observations may be empty; sparse arrays and duplicate native positions are invalid. */
export function isPlayerActiveBuffs(value: unknown): value is PlayerActiveBuff[] {
  if (!Array.isArray(value) || value.length > PLAYER_BUFF_SLOTS + PLAYER_SONG_SLOTS) return false
  const buffs: unknown[] = Array.from(value)
  if (!buffs.every(validBuff)) return false
  return new Set(buffs.map(buff => `${buff.kind}:${buff.slot}`)).size === buffs.length
}
