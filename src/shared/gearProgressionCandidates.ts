import { acquisitionAvailable, acquisitionEffort, type GearAcquisition } from './gearAcquisition'
import { gearClasses, gearRequiredLevel } from './gearAcquisitionRules'
import type { GearEffort, GearProgressionInput, GearRecommendation } from './gearProgressionTypes'
import { gearMergeAdvice, knownGearTier, spareGearCopies } from './gearProgressionMerge'
import { evaluateGear, type GearScoreContext } from './gearProgressionScore'
import { layeredVerdict } from './planner/era'
import type { GearRow } from './planner/gear'
import { ownershipKey, type OwnershipRow } from './planner/ownership'
import { cellsForSlot, type PlanSlotId } from './planner/types'

const EFFORT_ORDER: Record<GearEffort, number> = { owned: 0, easier: 1, 'near-level': 2, unknown: 3, harder: 4 }
export function effortOrder(effort: GearEffort): number { return EFFORT_ORDER[effort] }
export function gearEligible(row: GearRow, context: GearScoreContext): boolean {
  if (!gearClasses(row).some((c) => context.classes.includes(c))) return false
  if ((gearRequiredLevel(row) ?? 0) > context.level) return false
  if (row.eraDerived?.verdict === 'out-of-era') return false
  return layeredVerdict(row.wikiSources?.flatMap((source) => source.zone ? [source.zone] : []) ?? [], row.eraTag) !== 'out-of-era'
}
function handConflict(row: GearRow, slot: PlanSlotId, context: GearScoreContext): boolean {
  if (slot === 'SECONDARY' && row.stats.DMG !== undefined) return true
  if (slot !== 'PRIMARY') return false
  const current = context.equipped?.find((host) => host.slot === 'PRIMARY')
  const previous = current && context.byKey.get(current.key)
  if (previous?.skill && row.skill && previous.skill !== row.skill) return true
  return twoHandConflict(row, context)
}
function twoHandConflict(row: GearRow, context: GearScoreContext): boolean {
  return /2[hH]|two.hand/i.test(row.skill ?? '') && Boolean(context.equipped?.some((host) => host.slot === 'SECONDARY'))
}
function loreConflict(row: GearRow, slot: PlanSlotId, context: GearScoreContext): boolean {
  return row.flags.some((flag) => /^lore(?:\s|$)/i.test(flag.trim())) &&
    Boolean(context.equipped?.some((host) => host.key === row.key && host.slot !== slot))
}
export function sourceInEra(source: GearAcquisition): boolean {
  return layeredVerdict(source.zone ? [source.zone] : [], undefined) !== 'out-of-era'
}
function availableSources(row: GearRow, input: GearProgressionInput, context: GearScoreContext): GearAcquisition[] {
  return (input.acquisitions.get(row.key) ?? []).filter((source) => sourceInEra(source) && acquisitionAvailable(source, context.classes, context.level))
    .sort((a, b) => effortOrder(acquisitionEffort(a, context.level)) - effortOrder(acquisitionEffort(b, context.level)) || a.name.localeCompare(b.name))
}
function ownedTier(copies: readonly OwnershipRow[]): number | undefined {
  const tiers = spareGearCopies(copies).flatMap((copy) => {
    const tier = knownGearTier(copy.tier)
    return tier === undefined ? [] : [tier]
  })
  return tiers.length ? Math.max(...tiers) : undefined
}
interface CandidateContext { input: GearProgressionInput; context: GearScoreContext }
interface CandidatePlan { tier: number; currentTier?: number; action: GearRecommendation['action'] }
function candidatePlan(row: GearRow, slot: PlanSlotId, state: CandidateContext, copies: readonly OwnershipRow[]): CandidatePlan | undefined {
  const { input, context } = state
  if (handConflict(row, slot, context) || loreConflict(row, slot, context)) return undefined
  const worn = context.equipped?.find((host) => host.slot === slot)
  const same = worn?.key === row.key
  const owned = ownedTier(copies)
  const tier = candidateTier(input, same ? knownGearTier(worn?.tier) : owned, same)
  if (same && !higherTier(tier, worn?.tier)) return undefined
  return { tier, currentTier: worn?.tier, action: candidateAction(same, owned) }
}
function candidateAction(same: boolean, owned: number | undefined): GearRecommendation['action'] {
  return same ? 'improve' : owned !== undefined ? 'equip' : 'find'
}
function higherTier(candidate: number, current: number | undefined): boolean {
  return current !== undefined && candidate > current
}
function recommendationFor(row: GearRow, slot: PlanSlotId, state: CandidateContext, copies: readonly OwnershipRow[]): GearRecommendation | undefined {
  const { input, context } = state
  const plan = candidatePlan(row, slot, state, copies)
  if (!plan) return undefined
  const { tier, action } = plan
  const evaluation = evaluateGear(row, tier, slot, context)
  if (!evaluation || evaluation.gain <= 0) return undefined
  const sources = availableSources(row, input, context)
  const effort = action === 'find' ? sourceEffort(sources[0], context.level) : 'owned'
  const merge = action === 'improve' ? gearMergeAdvice(plan.currentTier, copies, evaluation.benefit) : undefined
  // With no spare copies, keeping this item is useful advice in My gear; farming remains separate.
  if (insufficientMerge(action, input, merge)) return undefined
  const cautions = candidateCautions(row, input, sources, evaluation.cautions)
  return { id: `${row.key}:${slot}:${action}:${tier}`, item: row, slot, tier, action, effort,
    score: evaluation.gain, benefit: evaluation.benefit, comparisonKnown: evaluation.comparisonKnown,
    reasons: candidateReasons(row, context, action, sources[0]),
    cautions, source: sources[0], alternatives: sources.slice(1), comparedWith: evaluation.comparedWith, merge }
}
function insufficientMerge(action: GearRecommendation['action'], input: GearProgressionInput, merge: GearRecommendation['merge']): boolean {
  return action === 'improve' && input.options.mode === 'attainable' && (!merge || merge.availableXp < merge.xp.max)
}
function candidateReasons(row: GearRow, context: GearScoreContext, action: GearRecommendation['action'], source: GearAcquisition | undefined): string[] {
  return [`Matches ${gearClasses(row).filter((c) => context.classes.includes(c)).join(', ')}.`,
    ...(action === 'equip' ? ['A spare copy appears in the latest inventory export.'] : []),
    ...(source ? [`${source.kind === 'drop' ? 'Dropped by' : 'Reward from'} ${source.name}.`] : [])]
}
function candidateTier(input: GearProgressionInput, owned: number | undefined, improve: boolean): number {
  if (input.options.mode === 'potential') return knownGearTier(input.options.targetTier) ?? 10
  return owned === undefined ? 0 : Math.min(10, owned + (improve ? 1 : 0))
}
function sourceEffort(source: GearAcquisition | undefined, level: number): GearEffort {
  return source ? acquisitionEffort(source, level) : 'unknown'
}
function candidateCautions(row: GearRow, input: GearProgressionInput, sources: readonly GearAcquisition[], original: readonly string[]): string[] {
  const result = [...original]
  if (!sources.length) result.push('No eligible acquisition route is verified in the catalog. Check Browse all before making a trip.')
  if (row.quest && !sources.some((source) => source.kind === 'quest')) result.push('A QUEST flag can describe an ingredient; it is not proof this item is a quest reward.')
  if (input.options.mode === 'potential') result.push('This is a hypothetical target tier, not an observed drop or a promise that its cost is affordable.')
  if ((input.options.difficulty ?? 0) > 0) result.push(`Difficulty ${input.options.difficulty} drops can be +${input.options.difficulty} or higher; difficulty does not prove that you can clear this source.`)
  return result
}
export function gearCandidates(input: GearProgressionInput, context: GearScoreContext): GearRecommendation[] {
  const ownership = new Map(input.ownership)
  return input.rows.flatMap((row) => {
    if (!gearEligible(row, context)) return []
    const sources = input.acquisitions.get(row.key)
    if (sources?.length && sources.every((source) => !sourceInEra(source))) return []
    const copies = ownership.get(ownershipKey(row.name)) ?? []
    return row.slots.flatMap(cellsForSlot).flatMap((slot) => {
      const recommendation = recommendationFor(row, slot, { input, context }, copies)
      return recommendation ? [recommendation] : []
    })
  })
}
