import type { QuestJournalManual, QuestJournalObservedTask, QuestJournalState } from '../../../shared/questJournal/journal'
import type { RecoveryRecord } from '../../../shared/questJournal/recovery'

export function taskState(task: QuestJournalObservedTask | undefined): QuestJournalState {
  if (!task) return 'unknown'
  const status = task.cycleStatus ?? task.lastChange
  if (status === 'completed') return 'completed'
  return status === 'removed' || status === 'failed' ? 'unknown' : 'active'
}

function latest(task: QuestJournalObservedTask): number {
  return task.lastObservedAt ?? Math.max(task.assignedAt ?? 0, task.updatedAt ?? 0,
    task.completedAt ?? 0, task.removedAt ?? 0, task.failedAt ?? 0)
}

/** Historical completions cannot close a repeat task which the log still records as active.
 * A current-task capture is a baseline as of recovery; subsequent observed events supersede it. */
export function usesRecovery(task: QuestJournalObservedTask | undefined, recovery: RecoveryRecord | undefined): recovery is RecoveryRecord {
  if (!recovery) return false
  if (!task) return true
  if (latest(task) >= recovery.recoveredAt) return false
  const historical = recovery.source === 'history-window' || recovery.source === 'achievement'
  return !(historical && recovery.state === 'completed' && taskState(task) === 'active')
}

export function recoveredState(manual: QuestJournalManual, task: QuestJournalObservedTask | undefined,
  recovery: RecoveryRecord | undefined): QuestJournalState {
  return manual.status ?? (usesRecovery(task, recovery) ? recovery.state : taskState(task))
}

export function recoveredLabel(recovery: RecoveryRecord): string {
  const state = recovery.state === 'completed' ? 'Completed' : 'Active'
  return `${state} · ${recovery.confidence === 'user-confirmed' ? 'confirmed by you from recovery' : 'recovered evidence'}`
}
