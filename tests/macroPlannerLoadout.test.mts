import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { MacroPlanInput, MacroRecipe, MacroRole, MacroSpell } from '../src/shared/macros'
import { compileMacro } from '../src/shared/macros/compiler'
import { planMacroLoadout } from '../src/shared/macros/loadout'

function spell(id: number): MacroSpell {
  return { id, name: `Spell ${id}`, classLevels: { MAG: 1 }, castMs: 1000, recoveryMs: 1000,
    recastMs: 0, mana: 10, targetType: 5, effects: [{ effect: 0, base: -10 }] }
}
function input(slots: number[] = [1, 3, 5], occupied: (number | null)[] = []): MacroPlanInput {
  return { player: { classes: ['MAG', 'SHM'], level: 10, spellbook: [1, 2, 3, 4, 5, 6],
    unlockedSpellSlots: slots, memorizedSpells: [...occupied, ...Array<null>(18 - occupied.length).fill(null)] },
  spells: [1, 2, 3, 4, 5, 6].map(spell), style: 'solo' }
}
function recipe(config: MacroPlanInput, role: MacroRole, ids: number[]): MacroRecipe {
  return { id: role, role, name: role, description: 'Authored selected recipe', selection: { role },
    ...compileMacro(role, ids.length ? ids.map((spellId) => ({ kind: 'cast', spellId })) : [{ kind: 'command', command: '/loc' }], config) }
}
function plan(config: MacroPlanInput, recipes: MacroRecipe[]) {
  return planMacroLoadout(config, recipes, recipes.map((r) => r.selection))
}

