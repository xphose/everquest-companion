import assert from 'node:assert/strict'
import test from 'node:test'
import { planMacroPreparation, preparationOptions, preparationPhase, foodDrinkPreset, changePreparationSelection } from '../src/shared/macros/preparation'
import { canCapturePreparation } from '../src/shared/macros/preparationOptions'
import { prepInput, prepSpell } from './macroPreparationFixture.mts'

test('options use owned strongest same-family ranks and precise food/drink presets across current classes', () => {
  const input = prepInput()
  const options = preparationOptions(input)
  assert.deepEqual(new Set(foodDrinkPreset(options)), new Set([12, 11]))
  assert.equal(options.some((option) => option.spellId === 10), false)
  assert.equal(options.some((option) => option.spellId === 20), false)
  const illusion = prepSpell(40, 'Illusion: Food', 12)
  input.spells.push(illusion); input.player.spellbook?.push(40)
  assert.equal(preparationOptions(input).find((option) => option.spellId === 40)?.preset, undefined)
  input.player.classes = ['CLR', 'DRU']
  assert.deepEqual(preparationOptions(input), [])
  input.spells[0].classLevels = { CLR: 1 }
  assert.deepEqual(preparationOptions(input).map((option) => [option.spellId, option.classes]), [[10, ['CLR']]])
})

test('safe self utilities exclude hostile mixtures, pet targets, AE and teleports', () => {
  const input = prepInput()
  const extras = [prepSpell(40, 'Cure Poison', 35, 51), prepSpell(41, 'Vision', 13, 6), prepSpell(42, 'Gate', 26),
    prepSpell(43, 'Pet Buff', 4, 14), prepSpell(44, 'Area Buff', 4, 3), prepSpell(45, 'Charm', 22, 5), prepSpell(46, 'Mixed Gift', 12)]
  extras[6].effects.push({ effect: 0, base: -10 })
  input.spells.push(...extras); input.player.spellbook?.push(...extras.map((spell) => spell.id))
  assert.deepEqual(preparationOptions(input).filter((option) => option.spellId >= 40).map((option) => option.spellId), [40, 41])
})

test('highest filled non-selected gems are replaced and exact positive return IDs are captured without mutating input', () => {
  const input = prepInput(); const original = structuredClone(input)
  const result = planMacroPreparation(input, [12, 11])
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.deepEqual(result.plan.replacements.map((slot) => [slot.gem, slot.originalSpellId, slot.spellId]), [[12, 30, 12], [3, 21, 11]])
  assert.equal(result.plan.combatGems[11], 30)
  assert.equal(result.plan.combatGems[2], 21)
  assert.equal(result.plan.preparationGems[0], -1, 'An untouched occupied combat slot stays unchanged')
  assert.equal(result.plan.preparationGems[1], -1, 'An empty slot is never used for temporary spells')
  assert.equal(result.plan.preparationGems.length, 14)
  assert.equal(result.plan.combatGems.length, 14)
  assert.deepEqual(input, original)
  assert.deepEqual(result.plan.utilities.map((utility) => utility.buttonName), ['Make Food', 'Make Drink'])
  assert.ok(result.plan.utilities.every((utility) => utility.lines.length <= 5 && utility.lines.at(-1) === '/autoinventory'))
  assert.ok(result.plan.utilities[0].lines.some((line) => line.endsWith('/cast Summon Food II')))
  assert.ok(result.plan.utilities.every((utility) => !utility.lines.some((line) => /\/cast \d+$/u.test(line))))
})

test('already loaded selected utility gems are retained; all-ready packages need no spell sets', () => {
  const input = prepInput(); input.player.memorizedSpells![0] = 12
  const result = planMacroPreparation(input, [12, 11]); assert.equal(result.ok, true)
  if (!result.ok) return
  assert.deepEqual(result.plan.replacements.map((slot) => slot.gem), [12])
  assert.equal(result.plan.utilities[0].gem, 1)
  input.player.memorizedSpells![11] = 11
  const ready = planMacroPreparation(input, [12, 11]); assert.equal(ready.ok, true)
  if (!ready.ok) return
  assert.equal(ready.plan.replacements.length, 0)
  assert.ok(ready.plan.preparationGems.every((id) => id === -1))
  assert.equal(preparationPhase(input, ready.plan).phase, 'combat')
  assert.deepEqual(preparationPhase(input, ready.plan).readySpellIds, [12, 11])
})

test('exact Food and Drink selections offer the complete four-line Make Supplies shortcut', () => {
  const result = planMacroPreparation(prepInput(), [12, 11]); assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.plan.suppliesButton?.name, 'Make Supplies')
  assert.deepEqual(result.plan.suppliesButton?.lines, [...result.plan.utilities[0].lines, ...result.plan.utilities[1].lines])
  assert.equal(result.plan.suppliesButton?.lines.length, 4)
  assert.equal(result.plan.suppliesButton?.mana, 20)
  const one = planMacroPreparation(prepInput(), [12]); assert.equal(one.ok, true)
  if (one.ok) assert.equal(one.plan.suppliesButton, undefined)
})

test('empty, locked, beyond-cast and unowned return slots never become replacement candidates', () => {
  const input = prepInput()
  input.player.unlockedSpellSlots = [1, 2, 15, 18]
  input.player.memorizedSpells?.push(30, null, null, 21)
  assert.equal(planMacroPreparation(input, [12, 11]).ok, false)
  input.player.unlockedSpellSlots = undefined
  assert.equal(planMacroPreparation(input, [12]).ok, false)
  input.player.unlockedSpellSlots = [12]
  input.player.spellbook = [12]
  assert.equal(planMacroPreparation(input, [12]).ok, false)
})

