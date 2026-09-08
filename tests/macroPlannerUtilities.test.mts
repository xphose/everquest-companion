import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CLASS_ABBRS, type ClassAbbr } from '../src/shared/classCombo'
import type { MacroPlanInput, MacroRole, MacroSpell } from '../src/shared/macros'
import { isMacroSelection } from '../src/shared/macros'
import { planMacros } from '../src/shared/macros/planner'
import { starterSelections } from '../src/shared/macros/presentation'
import { isFriendlyUtilitySpell, utilityRoles } from '../src/shared/macros/utilityRoles'

// Authored rows exercise effect meanings from EQEmu spdat.h and verified Legends target codes.
// They are not copied spell-table rows or claims that classes learn these fixture spell names.
function spell(id: number, name: string, [effect, base]: [number, number], changes: Partial<MacroSpell> = {}): MacroSpell {
  return { id, name, classLevels: { MAG: 1 }, castMs: 3000, recoveryMs: 1500, recastMs: 0,
    mana: 10, targetType: 51, effects: [{ effect, base }], ...changes }
}
const food = spell(50, 'Summon Food', [32, 13078], { targetType: 6 })
const drink = spell(211, 'Summon Drink', [32, 13079], { targetType: 6 })
function input(spells: MacroSpell[] = [food, drink], classes: ClassAbbr[] = ['MAG', 'SHM']): MacroPlanInput {
  return { player: { characterName: 'Example', classes, level: 10, spellbook: spells.map((s) => s.id),
    memorizedSpells: [...spells.slice(0, 14).map((s) => s.id), ...Array<null>(18 - Math.min(spells.length, 14)).fill(null)],
    unlockedSpellSlots: Array.from({ length: 14 }, (_, i) => i + 1) }, spells, style: 'solo' }
}
const utilities = (config: MacroPlanInput, role: MacroRole) => planMacros(config).filter((r) => r.role === role)

