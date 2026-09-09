import { test } from 'node:test'
import assert from 'node:assert/strict'
import itemsJson from '../src/main/data/items.json'
import type { ItemDbFile } from '../src/main/itemsDb'
import { buildGearIndex, readGearRequiredLevel } from '../src/main/planner/gearIndex'
import { GEAR_INDEX_VERSION, type GearRow } from '../src/shared/planner/gear'
import type { ItemStatBlock } from '../src/shared/itemStats'
import {
  GEAR_MECHANICS_EVIDENCE, gearAcquisitionNotes, gearCatalogCaveat, gearClasses,
  gearKnownPatchNotes, gearRequiredLevel
} from '../src/shared/gearAcquisitionRules'
import {
  GEAR_ACQUISITION_SNAPSHOTS, gearAcquisitions
} from '../src/renderer/src/features/gear/gearAcquisitionData'

const file = itemsJson as unknown as ItemDbFile
const index = buildGearIndex(file)
const rows = new Map(index.rows.map((row) => [row.key, row]))
function row(key: string): GearRow {
  const result = rows.get(key)
  assert.ok(result, `committed item ${key} must exist`)
  return result
}

test('explicit equipment level extraction stays separate from effect activation and numeric stats', () => {
  const block: ItemStatBlock = { flags: [], stats: [], saves: [], effects: [{ name: 'Synthetic Focus', kind: 'focus', reqLevel: 40 }], exaltationSlots: [], extras: [] }
  assert.equal(readGearRequiredLevel(block), undefined)
  assert.equal(readGearRequiredLevel({ ...block, stats: [{ key: 'RECOMMENDED LEVEL', value: '30' }] }), undefined)
  for (const key of ['REQUIRED LEVEL', 'Req Level', 'Required_Level:']) {
    assert.equal(readGearRequiredLevel({ ...block, stats: [{ key, value: '46,' }] }), 46)
    for (const value of ['?', '10 and faction at Kindly', '15-20', '0', '-1', '4.5']) {
      assert.equal(readGearRequiredLevel({ ...block, stats: [{ key, value }] }), undefined)
    }
  }
  assert.equal(readGearRequiredLevel({ ...block, stats: [{ key: 'REQ LEVEL', value: '5' }, { key: 'REQUIRED LEVEL', value: '10' }] }), 10)
  assert.equal(row('azarack skin wristwraps').requiredLevel, 46, 'explicit trailing-comma value in the corpus')
  assert.equal(row('baton of the sky').requiredLevel, 49)
  const effectOnly = index.rows.find((entry) => entry.effects.some((effect) => effect.reqLevel !== undefined) && entry.requiredLevel === undefined)
  assert.ok(effectOnly, 'activation requirements do not invent equipment minimums')
  assert.equal(index.version, GEAR_INDEX_VERSION)
  assert.deepEqual(JSON.parse(JSON.stringify(index.rows[0])), index.rows[0], 'optional missing fields survive IPC unchanged')
})

test('September 1 brooch override removes exactly the verified equipment requirement', () => {
  const suffixes = ['arcane', 'corrupt', 'darkened', 'robust', 'spirited', 'stalwart', 'stealthy', 'virtuous']
  for (const suffix of suffixes) {
    const item = row(`soldier's brooch of the ${suffix}`)
    assert.equal(item.requiredLevel, 30, 'raw catalog remains attributable to its own snapshot')
    assert.equal(gearRequiredLevel(item), undefined)
    const source = file.items[item.key]
    assert.ok(source.questUses?.some((quest) => quest.page === 'Rathe Mountains'))
    const note = gearKnownPatchNotes(item)[0]
    assert.equal(note.effectiveAt, '2026-09-01')
    assert.match(note.sourceUrl, /everquestlegends\.com\/patch-notes\/eql-update-notes-9-01-2026$/)
  }
  assert.equal(gearRequiredLevel(row('refugee shroud')), 15)
  assert.equal(gearRequiredLevel({ ...row('refugee shroud'), key: 'unverified new brooch' }), 15)
})

