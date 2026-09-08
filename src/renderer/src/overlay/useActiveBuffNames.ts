import { useEffect, useState } from 'react'
import type { ActiveBuffNames, ActiveBuffObservation } from '../../../shared/activeBuffs'
import { activeBuffIds } from '../../../shared/activeBuffs'
import { MODULE_WORLD_CHANGED } from '../../../shared/types'

const NO_NAMES: ActiveBuffNames = {}

/** Timer refreshes do not read the spell table. Missing names recover with quiet bounded retries. */
export function useActiveBuffNames(observation: ActiveBuffObservation | null): ActiveBuffNames {
  const [world, setWorld] = useState(0)
  const [held, setHeld] = useState<{ key: string; names: ActiveBuffNames }>({ key: '', names: NO_NAMES })
  const ids = activeBuffIds(observation).join(',')
  const name = observation?.characterName ?? ''
  const key = JSON.stringify([world, name, ids])
  useEffect(() => {
    const clear = (): void => { setWorld((value) => value + 1) }
    const offCharacter = window.eqOverlay.onCharacter(clear)
    const offWorld = window.eqOverlay.onModuleChanged((change) => { if (change.moduleId === MODULE_WORLD_CHANGED) clear() })
    return () => { offCharacter(); offWorld() }
  }, [])
  useEffect(() => {
    let cancelled = false
    if (!name || !ids) return
    let timer: ReturnType<typeof setTimeout> | undefined
    let delay = 5_000
    let names: ActiveBuffNames = {}
    const wanted = ids.split(',').map(Number)
    const read = async (): Promise<void> => {
      const missing = wanted.filter((id) => !names[id])
      try {
        const result = await window.eqOverlay.getActiveBuffNames({ characterName: name, spellIds: missing })
        if (cancelled) return
        names = { ...names, ...result }
        setHeld({ key, names })
      } catch { /* Keep detected effects visible while metadata is temporarily unavailable. */ }
      if (cancelled || wanted.every((id) => names[id])) return
      timer = setTimeout(() => { void read() }, delay)
      delay = Math.min(delay * 2, 30_000)
    }
    void read()
    return () => { cancelled = true; if (timer !== undefined) clearTimeout(timer) }
  }, [key, name, ids])
  return held.key === key ? held.names : NO_NAMES
}
