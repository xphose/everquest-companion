import type { QuestJournalCatalogEntry } from '../../shared/questJournal/catalog'
import type { QuestJournalProfile, QuestJournalRecommendation, QuestJournalRewardComparison } from '../../shared/questJournal/journal'
import type { ItemStatBlock } from '../../shared/itemStats'
import { normalizedClass } from './validate'

export interface JournalWornItem { name: string; slot: string; stats: ItemStatBlock }

export function allowsClass(classes: string[], wanted: string[]): boolean {
  if (classes.some((c) => c.toUpperCase() === 'ALL')) return true
  return classes.some((c) => {
    const normalized = normalizedClass(c)
    return normalized !== undefined && wanted.includes(normalized)
  })
}

function levelReason(entry: QuestJournalCatalogEntry, profile: QuestJournalProfile): string {
  if (entry.minLevel === undefined) return 'The source does not state a minimum level.'
  if (profile.level === undefined) return `Listed minimum level: ${String(entry.minLevel)}. Set your level to compare.`
  return `Listed minimum level ${String(entry.minLevel)}; your level ${String(profile.level)}.`
}

export function recommend(entry: QuestJournalCatalogEntry, profile: QuestJournalProfile): QuestJournalRecommendation {
  const reasons = [levelReason(entry, profile)]
  let fit: QuestJournalRecommendation['fit'] = 'unknown'
  if (profile.level !== undefined && entry.minLevel !== undefined) {
    fit = profile.level < entry.minLevel ? 'later' : 'suitable'
  }
  const knownRestrictions = entry.classes.every((c) => c.toUpperCase() === 'ALL' || normalizedClass(c))
  if (!knownRestrictions) {
    fit = 'unknown'
    reasons.push(`Check additional quest restrictions: ${entry.classes.join(', ')}.`)
  } else if (entry.classes.length && profile.classes.length && !allowsClass(entry.classes, profile.classes)) {
    fit = 'other-class'
    reasons.push(`Quest classes: ${entry.classes.join(', ')}.`)
  }
  reasons.push(...rewardReasons(entry, profile))
  const mobs = entry.guide?.steps.flatMap((step) => step.locations) ?? entry.relatedNpcs
  const levels = [...new Set(mobs.flatMap((mob) => mob.level ? [`${mob.name}: level ${mob.level}`] : []))]
  if (levels.length) reasons.push(`Listed NPC levels: ${levels.slice(0, 3).join('; ')}.`)
  reasons.push('Minimum level is not a combat difficulty or soloability rating.')
  return { fit, reasons }
}

function rewardReasons(entry: QuestJournalCatalogEntry, profile: QuestJournalProfile): string[] {
  if (!profile.classes.length) return ['Set your classes to check reward eligibility.']
  const eligible = entry.rewards.filter((reward) => reward.stats?.classes && allowsClass(reward.stats.classes, profile.classes))
  if (eligible.length) return [`Reward matches your classes: ${eligible.map((r) => r.name).join(', ')}. Check any additional race or quest restrictions.`]
  const known = entry.rewards.some((reward) => reward.stats?.classes?.length)
  return known ? ['The listed reward classes do not match your current classes.'] : ['Reward class restrictions are unknown.']
}

/** Compare only numeric values present on both stat blocks; absent never means zero. */
function numericStats(stats: ItemStatBlock): Map<string, number> {
  const result = new Map<string, number>()
  if (stats.ac !== undefined) result.set('AC', stats.ac)
  for (const stat of [...stats.stats, ...stats.saves]) {
    if (/^[+-]?\d+(?:\.\d+)?$/u.test(stat.value.trim())) result.set(stat.key, Number(stat.value))
  }
  return result
}

function comparisonStats(reward: ItemStatBlock, worn: ItemStatBlock): QuestJournalRewardComparison['stats'] {
  const baseline = numericStats(worn)
  return [...numericStats(reward)].flatMap(([label, value]) => {
    const previous = baseline.get(label)
    return previous === undefined ? [] : [{ label, reward: value, worn: previous, delta: value - previous }]
  })
}

export function compareRewards(
  entry: QuestJournalCatalogEntry, worn: JournalWornItem[], profile: QuestJournalProfile
): QuestJournalRewardComparison[] {
  const results: QuestJournalRewardComparison[] = []
  for (const reward of entry.rewards) {
    const stats = reward.stats
    if (!stats?.slot || !stats.classes || !allowsClass(stats.classes, profile.classes)) continue
    for (const equipped of worn.filter((item) => stats.slot?.split(/\s+/u).includes(item.slot))) {
      const compared = comparisonStats(stats, equipped.stats)
      if (!compared.length) continue
      results.push({ reward: reward.name, worn: equipped.name, slot: equipped.slot, stats: compared,
        note: 'Base item stats from the wiki. Merge tiers, sockets, effects, race restrictions and stat caps are not scored.' })
    }
  }
  return results
}