test('allocation skips an ineligible high gem when a lower restorable combat spell is available', () => {
  const input = prepInput()
  input.player.unlockedSpellSlots = [1, 3]
  input.spells[4].classLevels = { WIZ: 1 }
  const result = planMacroPreparation(input, [12]); assert.equal(result.ok, true)
  if (result.ok) assert.deepEqual(result.plan.replacements.map((slot) => [slot.gem, slot.originalSpellId]), [[1, 20]])
})

test('duplicate positive return IDs cannot generate a package the native spell-set loader cannot restore', () => {
  const input = prepInput()
  input.player.unlockedSpellSlots = [1, 3]
  input.player.memorizedSpells![2] = 20
  const result = planMacroPreparation(input, [12, 11])
  assert.equal(result.ok, false)
  if (!result.ok) assert.match(result.reasons.join(' '), /distinct usable combat spells/)
})

test('selection bounds, duplicates, unowned and class-ineligible utilities are rejected', () => {
  for (const ids of [[], [12, 12], [12, 10], [999], [10, 11, 12, 20, 30]]) assert.equal(planMacroPreparation(prepInput(), ids).ok, false)
  const input = prepInput(); input.player.classes = ['WAR', 'MNK']
  assert.equal(planMacroPreparation(input, [12]).ok, false)
  assert.deepEqual(changePreparationSelection([1, 2, 3, 4], 5, true), [1, 2, 3, 4])
  assert.deepEqual(changePreparationSelection([1, 2, 3, 4], 2, false), [1, 3, 4])
})

test('persistent Use buttons refuse unsafe or ambiguous names in either combat or utility layout', () => {
  const input = prepInput()
  input.spells[4].name = 'Summon Food II: Combat'
  const result = planMacroPreparation(input, [12]); assert.equal(result.ok, false)
  if (!result.ok) assert.match(result.reasons.join(' '), /safe unique full-name/)
  input.spells[4].name = 'Frost'; input.spells[2].name = '123 Unsafe'
  assert.equal(planMacroPreparation(input, [12]).ok, false)
  input.spells[2].name = 'Summon Food II'; input.spells = input.spells.filter((spell) => spell.id !== 30)
  assert.equal(planMacroPreparation(input, [12]).ok, false)
})

test('friendly utilities target the exact observed player and never invent a memorization wait', () => {
  const input = prepInput(); input.player.memorizedSpells![11] = 21
  const result = planMacroPreparation(input, [30]); assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.plan.utilities[0].lines[0], '/pause 3, /target Example')
  assert.ok(result.plan.utilities[0].lines.some((line) => line.endsWith('/cast Strengthen')))
  assert.ok(result.plan.utilities[0].lines.every((line) => !line.includes('/memspellset')))
})

test('phase recognizes exact prep, partial batches and restored combat without changing captured baseline', () => {
  const input = prepInput(); const result = planMacroPreparation(input, [12, 11]); assert.equal(result.ok, true)
  if (!result.ok) return
  const baseline = structuredClone(result.plan)
  assert.equal(preparationPhase(input, result.plan).phase, 'combat')
  input.player.classes.reverse()
  assert.equal(preparationPhase(input, result.plan).phase, 'combat')
  input.player.memorizedSpells![11] = null
  assert.equal(preparationPhase(input, result.plan).phase, 'changing')
  input.player.memorizedSpells![11] = 12; input.player.memorizedSpells![2] = 11
  assert.equal(preparationPhase(input, result.plan).phase, 'utility-ready')
  input.player.memorizedSpells = [...result.plan.baseline]
  assert.equal(preparationPhase(input, result.plan).phase, 'combat')
  assert.deepEqual(result.plan, baseline)
  input.player.memorizedSpells![0] = 30
  assert.equal(preparationPhase(input, result.plan).phase, 'changed')
  assert.equal(preparationPhase(undefined, result.plan).phase, 'unknown')
})

test('class, entitlement, ownership and utility metadata changes invalidate a captured package', () => {
  const result = planMacroPreparation(prepInput(), [12, 11]); assert.equal(result.ok, true)
  if (!result.ok) return
  const altered = [prepInput(), prepInput(), prepInput(), prepInput(), prepInput()]
  altered[0].player.classes = ['CLR', 'DRU']
  altered[1].player.unlockedSpellSlots = [1, 2, 3]
  altered[2].player.spellbook = [12, 11]
  altered[3].spells[2].recoveryMs += 500
  altered[4].spells[2].effects[0].base += 1
  for (const input of altered) assert.equal(preparationPhase(input, result.plan).phase, 'changed')
})

test('a changed plan cannot be recaptured while any replacement contains a utility or a transient empty gem', () => {
  const input = prepInput(); const result = planMacroPreparation(input, [12, 11]); assert.equal(result.ok, true)
  if (!result.ok) return
  const snapshot = { phase: 'changed' as const, message: 'Classes changed', readySpellIds: [], options: [], previewInput: input, plan: result.plan }
  assert.equal(canCapturePreparation(snapshot), true)
  input.player.memorizedSpells![11] = 12
  assert.equal(canCapturePreparation(snapshot), false)
  input.player.memorizedSpells![11] = null
  assert.equal(canCapturePreparation(snapshot), false)
  input.player.memorizedSpells![11] = 30
  assert.equal(canCapturePreparation(snapshot), true)
  assert.equal(canCapturePreparation({ ...snapshot, previewInput: undefined }), false)
})
