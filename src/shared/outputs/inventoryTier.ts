import { ITEM_MAX_TIER } from '../itemStats'
import type { InventoryEntry } from './inventory'

type ExportItem = Pick<InventoryEntry, 'name' | 'parsedName' | 'itemId'>

function hasControlCharacters(name: string): boolean {
  for (let index = 0; index < name.length; index++) {
    const code = name.charCodeAt(index)
    if (code < 32 || code === 127) return true
  }
  return false
}

function ordinaryName(entry: ExportItem): boolean {
  const { base, tier, starred, exaltation } = entry.parsedName
  if (!base || base === 'Empty' || base !== base.trim()) return false
  if (hasControlCharacters(base)) return false
  if (exaltation || / \((?:Exaltation|Ornamentation)\)$/i.test(base) || /\s\+/.test(base)) return false
  const suffix = tier === undefined ? '' : ` +${tier}`
  return entry.name === `${base}${suffix}${starred ? '*' : ''}`
}

/** Native export names omit +0 for ordinary items. Raw name parsing and manual missing tiers stay unchanged. */
export function inventoryExportTier(entry: ExportItem): number | undefined {
  if (!ordinaryName(entry)) return undefined
  const { tier, starred } = entry.parsedName
  if (tier !== undefined) return Number.isInteger(tier) && tier >= 0 && tier <= ITEM_MAX_TIER ? tier : undefined
  if (starred || !Number.isSafeInteger(entry.itemId) || entry.itemId <= 0) return undefined
  return 0
}
