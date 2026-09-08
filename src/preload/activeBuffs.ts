import { ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc'
import type { ActiveBuffNameRequest, ActiveBuffNames } from '../shared/activeBuffs'

export const activeBuffsBridge = {
  getActiveBuffNames: (request: ActiveBuffNameRequest): Promise<ActiveBuffNames> => ipcRenderer.invoke(IPC.activeBuffNames, request)
}
