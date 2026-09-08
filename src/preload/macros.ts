import { ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc'
import type { MacroAssistantMutation, MacroAssistantMutationResult, MacroAssistantSnapshot } from '../shared/macroAssistant'

export const macroAssistantBridge = {
  getMacroAssistant: (): Promise<MacroAssistantSnapshot> => ipcRenderer.invoke(IPC.macroAssistantQuery),
  mutateMacroAssistant: (mutation: MacroAssistantMutation): Promise<MacroAssistantMutationResult> =>
    ipcRenderer.invoke(IPC.macroAssistantMutate, mutation)
}
