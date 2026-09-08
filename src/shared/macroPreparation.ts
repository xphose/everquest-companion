import type { ClassAbbr } from './classCombo'
import type { MacroPlanInput } from './macros'

export type MacroPreparationCategory = 'summon-item' | 'buff' | 'cure' | 'invisibility' | 'vision' | 'breathing' | 'levitation' | 'rune'
export interface MacroPreparationOption {
  spellId: number
  name: string
  family: string
  category: MacroPreparationCategory
  classes: ClassAbbr[]
  preset?: 'food' | 'drink'
}
export interface MacroPreparationUtility {
  spellId: number
  name: string
  gem: number
  buttonName: string
  lines: string[]
  mana: number
  pauseTenths: number
  guidance: string[]
  /** Captured spell metadata, so a client patch cannot silently reuse stale instructions. */
  signature: string
}
/** Captured once when queued. The runtime must never rebuild this baseline from temporary gems. */
export interface MacroPreparationPlan {
  characterName: string
  classes: ClassAbbr[]
  spellIds: number[]
  unlockedSpellSlots: number[]
  baseline: (number | null)[]
  /** Exactly fourteen entries; -1 means leave unchanged in the client's spell-set format. */
  preparationGems: number[]
  combatGems: number[]
  replacements: { gem: number; originalSpellId: number; originalName?: string; spellId: number; name: string }[]
  utilities: MacroPreparationUtility[]
  suppliesButton?: { name: 'Make Supplies'; lines: string[]; mana: number; pauseTenths: number }
}
export type MacroPreparationResult = { ok: true; plan: MacroPreparationPlan } | { ok: false; reasons: string[] }
export interface MacroPreparationCompletion {
  kind: 'written' | 'unchanged'
  /** Completion/check time; installation.at remains the last actual save time. */
  at: string
}
export interface MacroPreparationPhase {
  phase: 'unknown' | 'combat' | 'utility-ready' | 'changing' | 'changed'
  message: string
  readySpellIds: number[]
}
export interface MacroPreparationSnapshot extends MacroPreparationPhase {
  options: MacroPreparationOption[]
  /** Only a fresh observation and owned spell metadata; used for a read-only local preview. */
  previewInput?: MacroPlanInput
  plan?: MacroPreparationPlan
  installation?: {
    state: 'pending' | 'saved' | 'conflict'
    message: string
    /** Stable for one explicitly captured preparation package, including queued replacements. */
    packageId?: string
    completion?: MacroPreparationCompletion
    at?: string
    targetFile?: string
    destination?: { bar: number; page: number }
    loadSetIndex?: number
    combatSetIndex?: number
    buttons?: { id: string; name: string; lines: string[] }[]
  }
}
