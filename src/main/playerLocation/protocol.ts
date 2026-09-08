import type { PlayerLocation, PlayerLocationResult } from '../../shared/playerLocation'
import { isClassAbbr } from '../../shared/classCombo'

export const LOCATION_UNAVAILABLE: PlayerLocationResult = {
  state: 'unavailable', reason: 'The game location is temporarily unavailable. The game may be loading or closing.'
}

export const LOCATION_UNSUPPORTED: PlayerLocationResult = {
  state: 'unsupported', reason: 'Automatic game location requires Windows on a 64-bit PC.'
}

export interface LocationRequest {
  type: 'read'
  id: number
  root: string | null
}

export interface LocationReply {
  id: number
  result: PlayerLocationResult
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object'
}

function validLevel(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 125
}

function validClasses(value: unknown): boolean {
  return Array.isArray(value) && value.length >= 2 && value.length <= 3 &&
    Array.from(value).every(isClassAbbr) && new Set(value).size === value.length
}

function validSpellId(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 0x7fffffff
}

function validSpellbook(value: unknown): boolean {
  return Array.isArray(value) && value.length <= 1120 && Array.from(value).every(validSpellId) &&
    new Set(value).size === value.length
}

function validMemorizedSpells(value: unknown): boolean {
  return Array.isArray(value) && value.length === 18 && Array.from(value).every(id => id === null || validSpellId(id))
}

function validUnlockedSlots(value: unknown): boolean {
  return Array.isArray(value) && value.length <= 18 && Array.from(value).every((slot, index) =>
    typeof slot === 'number' && Number.isInteger(slot) && slot >= 1 && slot <= 18 && (index === 0 || value[index - 1] < slot))
}

function validOptionalObservations(value: Record<string, unknown>): boolean {
  return (!('level' in value) || validLevel(value.level)) &&
    (!('classes' in value) || validClasses(value.classes)) &&
    (!('spellbook' in value) || validSpellbook(value.spellbook)) &&
    (!('memorizedSpells' in value) || validMemorizedSpells(value.memorizedSpells)) &&
    (!('unlockedSpellSlots' in value) || validUnlockedSlots(value.unlockedSpellSlots))
}

function validLocation(value: unknown): value is PlayerLocation {
  if (!record(value)) return false
  return typeof value.characterName === 'string' && typeof value.zone === 'string' &&
    validOptionalObservations(value) &&
    ['ns', 'ew', 'z', 'heading', 'sampledAt'].every(key =>
      typeof value[key] === 'number' && Number.isFinite(value[key]))
}

function validResult(value: unknown): value is PlayerLocationResult {
  if (!record(value)) return false
  if (value.state === 'live') return validLocation(value.location)
  return typeof value.state === 'string' && typeof value.reason === 'string' &&
    ['not-running', 'not-in-world', 'unsupported', 'unavailable', 'ambiguous'].includes(value.state)
}

export function parseLocationReply(value: unknown): LocationReply | null {
  if (!record(value) || typeof value.id !== 'number' || !validResult(value.result)) return null
  return { id: value.id, result: value.result }
}

export function parseLocationRequest(value: unknown): LocationRequest | null {
  if (!record(value) || value.type !== 'read' || !Number.isSafeInteger(value.id)) return null
  if (value.root !== null && (typeof value.root !== 'string' || value.root.length > 32768)) return null
  return { type: 'read', id: Number(value.id), root: value.root }
}
