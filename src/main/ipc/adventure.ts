import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { IPC } from '../../shared/ipc'
import { getAdventureShortcut, setAdventureShortcut } from '../adventureShortcut'
import { getMainWindow, getOverlayWindow } from '../windows'

/** The shortcut is available only to the main page and its dedicated Adventure window. */
function assertAdventureSender(event: IpcMainInvokeEvent): void {
  const allowed = [getMainWindow(), getOverlayWindow('adventure')].some(
    (window) => window && !window.isDestroyed() && window.webContents === event.sender
  )
  if (!allowed || event.senderFrame !== event.sender.mainFrame)
    throw new Error('Unsupported shortcut caller.')
}

export function registerAdventureIpc(): void {
  ipcMain.handle(IPC.adventureShortcutGet, (event) => {
    assertAdventureSender(event)
    return getAdventureShortcut()
  })
  ipcMain.handle(IPC.adventureShortcutSet, (event, value: unknown) => {
    assertAdventureSender(event)
    return setAdventureShortcut(value)
  })
}
