import { effortOrder, gearCandidates } from './gearProgressionCandidates'
import { gearExaltationAdvice } from './gearProgressionExaltation'
import { gearMergeAdvice, knownGearTier } from './gearProgressionMerge'
import { gearClasses, gearLevel, gearLevelBand, gearWeights } from './gearProgressionProfile'
import { evaluateGear, type GearScoreContext } from './gearProgressionScore'
import type { GearOwnedAdvice, GearProgressionInput, GearProgressionResult, GearRecommendation } from './gearProgressionTypes'
import type { PlannerInventoryHost } from './planner/inventorySlots'
import { ownershipKey } from './planner/ownership'
import { isAnyCell } from './planner/types'

export * from './gearProgressionTypes'
export { gearLevelBand, GEAR_GOAL_LABELS } from './gearProgressionProfile'
export { gearMergeAdvice } from './gearProgressionMerge'

function ordered(recommendations: GearRecommendation[], input: GearProgressionInput): GearRecommendation[] {
  return recommendations.sort((a, b) => {
    if (input.options.mode === 'potential') return b.score - a.score || a.id.localeCompare(b.id)
    const bucket = (effort: GearRecommendation['effort']): number => effort === 'harder' ? 2 : effort === 'unknown' ? 1 : 0
    const weight = { owned: 1.4, easier: 1.2, 'near-level': 1, unknown: 1, harder: 1 }
    return bucket(a.effort) - bucket(b.effort) || b.score * weight[b.effort] - a.score * weight[a.effort] || a.id.localeCompare(b.id)
  })
}
function distinctCards(recommendations: GearRecommendation[]): GearRecommendation[] {
  const seen = new Set<string>()
  return recommendations.filter((recommendation) => {
    // One item card chooses the weakest eligible paired cell; it never suggests wearing one copy twice.
    if (seen.has(recommendation.item.key)) return false
    seen.add(recommendation.item.key)
    return true
  }).slice(0, 36)
}
function ownedAdvice(host: PlannerInventoryHost, input: GearProgressionInput, context: GearScoreContext, recommendations: GearRecommendation[]): GearOwnedAdvice {
  const item = context.byKey.get(host.key)
  const tier = knownGearTier(host.tier)
  const base: GearOwnedAdvice = { id: `${host.slot}:${host.key}`, slot: host.slot, name: host.name, item, tier,
    action: 'unknown', benefit: 'Check this item in game', reasons: [] }
  if (!item || tier === undefined || isAnyCell(host.slot)) {
    base.reasons = [isAnyCell(host.slot) ? 'Any Slot interactions are not verified for automatic replacement.' : 'The item or its upgrade tier is missing from the export or catalog.']
    return base
  }
  const merge = ownedMerge(host, input, context)
  if (merge) merge.exaltations = gearExaltationAdvice(item, host.slot, context.level, input)
  const replacement = recommendations.find((entry) => entry.slot === host.slot && entry.item.key !== host.key && entry.comparisonKnown && effortOrder(entry.effort) <= 2)
  if (replacement) return { ...base, action: 'replace', benefit: replacement.benefit, reasons: ['A catalog upgrade has a known source or appears in your inventory.'], recommendation: replacement, merge }
  if (merge?.availableXp) return { ...base, action: 'improve', benefit: merge.benefit, reasons: ['Spare copies can contribute to the next tier. Check the cost range before spending them.'], merge }
  return { ...base, action: 'keep', benefit: tier === 10 ? 'Already at the maximum upgrade tier' : 'Keep using this while you explore',
    reasons: ['No better item with a known easier or near-level route was found in this catalog.'], merge }
}
function ownedMerge(host: PlannerInventoryHost, input: GearProgressionInput, context: GearScoreContext): GearOwnedAdvice['merge'] {
  const item = context.byKey.get(host.key)
  const tier = knownGearTier(host.tier)
  if (!item || tier === undefined || tier >= 10) return undefined
  const next = evaluateGear(item, tier + 1, host.slot, context)
  const benefit = next && next.gain > 0 ? next.benefit : `Reach tier +${tier + 1}; the stat gain depends on your current fractional progress`
  return gearMergeAdvice(tier, new Map(input.ownership).get(ownershipKey(item.name)) ?? [], benefit)
}
function limits(input: GearProgressionInput): string[] {
  return [
    'Recommendations are explainable catalog estimates, not a verified best-in-slot simulation.',
    'Class capabilities guide stat preferences. Missing stats, unverified class restrictions and unavailable-era items cannot earn invented value.',
    'Haste and matching spell foci use the strongest applicable effect across equipment; duplicate effects do not add their full value.',
    'Proc rates, special AA and stance interactions, combat caps, player skill and source clear times are not verified here.',
    'Offhand weapons, changes between weapon skill types and Any Slot replacements need manual comparison.',
    'Source level is an estimate of effort, not a promise that an encounter is safe or soloable. Quest minimum level is not encounter difficulty.',
    'Within known attainable options, the preference score favors owned items by 40% and easier sources by 20%. Unknown and harder routes stay behind that group.',
    ...(input.character.spells === undefined ? ['The current spellbook is unavailable; spell-specific focus value is withheld.'] : []),
    ...(input.options.mode === 'potential' ? ['Maximum potential previews the chosen item tier; it does not claim the resources or drop tier are available.'] : [])
  ]
}
/** Pure and deterministic: a level change, new spellbook or inventory export rebuilds the same plan. */
export function recommendGear(input: GearProgressionInput): GearProgressionResult {
  const classes = gearClasses(input.character.classes)
  const level = gearLevel(input.options.level) ?? gearLevel(input.character.level)
  const weights = gearWeights(classes, input.options.goal)
  const result: GearProgressionResult = { recommendations: [], myGear: [], level, band: level === undefined ? undefined : gearLevelBand(level),
    goal: weights.goal, classes, limits: limits(input) }
  if (!classes.length || level === undefined) {
    result.limits.unshift('Choose a character with a known level and classes, or set a preview level in More options.')
    result.myGear = (input.equipped ?? []).map((host) => ({ id: `${host.slot}:${host.key}`, slot: host.slot, name: host.name,
      item: input.rows.find((row) => row.key === host.key), tier: knownGearTier(host.tier), action: 'unknown',
      benefit: 'Waiting for your level and classes', reasons: ['Your exported equipment is available. Personalized comparisons will appear when your profile is known.'] }))
    return result
  }
  const context: GearScoreContext = { character: input.character, classes, level, weights,
    byKey: new Map(input.rows.map((row) => [row.key, row])), equipped: input.equipped }
  const candidates = ordered(gearCandidates(input, context), input)
  result.recommendations = distinctCards(candidates.filter((candidate) => !input.options.slot || candidate.slot === input.options.slot))
  for (const recommendation of result.recommendations.slice(0, 8)) {
    recommendation.exaltations = gearExaltationAdvice(recommendation.item, recommendation.slot, level, input)
  }
  result.myGear = (input.equipped ?? []).map((host) => ownedAdvice(host, input, context, candidates))
  return result
}
