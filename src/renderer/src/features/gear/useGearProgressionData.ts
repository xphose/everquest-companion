import { useCallback, useEffect, useRef, useState } from 'react'
import { gearProgressionSession, type GearCharacterReading } from './gearProgressionSession'
import { EMPTY_GEAR_INVENTORY, gearInventorySession, type GearInventoryReading } from './gearInventorySession'
import { GEAR_CHARACTER_INTERVAL, GEAR_INVENTORY_INTERVAL, gearRefreshCadence } from './gearRefreshCadence'
import { gearCharacterIdentity as identity, readGearInventory } from './readGearInventory'

export type { GearInventoryReading } from './gearInventorySession'
interface RefreshControl { refresh: () => void }
export type GearCharacterControl = GearCharacterReading & RefreshControl & { checkedAt: number | null }

/** A fresh check is separate from changed character facts, so heartbeat checks never rescore. */
export function useGearProgressionCharacter(): GearCharacterControl {
  const [state, setState] = useState<GearCharacterReading>({ context: null, pending: true, error: null })
  const [checkedAt, setCheckedAt] = useState<number | null>(null)
  const current = useRef<RefreshControl | null>(null)
  const refresh = useCallback(() => current.current?.refresh(), [])
  useEffect(() => {
    const session = gearProgressionSession({ read: () => window.eq.gearProgressionContext(), publish: setState, checked: setCheckedAt })
    current.current = session
    const off = window.eq.onCharacter(character => session.invalidate(identity(character)))
    const stop = gearRefreshCadence({ ...session, interval: GEAR_CHARACTER_INTERVAL, window, document })
    return () => { current.current = null; stop(); session.stop(); off() }
  }, [])
  return { ...state, checkedAt, refresh }
}

/** Watcher first, with a backstop for missed events, failed reads and returning to the app. */
export function useGearProgressionInventory(characterId: string | null): GearInventoryReading & RefreshControl {
  const [state, setState] = useState<GearInventoryReading>(EMPTY_GEAR_INVENTORY)
  const current = useRef<RefreshControl | null>(null)
  const refresh = useCallback(() => current.current?.refresh(), [])
  useEffect(() => {
    if (!characterId) return
    const session = gearInventorySession({ read: () => readGearInventory(characterId, window.eq), publish: setState })
    current.current = session
    const offInventory = window.eq.onInventoryReload(session.invalidate)
    const offCharacter = window.eq.onCharacter(character => {
      if (identity(character) === characterId) session.invalidate()
      else { current.current = null; session.stop(); setState(EMPTY_GEAR_INVENTORY) }
    })
    const stop = gearRefreshCadence({ ...session, interval: GEAR_INVENTORY_INTERVAL, window, document })
    return () => { current.current = null; stop(); session.stop(); offInventory(); offCharacter() }
  }, [characterId])
  return { ...state, refresh }
}
