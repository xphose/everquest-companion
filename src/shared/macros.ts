import type { ClassAbbr } from './classCombo'

/** Rows from the player's own client table. Ownership is a separate observed input. */
export interface MacroSpell {
  id: number
  name: string
  classLevels: Partial<Record<ClassAbbr, number>>
  castMs: number
  recoveryMs: number
  recastMs: number
  mana: number
  targetType: number
  effects: { effect: number; base: number; calc?: number; max?: number }[]
  durationTicks?: number
}
export interface MacroPlayer {
  /** Exact observed player name; required when a recipe explicitly targets the player. */
  characterName?: string
  classes: ClassAbbr[]
  level?: number
  /** Undefined means unavailable; an empty array is a verified empty spellbook. */
  spellbook?: number[]
  /** Array position + 1 is the actual /cast gem number. Null is an empty gem. */
  memorizedSpells?: (number | null)[]
  /** Verified unlocked one-based positions, sorted and unique. Undefined is unknown, never inferred from occupancy. */
  unlockedSpellSlots?: number[]
}
export type MacroStyle = 'solo' | 'group' | 'pet'
export const MACRO_CAST_GEMS = 14
export const MACRO_ROLES = ['damage', 'heal-self', 'heal-target', 'heal-pet', 'buff', 'debuff', 'pet-opener', 'self-buffs',
  'mez', 'summon-pet', 'pet-attack', 'pet-backoff', 'loc', 'export'] as const
export type MacroRole = typeof MACRO_ROLES[number]
export interface MacroSelection { role: MacroRole; spellLine?: string }
export function isMacroRole(value: unknown): value is MacroRole {
  return typeof value === 'string' && MACRO_ROLES.some((role) => role === value)
}
export function isMacroStyle(value: unknown): value is MacroStyle {
  return value === 'solo' || value === 'group' || value === 'pet'
}
export function isMacroSelection(value: unknown): value is MacroSelection {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  if (Object.keys(candidate).some((key) => key !== 'role' && key !== 'spellLine') || !isMacroRole(candidate.role)) return false
  const line = candidate.spellLine
  return line === undefined || typeof line === 'string' && line.length > 0 && line.length <= 120 &&
    line.trim() === line && line.toLowerCase() === line && /^[\x20-\x7e]+$/u.test(line)
}
/** Stable across rank upgrades and gem reordering. An empty selection list enables no installs. */
export function macroSelectionKey(selection: MacroSelection): string {
  return selection.spellLine ? `${selection.role}:${selection.spellLine}` : selection.role
}
export interface MacroPlanInput {
  player: MacroPlayer
  spells: MacroSpell[]
  style: MacroStyle
  /** Set only after this client is verified to support full-name /cast. Gem mode is the default. */
  castByName?: boolean
}
export type MacroStep = { kind: 'cast'; spellId: number } | { kind: 'command'; command: string; pauseTenths?: number } |
  { kind: 'target-self' }
export interface CompiledMacro {
  lines: string[]
  requiredSpellIds: number[]
  missingSpellIds: number[]
  mana: number
  /** Planned waits after commands, in tenths of a second. */
  pauseTenths: number
  ready: boolean
  status: 'ready' | 'needs-memorizing' | 'unavailable'
  reasons: string[]
}
export interface MacroUpgrade { from: MacroSpell; to: MacroSpell; reason: string }
export interface MacroRecipe extends CompiledMacro {
  id: string
  role: MacroRole
  name: string
  description: string
  selection: MacroSelection
  upgrade?: MacroUpgrade
}
export interface MacroAuditIssue {
  /** One-based line; absent for a whole-macro issue. */
  line?: number
  severity: 'error' | 'warning'
  code: string
  message: string
  suggestion?: string
}
export interface MacroLoadoutSlot {
  gem: number
  spellId?: number
  name?: string
  currentSpellId?: number
  currentName?: string
  action: 'keep' | 'memorize' | 'replace' | 'empty'
  required: boolean
}
export interface MacroLoadoutPlan {
  state: 'ready' | 'needs-memorizing' | 'over-capacity' | 'unavailable'
  message: string
  availableSlots?: number
  requiredSpellCount: number
  missingSpellCount: number
  overflow: number
  slots: MacroLoadoutSlot[]
  omitted: { id: number; name: string; reason: string }[]
}
