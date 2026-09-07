import type { QuestJournalCatalogEntry } from '../../../shared/questJournal/catalog'
import type { RecoveryCandidate, RecoveryCapture, RecoveryObjective } from '../../../shared/questJournal/recovery'
import { nameKey, observedTaskId } from '../progress'
import { safeId } from '../validate'
import { screenTable } from './table'
import { extractObjectives } from './objectives'

export type CandidateEvidence = Omit<RecoveryCandidate, 'id'>
export interface ScreenResult { candidates: CandidateEvidence[]; warnings: string[]; unassignedObjectives?: RecoveryObjective[] }

/** Screen names must occupy a whole table row, never occur within prose or an objective. */
export function screenCandidates(catalog: readonly QuestJournalCatalogEntry[], capture: RecoveryCapture): ScreenResult {
  const table = screenTable(capture)
  const result: ScreenResult = { candidates: [], warnings: [...table.warnings] }
  if (!table.state) return result
  for (const row of table.rows.slice(0, 250)) {
    const identity = rowIdentity(catalog, row, result.warnings)
    if (!identity) continue
    const { questId, name, known } = identity
    result.candidates.push({ questId, name, state: table.state,
      confidence: known ? 'confirmed' : 'likely', source: table.state === 'active' ? 'task-window' : 'history-window',
      evidence: [`Read the complete task title from the ${table.state === 'active' ? 'Current Tasks' : 'Quest History'} table.`,
        'The screenshot does not establish when the task was accepted or completed.'], selectedByDefault: known })
  }
  if (table.rows.length > 250) result.warnings.push('Only the first 250 visible table rows were considered.')
  if (table.state === 'active') associateObjectives(result, table.objectiveText, extractObjectives(capture, table.objectiveText))
  return result
}

function rowIdentity(catalog: readonly QuestJournalCatalogEntry[], row: { name: string; bounded: boolean }, warnings: string[]): { questId: string; name: string; known: boolean } | undefined {
  const matches = catalog.filter((entry) => nameKey(entry.name) === nameKey(row.name))
  if (matches.length > 1) {
    warnings.push(`Ambiguous quest name: ${row.name}. No quest was selected for it.`)
    return undefined
  }
  const questId = matches[0]?.id ?? observedTaskId(row.name)
  if (!safeId(questId) || (!matches.length && !row.bounded)) {
    warnings.push(`Unrecognized table text: ${row.name}. Check the original image.`)
    return undefined
  }
  if (!matches.length) warnings.push(`No guide matches the bounded task row “${row.name}”; it will be kept as an observed task.`)
  return { questId, name: matches[0]?.name ?? row.name, known: matches.length === 1 }
}

function associateObjectives(result: ScreenResult, lines: string[], objectives: RecoveryObjective[]): void {
  if (!objectives.length) return
  if (objectives.some((objective) => objective.complete === undefined)) result.warnings.push('Some objective status cells were not recognized. Their instruction text is retained with progress unknown.')
  // A title repeated directly under the progression heading identifies the selected task. A list
  // containing several tasks does not tell us which task the objective pane currently describes.
  const selected = result.candidates.filter((candidate) => nameKey(candidate.name) === nameKey(lines[0] ?? ''))
  if (selected.length !== 1) {
    result.warnings.push('Visible objective counts could not be tied to one selected task. Leave them unassigned or choose the task shown in the objective pane during review.')
    result.unassignedObjectives = objectives
    return
  }
  selected[0].objectives = objectives
}
