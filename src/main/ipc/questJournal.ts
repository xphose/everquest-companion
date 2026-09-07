import { ipcMain } from 'electron'
import { IPC } from '../../shared/ipc'
import { activeCharId, getActiveCharacter } from '../session'
import { engineRequest, engineServeReadiness, engineWorldToken } from '../dataServer/engineClientHost'
import { effectiveEqRoot } from '../log/config'
import { getProgress, setProgress } from '../store'
import { getQuestJournalCatalog } from '../questJournal/catalog'
import { journalFiles } from '../questJournal/files'
import { createQuestJournalService, type JournalWorld, type JournalServiceDeps } from '../questJournal/service'
import { createRecoveryService } from '../questJournal/recovery/service'
import { installJournalImageReader } from '../questJournal/recovery/ocr'
import { registerQuestRecoveryIpc } from './questRecovery'
import { record, safeId } from '../questJournal/validate'
import { journalSnapshots } from '../questJournal/snapshotCache'
import type { ItemDbFile } from '../itemsDb'
import itemsJson from '../data/items.json'

function world(): JournalWorld {
  const character = getActiveCharacter()
  const readiness = engineServeReadiness()
  return {
    character, characterId: character ? activeCharId() : null, token: engineWorldToken(),
    readiness: readiness.ok ? 'ready' : readiness.why === 'notLive' ? 'loading' : 'unavailable'
  }
}

const journalDeps: JournalServiceDeps = {
  world, catalog: getQuestJournalCatalog, now: Date.now, getProgress, setProgress,
  files: (character) => journalFiles(effectiveEqRoot(), character, itemsJson as unknown as ItemDbFile),
  snapshot: (module) => journalSnapshots.read(module, engineWorldToken(), async () => {
    const result = await engineRequest('module.snapshot', { module })
    if (result.module !== module) throw new Error('The engine answered for a different module.')
    return result.state
  }, engineWorldToken)
}
const journal = createQuestJournalService(journalDeps)
const recovery = createRecoveryService({ ...journalDeps, root: effectiveEqRoot })

export function registerQuestJournalIpc(): void {
  installJournalImageReader((pngBase64) => engineRequest('recovery.ocr', { pngBase64 }))
  registerQuestRecoveryIpc(journalDeps, recovery)
  ipcMain.handle(IPC.questJournalQuery, (_event, query: unknown) => journal.query(query))
  ipcMain.handle(IPC.questJournalDetail, (_event, request: unknown) => {
    const value = record(request)
    if (!value || !safeId(value.id) || !(value.characterId === null || safeId(value.characterId))) {
      throw new Error('Invalid journal request.')
    }
    return journal.detail({ id: value.id, characterId: value.characterId })
  })
  ipcMain.handle(IPC.questJournalMutate, (_event, mutation: unknown) => journal.mutate(mutation))
}
