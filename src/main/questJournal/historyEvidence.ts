import type { QuestJournalHistory } from '../../shared/questJournal/journal'
import { observedTaskId } from './identity'
import { lastTaskObservation } from './history'
import { taskState } from './recovery/state'

export function savedHistoryEvidence(history: QuestJournalHistory | undefined, name: string | undefined, id: string): string[] {
  if (!history) return []
  const task = history.tasks[name ? observedTaskId(name) : id]
  const handIn = history.rewardedHandIns[id]
  const dates = [task?.completedAt, handIn?.completedAt].filter((at): at is number => at !== undefined)
  if (!dates.length && !task) return []
  const format = (at: number): string => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(at)
  if (!dates.length) return [`Task activity saved automatically on this computer; the latest event was ${format(lastTaskObservation(task?.latest))}.`]
  const at = Math.max(...dates)
  const previous = task && lastTaskObservation(task.latest) >= at && taskState(task.latest) !== 'completed'
    ? 'Previous completion' : 'Completion'
  return [`${previous} from ${format(at)} is saved automatically on this computer, even if the original log is replaced. A previous completion does not finish a newer repeat run.`]
}
