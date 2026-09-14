import { globalShortcut } from 'electron'
import {
  adventureAccelerator,
  DEFAULT_ADVENTURE_SHORTCUT,
  type AdventureShortcutState
} from '../shared/adventureShortcut'
import { adventureShortcutRegistration } from './adventureShortcutRegistration'
import { E2E } from './e2e'
import { settingsStore } from './store'
import { adventureOverlayShown, toggleAdventureOverlay } from './windows'

let syntheticTrigger: (() => void) | null = null
const probe = {
  registrationAvailable: true,
  trigger: (): boolean => {
    syntheticTrigger?.()
    return syntheticTrigger !== null
  },
  shown: adventureOverlayShown
}
const registration = adventureShortcutRegistration({
  register: (accelerator, trigger) => {
    if (!E2E) return globalShortcut.register(accelerator, trigger)
    syntheticTrigger = probe.registrationAvailable ? trigger : null
    return syntheticTrigger !== null
  },
  unregister: (accelerator) => {
    if (E2E) syntheticTrigger = null
    else globalShortcut.unregister(accelerator)
  },
  toggle: toggleAdventureOverlay
})

export function startAdventureShortcut(): void {
  if (E2E) Object.assign(globalThis, { __eqAdventureShortcut: probe })
  registration.update(
    adventureAccelerator(settingsStore.get('adventureShortcut')) ?? DEFAULT_ADVENTURE_SHORTCUT
  )
}

export const stopAdventureShortcut = registration.stop
export const getAdventureShortcut = registration.read

export function setAdventureShortcut(value: unknown): AdventureShortcutState {
  const accelerator = adventureAccelerator(value)
  const state = registration.update(value)
  if (accelerator !== null) settingsStore.set('adventureShortcut', accelerator)
  return state
}
