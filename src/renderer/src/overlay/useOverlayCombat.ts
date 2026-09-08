import { useEffect, useState } from 'react'
import type { CombatSnapshot, SnapshotOpts } from '@shared/combat'
import { MODULE_WORLD_CHANGED, type ModuleChanged } from '../../../shared/types'
import { OverlaySnapshotReader } from './overlaySnapshotReader'

interface OverlayCombatBridge {
  getCombatSnapshot(options: SnapshotOpts): Promise<CombatSnapshot>
  onCombatActivity(callback: () => void): () => void
  onModuleChanged(callback: (change: ModuleChanged) => void): () => void
  onCharacter(callback: () => void): () => void
}

export function observeOverlayCombat(bridge: OverlayCombatBridge, selectedId: string | undefined,
  receive: (snapshot: CombatSnapshot | null) => void): () => void {
  const reader = new OverlaySnapshotReader<CombatSnapshot>({
    read: async () => ({ state: await bridge.getCombatSnapshot({ selectedId, maxSegments: 30 }) }), receive
  })
  const offActivity = bridge.onCombatActivity(() => reader.request())
  const offWorld = bridge.onModuleChanged((change) => { if (change.moduleId === MODULE_WORLD_CHANGED) reader.reset() })
  const offCharacter = bridge.onCharacter(() => reader.reset())
  const timer = setInterval(() => reader.request(), 1000)
  reader.reset()
  return () => { reader.dispose(); offActivity(); offWorld(); offCharacter(); clearInterval(timer) }
}

/** Throttled live nudges plus a one-second idle-decay poll, through one bounded reader.
 * Character/world changes discard old replies without changing the selected historical segment. */
export function useOverlayCombat(selectedId: string | undefined): CombatSnapshot | null {
  const [held, setHeld] = useState<{ selectedId: string | undefined; snapshot: CombatSnapshot | null }>({ selectedId, snapshot: null })
  useEffect(() => observeOverlayCombat(window.eqOverlay, selectedId, (snapshot) => setHeld({ selectedId, snapshot })), [selectedId])
  return held.selectedId === selectedId ? held.snapshot : null
}
