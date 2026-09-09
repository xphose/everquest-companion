import { isClassAbbr, type ClassAbbr } from './classCombo'
import type { GearLevelBand, GearProgressionContext, GearProgressionGoal } from './gearProgressionTypes'
import type { MacroSpell } from './macros'
import type { GearStatKey } from './planner/gear'

export const GEAR_GOAL_LABELS: Record<GearProgressionGoal, string> = {
  auto: 'Help my classes', balanced: 'A bit of everything', spells: 'Stronger spells',
  melee: 'Hit with weapons', healing: 'Better healing', pets: 'Help my pet', survival: 'Stay alive'
}
export function gearLevelBand(level: number): GearLevelBand {
  const min = Math.floor((Math.max(1, Math.trunc(level)) - 1) / 5) * 5 + 1
  return { min, max: min + 4, label: `${min} - ${min + 4}` }
}
export function gearClasses(classes: readonly ClassAbbr[]): ClassAbbr[] {
  return [...new Set(classes.filter(isClassAbbr))].sort().slice(0, 3)
}
export function gearLevel(level: number | undefined): number | undefined {
  return level !== undefined && Number.isInteger(level) && level >= 1 && level <= 125 ? level : undefined
}
export function learnedLevel(spell: MacroSpell, classes: readonly ClassAbbr[]): number | undefined {
  const levels = classes.flatMap((c) => spell.classLevels[c] === undefined ? [] : [spell.classLevels[c]])
    .filter((level) => level > 0 && level < 255)
  return levels.length ? Math.min(...levels) : undefined
}
export function eligibleGearSpells(context: GearProgressionContext, classes: readonly ClassAbbr[], level: number): MacroSpell[] {
  return (context.spells ?? []).filter((spell) => {
    const learned = learnedLevel(spell, classes)
    return learned !== undefined && learned <= level
  })
}
const MELEE = new Set<ClassAbbr>(['WAR', 'PAL', 'RNG', 'SHD', 'MNK', 'BRD', 'ROG', 'BST', 'BER'])
const HEALERS = new Set<ClassAbbr>(['CLR', 'DRU', 'SHM', 'PAL', 'RNG', 'BST', 'NEC'])
const INT_CASTERS = new Set<ClassAbbr>(['NEC', 'WIZ', 'MAG', 'ENC'])
const WIS_CASTERS = new Set<ClassAbbr>(['CLR', 'PAL', 'RNG', 'DRU', 'SHM', 'BST'])
const PETS = new Set<ClassAbbr>(['MAG', 'NEC', 'BST'])
export interface GearWeights {
  stats: Partial<Record<GearStatKey, number>>
  damage: number
  heal: number
  weapon: number
  goal: GearProgressionGoal
}
/** Capability union prevents a triple caster from receiving three times a single caster's score.
 * These are transparent preferences, not a reconstruction of the game's damage or mitigation. */
export function gearWeights(classes: readonly ClassAbbr[], requested: GearProgressionGoal): GearWeights {
  const has = (set: ReadonlySet<ClassAbbr>): boolean => classes.some((c) => set.has(c))
  const melee = has(MELEE), intellect = has(INT_CASTERS), wisdom = has(WIS_CASTERS)
  const caster = intellect || wisdom || classes.includes('BRD')
  const goal = requested === 'auto' ? 'balanced' : requested
  const attack = goal === 'melee' ? 2 : melee ? 1 : 0
  const damage = capabilityWeight(caster, goal === 'spells')
  const heal = capabilityWeight(has(HEALERS), goal === 'healing')
  const mana = petMana(goal, has(PETS), damage, heal)
  const guard = goal === 'survival' ? 2 : 1
  return { goal, weapon: attack, damage, heal, stats: {
    HP: 0.12 * guard, AC: 0.8 * guard, STA: 0.15 * guard, AGI: 0.08 * guard,
    HP_REGEN: 2 * guard, MP: 0.12 * mana, MANA_REGEN: 3 * mana,
    ...mentalWeights(intellect, wisdom, mana),
    STR: 0.25 * attack, DEX: 0.2 * attack, ATTACK: 0.2 * attack,
    HASTE: 1.5 * attack, END: 0.05 * attack, END_REGEN: attack,
    SV_FIRE: 0.05 * guard, SV_COLD: 0.05 * guard, SV_MAGIC: 0.05 * guard,
    SV_DISEASE: 0.05 * guard, SV_POISON: 0.05 * guard, SV_VOID: 0.05 * guard
  } }
}
function mentalWeights(intellect: boolean, wisdom: boolean, mana: number): Pick<NonNullable<GearWeights['stats']>, 'INT' | 'WIS'> {
  return { INT: intellect ? 0.4 * mana : 0, WIS: wisdom ? 0.4 * mana : 0 }
}
function petMana(goal: GearProgressionGoal, pets: boolean, damage: number, heal: number): number {
  return goal === 'pets' && pets ? 2 : Math.max(damage, heal)
}
function capabilityWeight(available: boolean, preferred: boolean): number {
  return available ? preferred ? 2 : 1 : 0
}
