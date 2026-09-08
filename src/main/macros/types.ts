import type { CharacterRef } from '../../shared/types'
import type { ClassAbbr } from '../../shared/classCombo'
import type { MacroAssistantSettings, MacroAssistantSnapshot } from '../../shared/macroAssistant'
import type { MacroRecipe, MacroSelection, MacroSpell } from '../../shared/macros'
import type { PlayerLocationResult } from '../../shared/playerLocation'
import type { ManagedSocial, SocialRequest } from './socialIni'
import type { MacroPreparationCompletion, MacroPreparationPlan } from '../../shared/macroPreparation'
import type { ManagedSpellLoadout, SpellLoadoutRequest } from './spellLoadoutIni'

export interface PreparedMacros {
  packageId?: string
  completion?: MacroPreparationCompletion
  /** Last verified temporary-gem state; an unavailable observation does not clear it. */
  temporaryGems?: boolean
  preserveBaseline?: boolean
  targetFile: string
  plan: MacroPreparationPlan
  destination: { bar: number; page: number }
  sets: SpellLoadoutRequest[]
  requests: SocialRequest[]
  createdAt: string
  installedAt?: string
  unchanged?: boolean
  invalidated?: string
  retired?: boolean
}

export interface MacroWorld {
  characterId: string | null
  character: CharacterRef | null
  root: string | null
  token: string
}
export interface MacroRepairBinding { id: string; selection: MacroSelection }
export interface MacroRepairClaim extends MacroRepairBinding { original: ManagedSocial; fingerprint: string }
export interface QueuedMacros {
  targetFile: string
  requests: SocialRequest[]
  problems: string[]
  signature: string
  source: 'auto' | 'manual' | 'prepare'
  repairs?: MacroRepairClaim[]
  preparation?: PreparedMacros
}
export interface MacroApplied {
  targetFile: string
  hash: string
  backup: string
  previousManaged: ManagedSocial[]
  previousRepairs?: MacroRepairBinding[]
  previousSetManaged?: ManagedSpellLoadout[]
  previousPreparation?: PreparedMacros
  at: string
}
export interface MacroSaved {
  settings: MacroAssistantSettings
  managed: Record<string, ManagedSocial[]>
  repairs?: Record<string, MacroRepairBinding[]>
  setManaged?: Record<string, ManagedSpellLoadout[]>
  preparations?: Record<string, PreparedMacros>
  queued?: QueuedMacros
  applied?: MacroApplied
  restoreRequested?: boolean
  recipes?: MacroRecipe[]
  classes?: ClassAbbr[]
  level?: number
  lastSignature?: string
  status?: Pick<MacroAssistantSnapshot['installation'], 'state' | 'message' | 'conflicts' | 'completion'>
}
export interface MacroRepository {
  get(key: string): Promise<MacroSaved>
  put(key: string, value: MacroSaved): Promise<void>
}
export interface MacroServiceDeps {
  world(): MacroWorld
  livePlayer(): Promise<PlayerLocationResult>
  spells(root: string, ids: number[]): Promise<MacroSpell[]>
  repository: MacroRepository
  backupDir: string
  now(): number
}
