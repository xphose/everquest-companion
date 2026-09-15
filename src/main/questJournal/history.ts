import type { QuestJournalHistory, QuestJournalObservedTask } from '../../shared/questJournal/journal'
import { observedTaskId } from './identity'

const LIMIT = 5000
const TIMES = ['assignedAt', 'updatedAt', 'completedAt', 'removedAt', 'failedAt', 'lastObservedAt'] as const
const CHANGES = ['assigned', 'updated', 'completed', 'removed', 'failed'] as const
const STATUSES = ['observed', 'assigned', 'completed', 'removed', 'failed'] as const

function object(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const proto: unknown = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null ? value as Record<string, unknown> : undefined
}

function key(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 300 &&
    !['__proto__', 'constructor', 'prototype'].includes(value) && !/\p{Cc}/u.test(value)
}

export function eventTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 8640000000000000
}

export function lastTaskObservation(task: QuestJournalObservedTask | undefined): number {
  return task ? Math.max(...TIMES.map(field => task[field] ?? 0)) : 0
}

/** Persist only recognized fields and bounded event dates, never an arbitrary engine object. */
export function sanitizeTask(value: unknown): QuestJournalObservedTask | undefined {
  const row = object(value)
  if (!row || !taskName(row.name)) return undefined
  if (TIMES.some(field => row[field] !== undefined && !eventTime(row[field]))) return undefined
  const times = Object.fromEntries(TIMES.filter(field => row[field] !== undefined).map(field => [field, row[field]]))
  if (!Object.keys(times).length) return undefined
  const changes = taskChanges(row)
  return changes ? { name: row.name.trim(), ...times, ...changes } : undefined
}

function taskName(value: unknown): value is string {
  return key(value) && key(value.trim()) && key(observedTaskId(value))
}

function taskChanges(row: Record<string, unknown>): Partial<QuestJournalObservedTask> | undefined {
  const lastChange = CHANGES.find(change => change === row.lastChange)
  const cycleStatus = STATUSES.find(status => status === row.cycleStatus)
  if ((row.lastChange !== undefined && !lastChange) || (row.cycleStatus !== undefined && !cycleStatus)) return undefined
  if (!statusHasEvent(row, lastChange) || !statusHasEvent(row, cycleStatus)) return undefined
  return { ...(lastChange ? { lastChange } : {}), ...(cycleStatus ? { cycleStatus } : {}) }
}

function statusHasEvent(row: Record<string, unknown>, status: string | undefined): boolean {
  return status === undefined || status === 'observed' || eventTime(row[`${status}At`])
}

export function emptyHistory(): QuestJournalHistory {
  return { version: 1, tasks: {}, rewardedHandIns: {} }
}

function sanitizeTasks(value: unknown): QuestJournalHistory['tasks'] {
  const tasks: QuestJournalHistory['tasks'] = {}
  for (const [id, raw] of Object.entries(object(value) ?? {}).slice(0, LIMIT)) {
    const row = object(raw)
    const latest = sanitizeTask(row?.latest)
    if (!key(id) || !latest || id !== observedTaskId(latest.name)) continue
    const completedAt = eventTime(row?.completedAt) ? row.completedAt : latest.completedAt
    tasks[id] = { latest, ...(completedAt === undefined ? {} : { completedAt }) }
  }
  return tasks
}

function sanitizeHandIns(value: unknown): QuestJournalHistory['rewardedHandIns'] {
  const handIns: QuestJournalHistory['rewardedHandIns'] = {}
  for (const [id, raw] of Object.entries(object(value) ?? {}).slice(0, LIMIT)) {
    const row = object(raw)
    if (!key(id) || !eventTime(row?.completedAt) || !eventTime(row.experienceAt)) continue
    if (row.experienceAt > row.completedAt || row.completedAt - row.experienceAt > 5000) continue
    handIns[id] = { completedAt: row.completedAt, experienceAt: row.experienceAt }
  }
  return handIns
}

export function sanitizeHistory(value: unknown): QuestJournalHistory {
  const row = object(value)
  if (row?.version !== 1) return emptyHistory()
  return { version: 1, tasks: sanitizeTasks(row.tasks), rewardedHandIns: sanitizeHandIns(row.rewardedHandIns),
    ...(row.capacityReached === true ? { capacityReached: true } : {}) }
}

/** EQ dates have one-second precision. At equal instants the newest guarded snapshot
 * preserves the engine's log order, including a repeat assignment after completion. */
function latestTask(a: QuestJournalObservedTask, b: QuestJournalObservedTask): QuestJournalObservedTask {
  const difference = lastTaskObservation(b) - lastTaskObservation(a)
  if (difference !== 0) return difference > 0 ? b : a
  return { ...a, ...b }
}

export function mergeTaskHistory(history: QuestJournalHistory, tasks: QuestJournalObservedTask[]): void {
  let count = Object.keys(history.tasks).length
  for (const raw of tasks) {
    const task = sanitizeTask(raw)
    if (!task) continue
    const id = observedTaskId(task.name)
    const old = history.tasks[id]
    if (!old && count >= LIMIT) { history.capacityReached = true; continue }
    if (!old) count++
    const latest = old ? latestTask(old.latest, task) : task
    const completed = [old?.completedAt, task.completedAt].filter(eventTime)
    history.tasks[id] = { latest, ...(completed.length ? { completedAt: Math.max(...completed) } : {}) }
  }
}

export function mergeHandInHistory(history: QuestJournalHistory, entries: ReadonlyMap<string, { ts: number; experienceAt?: number }>): void {
  let count = Object.keys(history.rewardedHandIns).length
  for (const [id, trade] of entries) {
    if (!key(id) || !eventTime(trade.ts) || !eventTime(trade.experienceAt)) continue
    const old = history.rewardedHandIns[id]
    if (old && old.completedAt >= trade.ts) continue
    if (!old && count >= LIMIT) { history.capacityReached = true; continue }
    if (!old) count++
    history.rewardedHandIns[id] = { completedAt: trade.ts, experienceAt: trade.experienceAt }
  }
}

export function historyTasks(history: QuestJournalHistory): QuestJournalObservedTask[] {
  return Object.values(history.tasks).map(row => row.latest)
}
