import type { QuestJournalCatalogEntry } from '../../shared/questJournal/catalog'
import type {
  QuestJournalContext, QuestJournalDetailResult, QuestJournalManual, QuestJournalObservedTask,
  QuestJournalProgress, QuestJournalQuery, QuestJournalQueryResult, QuestJournalRow
} from '../../shared/questJournal/journal'
import type { ClassUnlockClaim } from '../../shared/outputs/achievements'
import type { TurnInEvent } from '../../shared/types'
import { achievementCompletion, finalTrade, matchObserved, nameKey, observedTaskId, readyForTurnIn, stepProgress } from './progress'
import { allowsClass, compareRewards, recommend, type JournalWornItem } from './recommend'
import { normalizedClass, sanitizeManual, sanitizeQuery } from './validate'

export interface JournalModelInput {
  catalog: readonly QuestJournalCatalogEntry[]
  context: QuestJournalContext
  progress: QuestJournalProgress
  observed: QuestJournalObservedTask[]
  inventory: Record<string, number> | null
  claims: ClassUnlockClaim[]
  worn: JournalWornItem[]
  turnins: TurnInEvent[]
  completedSky: Set<string>
}

function manualFor(input: JournalModelInput, id: string): QuestJournalManual {
  return sanitizeManual(input.progress.quests[id])
}

function catalogRow(input: JournalModelInput, entry: QuestJournalCatalogEntry): QuestJournalRow {
  const manual = manualFor(input, entry.id)
  const observed = matchObserved(entry, input.observed)
  const steps = stepProgress(entry, manual, input.inventory)
  const completed = isCompleted(input, entry)
  const ready = !completed && readyForTurnIn(entry, steps, input.inventory)
  const active = manual.status === 'active' || taskState(observed) === 'active'
  const handedIn = finalTrade(entry, input.turnins) !== undefined
  return {
    id: entry.id, name: entry.name,
    state: completed ? 'completed' : ready ? 'ready' : active ? 'active' : 'unknown',
    stateLabel: completed ? 'Completed' : ready ? 'Ready based on inventory evidence' :
      manual.status === 'active' ? 'Active · marked by you' : handedIn ? 'Turn-in recorded · outcome unknown' : taskLabel(observed),
    tracked: manual.tracked === true, minLevel: entry.minLevel, startZone: entry.startZone,
    recommendation: recommend(entry, input.context), rewardNames: entry.rewards.map((reward) => reward.name),
    hasGuide: Boolean(entry.guide)
  }
}

function isCompleted(input: JournalModelInput, entry: QuestJournalCatalogEntry): boolean {
  const status = manualFor(input, entry.id).status
  if (status !== undefined) return status === 'completed'
  const task = matchObserved(entry, input.observed)
  if (task) return taskState(task) === 'completed'
  return achievementCompletion(entry, input.claims) ||
    input.completedSky.has(entry.id)
}

function taskState(task: QuestJournalObservedTask | undefined): QuestJournalRow['state'] {
  if (!task) return 'unknown'
  const status = task.cycleStatus ?? task.lastChange
  if (status === 'completed') return 'completed'
  if (status === 'removed' || status === 'failed') return 'unknown'
  return 'active'
}

function taskLabel(task: QuestJournalObservedTask | undefined): string {
  if (!task) return 'Progress unknown'
  const status = task.cycleStatus ?? task.lastChange
  if (status === 'completed') return 'Completion recorded in log'
  if (status === 'removed') return 'Removed in log'
  if (status === 'failed') return 'Failed in log'
  return 'Task activity recorded'
}

function taskRow(input: JournalModelInput, task: QuestJournalObservedTask): QuestJournalRow {
  const id = observedTaskId(task.name)
  const manual = manualFor(input, id)
  return {
    id, name: task.name, state: manual.status ?? taskState(task),
    stateLabel: manual.status ? `${manual.status === 'completed' ? 'Completed' : 'Active'} · marked by you` : taskLabel(task),
    tracked: manual.tracked === true,
    recommendation: { fit: 'unknown', reasons: ['No matching quest guide is available for this observed task.'] },
    rewardNames: [], hasGuide: false
  }
}

interface Candidate { row: QuestJournalRow; entry?: QuestJournalCatalogEntry }

function candidates(input: JournalModelInput): Candidate[] {
  const names = new Set(input.catalog.map((entry) => nameKey(entry.name)))
  const rows: Candidate[] = input.catalog.map((entry) => ({ row: catalogRow(input, entry), entry }))
  for (const task of input.observed) {
    if (!names.has(nameKey(task.name))) rows.push({ row: taskRow(input, task) })
  }
  // Keep user statements for observed-only tasks even when the log is replaced or truncated.
  const ids = new Set(rows.map((candidate) => candidate.row.id))
  for (const id of Object.keys(input.progress.quests)) {
    if (!id.startsWith('task:') || ids.has(id)) continue
    const row = taskRow(input, { name: id.slice(5) })
    if (manualFor(input, id).status === undefined) {
      row.state = 'unknown'
      row.stateLabel = 'Progress unknown'
    }
    rows.push({ row })
  }
  return rows
}

function matches(candidate: Candidate, query: QuestJournalQuery): boolean {
  const { row, entry } = candidate
  if (query.state === 'tracked' && !row.tracked) return false
  if (query.state && !['all', 'tracked'].includes(query.state) && row.state !== query.state) return false
  if (!matchesLevel(row, query.level)) return false
  if (query.zone && !matchesZone(entry, query.zone)) return false
  if (!matchesClass(entry, query.className ?? '')) return false
  return !query.search || nameKey(searchText(candidate)).includes(nameKey(query.search))
}

