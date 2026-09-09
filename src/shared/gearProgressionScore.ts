import type { GearProgressionContext } from './gearProgressionTypes'
import { eligibleGearSpells, learnedLevel, type GearWeights } from './gearProgressionProfile'
import type { ClassAbbr } from './classCombo'
import type { MacroSpell } from './macros'
import type { GearRow, GearStats, GearStatKey } from './planner/gear'
import { scaleGearStats, gearRatio } from './planner/gearScale'
import type { PlannerInventoryHost } from './planner/inventorySlots'
import type { PlanSlotId } from './planner/types'
import { bestWornFocus, focusPctFor, type FocusSpell, type WornFocus } from './wornFocus'
import { knownGearTier } from './gearProgressionMerge'
import { clientDurationTicks } from './spellMetrics'

export interface GearScoreContext {
  character: GearProgressionContext
  classes: ClassAbbr[]
  level: number
  weights: GearWeights
  byKey: ReadonlyMap<string, GearRow>
  equipped: readonly PlannerInventoryHost[] | null
}
export interface GearEvaluation { gain: number; benefit: string; cautions: string[]; comparedWith?: string; comparisonKnown: boolean }
interface OtherEquipment { haste: number; focus: WornFocus[]; focusScore: number }
const equipmentCache = new WeakMap<GearScoreContext, Map<PlanSlotId, OtherEquipment>>()
const spellCache = new WeakMap<GearScoreContext, NonNullable<ReturnType<typeof focusSpell>>[]>()
export function tierStats(row: GearRow, tier: number, upper = false): GearStats {
  return scaleGearStats(row.stats, { full: tier, fraction: upper && tier < 10 ? 2 ** tier - 1 : 0 }, row.voidSynth)
}
function passiveFocus(row: GearRow, context: GearScoreContext): WornFocus[] {
  return row.effects.flatMap((effect) => {
    if (effect.kind !== 'focus' || (effect.reqLevel ?? 0) > context.level) return []
    const focus = context.character.focusByEffect?.[effect.name.trim().toLowerCase()]
    return focus ? [{ ...focus, item: row.name }] : []
  })
}
/** Only explicit HP spell effects are valued. Unknown target layouts cannot earn an AE-limited focus. */
function focusSpell(spell: MacroSpell, classes: readonly ClassAbbr[], characterLevel: number): { kind: 'damage' | 'heal'; spell: FocusSpell } | undefined {
  const hp = spell.effects.find((effect) => effect.effect === 0 && effect.base !== 0)
  const level = learnedLevel(spell, classes)
  if (!hp || level === undefined) return undefined
  const kind = hp.base < 0 ? 'damage' : 'heal'
  const targets: Readonly<Record<number, string>> = { 1: 'Line of Sight', 4: 'PB AE', 5: 'Single', 6: 'Self', 8: 'Targeted AE', 14: 'Pet', 24: 'AE', 40: 'AE', 41: 'AE' }
  return { kind, spell: { name: spell.name, level, spellType: kind === 'damage' ? 'detrimental' : 'beneficial',
    durationMs: durationMs(spell, characterLevel), targetType: targets[spell.targetType] } }
}
function durationMs(spell: MacroSpell, level: number): number | undefined {
  if (spell.durationFormula === 0) return 0
  if (spell.durationFormula === undefined || spell.durationTicks === undefined) return undefined
  const ticks = clientDurationTicks({ formula: spell.durationFormula, value: spell.durationTicks }, level)
  return ticks === null ? undefined : ticks * 6000
}
function focusValue(focus: readonly WornFocus[], context: GearScoreContext): number {
  if (!focus.length) return 0
  const spells = spellCache.get(context) ?? eligibleGearSpells(context.character, context.classes, context.level).flatMap((spell) => {
    const observed = focusSpell(spell, context.classes, context.level)
    return observed ? [observed] : []
  })
  spellCache.set(context, spells)
  if (!spells.length) return 0
  return spells.reduce((sum, entry) => {
    const admitted = focus.filter((effect) => knownFocusLimits(effect, entry.spell))
    return sum + (bestWornFocus(admitted, entry.kind, entry.spell)?.pct ?? 0) * context.weights[entry.kind]
  }, 0) / spells.length
}
function knownFocusLimits(effect: WornFocus, spell: FocusSpell): boolean {
  if (spell.targetType === undefined && effect.excludesArea) return false
  return spell.durationMs !== undefined || (effect.minDurationMs === undefined && effect.maxDurationMs === undefined)
}
export function gearFocusSupports(focus: WornFocus, character: GearProgressionContext, classes: readonly ClassAbbr[], level: number): boolean {
  return eligibleGearSpells(character, classes, level).some((spell) => {
    const entry = focusSpell(spell, classes, level)
    return entry?.kind === focus.kind && knownFocusLimits(focus, entry.spell) && focusPctFor(focus, entry.spell) > 0
  })
}
function otherEquipment(slot: PlanSlotId, context: GearScoreContext): OtherEquipment {
  const cached = equipmentCache.get(context) ?? new Map<PlanSlotId, OtherEquipment>()
  const existing = cached.get(slot)
  if (existing) return existing
  const other = (context.equipped ?? []).filter((host) => host.slot !== slot)
  const rows = other.flatMap((host) => {
    const row = context.byKey.get(host.key)
    return row ? [{ host, row }] : []
  })
  const haste = Math.max(0, ...rows.map(({ host, row }) => tierStats(row, knownGearTier(host.tier) ?? 10, true).HASTE ?? 0))
  const replaced = context.equipped?.find((host) => host.slot === slot)?.name.toLowerCase()
  // Socketed foci without a known parent remain in the baseline. This understates, never invents, a gain.
  const observed = (context.character.wornFocus ?? []).filter((focus) => focus.item.toLowerCase() !== replaced)
  const focus = [...observed, ...rows.flatMap(({ row }) => passiveFocus(row, context))]
  const value = { haste, focus, focusScore: focusValue(focus, context) }
  cached.set(slot, value)
  equipmentCache.set(context, cached)
  return value
}
function staticValue(stats: GearStats, weights: GearWeights, slot: PlanSlotId): number {
  const sum = Object.entries(weights.stats).reduce((value, [key, weight]) =>
    key === 'HASTE' ? value : value + (stats[key as GearStatKey] ?? 0) * weight, 0)
  return sum + (slot === 'PRIMARY' ? (gearRatio(stats) ?? 0) * 20 * weights.weapon : 0)
}
function contextualValue(row: GearRow, stats: GearStats, slot: PlanSlotId, context: GearScoreContext): number {
  const other = otherEquipment(slot, context)
  const haste = Math.max(other.haste, stats.HASTE ?? 0) - other.haste
  const candidate = passiveFocus(row, context)
  const focus = candidate.length ? focusValue([...other.focus, ...candidate], context) - other.focusScore : 0
  return staticValue(stats, context.weights, slot) + haste * (context.weights.stats.HASTE ?? 0) + focus
}
const BENEFITS: Partial<Record<GearStatKey, string>> = {
  MP: 'More mana for your spells', MANA_REGEN: 'Recover mana between spells', HP: 'A bigger health buffer',
  AC: 'More armor for incoming hits', HP_REGEN: 'Recover health as you travel', INT: 'More intelligence for your caster classes',
  WIS: 'More wisdom for your caster classes', STR: 'More strength for weapons', DEX: 'More dexterity for weapons',
  HASTE: 'Faster weapon swings', END: 'More endurance for your abilities', ATTACK: 'More attack for weapons'
}
function benefitText(stats: GearStats, previous: GearStats | undefined, weights: GearWeights): string {
  const best = Object.entries(BENEFITS).map(([key, label]) => {
    const delta = (stats[key as GearStatKey] ?? 0) - (previous?.[key as GearStatKey] ?? 0)
    return { label, value: delta * (weights.stats[key as GearStatKey] ?? 0) }
  }).sort((a, b) => b.value - a.value)[0]
  return best.value > 0 ? best.label : 'Useful equipment for your selected classes'
}
function contextualBenefit(row: GearRow, pair: { stats: GearStats; oldStats?: GearStats }, slot: PlanSlotId, context: GearScoreContext): string {
  const { stats, oldStats } = pair
  const other = otherEquipment(slot, context)
  const marginal = Math.max(other.haste, stats.HASTE ?? 0) - Math.max(other.haste, oldStats?.HASTE ?? 0)
  const adjusted = { ...stats, HASTE: (oldStats?.HASTE ?? 0) + marginal }
  const benefit = benefitText(adjusted, oldStats, context.weights)
  if (benefit !== 'Useful equipment for your selected classes') return benefit
  if (passiveFocus(row, context).length) return 'A focus option for spells you have learned'
  return slot === 'PRIMARY' && gearRatio(stats) ? 'A stronger stated weapon damage-to-delay ratio' : benefit
}
export function evaluateGear(row: GearRow, tier: number, slot: PlanSlotId, context: GearScoreContext): GearEvaluation | undefined {
  const host = context.equipped?.find((entry) => entry.slot === slot)
  const previous = host && context.byKey.get(host.key)
  const previousTier = knownGearTier(host?.tier)
  const comparisonKnown = comparisonIsKnown({ row, previous, hostPresent: Boolean(host), previousTier }, context)
  const stats = tierStats(row, tier)
  const oldStats = previous && previousTier !== undefined ? tierStats(previous, previousTier, true) : undefined
  const gain = contextualValue(row, stats, slot, context) - (previous && oldStats ? contextualValue(previous, oldStats, slot, context) : 0)
  const cautions = evaluationCautions(row, context, { host: Boolean(host), comparisonKnown })
  const benefit = contextualBenefit(row, { stats, oldStats }, slot, context)
  return { gain, benefit: comparisonKnown ? benefit : factualBenefit(benefit), cautions, comparedWith: host?.name, comparisonKnown }
}
function comparisonIsKnown(pair: { row: GearRow; previous: GearRow | undefined; hostPresent: boolean; previousTier?: number }, context: GearScoreContext): boolean {
  if (context.equipped === null) return false
  if (!pair.hostPresent) return true
  if (!pair.previous || pair.previousTier === undefined) return false
  const previous = pair.previous
  return Object.entries(context.weights.stats).every(([key, weight]) => !weight ||
    (pair.row.stats[key as GearStatKey] === undefined) === (previous.stats[key as GearStatKey] === undefined))
}
function factualBenefit(benefit: string): string {
  return benefit.replace(/^More /, '').replace(/^A bigger health buffer$/, 'Health for your adventures')
    .replace(/^Faster weapon swings$/, 'Haste for weapon swings').replace(/^A stronger stated weapon/, 'A stated weapon')
}
function evaluationCautions(row: GearRow, context: GearScoreContext, comparison: { host: boolean; comparisonKnown: boolean }): string[] {
  const { host, comparisonKnown } = comparison
  const cautions = ['The ordering uses stated item stats and preferences; it is not measured damage or survivability.']
  if (context.equipped === null) cautions.push('Current equipment is unknown. This is an item to consider, not a verified upgrade.')
  if (host && comparisonKnown) cautions.push('Current fractional progress is unknown; the comparison uses the highest possible stats within its recorded tier.')
  if (host && !comparisonKnown) cautions.push('Some compared stats, the current item, or its tier are unstated. Missing values are not proof of zero; check before replacing anything.')
  if (row.effects.some((effect) => effect.kind !== 'focus')) cautions.push('Click, proc, pet and other special effects need review; they are not converted into a guessed combat score.')
  if (row.effects.some((effect) => (effect.reqLevel ?? 0) > context.level)) cautions.push('Some item effects unlock at a higher level and are not valued yet.')
  return cautions
}
