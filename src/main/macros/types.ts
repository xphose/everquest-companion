import type { CharacterRef } from '../../shared/types'
import type { ClassAbbr } from '../../shared/classCombo'
import type { MacroAssistantSettings, MacroAssistantSnapshot } from '../../shared/macroAssistant'
import type { MacroRecipe, MacroSpell } from '../../shared/macros'
import type { PlayerLocationResult } from '../../shared/playerLocation'
import type { ManagedSocial, SocialRequest } from './socialIni'

export interface MacroWorld {
  characterId: string | null
  character: CharacterRef | null
  root: string | null
  token: string
}
export interface QueuedMacros {
  targetFile: string
  requests: SocialRequest[]
  problems: string[]
  signature: string
  source: 'auto' | 'manual'
}
export interface MacroApplied {
  targetFile: string
  hash: string
  backup: string
  previousManaged: ManagedSocial[]
  at: string
}
export interface MacroSaved {
  settings: MacroAssistantSettings
  managed: Record<string, ManagedSocial[]>
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
