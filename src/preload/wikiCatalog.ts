import { ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc'
import type { WikiCatalogRendererData, WikiRefreshStatus } from '../shared/wikiCatalog'

export const wikiCatalogBridge = {
  getWikiCatalogStatus: (): Promise<WikiRefreshStatus> => ipcRenderer.invoke(IPC.wikiCatalogStatus),
  refreshWikiCatalog: (): Promise<WikiRefreshStatus> => ipcRenderer.invoke(IPC.wikiCatalogRefresh),
  getWikiCatalogRendererData: (): Promise<WikiCatalogRendererData> => ipcRenderer.invoke(IPC.wikiCatalogData)
}
