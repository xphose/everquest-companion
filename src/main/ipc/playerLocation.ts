import { ipcMain } from 'electron'
import { IPC } from '../../shared/ipc'
import { readActivePlayer } from '../playerLocation/active'

export function registerPlayerLocationIpc(): void {
  ipcMain.handle(IPC.mapsPlayerLocation, readActivePlayer)
}
