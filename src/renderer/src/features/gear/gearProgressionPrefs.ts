import type { GearProgressionOptions } from '@shared/gearProgression'
import { PLAN_SLOTS, isAnyCell, type PlanSlotId } from '../../../../shared/planner/types'

export type GearSection = 'recommended' | 'owned' | 'browse'
export interface GearProgressionPrefs {
  section: GearSection
  options: GearProgressionOptions
  selected: string | null
}

const GOALS = new Set(['auto', 'balanced', 'spells', 'melee', 'healing', 'pets', 'survival'])
const sections = new Set(['recommended', 'owned', 'browse'])
const object = (raw: unknown): Record<string, unknown> =>
  raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {}

/** Persist only this screen's bounded choices; character and game data never enter the value. */
export function sanitizeGearProgressionPrefs(raw: unknown): GearProgressionPrefs {
  const value = object(raw)
  const options = object(value.options)
  const result: GearProgressionPrefs = {
    section: sections.has(String(value.section)) ? value.section as GearSection : 'recommended',
    options: {
      goal: GOALS.has(String(options.goal)) ? options.goal as GearProgressionOptions['goal'] : 'auto',
      mode: options.mode === 'potential' ? 'potential' : 'attainable',
      difficulty: 0,
      targetTier: 1
    },
    selected: typeof value.selected === 'string' && value.selected.length <= 500 ? value.selected : null
  }
  if (integerWithin(options.level, 1, 50)) result.options.level = options.level
  if (integerWithin(options.targetTier, 0, 10)) result.options.targetTier = options.targetTier
  if (integerWithin(options.difficulty, 0, 4)) result.options.difficulty = options.difficulty as 0 | 1 | 2 | 3 | 4
  if (typeof options.slot === 'string' && (PLAN_SLOTS as readonly string[]).includes(options.slot) && !isAnyCell(options.slot as PlanSlotId)) result.options.slot = options.slot as PlanSlotId
  return result
}

function integerWithin(raw: unknown, min: number, max: number): raw is number {
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= min && raw <= max
}

/** Namespaces prevent one character's planning choices from changing another character's advice. */
export function gearProgressionStorageKey(characterId: string | null): string | null {
  return characterId ? `eq.gear.progression.v1.${encodeURIComponent(characterId)}` : null
}