test('loadout deduplicates shared requirements and keeps their exact unlocked gem positions', () => {
  const config = input([1, 3, 5], [6, null, 1, null, 2])
  const recipes = [recipe(config, 'damage', [1]), recipe(config, 'pet-opener', [1, 2])]
  const before = structuredClone({ config, recipes })
  const result = plan(config, recipes)
  assert.equal(result.state, 'ready')
  assert.equal(result.requiredSpellCount, 2)
  assert.equal(result.missingSpellCount, 0)
  assert.deepEqual(result.slots.map((s) => [s.gem, s.spellId, s.action, s.required]),
    [[1, 6, 'keep', false], [3, 1, 'keep', true], [5, 2, 'keep', true]])
  assert.deepEqual({ config, recipes }, before)
})
test('loadout fills empty unlocked gems before explicitly replacing an unrelated spell', () => {
  const config = input([1, 3, 5], [6, null, 1])
  const result = plan(config, [recipe(config, 'damage', [1, 2, 3])])
  assert.equal(result.state, 'needs-memorizing')
  assert.equal(result.missingSpellCount, 2)
  assert.deepEqual(result.slots.map((s) => [s.gem, s.spellId, s.action]),
    [[1, 3, 'replace'], [3, 1, 'keep'], [5, 2, 'memorize']])
  assert.equal(result.slots[0].currentSpellId, 6)
  assert.equal(result.slots[0].currentName, 'Spell 6')
  assert.equal(result.slots[0].name, 'Spell 3')
  assert.equal(result.slots[2].currentSpellId, undefined)
})
test('spare capacity preserves unrelated occupied spells and empty gem rows without churn', () => {
  const config = input([1, 2, 4, 6], [6, 1])
  const result = plan(config, [recipe(config, 'damage', [1, 2])])
  assert.deepEqual(result.slots.map((s) => [s.gem, s.spellId, s.action]),
    [[1, 6, 'keep'], [2, 1, 'keep'], [4, 2, 'memorize'], [6, undefined, 'empty']])
})
test('over-capacity planning reports exact omitted spells in recipe priority and retains loaded requirements', () => {
  const config = input([1, 3], [4])
  const recipes = [recipe(config, 'damage', [1, 2, 3]), recipe(config, 'pet-opener', [4])]
  const result = plan(config, recipes)
  assert.equal(result.state, 'over-capacity')
  assert.equal(result.availableSlots, 2)
  assert.equal(result.requiredSpellCount, 4)
  assert.equal(result.missingSpellCount, 3)
  assert.equal(result.overflow, 2)
  assert.deepEqual(result.omitted.map((s) => s.id), [2, 3])
  assert.deepEqual(result.slots.map((s) => s.spellId), [4, 1])
  assert.deepEqual(plan(config, recipes), result)
})
test('duplicate loaded copies share one requirement and can yield capacity to a missing spell', () => {
  const config = input([1, 3], [1, null, 1])
  const result = plan(config, [recipe(config, 'damage', [1, 2])])
  assert.equal(result.state, 'needs-memorizing')
  assert.deepEqual(result.slots.map((s) => [s.spellId, s.action]), [[1, 'keep'], [2, 'replace']])
  assert.equal(result.slots[1].currentSpellId, 1)
})
test('unknown slots and unobserved unlocked contents yield no speculative assignments', () => {
  const config = input()
  const recipes = [recipe(config, 'damage', [1])]
  config.player.unlockedSpellSlots = undefined
  const unknown = plan(config, recipes)
  assert.equal(unknown.state, 'unavailable')
  assert.equal(unknown.availableSlots, undefined)
  assert.deepEqual(unknown.slots, [])
  config.player.unlockedSpellSlots = [1, 3]
  config.player.memorizedSpells = [null]
  assert.equal(plan(config, recipes).state, 'unavailable')
  assert.deepEqual(plan(config, recipes).slots, [])
  config.player.memorizedSpells = [null, null, null]
  delete config.player.memorizedSpells[2]
  assert.equal(plan(config, recipes).state, 'unavailable')
})
test('verified no castable gems and occupied unsupported positions never supply capacity', () => {
  const config = input([15, 18], [...Array<null>(14).fill(null), 1])
  const result = plan(config, [recipe(config, 'damage', [1])])
  assert.equal(result.state, 'over-capacity')
  assert.equal(result.availableSlots, 0)
  assert.equal(result.overflow, 1)
  assert.deepEqual(result.slots, [])
  config.player.unlockedSpellSlots = []
  assert.equal(plan(config, [recipe(config, 'loc', [])]).state, 'ready')
})
test('missing or unsupported selected requirements stay unavailable instead of falsely fitting', () => {
  const config = input()
  assert.equal(planMacroLoadout(config, [], [{ role: 'damage' }]).state, 'unavailable')
  assert.equal(plan(config, [recipe(config, 'damage', [])]).state, 'unavailable')
  const unsupported = recipe(config, 'loc', [])
  unsupported.ready = false; unsupported.status = 'unavailable'
  assert.equal(plan(config, [unsupported]).state, 'unavailable')
})
test('unowned, wrong-class and level-ineligible requirements cannot receive assignments', () => {
  for (const invalid of ['unowned', 'class', 'level', 'metadata'] as const) {
    const config = input()
    const recipes = [recipe(config, 'damage', [1])]
    if (invalid === 'unowned') config.player.spellbook = [2]
    if (invalid === 'class') config.player.classes = ['WAR', 'MNK']
    if (invalid === 'level') config.spells[0].classLevels.MAG = 50
    if (invalid === 'metadata') config.spells = []
    const result = plan(config, recipes)
    assert.equal(result.state, 'unavailable', invalid)
    assert.deepEqual(result.slots, [])
    assert.deepEqual(result.omitted.map((s) => s.id), [1])
  }
})
test('a proposed assignment does not create installable commands until the actual gem observation changes', () => {
  const config = input([1, 3])
  const unready = recipe(config, 'damage', [1])
  assert.equal(plan(config, [unready]).state, 'needs-memorizing')
  assert.equal(unready.ready, false)
  assert.deepEqual(unready.lines, [])
  assert.equal(recipe(config, 'damage', [1]).ready, false)
  config.player.memorizedSpells![2] = 1
  assert.deepEqual(recipe(config, 'damage', [1]).lines, ['/pause 22, /cast 3'])
  assert.equal(plan(config, [recipe(config, 'damage', [1])]).state, 'ready')
})
