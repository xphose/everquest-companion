import type { CharacterRef } from '@shared/types'
import type { PlannerInventory } from '@shared/planner/inventorySlots'
import type { OwnershipPayload } from '@shared/planner/ownership'

export const gearCharacterIdentity = (character: CharacterRef | null): string | null => character ? `${character.name}_${character.server}`.toLowerCase() : null
interface InventoryReader {
  getCharacter: () => Promise<CharacterRef | null>
  plannerInventory: () => Promise<PlannerInventory | null>
  gearOwnership: () => Promise<OwnershipPayload>
}

/** Bind both channels to the expected character, including switches before subscription/mount. */
export async function readGearInventory(expected: string, reader: InventoryReader): Promise<[PlannerInventory | null, OwnershipPayload]> {
  if (gearCharacterIdentity(await reader.getCharacter()) !== expected) throw new Error('Character changed before inventory reading')
  // Wait for both channels even on failure; a retry must never overlap the other half.
  const [inventory, ownership] = await Promise.allSettled([reader.plannerInventory(), reader.gearOwnership()])
  if (gearCharacterIdentity(await reader.getCharacter()) !== expected) throw new Error('Character changed during inventory reading')
  if (inventory.status === 'rejected' || ownership.status === 'rejected') throw new Error('Inventory reading failed')
  return [inventory.value, ownership.value]
}
