import { app, ipcMain } from 'electron'
import { IPC } from '../../shared/ipc'
import type { PlayerLocationResult } from '../../shared/playerLocation'
import { effectiveEqRoot } from '../log/config'
import { getActiveCharacter } from '../session'
import { engineWorldToken } from '../dataServer/engineClientHost'
import { createPlayerLocationReader } from '../playerLocation'

export function registerPlayerLocationIpc(): void {
  const reader = createPlayerLocationReader()
  app.once('before-quit', () => reader.close())
  ipcMain.handle(IPC.mapsPlayerLocation, async (): Promise<PlayerLocationResult> => {
    const root = effectiveEqRoot()
    const character = getActiveCharacter()
    const token = engineWorldToken()
    const result = await reader.read(root)
    if (root !== effectiveEqRoot() || character?.logPath !== getActiveCharacter()?.logPath || token !== engineWorldToken()) {
      return { state: 'unavailable', reason: 'Character changed. Refreshing location…' }
    }
    if (result.state === 'live' && character && result.location.characterName.toLowerCase() !== character.name.toLowerCase()) {
      return { state: 'unavailable', reason: 'Select the character currently playing to show its location.' }
    }
    return result
  })
}
