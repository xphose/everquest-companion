import { useEffect, useState } from 'react'
import type { ModuleChanged, ModuleSnapshot } from '../../../shared/types'
import { MODULE_WORLD_CHANGED } from '../../../shared/types'
import { OverlaySnapshotReader } from './overlaySnapshotReader'

interface OverlayModuleBridge<S> {
  getModuleSnapshot(id: string): Promise<ModuleSnapshot<S> | null>
  onModuleChanged(callback: (change: ModuleChanged) => void): () => void
  onCharacter(callback: () => void): () => void
}

/** Subscribe before reading. A world reset clears held rows and invalidates older replies;
 * ordinary cursors retain the buff overlay's drop-flash distinction from rebuilds. */
export function observeOverlayModule<S>(bridge: OverlayModuleBridge<S>, id: string,
  receive: (state: S | null, rebuilt: boolean) => void): () => void {
  const reader = new OverlaySnapshotReader({ read: () => bridge.getModuleSnapshot(id), receive })
  const offChanged = bridge.onModuleChanged((change) => {
    if (change.moduleId === MODULE_WORLD_CHANGED) reader.reset()
    else if (change.moduleId === id) reader.request(change.seq)
  })
  const offCharacter = bridge.onCharacter(() => reader.reset())
  reader.reset()
  return () => { reader.dispose(); offChanged(); offCharacter() }
}

/** Empty while unavailable. Hydrations suppress false buff-drop flashes on reset/recovery,
 * and deliberately stay unchanged for ordinary live updates. */
export function useOverlayModuleState<S>(moduleId: string, empty: S): { state: S; hydrations: number } {
  const [held, setHeld] = useState({ id: moduleId, state: empty, hydrations: 0 })
  useEffect(() => observeOverlayModule<S>(window.eqOverlay, moduleId, (state, rebuilt) => {
    setHeld((previous) => ({ id: moduleId, state: state ?? empty, hydrations: previous.hydrations + (rebuilt ? 1 : 0) }))
  }), [moduleId, empty])
  return held.id === moduleId ? held : { state: empty, hydrations: held.hydrations }
}

export function useOverlayModule<S>(moduleId: string, empty: S): S {
  return useOverlayModuleState(moduleId, empty).state
}