test('Beastlord patch adds one supported class without inventing other eligibility changes', () => {
  const morningStar = row('enchanted fine steel morning star')
  assert.ok(!morningStar.classes.includes('BST'), 'test starts from the older source snapshot')
  assert.deepEqual(gearClasses(morningStar), [...morningStar.classes, 'BST'])
  assert.equal(gearClasses(row('refugee shroud')), row('refugee shroud').classes)
  const alreadyUpdated = { ...morningStar, classes: [...morningStar.classes, 'BST'] as GearRow['classes'] }
  assert.equal(gearClasses(alreadyUpdated), alreadyUpdated.classes)
})

test('current mechanics have dated sources and distinguish unknown rates and old stat values', () => {
  const difficulty = GEAR_MECHANICS_EVIDENCE.find((entry) => entry.id === 'difficulty')
  assert.ok(difficulty)
  assert.match(difficulty.text, /\+1 or higher/)
  assert.match(difficulty.text, /\+4 or higher/)
  const crawls = GEAR_MECHANICS_EVIDENCE.find((entry) => entry.id === 'crawls')
  assert.ok(crawls)
  assert.match(crawls.text, /too easy may not refund/)
  assert.match(crawls.text, /do not naturally respawn/)
  assert.match(gearKnownPatchNotes(row('verishe mal greataxe'))[0].text, /no exact amount/)
  assert.match(gearKnownPatchNotes(row('mithril greaves'))[0].text, /no exact values/)
  assert.match(gearKnownPatchNotes(row('spider silk cap'))[0].text, /upgraded again/)
  for (const entry of GEAR_MECHANICS_EVIDENCE) {
    assert.match(entry.sourceUrl, /^https:\/\/www\.everquestlegends\.com\/patch-notes\//)
    assert.ok(Number.isFinite(Date.parse(entry.effectiveAt)))
    assert.ok(Date.parse(entry.checkedAt) >= Date.parse(entry.effectiveAt))
  }
})

test('catalog provenance remains the scrape date; later advisory checks never refresh it', () => {
  assert.match(gearCatalogCaveat(file.scrapedAt), /2026-08-22.*predates the September 9 patch/)
  assert.match(gearCatalogCaveat('2026-09-10'), /does not verify every current game mechanic/)
  assert.match(gearCatalogCaveat('unknown'), /date unknown/)
  assert.ok(GEAR_ACQUISITION_SNAPSHOTS.quests.startsWith('2026-08-22'))
  assert.ok(GEAR_ACQUISITION_SNAPSHOTS.mobs.startsWith('2026-08-22'))
})

test('renderer cache joins the committed source singleton and rewards without losing useful acquisition coverage', () => {
  const acquisitions = gearAcquisitions(index.rows)
  assert.equal(gearAcquisitions(index.rows), acquisitions)
  assert.equal(acquisitions.size, index.rows.length)
  assert.ok([...acquisitions.values()].filter((sources) => sources.length).length >= 3796)
  const shinLord = acquisitions.get('ghoulbane')?.find((entry) => entry.name === 'the froglok shin lord')
  assert.ok(shinLord)
  assert.equal(shinLord.zone, 'Upper Guk')
  assert.equal(shinLord.minLevel, 30)
  assert.equal(shinLord.maxLevel, 30)
  const brassQuest = acquisitions.get('brass earring')?.find((entry) => entry.kind === 'quest' && entry.name === 'A Job for Nanrum')
  assert.ok(brassQuest)
  assert.equal(brassQuest.zone, 'Grobb')
  assert.equal(brassQuest.minLevel, 1)
  const unrest = gearAcquisitionNotes({ ...shinLord, zone: 'The Estate of Unrest' })
  assert.match(unrest[0].text, /new and improved/)
  assert.equal(gearAcquisitionNotes(shinLord).length, 0)
})
