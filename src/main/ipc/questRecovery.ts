import { ipcMain } from 'electron'
import { IPC } from '../../shared/ipc'
import type { RecoveryCapture, RecoveryCommitResult, RecoveryScanRequest, RecoveryScanResult } from '../../shared/questJournal/recovery'
import { sameJournalWorld, type JournalServiceDeps } from '../questJournal/service'
import { record, safeId } from '../questJournal/validate'
import { captureJournal } from '../questJournal/recovery/capture'

interface RecoveryMethods {
  scan: (request: RecoveryScanRequest, capture?: RecoveryCapture) => Promise<RecoveryScanResult>
  commit: (request: unknown) => Promise<RecoveryCommitResult>
}

function scanRequest(raw: unknown): RecoveryScanRequest | null {
  const request = record(raw)
  if (!request || !safeId(request.characterId) || request.characterId === 'none') return null
  if (!['files', 'game-window', 'clipboard', 'image-file'].includes(String(request.source))) return null
  return { characterId: request.characterId, source: request.source as RecoveryScanRequest['source'] }
}

export function registerQuestRecoveryIpc(deps: JournalServiceDeps, recovery: RecoveryMethods): void {
  let scanning = false
  ipcMain.handle(IPC.questJournalRecoverScan, async (_event, raw: unknown): Promise<RecoveryScanResult> => {
    const request = scanRequest(raw)
    if (!request) return { ok: false, error: 'Invalid recovery request.' }
    if (scanning) return { ok: false, error: 'A recovery scan is already running. Wait for it to finish.' }
    const before = deps.world()
    if (!before.characterId || before.characterId !== request.characterId) return { ok: false, error: 'The active character changed. Reopen recovery.' }
    scanning = true
    try {
      const capture = request.source === 'files' ? undefined : await captureJournal(request.source)
      if (!sameJournalWorld(before, deps.world())) return { ok: false, error: 'The character or engine changed during the scan. Reopen recovery.' }
      if (capture === null) return { ok: false, cancelled: true, error: 'Screenshot selection cancelled.' }
      return await recovery.scan(request, capture)
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Unable to read recovery evidence.' }
    } finally { scanning = false }
  })
  ipcMain.handle(IPC.questJournalRecoverCommit, (_event, raw: unknown) => recovery.commit(raw))
}
