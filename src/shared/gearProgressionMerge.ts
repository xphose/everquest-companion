import { EXALTATION_SLOT_TYPES, expToNextTier, ITEM_MAX_TIER } from './itemStats'
import type { GearMergeAdvice } from './gearProgressionTypes'
import type { OwnershipRow } from './planner/ownership'

export function knownGearTier(tier: number | undefined): number | undefined {
  return tier !== undefined && Number.isInteger(tier) && tier >= 0 && tier <= ITEM_MAX_TIER ? tier : undefined
}
/** Socket children, extracted effects and equipped hosts never become spare crafting ingredients. */
export function spareGearCopies(rows: readonly OwnershipRow[]): OwnershipRow[] {
  return rows.filter((row) => !row.exaltation && row.containment !== 'socket' &&
    ['inventory', 'bank', 'sharedBank', 'personalDepot'].includes(row.place) && row.count > 0)
}
export function gearMergeAdvice(tier: number | undefined, copies: readonly OwnershipRow[], benefit: string): GearMergeAdvice | undefined {
  const fromTier = knownGearTier(tier)
  if (fromTier === undefined || fromTier === ITEM_MAX_TIER) return undefined
  const max = expToNextTier(fromTier)
  if (max === null) return undefined
  const available = spareGearCopies(copies)
  const warnings = [
    'Your export does not include fractional upgrade progress; the cost is a range.',
    'Keep the item you wear. Only spare whole items are counted; check their contents before merging.',
    'Mote costs and your spare mote budget are not verified. Save resources for spell upgrades too.',
    'Copies with an unknown tier or tier +10 have no verified donor XP and are excluded from the XP total.',
    'An Exaltation needs a compatible donor and host; moving an effect removes it from the donor. Haste cannot be transferred.'
  ]
  return { fromTier, toTier: fromTier + 1, xp: { min: fromTier === 0 ? max : 1, max },
    availableCopies: available.reduce((sum, row) => sum + row.count, 0),
    availableXp: available.reduce((sum, row) => {
      const ownedTier = knownGearTier(row.tier)
      return sum + (ownedTier === undefined || ownedTier === ITEM_MAX_TIER ? 0 : 2 ** ownedTier * row.count)
    }, 0), benefit,
    unlocks: EXALTATION_SLOT_TYPES.filter((socket) => socket.unlocksAt === fromTier + 1).map((socket) => socket.type), warnings }
}