test('food, drink and every owned self item-summon family remain distinct cast-and-stow choices', () => {
  const weapon = spell(30, 'Summon Sword', [32, 999], { targetType: 6 })
  const config = input([food, drink, weapon])
  const recipes = utilities(config, 'summon-item')
  assert.deepEqual(recipes.map((r) => r.id), ['summon-item:summon drink', 'summon-item:summon food', 'summon-item:summon sword'])
  assert.equal(new Set(recipes.map((r) => r.name)).size, 3)
  assert.deepEqual(recipes.find((r) => r.requiredSpellIds[0] === 50)!.lines, ['/pause 47, /cast 1', '/autoinventory'])
  assert.ok(recipes.every((r) => r.description.includes('empty cursor') && r.description.includes('bag space')))
  const selectedFood = recipes.find((r) => r.requiredSpellIds[0] === 50)!.selection
  assert.equal(planMacros(config, [selectedFood]).filter((r) => r.role === 'summon-item').length, 3)
  assert.deepEqual(starterSelections(recipes, []), [recipes[0].selection])
  config.player.memorizedSpells![1] = null
  const unmemorized = utilities(config, 'summon-item').find((r) => r.requiredSpellIds[0] === 211)!
  assert.equal(unmemorized.status, 'needs-memorizing')
  assert.deepEqual(unmemorized.lines, [])
})
test('utility rank upgrades stay in the selected family and use actual reordered unlocked gems', () => {
  const rank1 = spell(80, 'Clear Vision I', [13, 1])
  const rank2 = spell(7, 'Clear Vision II', [13, 1])
  const config = input([rank1, rank2])
  config.player.memorizedSpells![1] = null
  const first = utilities(config, 'vision')[0]
  assert.deepEqual(first.requiredSpellIds, [80])
  assert.equal(first.upgrade?.to.id, 7)
  config.player.memorizedSpells = [null, null, 7, ...Array<null>(15).fill(null)]
  const upgraded = planMacros(config, [first.selection]).find((r) => r.id === first.id)!
  assert.deepEqual(upgraded.lines, ['/pause 47, /cast 3'])
  config.player.unlockedSpellSlots = [1, 2]
  assert.equal(planMacros(config, [first.selection]).find((r) => r.id === first.id)!.status, 'needs-memorizing')
})
test('verified friendly utilities and deliberate single-target controls have useful roles', () => {
  const examples: [MacroRole, number, number, number][] = [
    ['cure', 35, -4, 51], ['cure', 36, -4, 5], ['cure', 116, -4, 6],
    ['invisibility', 12, 1, 51], ['invisibility', 28, 1, 6], ['invisibility', 29, 1, 51],
    ['vision', 13, 1, 51], ['vision', 65, 1, 6], ['vision', 66, 1, 14],
    ['breathing', 14, 1, 51], ['levitation', 57, 1, 51], ['rune', 55, 10, 51],
    ['gate', 26, 98, 6], ['root', 99, -10000, 5], ['snare', 3, -30, 5], ['lull', 30, 15, 5], ['lull', 86, 15, 5]
  ]
  for (const [role, effect, base, targetType] of examples) {
    const row = spell(1, 'Test Utility', [effect, base], { targetType })
    assert.ok(utilityRoles(row).includes(role), `${role}: effect ${effect}`)
    const recipe = utilities(input([row]), role)[0]
    assert.equal(recipe.ready, true)
    assert.equal(isMacroSelection(recipe.selection), true)
    assert.equal(recipe.lines[0], role === 'lull' ? '/attack off' : '/pause 47, /cast 1')
  }
})
test('friendly utility recommendations exclude AE, unknown mixtures, hostile counters and HP damage', () => {
  for (const targetType of [1, 3, 4, 8, 20, 40, 41]) {
    assert.deepEqual(utilityRoles(spell(1, 'Unsupported Area', [12, 1], { targetType })), [])
  }
  for (const [effect, base] of [[0, -1], [3, -1], [11, 50], [22, 1], [31, 1], [35, 1], [36, 1], [116, 1], [999, 1]]) {
    const row = spell(1, 'Mixed Utility', [13, 1])
    row.effects.push({ effect, base })
    assert.deepEqual(utilityRoles(row), [])
    assert.equal(isFriendlyUtilitySpell(row), false)
  }
  assert.deepEqual(utilityRoles({ ...food, targetType: 5 }), [])
  assert.deepEqual(utilityRoles({ ...food, effects: [...food.effects, { effect: 0, base: -1 }] }), [])
  assert.deepEqual(utilityRoles(spell(1, 'Group Gate', [26, 1], { targetType: 41 })), [])
  assert.deepEqual(utilityRoles(spell(1, 'Friendly Root', [99, 0])), [])
  const mixedRoot = spell(1, 'Root And Nuke', [99, 0], { targetType: 5 })
  mixedRoot.effects.push({ effect: 0, base: -20 })
  assert.deepEqual(utilityRoles(mixedRoot), [])
})
test('all sixteen classes retain universal utilities and only eligible observed spell support', () => {
  const melee: ClassAbbr[] = ['BER', 'MNK', 'ROG', 'WAR']
  const rows = CLASS_ABBRS.filter((cls) => !melee.includes(cls)).map((cls, i) =>
    spell(100 + i, `Vision ${cls}`, [13, 1], { classLevels: { [cls]: 1 } }))
  for (const cls of CLASS_ABBRS) {
    const recipes = planMacros(input(rows, [cls]))
    assert.deepEqual(recipes.filter((r) => !r.requiredSpellIds.length).map((r) => r.role), ['loc', 'export'])
    assert.equal(recipes.filter((r) => r.role === 'vision').length, melee.includes(cls) ? 0 : 1, cls)
  }
})
test('two- and three-class combinations are order-independent unions, deduplicating shared eligible spells', () => {
  const rows = [spell(80, 'Shared Vision', [13, 1], { classLevels: { MAG: 1, SHM: 1, ENC: 1 } }),
    ...CLASS_ABBRS.filter((cls) => !['BER', 'MNK', 'ROG', 'WAR'].includes(cls)).map((cls, i) =>
      spell(100 + i, `Vision ${cls}`, [13, 1], { classLevels: { [cls]: 1 } }))]
  const ids = (classes: ClassAbbr[]) => utilities(input(rows, classes), 'vision').flatMap((r) => r.requiredSpellIds).sort((a, b) => a - b)
  for (let a = 0; a < CLASS_ABBRS.length; a++) for (let b = a + 1; b < CLASS_ABBRS.length; b++) {
    const pair = [CLASS_ABBRS[a], CLASS_ABBRS[b]]
    assert.deepEqual(ids(pair), ids([...pair].reverse()))
    for (let c = b + 1; c < CLASS_ABBRS.length; c++) {
      const combo = [...pair, CLASS_ABBRS[c]]
      const expected = rows.filter((row) => combo.some((cls) => row.classLevels[cls] === 1)).map((r) => r.id).sort((x, y) => x - y)
      assert.deepEqual(ids(combo), expected)
      assert.deepEqual(ids([combo[2], combo[0], combo[1]]), expected)
    }
  }
})
test('replacing startup inferred classes removes stale availability without losing explicit utility choices', () => {
  const vision = spell(80, 'Mind Sight', [13, 1], { classLevels: { ENC: 1 } })
  const config = input([food, drink, vision], ['MAG', 'SHM'])
  const selected = utilities(config, 'summon-item')[0].selection
  assert.equal(utilities(config, 'vision').length, 0)
  config.player.classes = ['SHM', 'ENC', 'WAR']
  const after = planMacros(config, [selected])
  assert.equal(after.find((r) => r.id === 'summon-item:summon drink')!.status, 'unavailable')
  assert.equal(after.find((r) => r.role === 'vision')!.ready, true)
  assert.equal(after.filter((r) => r.role === 'summon-item' && r.ready).length, 0)
})
test('owned book membership, valid classes and eligible level remain necessary for every utility', () => {
  const config = input()
  config.spells.push(spell(10, 'Summon Treasure', [32, 1], { targetType: 6 }))
  assert.equal(utilities(config, 'summon-item').length, 2)
  config.player.spellbook = [50, 10]
  config.spells[2].classLevels = { MAG: 11, SHM: 255 }
  assert.equal(utilities(config, 'summon-item').length, 1)
  config.player.level = 11
  assert.equal(utilities(config, 'summon-item').length, 2)
  config.player.classes = ['INVALID' as ClassAbbr]
  assert.deepEqual(planMacros(config).map((r) => r.role), ['loc', 'export'])
  config.player.classes = ['MAG', 'SHM']
  config.player.spellbook = undefined
  assert.deepEqual(planMacros(config).map((r) => r.role), ['loc', 'export'])
})
