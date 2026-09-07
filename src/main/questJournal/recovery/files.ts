import type { QuestJournalCatalogEntry } from '../../../shared/questJournal/catalog'
import type { RecoverySourceStatus } from '../../../shared/questJournal/recovery'
import type { JournalFiles } from '../files'
import { achievementCompletion, nameKey } from '../progress'
import type { CandidateEvidence } from './screen'

export function fileCandidates(catalog: readonly QuestJournalCatalogEntry[], files: JournalFiles): CandidateEvidence[] {
  const result: CandidateEvidence[] = []
  for (const entry of catalog) {
    if (achievementCompletion(entry, files.claims)) {
      result.push({ questId: entry.id, name: entry.name, state: 'completed', confidence: 'confirmed', source: 'achievement',
        evidence: ['The exact-character achievements export records an earned quest reward; class-bypass grants are excluded.',
          'This is historical completion evidence, not the completion date of a current repeat run.'], selectedByDefault: true })
    }
    const reward = entry.rewards.find((item) => (files.inventory?.[nameKey(item.name)] ?? 0) > 0)
    if (reward && !achievementCompletion(entry, files.claims)) result.push({ questId: entry.id, name: entry.name, state: 'completed', confidence: 'likely', source: 'inventory',
      evidence: [`The exact-character inventory export contains ${reward.name}.`,
        'An owned reward does not prove completion. Select this suggestion only if you confirm that you completed this quest.'], selectedByDefault: false })
    const ingredient = ingredientCandidate(entry, catalog, files)
    if (ingredient) result.push(ingredient)
  }
  return result
}

function exactIngredients(entry: QuestJournalCatalogEntry): string[] {
  return entry.guide?.steps.filter((step) => step.kind === 'collect' && !step.manualOnly)
    .flatMap((step) => step.items?.filter((item) => !item.variant).map((item) => item.name) ?? []) ?? []
}

function ingredientCandidate(entry: QuestJournalCatalogEntry, catalog: readonly QuestJournalCatalogEntry[], files: JournalFiles): CandidateEvidence | undefined {
  const ingredient = exactIngredients(entry).find((name) => (files.inventory?.[nameKey(name)] ?? 0) > 0)
  if (!ingredient) return undefined
  const count = files.inventory?.[nameKey(ingredient)] ?? 0
  const shared = catalog.some((other) => other.id !== entry.id && exactIngredients(other).some((name) => nameKey(name) === nameKey(ingredient)))
  return { questId: entry.id, name: entry.name, state: 'active', confidence: 'likely', source: 'inventory', selectedByDefault: false,
    evidence: [`The exact-character inventory export contains ${count} × ${ingredient}, named by a verified collection step.`,
      ...(shared ? ['This item is referenced by other quest guides too; it does not identify one quest uniquely.'] : []),
      'Holding an ingredient does not establish acceptance or the current step. Select this suggestion only if you confirm the quest is active.'] }
}

export function fileStatuses(files: JournalFiles): RecoverySourceStatus[] {
  return [
    { label: 'Achievements export', state: files.achievementsStatus.state,
      message: files.achievementsStatus.message ?? (files.achievementsStatus.state === 'available'
        ? 'Read the exact-character achievements export.' : 'No exact-character achievements export was found.') },
    { label: 'Inventory export', state: files.inventoryStatus.state,
      message: files.inventoryStatus.message ?? (files.inventoryStatus.state === 'available'
        ? 'Read the exact-character inventory export; reward possession produces optional suggestions only.' : 'No exact-character inventory export was found.') }
  ]
}
