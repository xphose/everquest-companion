import type { LogEventBase } from './logEvents'

export type TaskChange = 'assigned' | 'updated' | 'completed' | 'removed' | 'failed'

/** A task statement: removal and failure remain distinct from a recorded completion. */
export interface TaskActivityEvent extends LogEventBase {
  kind: 'taskActivity'
  name: string
  change: TaskChange
}

export interface TaskActivityRow {
  name: string
  assignedAt?: number
  updatedAt?: number
  completedAt?: number
  removedAt?: number
  failedAt?: number
  lastChange: TaskChange
  lastObservedAt: number
  cycleStatus: 'observed' | 'assigned' | 'completed' | 'removed' | 'failed'
}

/** The `tasks` engine module's state, scoped to the attached character epoch. */
export interface TasksState {
  v: 1
  tasks: TaskActivityRow[]
  truncated: boolean
}
