// This renderer has map/journal reads and explicit journal corrections only. It must never
// import the full app bridge: install paths, macros and arbitrary settings are not its job.
import './overlay'
import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc'
import type { EqApi } from './index'
import type { AdventureShortcutState } from '../shared/adventureShortcut'

// The callback fixes each payload type; Electron's untyped event must not widen it to any.
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- typed IPC callbacks keep the payload boundary explicit
function on<T>(channel: string, cb: (value: T) => void): () => void {
  const listener = (_event: unknown, value: T): void => cb(value)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

type ReadApi = Pick<EqApi, 'getCharacter' | 'getModuleSnapshot' | 'onCharacter' | 'onModuleChanged'
  | 'onInventoryReload' | 'onProgress' | 'onAppBack' | 'listMapPacks' | 'listMapZones'
  | 'getMapData' | 'searchMapPoints' | 'getPlayerLocation' | 'questJournalQuery'
  | 'questJournalDetail' | 'questJournalMutate' | 'reportError'>

const api: ReadApi = {
  getCharacter: () => ipcRenderer.invoke(IPC.getCharacter),
  getModuleSnapshot: (id) => ipcRenderer.invoke(IPC.getModuleSnapshot, id),
  onCharacter: (cb) => on(IPC.onCharacter, cb),
  onModuleChanged: (cb) => on(IPC.onModuleChanged, cb),
  onInventoryReload: (cb) => on(IPC.onInventoryReload, cb),
  onProgress: (cb) => on(IPC.onProgress, cb),
  onAppBack: (cb) => on(IPC.onAppBack, cb),
  listMapPacks: () => ipcRenderer.invoke(IPC.mapsListPacks),
  listMapZones: (pack) => ipcRenderer.invoke(IPC.mapsListZones, pack),
  getMapData: (zone, prefs) => ipcRenderer.invoke(IPC.mapsGet, zone, prefs),
  searchMapPoints: (query, opts) => ipcRenderer.invoke(IPC.mapsSearch, query, opts),
  getPlayerLocation: () => ipcRenderer.invoke(IPC.mapsPlayerLocation),
  questJournalQuery: (query) => ipcRenderer.invoke(IPC.questJournalQuery, query),
  questJournalDetail: (request) => ipcRenderer.invoke(IPC.questJournalDetail, request),
  questJournalMutate: (request) => ipcRenderer.invoke(IPC.questJournalMutate, request),
  reportError: (error) => ipcRenderer.send(IPC.reportError, error)
}

const controls = {
  getAdventureShortcut: (): Promise<AdventureShortcutState> => ipcRenderer.invoke(IPC.adventureShortcutGet),
  setAdventureShortcut: (accelerator: string): Promise<AdventureShortcutState> =>
    ipcRenderer.invoke(IPC.adventureShortcutSet, accelerator)
}

export type AdventureControls = typeof controls
contextBridge.exposeInMainWorld('eq', api)
contextBridge.exposeInMainWorld('eqAdventure', controls)
