// Bounds and shapes at the disk/network boundary. Text is rendered as text, never HTML.
type Check = (value: unknown) => boolean
const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
const text: Check = (v) => typeof v === 'string' && v.length <= 200_000
const name: Check = (v) => typeof v === 'string' && v.trim().length > 0 && v.length <= 512
const number: Check = (v) => typeof v === 'number' && Number.isFinite(v)
const boolean: Check = (v) => typeof v === 'boolean'
const stamp: Check = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) && Number.isFinite(Date.parse(v))
const list = (check: Check, max = 10_000): Check => (v) => Array.isArray(v) && v.length <= max && v.every(check)
const names = list(name)
const shape = (required: Record<string, Check>, optional: Record<string, Check> = {}): Check => (v) => {
  if (!record(v)) return false
  if (!Object.entries(required).every(([k, check]) => check(v[k]))) return false
  return Object.entries(v).every(([k, value]) => {
    if (Object.prototype.hasOwnProperty.call(required, k)) return true
    return Object.prototype.hasOwnProperty.call(optional, k) && (value === undefined || optional[k](value))
  })
}
const keyed = (check: Check, max = 100_000): Check => (v) => record(v) && Object.keys(v).length <= max &&
  Object.entries(v).every(([key, value]) => name(key) && !['__proto__', 'constructor', 'prototype'].includes(key) && check(value))
const pair = shape({ key: text, value: text })
const stats = shape({
  flags: names, stats: list(pair), saves: list(pair), extras: names,
  effects: list(shape({ kind: (v) => ['combat', 'focus', 'click', 'worn', 'proc', 'effect'].includes(String(v)), name }, { detail: text, reqLevel: number })),
  exaltationSlots: list(shape({ type: name }, { content: text, empty: boolean }))
}, {
  slot: text, classes: names, races: names, skill: text, atkDelay: number, dmg: number,
  dmgBonus: number, backstab: number, ac: number, weight: text, size: text, range: text
})
const questUse = shape({ quest: name, source: (v) => ['posky', 'quests', 'wiki'].includes(String(v)) }, {
  page: name, giver: text, zone: text, role: (v) => ['required', 'reward'].includes(String(v)), rewards: names
})
const recipe = shape({ recipe: name }, { page: name, tradeskill: text, trivial: number })
const craft = shape({ ingredients: list(shape({ name }, { qty: number, sources: names })) }, {
  tradeskill: text, trivial: number, container: text, yieldItem: text, yieldQty: number
})
export const validWikiItem = shape({ page: name }, {
  name, lore: boolean, quest: boolean, questUses: list(questUse),
  dropsFrom: list(shape({ mob: name }, { zone: text })), eraTag: text,
  summary: text, statsBlock: text, stats, iconId: number, recipes: list(recipe),
  recipesNote: text, playerCrafted: boolean, craftedBy: list(craft), craftedNote: text,
  // These optional fields are part of ItemKnowledge's local-lookup shape.
  notFound: boolean
})
export const validWikiMob = shape({ page: name, name }, {
  level: text, zones: names, drops: names,
  loc: list(shape({ ns: number, ew: number }, { z: number, pct: number }))
})
const quest = shape({ page: name, name }, {
  startZone: text, giver: text, minLevel: number, classes: names, relatedZones: names,
  relatedNpcs: names, rewards: list(shape({ name })), requiredItems: names, expReward: boolean
})
const itemFile = shape({ scrapedAt: stamp, source: text, count: number, items: keyed(validWikiItem) })
const mobFile = shape({ scrapedAt: stamp, source: text, mobs: list(validWikiMob, 100_000) })
const questFile = shape({ scrapedAt: stamp, source: text, quests: list(quest, 100_000) })

export function validCatalogData(value: Record<string, unknown>): boolean {
  return itemFile(value.items) && mobFile(value.mobs) && questFile(value.quests)
}

export const validJournalMetadata: Check = shape({
  snapshotAt: stamp,
  levelNotes: keyed(text),
  walkthroughs: keyed(shape({
    sections: list(shape({ text }, { heading: text }), 64), truncated: boolean
  }))
})
