import { useEffect, useState } from 'react'
import type { PlannerInventory } from '@shared/planner/inventorySlots'
import { NO_OWNERSHIP, type OwnershipPayload } from '@shared/planner/ownership'
import { gearProgressionSession, type GearCharacterReading } from './gearProgressionSession'

export interface GearInventoryReading { inventory: PlannerInventory | null; ownership: OwnershipPayload; ready: boolean; error: string | null }

/** One in-flight read, an invalidation generation, and a finite visible wait. No macro queue side effects. */
export function useGearProgressionCharacter(): GearCharacterReading {
  const [state, setState] = useState<GearCharacterReading>({ context: null, pending: true, error: null })
  useEffect(() => {
    const session = gearProgressionSession({ read: () => window.eq.gearProgressionContext(), publish: setState })
    const off = window.eq.onCharacter(session.invalidate)
    session.tick()
    const timer = window.setInterval(session.tick, 2_000)
    return () => { session.stop(); window.clearInterval(timer); off() }
  }, [])
  return state
}

/** Inventory is an export, so refresh on its existing watcher event rather than polling the file. */
export function useGearProgressionInventory(characterId: string | null): GearInventoryReading {
  const [state, setState] = useState<GearInventoryReading>({ inventory: null, ownership: NO_OWNERSHIP, ready: false, error: null })
  useEffect(() => {
    let alive = true
    let pending = false
    let again = false
    let generation = 0
    const read = async (): Promise<void> => {
      if (!alive || !characterId) return
      if (pending) { again = true; return }
      pending = true
      const own = generation
      try {
        const [inventory, ownership] = await Promise.all([window.eq.plannerInventory(), window.eq.gearOwnership()])
        if (alive && own === generation) setState({ inventory, ownership, ready: true, error: null })
      } catch {
        if (alive && own === generation) setState({ inventory: null, ownership: NO_OWNERSHIP, ready: true, error: 'Your inventory export could not be read.' })
      } finally {
        pending = false
        if (again && alive) { again = false; void read() }
      }
    }
    const offInventory = window.eq.onInventoryReload(() => { generation++; void read() })
    const offCharacter = window.eq.onCharacter(() => {
      alive = false
      generation++
      setState({ inventory: null, ownership: NO_OWNERSHIP, ready: false, error: null })
    })
    void read()
    return () => { alive = false; generation++; offInventory(); offCharacter() }
  }, [characterId])
  return state
}
