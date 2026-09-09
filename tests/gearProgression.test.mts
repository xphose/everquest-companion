import assert from 'node:assert/strict'
import test from 'node:test'
import { recommendGear, gearLevelBand, gearMergeAdvice, type GearProgressionInput } from '../src/shared/gearProgression.ts'
import { gearWeights } from '../src/shared/gearProgressionProfile.ts'
import type { ClassAbbr } from '../src/shared/classCombo.ts'
import type { GearRow } from '../src/shared/planner/gear.ts'
import type { OwnershipRow } from '../src/shared/planner/ownership.ts'
import { ownershipKey } from '../src/shared/planner/ownership.ts'
import type { GearAcquisition } from '../src/shared/gearAcquisition.ts'
import type { MacroSpell } from '../src/shared/macros.ts'
import type { WornFocus } from '../src/shared/wornFocus.ts'

const CLASSES: ClassAbbr[] = ['WAR', 'CLR', 'PAL', 'RNG', 'SHD', 'DRU', 'MNK', 'BRD', 'ROG', 'SHM', 'NEC', 'WIZ', 'MAG', 'ENC', 'BST', 'BER']
function row(key: string, patch: Partial<GearRow> = {}): GearRow {
  return { key, name: key, searchKey: key, classes: CLASSES, slots: ['HEAD'], races: [], flags: [],
    quest: false, playerCrafted: false, stats: { HP: 20, MP: 20 }, effects: [], ...patch }
}
function source(name: string, maxLevel: number, patch: Partial<GearAcquisition> = {}): GearAcquisition {
  return { id: name, name, kind: 'drop', zone: 'Steamfont Mountains', minLevel: maxLevel, maxLevel,
    requirements: [], evidence: 'catalog', ...patch }
}
function input(rows: GearRow[]): GearProgressionInput {
  return { rows, character: { characterId: 'example:demo', classes: ['MAG'], level: 10, source: 'live', message: '', spells: [] },
    equipped: [], ownership: [], acquisitions: new Map(rows.map((r) => [r.key, [source(r.key, 5)]])),
    options: { goal: 'auto', mode: 'attainable' } }
}
function copy(tier: number | undefined, patch: Partial<OwnershipRow> = {}): OwnershipRow {
  return { key: 'cap', name: 'cap', rawName: 'cap', tier, count: 1, section: 'Items', place: 'bank', containment: 'top',
    location: 'Bank', exaltation: false, itemId: 1, line: 1, ...patch }
}
function spell(patch: Partial<MacroSpell> = {}): MacroSpell {
  return { id: 1001, name: 'Example Flame +2', classLevels: { MAG: 5 }, castMs: 2000, recoveryMs: 1500, recastMs: 0,
    mana: 10, targetType: 5, effects: [{ effect: 0, base: -40 }], durationFormula: 0, durationTicks: 0, ...patch }
}
const focus: WornFocus = { effect: 'Example Focus', item: '', kind: 'damage', minPct: 10, maxPct: 20, maxLevel: 20, polarity: 'detrimental' }

test('every class and every distinct class trio receives union-eligible suggestions without additive class multiplication', () => {
  for (const abbr of CLASSES) {
    const value = input([row('class-item', { classes: [abbr] }), row('unknown', { classes: [] })])
    value.character.classes = [abbr]
    assert.equal(recommendGear(value).recommendations[0]?.item.key, 'class-item')
  }
  for (let a = 0; a < CLASSES.length; a++) for (let b = a + 1; b < CLASSES.length; b++) for (let c = b + 1; c < CLASSES.length; c++) {
    const value = input([row('class-item', { classes: [CLASSES[c]] })])
    value.character.classes = [CLASSES[a], CLASSES[b], CLASSES[c]]
    assert.equal(recommendGear(value).recommendations.length, 1)
  }
  assert.equal(gearWeights(['MAG'], 'auto').stats.MP, gearWeights(['MAG', 'WIZ', 'ENC'], 'auto').stats.MP)
  assert.equal(gearWeights(['WAR'], 'spells').stats.MP, 0, 'goal overrides do not invent spellcasting')
  assert.deepEqual(recommendGear({ ...input([]), character: { ...input([]).character, classes: ['MAG', 'MAG'] } }).classes, ['MAG'])
})

test('five-level bands preserve exact equip-level eligibility, effect unlocks do not block wearing an item', () => {
  assert.deepEqual(gearLevelBand(10), { min: 6, max: 10, label: '6 - 10' })
  assert.deepEqual(gearLevelBand(11), { min: 11, max: 15, label: '11 - 15' })
  const value = input([row('eleven', { requiredLevel: 11 }), row('effect-later', { effects: [{ name: 'Late click', kind: 'click', reqLevel: 30 }] })])
  assert.deepEqual(recommendGear(value).recommendations.map((r) => r.item.key), ['effect-later'])
  value.options.level = 11
  assert.equal(recommendGear(value).recommendations.length, 2)
})

