import assert from 'node:assert/strict'
import test from 'node:test'
import { parseInventoryDump } from '../src/main/outputs/inventoryParse'
import { parseItemName } from '../src/shared/outputs/inventory'
import { inventoryExportTier } from '../src/shared/outputs/inventoryTier'
import { equippedHosts } from '../src/shared/planner/inventorySlots'
import { ownershipIndex, ownershipKey, ownershipForLootName } from '../src/shared/planner/ownership'
import { recommendGear, type GearProgressionInput } from '../src/shared/gearProgression'
import { knownGearTier } from '../src/shared/gearProgressionMerge'
import { hostText } from '../src/renderer/src/features/gear/gearCompare'
import { factText } from '../src/renderer/src/features/gear/gearOwnership'

function entry(name: string, itemId = 321) {
  return { name, parsedName: parseItemName(name), itemId }
}

test('ordinary native base exports resolve zero without changing raw suffix metadata', () => {
  const item = entry('Dawn Cap')
  assert.equal(item.parsedName.tier, undefined)
  assert.equal(inventoryExportTier(item), 0)
  assert.equal(item.parsedName.tier, undefined)
  for (let tier = 0; tier <= 10; tier++) {
    assert.equal(inventoryExportTier(entry(`Dawn Cap +${tier}`)), tier)
    assert.equal(inventoryExportTier(entry(`Dawn Cap +${tier}*`)), tier)
  }
})

test('special decorations, malformed tiers and invalid unsuffixed records remain unknown', () => {
  for (const name of ['', 'Empty', ' Dawn Cap', 'Dawn Cap ', 'Dawn\tCap', 'Dawn Cap*',
    'Dawn Cap (Exaltation)', 'Dawn Cap +2 (Exaltation)', 'Dawn Cap (Ornamentation)',
    'Dawn Cap (Ornamentation) +2', 'Dawn Cap +11', 'Dawn Cap +01', 'Dawn Cap +1.5',
    'Dawn Cap +-1', 'Dawn Cap + 1', 'Dawn Cap +1 extra', 'Dawn Cap +Infinity']) {
    assert.equal(inventoryExportTier(entry(name)), undefined, name)
  }
  for (const id of [0, -1, 0.5, Infinity, NaN]) assert.equal(inventoryExportTier(entry('Dawn Cap', id)), undefined)
})

test('native equipment and all ownership locations agree on base tiers while preserving special rows', () => {
  const dump = parseInventoryDump([
    'Location\tName\tID\tCount\tSlots',
    'Head\tDawn Cap\t321\t1\t10', 'General 1\tDawn Cap\t321\t1\t10',
    'Bank1\tDawn Cap\t321\t1\t10', 'SharedBank1\tDawn Cap +2\t321\t1\t10',
    'Head-Slot7\tDawn Cap (Exaltation)\t321\t1\t10',
    'Bank2\tDawn Cap*\t321\t1\t10',
    'KeyRing\tName\tID', 'Equipment\tDawn Cap\t321'
  ].join('\n'))
  assert.deepEqual(equippedHosts(dump), [{ slot: 'HEAD', name: 'Dawn Cap', tier: 0 }])
  const rows = ownershipIndex(dump).get('dawn cap') ?? []
  assert.deepEqual(rows.map(row => [row.place, row.tier]), [
    ['equipped', 0], ['equipped', undefined], ['inventory', 0], ['bank', 0],
    ['sharedBank', 2], ['bank', undefined], ['keyring', 0]
  ])
  assert.equal(rows[0]?.rawName, 'Dawn Cap')
  assert.equal(rows[1]?.exaltation, true)
})

function progressionInput(): GearProgressionInput {
  const dump = parseInventoryDump('Location\tName\tID\tCount\tSlots\nHead\tDawn Cap\t321\t1\t10\nBank1\tDawn Cap\t321\t2\t10\n')
  return {
    rows: [{ key: 'dawn cap', name: 'Dawn Cap', searchKey: 'dawn cap', classes: ['CLR'], slots: ['HEAD'], races: [], flags: [],
      quest: false, playerCrafted: false, stats: { HP: 20 }, effects: [] }],
    equipped: equippedHosts(dump).map(host => ({ ...host, key: ownershipKey(host.name) })),
    ownership: [...ownershipIndex(dump)], acquisitions: new Map(),
    character: { characterId: 'example:sample', classes: ['CLR'], level: 37, source: 'log', message: '' },
    options: { goal: 'auto', mode: 'attainable' }
  }
}

test('the parsed base item gets real gear advice and spare base copies contribute verified XP', () => {
  const input = progressionInput()
  const advice = recommendGear(input).myGear[0]
  assert.equal(advice?.tier, 0)
  assert.equal(advice.action, 'improve')
  assert.equal(advice.merge?.fromTier, 0)
  assert.equal(advice.merge?.toTier, 1)
  assert.equal(advice.merge?.availableXp, 2)
  assert.equal(advice.merge?.availableCopies, 2)
  input.ownership = []
  assert.equal(recommendGear(input).myGear[0]?.action, 'keep')
})

test('manual missing-tier gear and raw loot names remain unknown; base display names stay uncluttered', () => {
  const input = progressionInput()
  input.equipped = [{ key: 'dawn cap', name: 'Dawn Cap', slot: 'HEAD' }]
  assert.equal(recommendGear(input).myGear[0]?.action, 'unknown')
  assert.equal(knownGearTier(undefined), undefined)
  assert.equal(ownershipForLootName(new Map(input.ownership), 'Dawn Cap').tier, undefined)
  for (const tier of [undefined, 0, 1, 10]) {
    const suffix = tier ? ` +${tier}` : ''
    assert.equal(hostText({ key: 'dawn cap', name: 'Dawn Cap', slot: 'HEAD', tier }), `Dawn Cap${suffix}`)
    assert.equal(factText({ place: 'bank', count: 1, tier }), `Bank${suffix}`)
  }
})
