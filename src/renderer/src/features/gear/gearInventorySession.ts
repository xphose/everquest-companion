import type { PlannerInventory } from '@shared/planner/inventorySlots'
import { NO_OWNERSHIP, type OwnershipPayload } from '../../../../shared/planner/ownership'

export interface GearInventoryReading {
  inventory: PlannerInventory | null
  ownership: OwnershipPayload
  ready: boolean
  error: string | null
  checkedAt: number | null
}
export const EMPTY_GEAR_INVENTORY: GearInventoryReading = {
  inventory: null, ownership: NO_OWNERSHIP, ready: false, error: null, checkedAt: null
}
interface InventoryDeps {
  read: () => Promise<[PlannerInventory | null, OwnershipPayload]>
  publish: (state: GearInventoryReading) => void
  now?: () => number
}
function unchanged<T>(previous: T, next: T): T {
  return JSON.stringify(previous) === JSON.stringify(next) ? previous : next
}

/** Keep semantic references across fresh checks, including an export with only a new file date. */
function retainFacts(previous: GearInventoryReading, inventory: PlannerInventory | null, ownership: OwnershipPayload): Pick<GearInventoryReading, 'inventory' | 'ownership'> {
  const retained = inventory && previous.inventory ? unchanged(previous.inventory, {
    ...inventory, hosts: unchanged(previous.inventory.hosts, inventory.hosts), focus: unchanged(previous.inventory.focus, inventory.focus)
  }) : inventory
  return { inventory: retained, ownership: unchanged(previous.ownership, { ...ownership, entries: unchanged(previous.ownership.entries, ownership.entries) }) }
}

/** One file-read pair at a time. Watcher bursts invalidate its answer and request one follow-up. */
export function gearInventorySession(deps: InventoryDeps): { tick: () => void; refresh: () => void; invalidate: () => void; stop: () => void } {
  let alive = true
  let pending = false
  let again = false
  let generation = 0
  let state = EMPTY_GEAR_INVENTORY
  const tick = (): void => {
    if (!alive || pending) return
    pending = true
    const own = generation
    void deps.read().then(([inventory, ownership]) => {
      if (!alive || own !== generation) return
      if ((inventory?.path ?? null) !== ownership.path || (inventory?.loadedAt ?? null) !== ownership.loadedAt) throw new Error('Export changed during reading')
      state = { ...retainFacts(state, inventory, ownership), ready: true, error: null, checkedAt: (deps.now ?? Date.now)() }
      deps.publish(state)
    }).catch(() => {
      if (!alive || own !== generation) return
      state = { ...state, ready: true, error: 'Your inventory export could not be read. Retrying automatically every 30 seconds.' }
      deps.publish(state)
    }).finally(() => {
      pending = false
      if (again && alive) { again = false; tick() }
    })
  }
  const refresh = (): void => { if (pending) again = true; else tick() }
  return { tick, refresh, invalidate: () => { generation++; refresh() }, stop: () => { alive = false; generation++ } }
}
