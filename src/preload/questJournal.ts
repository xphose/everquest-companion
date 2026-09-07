import { ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc'
import type { ProgressState } from '../shared/types'
import type { RecoveryScanRequest, RecoveryScanResult, RecoveryCommitRequest, RecoveryCommitResult } from '../shared/questJournal/recovery'
import type {
  QuestJournalDetailRequest, QuestJournalDetailResult, QuestJournalMutation,
  QuestJournalMutationResult, QuestJournalQuery, QuestJournalQueryResult
} from '../shared/questJournal/journal'

export const questJournalBridge = {
  questJournalRecoverScan: (request: RecoveryScanRequest): Promise<RecoveryScanResult> =>
    ipcRenderer.invoke(IPC.questJournalRecoverScan, request),
  questJournalRecoverCommit: (request: RecoveryCommitRequest): Promise<RecoveryCommitResult> =>
    ipcRenderer.invoke(IPC.questJournalRecoverCommit, request),
  // The existing Sky and inventory surfaces share these progress reads and notifications.
  getProgress: (): Promise<ProgressState> => ipcRenderer.invoke(IPC.getProgress),
  onProgress: (cb: (progress: ProgressState) => void): (() => void) => {
    const listener = (_event: unknown, progress: ProgressState): void => cb(progress)
    ipcRenderer.on(IPC.onProgress, listener)
    return () => ipcRenderer.removeListener(IPC.onProgress, listener)
  },
  questJournalQuery: (query: QuestJournalQuery): Promise<QuestJournalQueryResult> =>
    ipcRenderer.invoke(IPC.questJournalQuery, query),
  questJournalDetail: (request: QuestJournalDetailRequest): Promise<QuestJournalDetailResult> =>
    ipcRenderer.invoke(IPC.questJournalDetail, request),
  questJournalMutate: (mutation: QuestJournalMutation): Promise<QuestJournalMutationResult> =>
    ipcRenderer.invoke(IPC.questJournalMutate, mutation)
}