function matchesLevel(row: QuestJournalRow, level: number | undefined): boolean {
  return level === undefined || row.minLevel === undefined || row.minLevel <= level
}

function matchesZone(entry: QuestJournalCatalogEntry | undefined, zone: string): boolean {
  if (!entry) return false
  return [entry.startZone ?? '', ...entry.relatedZones].some((z) => nameKey(z) === nameKey(zone))
}

function matchesClass(entry: QuestJournalCatalogEntry | undefined, className: string): boolean {
  const desired = normalizedClass(className)
  if (desired && entry?.classes.length && entry.classes.every((c) => normalizedClass(c)) &&
    !allowsClass(entry.classes, [desired])) return false
  return true
}

function searchText({ row, entry }: Candidate): string {
  if (!entry) return row.name
  return [row.name, entry.giver, entry.startZone, ...entry.relatedZones,
    ...row.rewardNames, ...entry.referencedItems.map((item) => item.name)].join(' ')
}

function rowRank(row: QuestJournalRow): number {
  if (row.state === 'completed') return 8
  if (row.state === 'ready') return 0
  if (row.tracked) return 1
  if (row.state === 'active') return 2
  if (row.recommendation.fit === 'suitable') return 3
  if (row.recommendation.fit === 'unknown') return 4
  if (row.recommendation.fit === 'later') return 5
  return 6
}

export function queryJournal(input: JournalModelInput, raw: unknown): QuestJournalQueryResult {
  const query = sanitizeQuery(raw)
  const rows = candidates(input).filter((candidate) => matches(candidate, query)).map((candidate) => candidate.row)
  rows.sort((a, b) => (query.sort === 'name' ? 0 : rowRank(a) - rowRank(b)) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
  const zones = [...new Set(input.catalog.flatMap((entry) => [entry.startZone, ...entry.relatedZones]).filter((z): z is string => Boolean(z)))].sort()
  const classes = [...new Set(input.catalog.flatMap((entry) => entry.classes).flatMap((c) => normalizedClass(c) ?? []))].sort()
  return { context: input.context, rows: rows.slice(query.offset, query.offset + query.limit),
    total: rows.length, offset: query.offset, limit: query.limit, zones, classes }
}

function evidenceFor(input: JournalModelInput, entry: QuestJournalCatalogEntry | undefined, id: string): string[] {
  const manual = manualFor(input, id)
  const evidence: string[] = []
  if (manual.status) evidence.push(`You marked this quest ${manual.status}.`)
  if (entry && achievementCompletion(entry, input.claims)) evidence.push('The character’s achievements export records an earned quest reward; bypass class grants are excluded.')
  if (entry && finalTrade(entry, input.turnins)) evidence.push('The log records the exact final items handed to the named NPC. A closed trade alone does not confirm the quest reward or success.')
  if (input.completedSky.has(id)) evidence.push('Completion was recorded in this character’s Plane of Sky journal.')
  evidence.push('Task history includes only events present in this log. Absence of a completion line is not proof a quest is unfinished.')
  evidence.push('Collected items and owned rewards never mark a quest accepted or completed.')
  return evidence
}

export function detailJournal(input: JournalModelInput, id: string): QuestJournalDetailResult {
  const entry = input.catalog.find((candidate) => candidate.id === id)
  const observed = entry ? matchObserved(entry, input.observed) : input.observed.find((task) => observedTaskId(task.name) === id)
  const manual = manualFor(input, id)
  const row = entry ? catalogRow(input, entry) : candidates(input).find((candidate) => candidate.row.id === id)?.row ?? null
  return { context: input.context, row, entry, observed, manual,
    steps: entry ? detailSteps(input, entry, manual) : [],
    evidence: evidenceFor(input, entry, id), comparisons: entry ? compareRewards(entry, input.worn, input.context) : [],
    nextStep: nextStep(input, entry, row), inventoryRefreshSuggested: input.context.inventory.state !== 'available' || input.context.inventory.refreshSuggested === true }
}

function detailSteps(input: JournalModelInput, entry: QuestJournalCatalogEntry, manual: QuestJournalManual): QuestJournalDetailResult['steps'] {
  const steps = stepProgress(entry, manual, input.inventory)
  if (!finalTrade(entry, input.turnins)) return steps
  return steps.map((step, index) => {
    const kind = entry.guide?.steps[index].kind
    if (kind === 'turn-in' || kind === 'collect') return { ...step, complete: true, source: 'log' }
    return step
  })
}

function nextStep(input: JournalModelInput, entry: QuestJournalCatalogEntry | undefined, row: QuestJournalRow | null): string | undefined {
  if (row?.state === 'completed') return 'Completion recorded. You can keep this quest tracked for a repeat run.'
  if (!entry) return undefined
  const steps = entry.guide?.steps
  if (!steps) return entry.giver ? `Speak to ${entry.giver} and consult the linked quest source.` : undefined
  if (row?.state === 'ready') return steps[steps.length - 1]?.text
  return guidedNextStep(input, entry, row)
}

function guidedNextStep(input: JournalModelInput, entry: QuestJournalCatalogEntry, row: QuestJournalRow | null): string | undefined {
  if (finalTrade(entry, input.turnins)) return 'Hand-in recorded. Check the NPC response and reward; the outcome is not confirmed by this trade alone.'
  const steps = entry.guide?.steps ?? []
  if (row?.state === 'unknown') return steps.find((step) => step.kind === 'pickup')?.text
  const progress = stepProgress(entry, manualFor(input, entry.id), input.inventory)
  return steps.find((step, i) => step.kind !== 'pickup' && !progress[i].complete)?.text
}
