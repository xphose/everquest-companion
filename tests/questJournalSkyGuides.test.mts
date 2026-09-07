import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import skyJson from '../src/renderer/src/data/eqlegends/posky.json'
import guidesJson from '../src/main/data/questJournalGuides.json'
import type { PoskyQuest } from '../src/shared/types'
import type { MobEntry } from '../src/shared/mobTypes'
import type { QuestJournalCatalogEntry, QuestJournalGuide } from '../src/shared/questJournal/catalog'
import { renameItemName } from '../src/shared/itemRenames'
import { getQuestJournalCatalog } from '../src/main/questJournal/catalog'
import { buildSkyQuestJournalEntries } from '../src/main/questJournal/catalogSky'
import { buildCatalogLocationIndex } from '../src/main/questJournal/catalogLocations'
import { countTurnIns } from '../src/renderer/src/features/posky/turnInCelebration'

const catalog = getQuestJournalCatalog()
const skyEntries = catalog.filter((entry) => entry.id.startsWith('posky:'))

function guideOf(entry: QuestJournalCatalogEntry): QuestJournalGuide {
  assert.ok(entry.guide, entry.id)
  return entry.guide
}

function entryFor(quest: PoskyQuest, mobs: MobEntry[] = []): QuestJournalCatalogEntry {
  return buildSkyQuestJournalEntries(
    { scrapedAt: skyJson.scrapedAt, quests: [quest] }, new Map(), buildCatalogLocationIndex(mobs)
  )[0]
}

test('all 95 structured Sky tests retain exact required counts, one rune and source dates', () => {
  assert.equal(skyEntries.length, 95)
  for (const quest of skyJson.quests) {
    const entry = skyEntries.find((row) => row.id === `posky:${quest.className}::${quest.name}`)
    assert.ok(entry)
    const guide = guideOf(entry)
    const collect = guide.steps.filter((step) => step.kind === 'collect')
    const expected = quest.items.map((item) => ({ name: renameItemName(item.name), quantity: item.count }))
    assert.deepEqual(collect.flatMap((step) => step.items ?? []).map(({ name, quantity }) => ({ name, quantity })), expected)
    assert.deepEqual(guide.steps.at(-1)?.items, collect.flatMap((step) => step.items ?? []))
    assert.equal(collect.filter((step) => step.items?.[0].name === quest.rune).length, 1, quest.name)
    assert.deepEqual(guide.source, entry.source)
    assert.equal(guide.source.snapshotAt, skyJson.scrapedAt)
    assert.ok(guide.source.url.endsWith(`${quest.className.replaceAll(' ', '_')}_Plane_of_Sky_Tests`))
    assert.equal(guide.steps[0].kind, 'pickup')
    assert.equal(guide.steps[0].manualOnly, false, 'pickup is information, not a readiness checkbox')
    assert.equal(guide.steps.at(-1)?.locations[0].name.toLowerCase(), quest.giver.toLowerCase())
  }
  for (const [id, guide] of Object.entries(guidesJson)) {
    assert.deepEqual(catalog.find((entry) => entry.id === id)?.guide, guide, id)
  }
})

test('recipient and ingredients agree with existing Sky trades, including the recorded Paladin hand-in', () => {
  const quest = skyJson.quests.find((row) => row.name === 'Paladin Test of Love')
  assert.ok(quest)
  const guide = guideOf(entryFor(quest))
  const final = guide.steps.at(-1)
  assert.equal(final?.locations[0].name, 'Dason Goldblade')
  assert.deepEqual(final.items, [
    { name: 'Golden Hilt', quantity: 1 },
    { name: 'Sphinx Claw', quantity: 1 },
    { name: 'Wind Rune Geza', quantity: 1 }
  ])
  const recorded = readFileSync(new URL('./fixtures/w15-sphinx-claw-variant.log', import.meta.url), 'utf8')
  for (const item of final.items) assert.ok(recorded.includes(`You offered ${item.quantity} ${item.name} to Dason Goldblade.`))
  // Synthetic trades over the bundled recipes check compatibility with the existing recipient rule.
  for (const row of skyJson.quests) {
    const trade = { ts: 1, npc: row.giver, items: row.items.map((item) => item.name) }
    assert.deepEqual(countTurnIns([trade], [row]), { [`${row.className}::${row.name}`]: [1] })
  }
})

