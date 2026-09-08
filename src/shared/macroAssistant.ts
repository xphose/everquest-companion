import type { CharacterRef } from './types'
import type { ClassAbbr } from './classCombo'
import type { MacroAuditIssue, MacroLoadoutPlan, MacroRecipe, MacroSelection, MacroStyle } from './macros'

export interface MacroAssistantSettings {
  autoUpdate: boolean
  style: MacroStyle
  selections: MacroSelection[]
  destination: { bar: number; page: number }
  /** An observed basename only, selected explicitly when several loadouts exist. */
  targetFile?: string
}

export interface MacroExistingSocial {
  page: number
  button: number
  name: string
  lines: string[]
  managed: boolean
  issues: MacroAuditIssue[]
}

export interface MacroInstallCompletion {
  kind: 'written' | 'unchanged' | 'restored'
  /** Time of this outcome; unchanged is a check, not a new file write. */
  at: string
  targetFile: string
  destination?: { bar: number; page: number }
}

export interface MacroAssistantSnapshot {
  character: CharacterRef | null
  characterId: string | null
  context: {
    live: boolean
    message: string
    classes: ClassAbbr[]
    level?: number
    knownSpells?: number
    /** All occupied native gem entries; some may be locked or beyond /cast's range. */
    memorizedSpells?: number
    /** Verified unlocked gem positions usable through /cast, restricted to 1 through 14. */
    availableSpellSlots?: number
    filledSpellSlots?: number
    emptySpellSlots?: number
  }
  settings: MacroAssistantSettings
  recipes: MacroRecipe[]
  loadout?: MacroLoadoutPlan
  existing: MacroExistingSocial[]
  installation: {
    state: 'off' | 'ready' | 'pending' | 'applied' | 'conflict' | 'unavailable'
    message: string
    targetFiles: string[]
    targetFile?: string
    pendingCount: number
    pendingAction?: 'install' | 'restore'
    /** Optional for compatibility with saved outcomes from earlier versions. */
    completion?: MacroInstallCompletion
    appliedAt?: string
    canRestore: boolean
    conflicts: string[]
  }
}

export type MacroAssistantMutation =
  | { characterId: string; action: 'configure'; settings: Partial<MacroAssistantSettings> }
  | { characterId: string; action: 'queue' | 'restore' }

export interface MacroAssistantMutationResult {
  ok: boolean
  error?: string
  snapshot: MacroAssistantSnapshot
}
