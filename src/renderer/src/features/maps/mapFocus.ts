import type { JumpTarget } from './crossZone'

/** A source-backed map destination carried through the app's ordinary origin/back router. */
export interface MapFocus extends JumpTarget {
  label: string
  source?: 'quest' | 'gear'
}
