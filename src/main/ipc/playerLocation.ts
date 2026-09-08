import { ipcMain } from 'electron'
import { IPC } from '../../shared/ipc'
import { registerActiveBuffsIpc } from './activeBuffs'
import { readActivePlayer } from '../playerLocation/active'

export function registerPlayerLocationIpc(): void {
  ipcMain.handle(IPC.mapsPlayerLocation, readActivePlayer)
  registerActiveBuffsIpc()
}
