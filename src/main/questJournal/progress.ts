import type { QuestJournalCatalogEntry, QuestJournalStep } from '../../shared/questJournal/catalog'
import type {
  QuestJournalManual, QuestJournalObservedTask, QuestJournalStepProgress
} from '../../shared/questJournal/journal'
import type { ClassUnlockClaim } from '../../shared/outputs/achievements'
import type { LootEvent, TurnInEvent } from '../../shared/types'
import { isDestroyed } from '../../shared/lootDisposition'
import { itemBaseName } from '../../shared/itemStats'
import { normalizedClass } from './validate'

/** Case and spaces only: punctuation and item variants remain distinct. */
export function nameKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/gu, ' ')
}

export function observedTaskId(name: string): string {
  return `task:${nameKey(name)}`
}

interface ItemCounts { held: number; required: number; complete: boolean }

function itemCounts(step: QuestJournalStep, held: Record<string, number>): ItemCounts | undefined {
  if (!step.items?.length || step.items.some((item) => item.variant)) return undefined
  const needed = new Map<string, number>()
  for (const item of step.items) {
    const key = nameKey(item.name)
    needed.set(key, (needed.get(key) ?? 0) + item.quantity)
  }
  let count = 0
  let required = 0
  let complete = true
  for (const [key, quantity] of needed) {
    const have = held[key] ?? 0
    count += Math.min(have, quantity)
    required += quantity
    complete = complete && have >= quantity
  }
  return { held: count, required, complete }
}

export function stepProgress(
  entry: QuestJournalCatalogEntry, manual: QuestJournalManual, inventory: Record<string, number> | null
): QuestJournalStepProgress[] {
  return (entry.guide?.steps ?? []).map((step) => {
    const base = { id: step.id, text: step.text }
    if (Object.prototype.hasOwnProperty.call(manual.steps, step.id)) {
      return { ...base, complete: manual.steps[step.id], source: 'manual' }
    }
    const counts = step.kind === 'collect' && !step.manualOnly && inventory
      ? itemCounts(step, inventory) : undefined
    if (counts) return { ...base, ...counts, source: 'inventory' }
    return { ...base, complete: false, source: 'unknown' }
  })
}

export function readyForTurnIn(
  entry: QuestJournalCatalogEntry, steps: QuestJournalStepProgress[], inventory: Record<string, number> | null
): boolean {
  const guide = entry.guide?.steps ?? []
  const final = guide[guide.length - 1]
  if (final?.kind !== 'turn-in' || !inventory || steps[steps.length - 1]?.complete) return false
  if (!steps.slice(0, -1).every((step, i) => guide[i].kind === 'pickup' || step.complete)) return false
  return itemCounts(final, inventory)?.complete === true
}

/** Only Sky class-unlock quest grants have a verified completion interpretation. */
export function achievementCompletion(entry: QuestJournalCatalogEntry, claims: ClassUnlockClaim[]): boolean {
  if (!entry.id.startsWith('posky:')) return false
  return claims.some((claim) => {
    const className = normalizedClass(claim.className)
    return claim.grant === 'quest' && className !== undefined &&
      entry.classes.some((c) => normalizedClass(c) === className) && achievementRewardMatches(entry, claim.item)
  })
}

function achievementRewardMatches(entry: QuestJournalCatalogEntry, item: string): boolean {
  if (entry.rewards.some((reward) => nameKey(reward.name) === nameKey(item))) return true
  // Same verified weapon-pair alias as posky/achievementInference.ts, checked against the 2026-08-20 export.
  return entry.id === 'posky:Beastlord::Beastlord Test of Claw' &&
    entry.rewards.some((reward) => reward.name === 'Windhowl') && nameKey(item) === 'windhowl and spirit render'
}

export function matchObserved(
  entry: QuestJournalCatalogEntry, tasks: QuestJournalObservedTask[]
): QuestJournalObservedTask | undefined {
  return tasks.find((task) => nameKey(task.name) === nameKey(entry.name))
}

/** An exact final hand-in is observable; quest success still requires separate evidence. */
export function finalTrade(entry: QuestJournalCatalogEntry, turnins: TurnInEvent[]): TurnInEvent | undefined {
  const steps = entry.guide?.steps ?? []
  const final = steps[steps.length - 1]
  if (final?.kind !== 'turn-in' || !final.items?.length || final.items.some((item) => item.variant)) return undefined
  return turnins.find((trade) => {
    if (!final.locations.some((location) => nameKey(location.name) === nameKey(trade.npc))) return false
    const held = tradeCounts(trade)
    const counts = itemCounts(final, held)
    return counts?.complete === true && Object.values(held).reduce((sum, count) => sum + count, 0) === counts.required
  })
}

function tradeCounts(trade: TurnInEvent): Record<string, number> {
  const counted = (trade as TurnInEvent & { itemCounts?: Record<string, number> }).itemCounts
  const held: Record<string, number> = {}
  if (counted) {
    for (const [item, count] of Object.entries(counted)) held[nameKey(item)] = count
  } else {
    for (const item of trade.items) held[nameKey(item)] = (held[nameKey(item)] ?? 0) + 1
  }
  return held
}

/** The export is a baseline. Only later, observed loot/trades move its counts. */
export function supplementInventory(
  inventory: Record<string, number> | null, exportedAt: number, loot: LootEvent[], turnins: TurnInEvent[]
): Record<string, number> | null {
  if (!inventory || !Number.isFinite(exportedAt)) return inventory
  const held = { ...inventory }
  const events = [
    ...loot.filter((event) => event.ts > exportedAt).map((event) => ({ kind: 'loot' as const, ...event })),
    ...turnins.filter((event) => event.ts > exportedAt).map((event) => ({ kind: 'trade' as const, ...event }))
  ].sort((a, b) => a.ts - b.ts)
  for (const event of events) {
    if (event.kind === 'trade') {
      for (const [item, count] of Object.entries(tradeCounts(event))) held[item] = Math.max(0, (held[item] ?? 0) - count)
    } else applyLoot(held, event)
  }
  return held
}

function applyLoot(held: Record<string, number>, event: LootEvent): void {
  const key = nameKey(event.item)
  if (isDestroyed(event)) {
    held[key] = Math.max(0, (held[key] ?? 0) - (event.count ?? 1))
  } else if (event.disposition === 'combined') {
    // A merge consumes an older tier the loot row does not identify. Invalidate that base name.
    for (const existing of Object.keys(held)) {
      if (nameKey(itemBaseName(existing)) === nameKey(itemBaseName(event.item))) Reflect.deleteProperty(held, existing)
    }
  } else if (event.disposition !== 'sold') {
    held[key] = (held[key] ?? 0) + (event.count ?? 1)
  }
}
