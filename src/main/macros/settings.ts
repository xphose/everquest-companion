import { createHash } from 'node:crypto'
import type { MacroAssistantSettings, MacroAssistantMutation } from '../../shared/macroAssistant'
import { isMacroSelection, isMacroStyle, macroSelectionKey } from '../../shared/macros'
import type { MacroSaved, MacroWorld } from './types'

export function defaultMacroSettings(): MacroAssistantSettings {
  return { autoUpdate: false, style: 'solo', selections: [], destination: { bar: 4, page: 1 } }
}
export function emptyMacroSaved(): MacroSaved { return { settings: defaultMacroSettings(), managed: {} } }
export function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}
function slot(value: unknown): value is number { return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 10 }
export function settingsPatch(raw: unknown): Partial<MacroAssistantSettings> | null {
  const value = object(raw)
  if (!value || Object.keys(value).some((key) => !['autoUpdate', 'style', 'selections', 'destination', 'targetFile'].includes(key))) return null
  if (!simpleSettings(value)) return null
  if ('selections' in value && !validSelections(value.selections)) return null
  if ('destination' in value && !validDestination(value.destination)) return null
  return value
}
function simpleSettings(value: Record<string, unknown>): boolean {
  if ('autoUpdate' in value && typeof value.autoUpdate !== 'boolean') return false
  if ('style' in value && !isMacroStyle(value.style)) return false
  return !('targetFile' in value) || typeof value.targetFile === 'string' && /^[a-z0-9_-]{1,150}\.ini$/i.test(value.targetFile)
}
function validSelections(value: unknown): boolean {
  if (!Array.isArray(value) || value.length > 12 || !value.every(isMacroSelection)) return false
  return new Set(value.map(macroSelectionKey)).size === value.length
}
function validDestination(value: unknown): boolean {
  const dest = object(value)
  return Boolean(dest && Object.keys(dest).length === 2 && slot(dest.bar) && slot(dest.page))
}
export function macroMutation(raw: unknown): MacroAssistantMutation | null {
  const value = object(raw)
  if (!value || typeof value.characterId !== 'string' || value.characterId.length > 200) return null
  if (value.action === 'queue' || value.action === 'restore') return value as unknown as MacroAssistantMutation
  if (value.action !== 'configure') return null
  const settings = settingsPatch(value.settings)
  return settings ? { characterId: value.characterId, action: 'configure', settings } : null
}
export function worldKey(world: MacroWorld): string {
  return createHash('sha256').update(JSON.stringify([world.root?.toLowerCase(), world.characterId])).digest('hex')
}
export function assertMacroWorld(expected: MacroWorld, current: MacroWorld): void {
  if (expected.root !== current.root || expected.token !== current.token || expected.characterId !== current.characterId ||
    expected.character?.logPath !== current.character?.logPath) throw new Error('The active character or game folder changed. Refresh Macros.')
}
