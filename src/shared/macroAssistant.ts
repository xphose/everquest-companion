import type { CharacterRef } from './types'
import type { ClassAbbr } from './classCombo'
import type { MacroAuditIssue, MacroRecipe, MacroSelection, MacroStyle } from './macros'

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

export interface MacroAssistantSnapshot {
  character: CharacterRef | null
  characterId: string | null
  context: {
    live: boolean
    message: string
    classes: ClassAbbr[]
    level?: number
    knownSpells?: number
    memorizedSpells?: number
  }
  settings: MacroAssistantSettings
  recipes: MacroRecipe[]
  existing: MacroExistingSocial[]
  installation: {
    state: 'off' | 'ready' | 'pending' | 'applied' | 'conflict' | 'unavailable'
    message: string
    targetFiles: string[]
    targetFile?: string
    pendingCount: number
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
