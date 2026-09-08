import { ipcMain } from 'electron'
import { IPC } from '../../shared/ipc'
import { effectiveEqRoot } from '../log/config'
import { getActiveCharacter } from '../session'
import { engineWorldToken } from '../dataServer/engineClientHost'
import { createMacroSpellLoader } from '../macros/spellLoader'
import { createActiveBuffMetadata } from '../activeBuffs/metadata'

export function registerActiveBuffsIpc(): void {
  const query = createActiveBuffMetadata({
    scope: () => {
      const character = getActiveCharacter()
      return { root: effectiveEqRoot(), characterName: character?.name, characterPath: character?.logPath, token: engineWorldToken() }
    },
    spells: createMacroSpellLoader()
  })
  ipcMain.handle(IPC.activeBuffNames, (_event, request: unknown) => query(request))
}
