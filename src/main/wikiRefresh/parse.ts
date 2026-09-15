import { parseItemWikitext, templateField } from '../itemLookupParse'
import { itemKey, type ItemDbEntry } from '../itemsDb'
import { parseMobPage } from '../../../scripts/sources/mobPage'
import { parseQuestPage, isEmptyParse } from '../../../scripts/sources/questPage'
import { extractQuestWalkthrough } from '../../../scripts/gen-quest-journal-text'
import type { MobEntry, QuestEntry } from '../../shared/types'
import type { WikiCatalogPack } from '../../shared/wikiCatalog'

/** Compact intermediate page. Only quest prose waits for the complete item-name set. */
export interface WikiParsedPage {
  title: string
  missing?: true
  redirect?: string
  item?: ItemDbEntry
  mob?: MobEntry
  questText?: string
}
/** MediaWiki's first-letter case rule; the remainder of a page title is case-sensitive. */
export const titleKey = (title: string): string => {
  // A leading colon escapes namespace/transclusion syntax; it is not part of a page's name.
  const normalized = title.replace(/_/g, ' ').trim().replace(/^:/, '').trim()
  return normalized.charAt(0).toUpperCase() + normalized.slice(1)
}
export interface WikiKnownPages { items: Set<string>; mobs: Set<string>; quests: Set<string> }
export function knownWikiPages(base: WikiCatalogPack): WikiKnownPages {
  return {
    items: new Set(Object.values(base.items.items).map((item) => titleKey(item.page))),
    mobs: new Set(base.mobs.mobs.map((mob) => titleKey(mob.page))),
    quests: new Set(base.quests.quests.map((quest) => titleKey(quest.page)))
  }
}

