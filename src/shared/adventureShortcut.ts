/** Local keyboard preference; never included in a shared settings profile. */
export const DEFAULT_ADVENTURE_SHORTCUT = 'Ctrl+Shift+Space'

export interface AdventureShortcutState {
  accelerator: string
  registered: boolean
  error: string | null
}

const MODIFIERS = ['Ctrl', 'Alt', 'Shift', 'Super', 'CommandOrControl']
const KEY = /^(?:[A-Z0-9]|F(?:[1-9]|1[0-9]|2[0-4])|Space)$/

/** A small accelerator vocabulary keeps ordinary game typing out of global shortcuts. */
export function adventureAccelerator(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 64) return null
  const text = value.trim()
  if (!text) return ''
  const tokens = text.split('+').map((token) => token.trim())
  const key = tokens.pop() ?? ''
  if (!KEY.test(key) || !tokens.length || new Set(tokens).size !== tokens.length) return null
  if (tokens.some((token) => !MODIFIERS.includes(token))) return null
  if (!tokens.some((token) => token !== 'Shift')) return null
  if (tokens.includes('Ctrl') && tokens.includes('CommandOrControl')) return null
  return [...MODIFIERS.filter((token) => tokens.includes(token)), key].join('+')
}
