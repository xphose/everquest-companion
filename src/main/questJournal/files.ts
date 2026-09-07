import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import type { CharacterRef } from '../../shared/types'
import type { QuestJournalFileState } from '../../shared/questJournal/journal'
import { outputFileNames, outputKind } from '../../shared/outputs/kinds'
import { classUnlockClaims, parseAchievementsDump, type ClassUnlockClaim } from '../../shared/outputs/achievements'
import { heldCountsFromDump, type InventoryDump } from '../../shared/outputs/inventory'
import { equippedHosts } from '../../shared/planner/inventorySlots'
import { equipSlotOf } from '../../shared/planner/types'
import { parseInventoryDump } from '../outputs/inventoryParse'
import { itemKey, type ItemDbFile } from '../itemsDb'
import { nameKey } from './progress'
import type { JournalWornItem } from './recommend'

export interface JournalFiles {
  inventoryStatus: QuestJournalFileState
  achievementsStatus: QuestJournalFileState
  inventory: Record<string, number> | null
  claims: ClassUnlockClaim[]
  worn: JournalWornItem[]
}

export interface ExactFile { path: string; updatedAt: string; text: string }

/** Never use the registry's newest-other-character fallback for progress evidence. */
export function exactOutputFile(root: string, character: CharacterRef, kind: 'inventory' | 'achievements'): ExactFile | null {
  const expected = outputFileNames(outputKind(kind), character.name, character.server)[0]
  if (!expected) return null
  const name = readdirSync(root).find((file) => file.toLowerCase() === expected.toLowerCase())
  if (!name) return null
  const path = join(root, name)
  const before = statSync(path)
  if (!before.isFile() || before.size > 20 * 1024 * 1024) throw new Error('Export is not a supported file size.')
  const text = readFileSync(path, 'utf8')
  const after = statSync(path)
  if (before.mtimeMs !== after.mtimeMs || before.size !== after.size) throw new Error('Export is being rewritten. Refreshing will retry.')
  return { path, text, updatedAt: before.mtime.toISOString() }
}

function wornItems(dump: InventoryDump, items: ItemDbFile): JournalWornItem[] {
  return equippedHosts(dump).flatMap((host) => {
    const stats = items.items[itemKey(host.name)]?.stats
    const slot = equipSlotOf(host.slot)
    return stats && slot ? [{ name: host.name, slot, stats }] : []
  })
}

function readInventory(files: JournalFiles, file: ExactFile | null, items: ItemDbFile): void {
  if (!file) return
  const dump = parseInventoryDump(file.text)
  if (dump.sectionShapes.Location !== 'items' || dump.malformed.length) {
    throw new Error('Inventory export is incomplete or has unrecognized rows. Export inventory again.')
  }
  const counts: Record<string, number> = {}
  for (const [name, count] of Object.entries(heldCountsFromDump(dump))) counts[nameKey(name)] = count
  files.inventory = counts
  files.worn = wornItems(dump, items)
  files.inventoryStatus = { state: 'available', updatedAt: file.updatedAt }
}

function readAchievements(files: JournalFiles, file: ExactFile | null): void {
  if (!file) return
  const dump = parseAchievementsDump(file.text)
  if (!dump.rows.length) throw new Error('Achievements export has no recognized rows. Export achievements again.')
  files.claims = classUnlockClaims(dump)
  files.achievementsStatus = { state: 'available', updatedAt: file.updatedAt }
}

export function journalFiles(root: string, character: CharacterRef | null, items: ItemDbFile): JournalFiles {
  const files: JournalFiles = { inventoryStatus: { state: 'missing' }, achievementsStatus: { state: 'missing' }, inventory: null, claims: [], worn: [] }
  if (!character) return files
  for (const kind of ['inventory', 'achievements'] as const) {
    try {
      const file = exactOutputFile(root, character, kind)
      if (kind === 'inventory') readInventory(files, file, items)
      else readAchievements(files, file)
    } catch (error) {
      const state: QuestJournalFileState = { state: 'error', message: error instanceof Error ? error.message : 'Unable to read export.' }
      if (kind === 'inventory') files.inventoryStatus = state
      else files.achievementsStatus = state
    }
  }
  return files
}