test('near-level meaningful gain beats a tiny easy gain; unknown and harder sources stay behind attainable routes', () => {
  const value = input([row('tiny', { stats: { HP: 1 } }), row('good', { stats: { HP: 50 } }), row('boss', { stats: { HP: 5000 } }), row('unknown', { stats: { HP: 10000 } })])
  value.acquisitions = new Map([['tiny', [source('tiny', 1)]], ['good', [source('good', 10)]], ['boss', [source('boss', 50)]]])
  const plan = recommendGear(value)
  assert.deepEqual(plan.recommendations.map((r) => r.item.key), ['good', 'tiny', 'unknown', 'boss'])
  value.options.mode = 'potential'
  value.options.targetTier = 8
  assert.equal(recommendGear(value).recommendations[0]?.tier, 8)
  assert.equal(recommendGear(value).recommendations[0]?.effort, 'unknown')
})

test('quest flags never imply a reward and quest minimum level never implies easy combat', () => {
  const value = input([row('ingredient', { quest: true }), row('quest')])
  value.acquisitions = new Map([['quest', [source('Quest', 1, { kind: 'quest', minLevel: 1 })]]])
  const plan = recommendGear(value)
  assert.ok(plan.recommendations.find((r) => r.item.key === 'ingredient')?.cautions.some((text) => text.includes('ingredient')))
  assert.equal(plan.recommendations.find((r) => r.item.key === 'quest')?.effort, 'unknown')
})

test('class, era, source era and lore-equipped paired restrictions prevent illegal suggestions', () => {
  const value = input([row('future', { eraTag: 'kunark' }), row('inverted-future'), row('wrong', { classes: ['WAR'] }),
    row('ring', { slots: ['FINGER'], flags: ['Lore Item'] }), row('normal-ring', { slots: ['FINGER'], flags: ['Lore Equipped'] })])
  value.acquisitions = new Map([['inverted-future', [source('Future mob', 1, { zone: 'Field of Bone' })]]])
  value.equipped = [{ key: 'ring', name: 'ring', slot: 'FINGER', tier: 10 }, { key: 'normal-ring', name: 'normal-ring', slot: 'FINGER2', tier: 10 }]
  assert.equal(recommendGear(value).recommendations.length, 0)
})

test('unknown equipment or tier stays explicitly unverified; unknown classes or level gives no personalized plan', () => {
  const value = input([row('new')]); value.equipped = null
  assert.equal(recommendGear(value).recommendations[0]?.comparisonKnown, false)
  value.equipped = [{ key: 'missing', name: 'Missing item', slot: 'HEAD' }]
  assert.equal(recommendGear(value).recommendations[0]?.comparisonKnown, false)
  assert.equal(recommendGear(value).myGear[0]?.action, 'unknown')
  value.character.classes = []
  assert.equal(recommendGear(value).recommendations.length, 0)
  assert.equal(recommendGear(value).myGear[0]?.name, 'Missing item', 'incomplete profile never erases exported inventory')
  assert.equal(recommendGear(value).myGear[0]?.action, 'unknown')
  value.character.classes = ['MAG']; value.character.level = undefined
  assert.equal(recommendGear(value).recommendations.length, 0)
})

test('owned fractional ceiling prevents a false replacement and spare equip uses its actual tier', () => {
  const value = input([row('old', { stats: { HP: 100 } }), row('new', { stats: { HP: 125 } })])
  value.equipped = [{ key: 'old', name: 'old', slot: 'HEAD', tier: 2 }]
  assert.equal(recommendGear(value).recommendations.some((r) => r.item.key === 'new'), false)
  value.ownership = [[ownershipKey('new'), [copy(2, { name: 'new', key: ownershipKey('new') })]]]
  const candidate = recommendGear(value).recommendations.find((r) => r.item.key === 'new')
  assert.equal(candidate?.tier, 2)
  assert.equal(candidate?.action, 'equip')
})

test('unstated incumbent stats do not become zero or a verified replacement benefit', () => {
  const value = input([row('old', { stats: { AC: 2 } }), row('new', { stats: { AC: 3, HP: 100 } })])
  value.equipped = [{ key: 'old', name: 'old', slot: 'HEAD', tier: 0 }]
  const next = recommendGear(value).recommendations.find((candidate) => candidate.item.key === 'new')
  assert.equal(next?.comparisonKnown, false)
  assert.equal(next?.benefit, 'Health for your adventures')
  assert.ok(next?.cautions.some((text) => text.includes('Missing values are not proof of zero')))
})

test('merge XP is bounded, max-tier donor XP is unknown, and equipped, socket and exaltation copies never get spent', () => {
  const copies = [copy(1, { count: 3 }), copy(2, { place: 'inventory' }), copy(10), copy(undefined),
    copy(8, { place: 'equipped' }), copy(8, { containment: 'socket' }), copy(8, { exaltation: true })]
  const advice = gearMergeAdvice(3, copies, 'More health')
  assert.deepEqual(advice?.xp, { min: 1, max: 8 })
  assert.equal(advice?.availableCopies, 6)
  assert.equal(advice?.availableXp, 10)
  assert.deepEqual(advice?.unlocks, ['Proc'])
  assert.deepEqual(gearMergeAdvice(0, [], '')?.xp, { min: 1, max: 1 })
  assert.equal(gearMergeAdvice(10, copies, ''), undefined)
  assert.equal(gearMergeAdvice(undefined, copies, ''), undefined)
})

