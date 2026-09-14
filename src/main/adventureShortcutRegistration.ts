import { adventureAccelerator, type AdventureShortcutState } from '../shared/adventureShortcut'

interface ShortcutDeps {
  register: (accelerator: string, trigger: () => void) => boolean
  unregister: (accelerator: string) => void
  toggle: () => void
}

/** Own exactly one registration. Failed or disabled shortcuts never pretend to be active. */
export function adventureShortcutRegistration(deps: ShortcutDeps) {
  let state: AdventureShortcutState = {
    accelerator: '',
    registered: false,
    error: null
  }
  const stop = (): void => {
    if (state.registered) deps.unregister(state.accelerator)
    state = { ...state, registered: false }
  }
  const update = (value: unknown): AdventureShortcutState => {
    const accelerator = adventureAccelerator(value)
    if (accelerator === null)
      return {
        ...state,
        error:
          'Use Ctrl, Alt, Super, or CommandOrControl with a letter, number, F key, or Space. Shift is optional.'
      }
    if (accelerator === state.accelerator && state.registered) return { ...state }
    stop()
    let registered = false
    try {
      registered = !!accelerator && deps.register(accelerator, deps.toggle)
    } catch {
      /* Collision or OS refusal. */
    }
    state = {
      accelerator,
      registered,
      error:
        accelerator && !registered
          ? 'That shortcut could not be registered. Choose another combination.'
          : null
    }
    return { ...state }
  }
  return { update, stop, read: (): AdventureShortcutState => ({ ...state }) }
}
