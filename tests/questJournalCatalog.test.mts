import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import questsJson from '../src/renderer/src/data/eqlegends/quests.json'
import skyJson from '../src/renderer/src/data/eqlegends/posky.json'
import guidesJson from '../src/main/data/questJournalGuides.json'
import { buildQuestJournalCatalog, getQuestJournalCatalog, findQuestJournalCatalogEntry } from '../src/main/questJournal/catalog'
import { buildCatalogLocationIndex } from '../src/main/questJournal/catalogLocations'
import type { QuestJournalGuide } from '../src/shared/questJournal/catalog'
import { extractQuestWalkthrough } from '../scripts/gen-quest-journal-text'

const catalog = getQuestJournalCatalog()
const guide = (id: string): QuestJournalGuide => {
  const entry = findQuestJournalCatalogEntry(id)
  assert.ok(entry?.guide, `Missing guide ${id}`)
  return entry.guide
}

test('offline directory preserves every wiki quest and separately identifies individual Sky tests', () => {
  assert.equal(catalog.length, questsJson.quests.length + skyJson.quests.length)
  assert.equal(new Set(catalog.map((entry) => entry.id)).size, catalog.length)
  for (const quest of questsJson.quests) assert.ok(findQuestJournalCatalogEntry(quest.page))
  for (const quest of skyJson.quests) {
    const entry = findQuestJournalCatalogEntry(`posky:${quest.className}::${quest.name}`)
    assert.equal(entry?.name, quest.name)
    assert.deepEqual(entry?.classes, [quest.className])
    assert.ok(entry?.page.endsWith('Plane of Sky Tests'))
  }
  assert.equal(getQuestJournalCatalog(), catalog)
  assert.equal(findQuestJournalCatalogEntry('not a quest'), undefined)
})

test('preserves minimum-level qualifications rather than treating them as difficulty', () => {
  assert.equal(findQuestJournalCatalogEntry('Corrupt Guards')?.minLevel, 15)
  assert.equal(findQuestJournalCatalogEntry('Corrupt Guards')?.minLevelText,
    '15 (lowest level of the guard you need to kill is 30)')
  assert.equal(findQuestJournalCatalogEntry('Coin of Tash (Tashania)')?.minLevelText,
    '35 (to start, 41 to use)')
})

test('a quest giver and final recipient remain distinct', () => {
  const sisters = findQuestJournalCatalogEntry('Bandit Sisters')
  assert.equal(sisters?.pickupLocations[0].name, 'Tynkale')
  const final = guide('Bandit Sisters').steps.at(-1)
  assert.equal(final?.kind, 'turn-in')
  assert.equal(final?.locations[0].page, 'A Drunkard')
  assert.equal(final?.locations[0].zone, 'Greater Faydark')
  assert.equal(guide('Aegis of Life Quest').steps.at(-1)?.locations[0].name, 'Camlend Serbold')
})

test('exact quantities and identical-name variants are explicit and require manual checking', () => {
  const casks = guide('Blackburrow Brewers').steps
  assert.deepEqual(casks.find((step) => step.kind === 'collect')?.items,
    [{ name: 'Blackburrow Cask', quantity: 3 }])
  assert.deepEqual(casks.at(-1)?.items, [{ name: 'Blackburrow Cask', quantity: 3 }])
  for (const id of ['Clay Bracelet Quest', 'Bandit Sisters']) {
    const steps = guide(id).steps
    const collection = steps.filter((step) => step.kind === 'collect')
    assert.equal(collection.length, 4)
    assert.ok(collection.every((step) => step.manualOnly && step.items?.[0].quantity === 1))
    assert.equal(new Set(collection.map((step) => step.items?.[0].variant)).size, 4)
    assert.equal(steps.at(-1)?.items?.length, 4)
    assert.ok(steps.at(-1)?.manualOnly)
  }
})

test('reward stats and effects retain usable classes and their distinct required level', () => {
  const bracelet = findQuestJournalCatalogEntry('Clay Bracelet Quest')?.rewards[0]
  assert.deepEqual(bracelet?.stats?.classes, ['MAG'])
  assert.equal(bracelet?.stats?.effects[0].reqLevel, 20)
  assert.equal(findQuestJournalCatalogEntry('Clay Bracelet Quest')?.minLevel, 25)
  const bard = findQuestJournalCatalogEntry('posky:Bard::Bard Test of Tone')
  assert.equal(bard?.rewards[0].name, 'Mask of Song')
  assert.deepEqual(bard?.rewards[0].stats?.classes, ['BRD'])
})

