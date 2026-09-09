import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  acquisitionAvailable, acquisitionEffort, buildGearAcquisitionIndex, buildQuestRewardIndex,
  gearAcquisitionItemKey, mergeGearAcquisitions, parseAcquisitionLevels, type GearAcquisition
} from '../src/shared/gearAcquisition'
import type { GearRow } from '../src/shared/planner/gear'
import type { MobEntry, QuestEntry } from '../src/shared/types'
import { buildSourceIndex } from '../src/renderer/src/lib/itemSources'

const gear = (name: string, extra: Partial<GearRow> = {}): GearRow => ({
  key: gearAcquisitionItemKey(name), name, searchKey: name.toLowerCase(), slots: ['HEAD'],
  classes: ['MAG'], races: ['ALL'], flags: [], quest: false, playerCrafted: false,
  stats: { MP: 15 }, effects: [], ...extra
})
const source = (extra: Partial<GearAcquisition> = {}): GearAcquisition => ({
  id: 'drop|synthetic guard|test valley|', kind: 'drop', name: 'synthetic guard', zone: 'Test Valley',
  minLevel: 10, maxLevel: 12, requirements: [], evidence: 'catalog', ...extra
})

test('NPC level parsing refuses estimates, lists and ambiguous ranges', () => {
  assert.deepEqual(parseAcquisitionLevels(' 10 – 12 '), { minLevel: 10, maxLevel: 12 })
  assert.deepEqual(parseAcquisitionLevels('8'), { minLevel: 8, maxLevel: 8 })
  for (const text of [undefined, '?', 'about 10', '10+', '10 or 15', '10-12 (rare)', '12-10', '0', '5.5']) {
    assert.deepEqual(parseAcquisitionLevels(text), {}, `${text} must remain unknown`)
  }
})

test('difficulty compares the highest NPC level; quest eligibility does not establish difficulty', () => {
  assert.equal(acquisitionEffort(source(), 17), 'easier')
  assert.equal(acquisitionEffort(source(), 16), 'near-level')
  assert.equal(acquisitionEffort(source(), 12), 'near-level')
  assert.equal(acquisitionEffort(source(), 11), 'harder')
  assert.equal(acquisitionEffort(source({ kind: 'quest', minLevel: 1 }), 50), 'unknown')
  assert.equal(acquisitionEffort(source({ maxLevel: undefined }), 50), 'unknown')
  assert.equal(acquisitionEffort(source({ maxLevel: NaN }), 50), 'unknown')
  assert.equal(acquisitionEffort(source(), NaN), 'unknown')
  assert.equal(acquisitionAvailable(source(), ['WAR'], 1), true, 'high NPC level is not an eligibility gate')
})

test('quest acquisition is only built from explicit rewards, not collectible flags or body references', () => {
  const quests: QuestEntry[] = [{
    name: 'A Synthetic Errand', page: 'A Synthetic Errand', giver: 'Synthetic Guide',
    startZone: 'Test Valley', minLevel: 10, classes: ['Magician', 'Shaman'],
    requiredItems: ['Practice Token', 'Practice Hat'], rewards: [{ name: 'Reward Cap +1' }, { name: 'Reward Cap' }]
  }]
  const rewards = buildQuestRewardIndex(quests)
  assert.equal(rewards.has('practice token'), false)
  assert.equal(rewards.has('practice hat'), false)
  assert.equal(rewards.get('reward cap')?.length, 1)
  const reward = rewards.get('reward cap')?.[0]
  assert.ok(reward)
  assert.deepEqual(reward.classes, ['MAG', 'SHM'])
  assert.equal(reward.minLevel, 10)
  assert.equal(reward.maxLevel, undefined)
  assert.match(reward.requirements.join(' '), /page mentions.*Check quantities/)
  assert.equal(acquisitionAvailable(reward, ['MAG', 'WAR'], 10), true)
  assert.equal(acquisitionAvailable(reward, ['WAR', 'SHM', 'BRD'], 10), true)
  assert.equal(acquisitionAvailable(reward, ['MAG'], 9), false)
  assert.equal(acquisitionAvailable(reward, ['WAR'], 10), false)
  const rows = [gear('Practice Hat', { quest: true }), gear('Reward Cap')]
  const joined = buildGearAcquisitionIndex(rows, new Map(), rewards)
  assert.deepEqual(joined.get('practice hat'), [], 'a quest ingredient flag cannot invent a reward source')
  assert.equal(joined.get('reward cap')?.[0].name, 'A Synthetic Errand')
})

