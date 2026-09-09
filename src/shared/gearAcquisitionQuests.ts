import { CLASS_ABBRS, type ClassAbbr } from './classCombo'
import { classAbbrFor } from './spellLines'
import type { MobEntry, MobLoc } from './mobTypes'
import type { QuestEntry } from './types'
import { acquisitionId, gearAcquisitionItemKey, mergeGearAcquisitions, type GearAcquisition } from './gearAcquisition'

const UNRESTRICTED = /^(all(?: classes)?|any)$/i

function classList(text: string): ClassAbbr[] | undefined {
  const direct = classAbbrFor(text)
  if (direct) return [direct]
  const words = text.trim().split(/[\s,/]+/).map(classAbbrFor)
  if (words.some((word) => word === null)) return undefined
  return words.filter((word): word is ClassAbbr => word !== null)
}

function questClasses(raw: readonly string[] | undefined): ClassAbbr[] | undefined {
  if (!raw?.length) return undefined
  if (raw.some((text) => UNRESTRICTED.test(text.trim()))) return undefined
  const classes: ClassAbbr[] = []
  for (const text of raw) {
    const except = /^all except (.+)$/i.exec(text.trim())
    const parsed = classList(except?.[1] ?? text)
    if (!parsed?.length) return undefined
    classes.push(...(except ? CLASS_ABBRS.filter((cls) => !parsed.includes(cls)) : parsed))
  }
  return [...new Set(classes)]
}

function questRequirements(quest: QuestEntry): string[] {
  const out = ['Possible quest reward; check the quest steps and reward choices.']
  if (quest.giver) out.push(`Start with ${quest.giver}.`)
  if (quest.classes?.length && !quest.classes.every((text) => UNRESTRICTED.test(text.trim()))) {
    out.push(`Quest eligibility from the page: ${quest.classes.join(', ')}.`)
  }
  if (quest.requiredItems?.length) out.push(`Quest page mentions: ${quest.requiredItems.join(', ')}. Check quantities and prerequisites.`)
  return out
}

function mobNames(mobs: readonly MobEntry[]): Map<string, MobEntry[]> {
  const index = new Map<string, MobEntry[]>()
  for (const mob of mobs) {
    for (const name of new Set([mob.page.toLowerCase(), mob.name.toLowerCase()])) {
      const list = index.get(name) ?? []
      list.push(mob)
      index.set(name, list)
    }
  }
  return index
}

/** Only a unique giver in exactly the quest's start zone can provide a navigable pin. */
function questLocations(quest: QuestEntry, npcs: ReadonlyMap<string, readonly MobEntry[]>): (MobLoc | undefined)[] {
  if (!quest.giver || !quest.startZone) return [undefined]
  const matches = (npcs.get(quest.giver.toLowerCase()) ?? []).filter((mob) =>
    mob.zones?.length === 1 && mob.zones[0].toLowerCase() === quest.startZone?.toLowerCase()
  )
  return matches.length === 1 && matches[0].loc?.length ? matches[0].loc : [undefined]
}

function questSources(quest: QuestEntry, npcs: ReadonlyMap<string, readonly MobEntry[]>): GearAcquisition[] {
  const classes = questClasses(quest.classes)
  const minLevel = Number.isInteger(quest.minLevel) && (quest.minLevel ?? 0) > 0 ? quest.minLevel : undefined
  return questLocations(quest, npcs).map((loc) => ({
    id: acquisitionId('quest', quest.page, quest.startZone, loc),
    kind: 'quest', name: quest.name, page: quest.page, zone: quest.startZone, loc,
    minLevel, classes, requirements: questRequirements(quest), evidence: 'catalog'
  }))
}

/** Rewards alone establish an acquisition edge. Body references and quest flags do not. */
export function buildQuestRewardIndex(
  quests: readonly QuestEntry[],
  mobs: readonly MobEntry[] = []
): Map<string, GearAcquisition[]> {
  const out = new Map<string, GearAcquisition[]>()
  const npcs = mobNames(mobs)
  for (const quest of quests) {
    if (!quest.rewards?.length) continue
    const sources = questSources(quest, npcs)
    for (const reward of quest.rewards) {
      const key = gearAcquisitionItemKey(reward.name)
      if (key) out.set(key, mergeGearAcquisitions(out.get(key) ?? [], sources))
    }
  }
  return out
}