test('synthetic quantity changes are preserved and the corrected Bard reward is used', () => {
  const quest = structuredClone(skyJson.quests[0])
  quest.items[0].count = 4
  const guide = guideOf(entryFor(quest))
  assert.equal(guide.steps[1].items?.[0].quantity, 4)
  assert.equal(guide.steps.at(-1)?.items?.[0].quantity, 4)
  assert.match(guide.steps.at(-1)?.text ?? '', /4 × Light Woolen Mask/)
  assert.deepEqual(quest.items.map((item) => item.count), [4, 1], 'input was not mutated')
  const bard = skyEntries.find((entry) => entry.name === 'Bard Test of Wind')
  assert.ok(bard)
  assert.equal(bard.rewards[0].name, 'Amulet of the Fae')
  assert.match(guideOf(bard).steps.at(-1)?.text ?? '', /for Amulet of the Fae\./)
})

test('incomplete source rows never invent a recipient, quantity or omitted rune', () => {
  const base = skyJson.quests[0]
  for (const giver of [undefined, '', ' ']) assert.equal(entryFor({ ...base, giver }).guide, undefined)
  assert.equal(entryFor({ ...base, items: [] }).guide, undefined)
  assert.equal(entryFor({ ...base, items: [base.items[0]] }).guide, undefined, 'a declared missing rune must not disappear')
  for (const count of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(entryFor({ ...base, items: [{ ...base.items[0], count }, base.items[1]] }).guide, undefined)
  }
  assert.equal(entryFor({ ...base, items: [{ ...base.items[0], name: '' }, base.items[1]] }).guide, undefined)
})

test('same-name variants remain separate and ordinary bixie loot cannot satisfy the Sky variant', () => {
  const rogue = skyEntries.find((entry) => entry.name === 'Rogue Test of Deception')
  assert.ok(rogue)
  const steps = guideOf(rogue).steps
  const stinger = steps.find((step) => step.kind === 'collect' && step.items?.[0].name === 'Bixie Stinger')
  assert.equal(stinger?.manualOnly, true)
  assert.equal(stinger.items?.[0].variant, "Bixie God's Stinger (Plane of Sky)")
  assert.ok(stinger.locations.every((location) => location.zone === 'Plane of Sky'))
  assert.equal(steps.at(-1)?.manualOnly, true)
  assert.ok(steps.filter((step) => step.kind === 'collect' && step !== stinger).every((step) => !step.manualOnly))
  const base = skyJson.quests[0]
  const items = [
    { ...base.items[0], name: 'Shared name', page: 'Shared name (first)' },
    { ...base.items[0], name: 'Shared name', page: 'Shared name (second)' }
  ]
  const variants = guideOf(entryFor({ ...base, rune: undefined, items })).steps.at(-1)?.items
  assert.deepEqual(variants?.map((item) => item.variant), ['Shared name (first)', 'Shared name (second)'])
})

test('item sources retain island prose while abbreviations never acquire guessed NPC pins', () => {
  const quest = skyJson.quests.find((row) => row.name === 'Bard Test of Voice')
  assert.ok(quest)
  const entry = entryFor(quest, [
    { name: 'Keeper of Souls', page: 'Keeper of Souls', zones: ['Plane of Sky'], drops: ['Light Woolen Mantle'], loc: [{ ns: 1, ew: 2 }] },
    { name: 'Wrong zone mob', page: 'Wrong zone mob', zones: ['North Qeynos'], drops: ['Light Woolen Mantle'], loc: [{ ns: 3, ew: 4 }] }
  ])
  const collection = guideOf(entry).steps[1]
  assert.match(collection.text, /Island 4/)
  assert.deepEqual(collection.locations.find((row) => row.name === 'Keeper of Souls')?.loc, [{ ns: 1, ew: 2 }])
  assert.equal(collection.locations.find((row) => row.name === 'Wrong zone mob'), undefined)
  const abbreviation = collection.locations.find((row) => row.name === 'KoS')
  assert.ok(abbreviation)
  assert.equal(abbreviation.loc, undefined)
  assert.equal(abbreviation.page, undefined)
  assert.equal(abbreviation.sourceUrl, entry.source.url)
  assert.match(abbreviation.note ?? '', /Island 4/)
  const rune = guideOf(entry).steps[2]
  assert.equal(rune.locations[0].name, 'random drop — any Plane of Sky mob')
  assert.equal(rune.locations[0].loc, undefined)
})