test('unknown quest eligibility text remains visible rather than becoming a false class exclusion', () => {
  for (const classes of [['Karana'], ['All (Faction Dependent)'], ['Cleric', 'others?'], ['All']]) {
    const reward = buildQuestRewardIndex([{ name: 'Test Quest', page: 'Test Quest', classes, rewards: [{ name: 'Cap' }] }]).get('cap')?.[0]
    assert.ok(reward)
    assert.equal(reward.classes, undefined)
    assert.equal(acquisitionAvailable(reward, ['MAG'], 10), true)
    if (classes[0] !== 'All') assert.match(reward.requirements.join(' '), /Quest eligibility from the page:/)
  }
  const reward = buildQuestRewardIndex([{
    name: 'Test Quest', page: 'Test Quest', classes: ['ALL except NEC WIZ MAG ENC'], rewards: [{ name: 'Cap' }]
  }]).get('cap')?.[0]
  assert.ok(reward)
  assert.equal(acquisitionAvailable(reward, ['MAG'], 10), false)
  assert.equal(acquisitionAvailable(reward, ['MAG', 'SHD'], 10), true)
})

test('drop alternatives retain every camp but ambiguous multi-zone coordinates never become pins', () => {
  const mobs: MobEntry[] = [
    { page: 'Test Spider', name: 'test spider', level: '10-12', zones: ['Test Valley'], drops: ['Practice Cap', 'Practice Cap +2'], loc: [{ ns: 10, ew: 20 }, { ns: 30, ew: 40 }] },
    { page: 'Test Beetle', name: 'test beetle', level: '?', zones: ['Test Woods', 'Test Valley'], drops: ['Practice Cap'], loc: [{ ns: 5, ew: 6 }] }
  ]
  const row = gear('Practice Cap', { wikiSources: [
    { mob: 'Test Spider', zone: 'Test Valley' },
    { mob: 'test wasp', zone: 'Test Woods' }, { mob: 'test wasp', zone: 'Test Coast' },
    { mob: 'test wasp', zone: 'Test Coast' }
  ] })
  const sources = buildGearAcquisitionIndex([row], buildSourceIndex(mobs), new Map()).get(row.key) ?? []
  assert.equal(sources.length, 6, 'two spider pins, two beetle zones, and two wiki-only wasp zones')
  assert.equal(sources.filter((entry) => entry.loc).length, 2)
  for (const beetle of sources.filter((entry) => entry.name === 'test beetle')) {
    assert.equal(beetle.loc, undefined)
    assert.match(beetle.requirements.join(' '), /not tied to a specific zone/)
    assert.equal(acquisitionEffort(beetle, 10), 'unknown')
  }
  assert.equal(mergeGearAcquisitions(sources, sources).length, sources.length)
})

test('wiki zones missing from the catalog remain alternatives without borrowing NPC levels or coordinates', () => {
  const rows = [gear('Practice Cap', { wikiSources: [
    { mob: 'test spider', zone: 'Test Valley' }, { mob: 'test spider', zone: 'Test Coast' },
    { mob: 'test wasp', zone: 'Test Valley' }, { mob: 'test skeleton', zone: 'The City of Guk' }
  ] })]
  const drops = new Map([['practice cap', [
    { mob: 'test spider', levelText: '10', zones: ['Test Valley'], loc: [{ ns: 1, ew: 2 }] },
    { mob: 'test wasp', levelText: '20', zones: [] },
    { mob: 'test skeleton', levelText: '30', zones: ['Upper Guk'] }
  ]]])
  const sources = buildGearAcquisitionIndex(rows, drops, new Map()).get('practice cap') ?? []
  const coast = sources.find((entry) => entry.zone === 'Test Coast')
  assert.ok(coast)
  assert.equal(coast.maxLevel, undefined)
  assert.equal(coast.loc, undefined)
  assert.equal(sources.filter((entry) => entry.name === 'test spider').length, 2)
  assert.equal(sources.filter((entry) => entry.name === 'test wasp').length, 2)
  assert.equal(sources.filter((entry) => entry.name === 'test skeleton').length, 1, 'known aliases are one zone')
})

test('quest giver pins require unique identity and an unambiguous matching zone', () => {
  const quest: QuestEntry = { name: 'Test Quest', page: 'Test Quest', giver: 'Test Guide', startZone: 'Test Valley', rewards: [{ name: 'Cap' }] }
  const mob: MobEntry = { name: 'Test Guide', page: 'Test Guide', zones: ['Test Valley'], loc: [{ ns: 25, ew: 30 }] }
  assert.deepEqual(buildQuestRewardIndex([quest], [mob]).get('cap')?.[0].loc, mob.loc?.[0])
  for (const mobs of [[{ ...mob, zones: ['Other Zone'] }], [{ ...mob, zones: ['Test Valley', 'Other Zone'] }], [mob, { ...mob, page: 'Another Guide' }]]) {
    assert.equal(buildQuestRewardIndex([quest], mobs).get('cap')?.[0].loc, undefined)
  }
})