test('mob-side drops and item-side drops are both usable without guessing missing coordinates', () => {
  const index = buildCatalogLocationIndex([
    { name: 'a scout', page: 'Scout North', zones: ['North Qeynos'], drops: ['Token'], loc: [{ ns: 1, ew: 2 }] },
    { name: 'a scout', page: 'Scout South', zones: ['South Qeynos'], loc: [{ ns: 3, ew: 4 }] }
  ])
  const sources = index.drops('Token', [{ mob: 'a scout', zone: 'South Qeynos' }, { mob: 'Unknown keeper', zone: 'Qeynos Hills' }])
  assert.equal(sources.length, 3)
  assert.deepEqual(sources.find((row) => row.page === 'Scout South')?.loc, [{ ns: 3, ew: 4 }])
  assert.equal(sources.find((row) => row.name === 'Unknown keeper')?.loc, undefined)
  assert.equal(index.npc('a scout')[0].loc, undefined, 'ambiguous names must not choose a pin')
})

test('multi-zone coordinates are withheld even when one of its zones is requested', () => {
  const index = buildCatalogLocationIndex([
    { name: 'Wanderer', page: 'Wanderer', zones: ['North Qeynos', 'South Qeynos'], loc: [{ ns: 10, ew: 20 }] }
  ])
  const location = index.npc('Wanderer', 'North Qeynos')[0]
  assert.equal(location.zone, 'North Qeynos')
  assert.equal(location.loc, undefined)
  assert.match(location.note ?? '', /several zones/)
  assert.equal(index.npc('Wanderer', 'Blackburrow')[0].loc, undefined)
})

test('an unstructured prose item remains a reference without an invented quantity or guide', () => {
  const [entry] = buildQuestJournalCatalog({
    quests: { scrapedAt: '2026-08-22', source: 'fixture', quests: [{ name: 'Prose', page: 'Prose', requiredItems: ['Example'] }] },
    mobs: { scrapedAt: '2026-08-22', source: 'fixture', mobs: [] },
    items: { scrapedAt: '2026-08-22', source: 'fixture', count: 0, items: {} },
    guides: {}, levelNotes: {}
  })
  assert.deepEqual(entry.referencedItems, [{ name: 'Example', sources: [] }])
  assert.equal(entry.guide, undefined)
  assert.equal(entry.minLevel, undefined)
  assert.deepEqual(entry.rewards, [])
})

test('curated source hashes identify the exact cached walkthrough bytes', () => {
  for (const [page, raw] of Object.entries(guidesJson)) {
    const source = raw.source
    const text = readFileSync(new URL(`../scripts/sources/cache/quests/page-${source.cachePageId}.wikitext`, import.meta.url), 'utf8')
    assert.equal(createHash('sha256').update(text).digest('hex'), source.cacheSha256, page)
    assert.ok(source.snapshotAt)
    assert.ok(source.url.startsWith('https://eqlwiki.com/'))
  }
})

test('cached narrative preserves source quantities, faction, dialogue and locations as plain text', () => {
  const sisters = findQuestJournalCatalogEntry('Bandit Sisters')?.walkthrough
  assert.ok(sisters?.some((section) => section.text.includes('Indifferent')))
  assert.ok(sisters?.some((section) => section.text.includes('-802, 2682, -2')))
  const brewers = findQuestJournalCatalogEntry('Blackburrow Brewers')?.walkthrough
  assert.ok(brewers?.some((section) => section.text.includes('three of these casks')))
  assert.ok(brewers?.some((section) => section.text.includes('You do not have to complete')))
  const text = extractQuestWalkthrough('== Walkthrough ==\nBring {{:Test Item}} to [[Keeper|the keeper]].<br>Wait.\n{{Navbox|x={{Nested|secret}}}}\n[[Category:Quests]]')
  assert.equal(text.sections[0].text, 'Bring Test Item to the keeper.\nWait.')
  assert.equal(text.truncated, false)
})

test('long source narratives stay bounded and announce that further text exists', () => {
  const long = extractQuestWalkthrough('== Walkthrough ==\n' + 'a'.repeat(45_000))
  assert.equal(long.sections[0].text.length, 40_000)
  assert.equal(long.truncated, true)
  const table = extractQuestWalkthrough('== Items ==\n{| class="wikitable"\n| [[Token]] || 4\n|}')
  assert.match(table.sections[0].text, /Token \| 4/)
})