test('one spare XP at +9 cannot promise a whole +10 upgrade with unknown fractional progress', () => {
  const value = input([row('cap', { stats: { HP: 1000 } })])
  value.equipped = [{ key: 'cap', name: 'cap', slot: 'HEAD', tier: 9 }]
  value.ownership = [[ownershipKey('cap'), [copy(0)]]]
  assert.equal(recommendGear(value).recommendations.length, 0)
  assert.equal(recommendGear(value).myGear[0]?.merge?.xp.max, 512)
})

test('redundant haste is not valued or advertised as a benefit', () => {
  const value = input([row('belt', { slots: ['WAIST'], stats: { HASTE: 40 } }), row('cap', { stats: { HASTE: 20, HP: 5 } })])
  value.character.classes = ['WAR']
  value.equipped = [{ key: 'belt', name: 'belt', slot: 'WAIST', tier: 0 }]
  const recommendation = recommendGear(value).recommendations.find((r) => r.item.key === 'cap')
  assert.equal(recommendation?.score, 0.6)
  assert.equal(recommendation?.benefit, 'A bigger health buffer')
})

test('focus uses actual eligible upgraded spells, learned-level decay, exact duration and strongest equipment focus', () => {
  const value = input([row('focus', { stats: {}, effects: [{ name: 'Example Focus', kind: 'focus' }] })])
  value.character.spells = [spell()]; value.character.focusByEffect = { 'example focus': focus }
  assert.equal(recommendGear(value).recommendations[0]?.score, 15)
  value.character.wornFocus = [{ ...focus, item: 'Other belt', minPct: 25, maxPct: 25 }]
  assert.equal(recommendGear(value).recommendations.length, 0)
  value.character.wornFocus = []
  value.character.spells = [spell({ classLevels: { MAG: 50 } })]
  assert.equal(recommendGear(value).recommendations.length, 0)
  value.character.spells = [spell({ classLevels: { MAG: 10 } })]
  value.character.focusByEffect['example focus'] = { ...focus, maxLevel: 1 }
  assert.equal(recommendGear(value).recommendations[0]?.score, 8.25)
  value.character.focusByEffect['example focus'] = { ...focus, maxDurationMs: 30000 }
  value.character.spells = [spell({ durationFormula: 1, durationTicks: 100 })]
  assert.equal(recommendGear(value).recommendations[0]?.score, 15, 'formula 1 at level 10 is five ticks, not a 100-tick cap')
  value.character.spells = [spell({ durationFormula: undefined })]
  assert.equal(recommendGear(value).recommendations.length, 0, 'unknown duration never masquerades as instant')
})

test('per-slot planning keeps full candidate pool for My gear even beyond the 36-card limit', () => {
  const rows = Array.from({ length: 40 }, (_, i) => row(`head${i}`, { stats: { HP: 1000 + i } }))
  rows.push(row('old-boots', { slots: ['FEET'], stats: { HP: 1 } }), row('new-boots', { slots: ['FEET'], stats: { HP: 5 } }))
  const value = input(rows)
  value.equipped = [{ key: 'old-boots', name: 'old-boots', slot: 'FEET', tier: 0 }]
  assert.equal(recommendGear(value).recommendations.length, 36)
  assert.equal(recommendGear(value).myGear[0]?.recommendation?.item.key, 'new-boots')
  value.options.slot = 'FEET'
  assert.equal(recommendGear(value).recommendations[0]?.item.key, 'new-boots')
})

test('compatible Exaltation options preserve host, donor, narrowed classes and reject haste or excluded spells', () => {
  const host = row('host', { classes: ['MAG', 'WAR'] })
  const donor = row('donor', { classes: ['MAG'], effects: [{ name: 'Example Focus', kind: 'focus', socket: 'focus', tierRequired: 1 }] })
  const value = input([host, donor]); value.character.spells = [spell()]; value.character.focusByEffect = { 'example focus': focus }
  const advice = recommendGear(value).recommendations.find((r) => r.item.key === 'host')?.exaltations?.[0]
  assert.equal(advice?.donorName, 'donor')
  assert.equal(advice?.baseCopies, 1)
  assert.deepEqual(advice?.classes, ['MAG'])
  value.character.focusByEffect['example focus'] = { ...focus, excludesSpells: ['example flame'] }
  assert.equal(recommendGear(value).recommendations.find((r) => r.item.key === 'host')?.exaltations?.length, 0)
  donor.effects[0].hasteLocked = true
  value.character.focusByEffect['example focus'] = focus
  assert.equal(recommendGear(value).recommendations.find((r) => r.item.key === 'host')?.exaltations?.length, 0)
})
