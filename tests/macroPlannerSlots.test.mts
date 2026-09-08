import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { MacroPlanInput, MacroSpell } from '../src/shared/macros'
import { castableMacroSlots, memorizedMacroSpellIds, spellGem } from '../src/shared/macros/slots'
import { castCommand, compileMacro } from '../src/shared/macros/compiler'
import { planMacros } from '../src/shared/macros/planner'
import { auditMacro } from '../src/shared/macros/audit'

// Authored spell rows exercise verified command semantics, not a copied game database.
function spell(id: number, name: string, changes: Partial<MacroSpell> = {}): MacroSpell {
  return { id, name, classLevels: { MAG: 1 }, castMs: 2000, recoveryMs: 1500, recastMs: 0,
    mana: 10, targetType: 5, effects: [{ effect: 0, base: -20 }], ...changes }
}
function input(): MacroPlanInput {
  return { player: { characterName: 'Example', classes: ['MAG', 'SHM'], level: 10, spellbook: [1, 2, 3],
    memorizedSpells: [1, 2, 3, ...Array<null>(15).fill(null)], unlockedSpellSlots: [1, 3] },
  spells: [spell(1, 'Ember I'), spell(2, 'Ember II'), spell(3, 'Frost')], style: 'solo', castByName: true }
}
const cast = (spellId: number) => ({ kind: 'cast' as const, spellId })

test('verified castable slots preserve holes and reject sparse, duplicate, unsorted and invalid availability', () => {
  assert.deepEqual(castableMacroSlots({ unlockedSpellSlots: [1, 3, 14, 15, 18] }), [1, 3, 14])
  assert.deepEqual(castableMacroSlots({ unlockedSpellSlots: [] }), [])
  const sparse = Array<number>(2); sparse[1] = 3
  for (const slots of [undefined, sparse, [1, 1], [3, 1], [0], [19], [1.5], [NaN]]) {
    assert.equal(castableMacroSlots({ unlockedSpellSlots: slots }), null)
  }
})
test('occupied locked gems cannot compile or displace the lower ready rank', () => {
  const config = input()
  assert.deepEqual(memorizedMacroSpellIds(config.player), [1, 3])
  assert.equal(spellGem(2, config), null)
  assert.equal(spellGem(3, config), 3)
  assert.equal(compileMacro('Locked', [cast(2)], config).status, 'needs-memorizing')
  const damage = planMacros(config, [{ role: 'damage', spellLine: 'ember' }]).find((r) => r.role === 'damage')!
  assert.equal(damage.ready, true)
  assert.deepEqual(damage.requiredSpellIds, [1])
  assert.equal(damage.upgrade?.to.id, 2)
  config.player.unlockedSpellSlots = [2, 3]
  assert.deepEqual(planMacros(config, [damage.selection]).find((r) => r.role === 'damage')!.requiredSpellIds, [2])
})
test('unknown availability blocks spell compilation but command-only macros remain usable', () => {
  const config = input()
  config.player.unlockedSpellSlots = undefined
  const blocked = compileMacro('Unknown', [cast(1)], config)
  assert.equal(blocked.status, 'unavailable')
  assert.deepEqual(blocked.lines, [])
  assert.equal(compileMacro('Location', [{ kind: 'command', command: '/loc' }], config).ready, true)
  config.player.unlockedSpellSlots = []
  assert.equal(compileMacro('None', [cast(1)], config).status, 'needs-memorizing')
})
test('name mode accounts for locked prefix matches and unobserved controls while numeric mode preserves indices', () => {
  const config = input()
  assert.equal(castCommand(config.spells[0], config), '/cast 1')
  assert.equal(castCommand(config.spells[2], config), '/cast Frost')
  config.player.memorizedSpells = [1, null, 3]
  assert.equal(castCommand(config.spells[2], config), '/cast 3')
  config.player.memorizedSpells = [1, null, 3, ...Array<null>(15).fill(null)]
  delete config.player.memorizedSpells[4]
  assert.equal(castCommand(config.spells[2], config), '/cast 3')
})
test('audit reports locked first-prefix resolution, unavailable slot observations, and unsupported cast slots', () => {
  const config = input()
  assert.ok(auditMacro('Locked', ['/cast 2'], config).some((i) => i.code === 'locked-gem'))
  config.player.memorizedSpells = [2, 1, ...Array<null>(16).fill(null)]
  config.player.unlockedSpellSlots = [2, 15]
  assert.ok(auditMacro('Prefix', ['/cast Ember I'], config).some((i) => i.code === 'locked-gem'))
  assert.ok(auditMacro('Range', ['/cast 15'], config).some((i) => i.code === 'gem-range'))
  config.player.unlockedSpellSlots = undefined
  for (const command of ['/cast 2', '/cast Ember I']) {
    assert.ok(auditMacro('Unknown', [command], config).some((i) => i.code === 'slots-unavailable' && i.severity === 'warning'))
  }
})
test('audit never labels an unobserved gem empty or claims an unknown prefix absent', () => {
  const config = input()
  config.player.memorizedSpells = [1]
  assert.ok(auditMacro('Unknown', ['/cast 3'], config).some((i) => i.code === 'gems-unavailable'))
  assert.ok(auditMacro('Unknown', ['/cast Frost'], config).some((i) => i.code === 'spell-data-unavailable'))
  config.player.memorizedSpells = [1, null, 3, ...Array<null>(15).fill(null)]
  delete config.player.memorizedSpells[4]
  assert.ok(auditMacro('Unknown', ['/cast Frost'], config).some((i) => i.code === 'spell-data-unavailable'))
})
test('self buffs use only unlocked families and never the rank stored in a locked gem', () => {
  const config = input()
  config.spells = config.spells.map((row) => ({ ...row, effects: [{ effect: 4, base: 10 }] }))
  const buffs = planMacros(config).find((r) => r.role === 'self-buffs')!
  assert.equal(buffs.ready, true)
  assert.deepEqual(buffs.requiredSpellIds, [1, 3])
  config.player.unlockedSpellSlots = [1]
  assert.equal(planMacros(config).some((r) => r.role === 'self-buffs'), false)
})
