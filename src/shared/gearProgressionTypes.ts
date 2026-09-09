import type { ClassAbbr } from './classCombo'
import type { GearAcquisition } from './gearAcquisition'
import type { MacroSpell } from './macros'
import type { GearRow } from './planner/gear'
import type { PlannerInventoryHost } from './planner/inventorySlots'
import type { OwnershipEntry } from './planner/ownership'
import type { PlanSlotId } from './planner/types'
import type { SocketType } from './planner/types'
import type { WornFocus } from './wornFocus'

/** Read-only character facts. Missing spellbook is different from a verified empty book. */
export interface GearProgressionContext {
  characterId: string | null
  classes: ClassAbbr[]
  level?: number
  source: 'live' | 'log' | 'none'
  spells?: MacroSpell[]
  focusByEffect?: Record<string, WornFocus>
  wornFocus?: WornFocus[]
  sampledAt?: number
  message: string
}
export type GearProgressionGoal = 'auto' | 'balanced' | 'spells' | 'melee' | 'healing' | 'pets' | 'survival'
export interface GearProgressionOptions {
  goal: GearProgressionGoal
  mode: 'attainable' | 'potential'
  level?: number
  targetTier?: number
  difficulty?: 0 | 1 | 2 | 3 | 4
  slot?: PlanSlotId
}
export interface GearLevelBand { min: number; max: number; label: string }
export type GearEffort = 'owned' | 'easier' | 'near-level' | 'harder' | 'unknown'
export interface GearMergeAdvice {
  fromTier: number
  toTier: number
  xp: { min: number; max: number }
  availableCopies: number
  availableXp: number
  benefit: string
  unlocks: string[]
  warnings: string[]
  exaltations?: GearExaltationAdvice[]
}
export interface GearExaltationAdvice {
  donorKey: string
  donorName: string
  effect: string
  socket: SocketType
  donorTier: number
  hostTier: number
  /** Extra base copies consumed to upgrade a starting donor; keep that donor and host separate. */
  baseCopies: number
  classes: ClassAbbr[]
  source?: GearAcquisition
  warnings: string[]
}
export interface GearRecommendation {
  id: string
  item: GearRow
  slot: PlanSlotId
  action: 'find' | 'equip' | 'improve'
  tier: number
  benefit: string
  reasons: string[]
  cautions: string[]
  source?: GearAcquisition
  alternatives: GearAcquisition[]
  effort: GearEffort
  /** An explained ordering heuristic, never DPS, eHP, or a percentage improvement. */
  score: number
  comparedWith?: string
  merge?: GearMergeAdvice
  comparisonKnown: boolean
  exaltations?: GearExaltationAdvice[]
}
export interface GearOwnedAdvice {
  id: string
  slot: PlanSlotId
  name: string
  item?: GearRow
  tier?: number
  action: 'keep' | 'improve' | 'replace' | 'unknown'
  benefit: string
  reasons: string[]
  recommendation?: GearRecommendation
  merge?: GearMergeAdvice
}
export interface GearProgressionInput {
  rows: readonly GearRow[]
  acquisitions: ReadonlyMap<string, readonly GearAcquisition[]>
  character: GearProgressionContext
  /** null means no equipment export, not a character with every slot empty. */
  equipped: readonly PlannerInventoryHost[] | null
  ownership: readonly OwnershipEntry[]
  options: GearProgressionOptions
}
export interface GearProgressionResult {
  recommendations: GearRecommendation[]
  myGear: GearOwnedAdvice[]
  level?: number
  band?: GearLevelBand
  goal: GearProgressionGoal
  classes: ClassAbbr[]
  limits: string[]
}
