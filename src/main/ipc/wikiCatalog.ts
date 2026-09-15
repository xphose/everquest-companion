import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { IPC } from '../../shared/ipc'
import { getMainWindow, getOverlayWindow } from '../windows'
import { getWikiRefreshStatus, refreshWikiCatalog, getWikiCatalogRendererData } from '../wikiRefresh/service'

function assertSender(event: IpcMainInvokeEvent, adventure = false): void {
  const windows = adventure ? [getMainWindow(), getOverlayWindow('adventure')] : [getMainWindow()]
  if (event.senderFrame !== event.sender.mainFrame || !windows.some(window =>
    window && !window.isDestroyed() && window.webContents === event.sender)) {
    throw new Error('Unsupported game data caller.')
  }
}

export function registerWikiCatalogIpc(): void {
  ipcMain.handle(IPC.wikiCatalogStatus, event => { assertSender(event); return getWikiRefreshStatus() })
  ipcMain.handle(IPC.wikiCatalogRefresh, event => { assertSender(event); return refreshWikiCatalog() })
  ipcMain.handle(IPC.wikiCatalogData, event => { assertSender(event, true); return getWikiCatalogRendererData() })
}
