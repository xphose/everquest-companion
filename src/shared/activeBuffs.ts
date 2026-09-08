import type { PlayerLocation } from './playerLocation'
import { isPlayerActiveBuffs, PLAYER_BUFF_SLOTS, PLAYER_SONG_SLOTS, type PlayerActiveBuff } from './playerBuffs'
import { currentPlayerLocation } from './currentPlayer'
import { buffAllowAllowed, type BuffAllowPrefs } from './buffAllow'
import { timerNameKey, type BuffTimerRow } from './buffTimers'

export type ActiveBuffNames = Record<number, string>
export interface ActiveBuffNameRequest { characterName: string; spellIds: number[] }
export interface ActiveBuffObservation { characterName: string; sampledAt: number; effects: PlayerActiveBuff[] }
export interface ActiveEffectRow { id: string; spellId: number; name: string; kind: 'buff' | 'song'; time: string }

function spellId(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 0x7fffffff
}

export function activeBuffNameRequest(raw: unknown): ActiveBuffNameRequest | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Record<string, unknown>
  if (Object.keys(value).some((key) => !['characterName', 'spellIds'].includes(key))) return null
  if (typeof value.characterName !== 'string' || !/^[A-Za-z]{2,64}$/.test(value.characterName)) return null
  if (!Array.isArray(value.spellIds)) return null
  const ids: unknown[] = Array.from(value.spellIds)
  if (ids.length > PLAYER_BUFF_SLOTS + PLAYER_SONG_SLOTS || !ids.every(spellId)) return null
  return { characterName: value.characterName, spellIds: [...new Set(ids)].sort((a, b) => a - b) }
}

/** Only a fresh, complete observation can supersede log-derived self rows. */
export function observedActiveBuffs(player: PlayerLocation | null, name: string | undefined, now: number): ActiveBuffObservation | null {
  const location = currentPlayerLocation(player ? { state: 'live', location: player } : undefined, name, now)
  if (!name || !location || !isPlayerActiveBuffs(location.activeBuffs)) return null
  return { characterName: location.characterName, sampledAt: location.sampledAt, effects: location.activeBuffs }
}

export function activeBuffIds(observation: ActiveBuffObservation | null): number[] {
  return [...new Set(observation?.effects.map((effect) => effect.spellId) ?? [])].sort((a, b) => a - b)
}

/** Native duration has six-second precision and no verified initial duration or permanence. */
export function activeEffectTime(effect: PlayerActiveBuff, sampledAt: number, now: number): string {
  if (effect.remainingMs === undefined) return 'Active'
  const remaining = Math.max(0, effect.remainingMs - Math.max(0, now - sampledAt))
  const seconds = Math.ceil(remaining / 6000) * 6
  if (seconds < 60) return `~${seconds}s`
  const minutes = Math.ceil(seconds / 60)
  return minutes < 60 ? `~${minutes}m` : `~${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ''}`
}

export function activeEffectRows(observation: ActiveBuffObservation | null, names: ActiveBuffNames, allow: BuffAllowPrefs, now: number): ActiveEffectRow[] {
  if (!observation) return []
  return observation.effects.filter((effect) => !names[effect.spellId] || buffAllowAllowed(allow, timerNameKey(names[effect.spellId])))
    .map((effect) => ({ id: `${effect.kind}:${effect.slot}:${effect.spellId}`, spellId: effect.spellId,
      name: names[effect.spellId] ?? `Spell ${effect.spellId}`, kind: effect.kind,
      time: activeEffectTime(effect, observation.sampledAt, now) }))
}

export function withoutSupersededSelfRows(rows: BuffTimerRow[], live: boolean): BuffTimerRow[] {
  return live ? rows.filter((row) => row.group !== 'self') : rows
}
