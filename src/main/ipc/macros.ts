import { app, ipcMain } from 'electron'
import { join } from 'node:path'
import { IPC } from '../../shared/ipc'
import { getActiveCharacter, activeCharId } from '../session'
import { effectiveEqRoot } from '../log/config'
import { engineWorldToken } from '../dataServer/engineClientHost'
import { readActivePlayer } from '../playerLocation/active'
import { createMacroService } from '../macros/service'
import { createMacroRepository } from '../macros/repository'
import { createMacroSpellLoader } from '../macros/spellLoader'
import { logError } from '../errorLog'

export function registerMacrosIpc(): void {
  const folder = join(app.getPath('userData'), 'macro-assistant')
  const service = createMacroService({
    world: () => {
      const character = getActiveCharacter()
      return { character, characterId: character ? activeCharId() : null, root: effectiveEqRoot(), token: engineWorldToken() }
    },
    livePlayer: readActivePlayer, spells: createMacroSpellLoader(),
    repository: createMacroRepository(join(folder, 'characters')), backupDir: join(folder, 'backups'), now: Date.now
  })
  let stopped = false
  let ticking = false
  const tick = async (): Promise<void> => {
    if (stopped || ticking) return
    ticking = true
    try { await service.tick() } catch (error) { logError('macros:background', error) } finally { ticking = false }
  }
  const timer = setInterval(() => { void tick() }, 5000)
  timer.unref()
  app.once('before-quit', () => { stopped = true; clearInterval(timer) })
  void tick()
  ipcMain.handle(IPC.macroAssistantQuery, () => service.query())
  ipcMain.handle(IPC.macroAssistantMutate, (_event, mutation: unknown) => service.mutate(mutation))
}