function itemPage(title: string, text: string): ItemDbEntry | undefined {
  if (!/\{\{\s*Itempage\b/i.test(text)) return undefined
  const rawName = templateField(text, 'itemname')?.replace(/\s+/g, ' ').trim()
  const name = rawName && rawName !== title && rawName.length <= 80 && !/[{}[\]|<>]/.test(rawName) ? rawName : undefined
  const entry = Object.fromEntries(Object.entries({ page: title, name, ...parseItemWikitext(title, text) })
    .filter(([, value]) => value !== undefined && value !== false && !(Array.isArray(value) && !value.length))) as unknown as ItemDbEntry
  if (Object.keys(entry).filter((key) => key !== 'page' && key !== 'name').length === 0) {
    // A new stub contributes no facts. assertKnownPage still rejects loss of a known item.
    return undefined
  }
  return entry
}

export function parseWikiPage(title: string, text: string, known: WikiKnownPages): WikiParsedPage {
  const redirect = /^\s*#redirect\s*\[\[([^\]|#]+)(?:[^\]]*)\]\]/i.exec(text)
  if (redirect) {
    if (known.quests.has(titleKey(title))) known.quests.add(titleKey(redirect[1]))
    return { title, redirect: redirect[1].trim() }
  }
  const item = itemPage(title, text)
  const mob = parseMobPage(title, text) ?? undefined
  const knownQuest = known.quests.has(titleKey(title))
  const questLike = /questTopTable|\[\[Category:[^\]\n]*quests?\s*\]\]/i.test(text)
  const parsed: WikiParsedPage = { title, item, mob, questText: knownQuest || questLike ? text : undefined }
  assertKnownPage(parsed, known)
  return parsed
}

function assertKnownPage(page: WikiParsedPage, known: WikiKnownPages): void {
  const key = titleKey(page.title)
  if (!page.item && known.items.has(key)) {
    throw new Error('A known item page could not be parsed; the previous catalog was kept')
  }
  if (!page.mob && known.mobs.has(key)) {
    throw new Error('A known NPC page could not be parsed; the previous catalog was kept')
  }
}

function questEntry(page: string, text: string, isItem: (title: string) => boolean): QuestEntry | undefined {
  const parsed = parseQuestPage(page, text, isItem)
  if (isEmptyParse(parsed) || (parsed.disambiguation && !parsed.hasTopTable)) return undefined
  if (!parsed.hasTopTable && parsed.requiredItems.length > 40) return undefined
  return {
    name: page, page, startZone: parsed.startZone, giver: parsed.giver,
    minLevel: parsed.minLevel, classes: parsed.classes, relatedZones: parsed.relatedZones,
    relatedNpcs: parsed.relatedNpcs, rewards: parsed.rewards.map((name) => ({ name })),
    requiredItems: parsed.requiredItems, expReward: parsed.expReward
  }
}

function resolvePage(page: WikiParsedPage, pages: Record<string, WikiParsedPage>): WikiParsedPage {
  const seen = new Set<string>()
  let current = page
  while (current.redirect) {
    const key = titleKey(current.redirect)
    if (seen.has(key) || seen.size >= 8) throw new Error('Wiki contains a redirect cycle; the previous catalog was kept')
    seen.add(key)
    const next = pages[key]
    if (!next) throw new Error('Wiki redirect target was not downloaded')
    current = next
  }
  return current
}

function replaceItems(pack: WikiCatalogPack, pages: WikiParsedPage[], all: Record<string, WikiParsedPage>): void {
  const touched = new Set(pages.map((page) => titleKey(page.title)))
  const aliases = Object.entries(pack.items.items).filter(([key, item]) =>
    touched.has(titleKey(item.page)) && key !== itemKey(item.page) && key !== itemKey(item.name ?? item.page))
  pack.items.items = Object.fromEntries(Object.entries(pack.items.items).filter(([, item]) => !touched.has(titleKey(item.page))))
  const add = (key: string, item: ItemDbEntry): void => {
    if (!key) return
    const old = pack.items.items[key]
    if (!old || JSON.stringify(item).length > JSON.stringify(old).length) pack.items.items[key] = item
  }
  for (const page of pages) {
    const resolved = resolvePage(page, all)
    if (!resolved.item) continue
    add(itemKey(page.title), resolved.item)
    add(itemKey(resolved.title), resolved.item)
    if (resolved.item.name) add(itemKey(resolved.item.name), resolved.item)
  }
  for (const [key, old] of aliases) {
    const updated = pack.items.items[itemKey(old.page)]
    if (updated && !touched.has(titleKey(key))) add(key, updated)
  }
  pack.items.items = Object.fromEntries(Object.entries(pack.items.items).sort(([a], [b]) => a.localeCompare(b)))
  pack.items.count = new Set(Object.values(pack.items.items).map((item) => item.page)).size
}

/** A redirect still represents the saved quest identity; do not add its target a second time. */
function redirectedIdentities(base: WikiCatalogPack, pages: WikiParsedPage[], all: Record<string, WikiParsedPage>): Set<string> {
  const known = new Set([...base.mobs.mobs, ...base.quests.quests].map((entry) => titleKey(entry.page)))
  const targets = new Set<string>()
  for (const page of pages) {
    if (!page.redirect || !known.has(titleKey(page.title))) continue
    const resolved = resolvePage(page, all)
    if (!known.has(titleKey(resolved.title))) targets.add(titleKey(resolved.title))
  }
  return targets
}

/** Rebuild all changed domains together; a malformed page aborts the entire candidate. */
export function applyWikiPages(base: WikiCatalogPack, all: Record<string, WikiParsedPage>): WikiCatalogPack {
  const pack = structuredClone(base)
  const pages = Object.values(all)
  if (!pages.length) return pack
  replaceItems(pack, pages, all)
  const isItem = (title: string): boolean => Object.hasOwn(pack.items.items, itemKey(title))
  const touched = new Set(pages.map((page) => titleKey(page.title)))
  const knownQuests = new Set(pack.quests.quests.map((quest) => titleKey(quest.page)))
  // Catalogs can contain differently cased page titles; untouched records must not collapse.
  const mobs = new Map(pack.mobs.mobs.filter((mob) => !touched.has(titleKey(mob.page))).map((mob) => [mob.page, mob]))
  const quests = new Map(pack.quests.quests.filter((quest) => !touched.has(titleKey(quest.page))).map((quest) => [quest.page, quest]))
  const levelNotes = new Map(Object.entries(pack.metadata.levelNotes))
  const walkthroughs = new Map(Object.entries(pack.metadata.walkthroughs))
  const redirectTargets = redirectedIdentities(base, pages, all)
  for (const page of pages) {
    if (redirectTargets.has(titleKey(page.title))) continue
    const resolved = resolvePage(page, all)
    const key = titleKey(page.title)
    const existingQuest = knownQuests.has(key)
    levelNotes.delete(page.title)
    walkthroughs.delete(page.title)
    if (resolved.mob) mobs.set(page.title, { ...resolved.mob, page: page.title })
    const quest = resolved.questText ? questEntry(page.title, resolved.questText, isItem) : undefined
    if (existingQuest && !quest && !resolved.missing) throw new Error('A known quest page could not be parsed; the previous catalog was kept')
    if (quest && resolved.questText) {
      quests.set(page.title, quest)
      const parsed = parseQuestPage(page.title, resolved.questText, isItem)
      if (parsed.minLevelText) levelNotes.set(page.title, parsed.minLevelText)
      walkthroughs.set(page.title, extractQuestWalkthrough(resolved.questText))
    }
  }
  pack.mobs.mobs = [...mobs.values()].sort((a, b) => a.page.localeCompare(b.page))
  pack.quests.quests = [...quests.values()].sort((a, b) => a.page.localeCompare(b.page))
  pack.metadata.levelNotes = Object.fromEntries(levelNotes)
  pack.metadata.walkthroughs = Object.fromEntries(walkthroughs)
  return pack
}
