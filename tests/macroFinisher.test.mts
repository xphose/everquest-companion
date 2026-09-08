import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { MacroPlanInput, MacroSelection, MacroSpell } from '../src/shared/macros'
import { planMacros } from '../src/shared/macros/planner'
import { spellRoles } from '../src/shared/macros/spells'
import { auditMacro } from '../src/shared/macros/audit'
import { macroBindings } from '../src/shared/macros/bindings'

// Synthetic table rows use the verified projectile target/effect semantics, never player exports.
function spell(id: number, name: string, changes: Partial<MacroSpell> = {}): MacroSpell {
  return { id, name, classLevels: { MAG: 5 }, castMs: 1800, recoveryMs: 1500, recastMs: 2000,
    mana: 20, targetType: 5, effects: [{ effect: 0, base: -40, calc: 102, max: 55 }], durationTicks: 0, ...changes }
}
const burn = spell(801, 'Test Burn')
const bolt = spell(12, 'Flame Bolt', { targetType: 1 })
const dot = spell(903, 'Test Poison', { durationTicks: 4 })
const ae = spell(1, 'Test Firestorm', { targetType: 8 })
const buff = spell(77, 'Test Armor', { targetType: 6, effects: [{ effect: 1, base: 10 }], durationTicks: 30 })
function input(): MacroPlanInput {
  return { player: { characterName: 'Example', classes: ['MAG'], level: 10,
    spellbook: [801, 12, 903, 1, 77], memorizedSpells: [801, 903, 1, 12, 77, ...Array<null>(13).fill(null)],
    unlockedSpellSlots: [1, 2, 3, 4, 5, 6, 7, 8] }, spells: [ae, bolt, dot, buff, burn], style: 'solo', castByName: true }
}
function finishers(config: MacroPlanInput, selected: MacroSelection[] = []) {
  return planMacros(config, selected).filter((recipe) => recipe.role === 'finisher')
}

test('owned projectile HP damage is offered alongside the default with target and travel guidance', () => {
  const config = input()
  assert.ok(spellRoles(bolt).includes('damage'))
  assert.ok(spellRoles(bolt).includes('finisher'))
  const recipes = finishers(config)
  assert.deepEqual(recipes.map((recipe) => recipe.requiredSpellIds[0]), [801, 12])
  assert.ok(recipes.every((recipe) => recipe.ready))
  const projectile = recipes[1]
  assert.deepEqual(projectile.lines, ['/pause 35, /cast Flame Bolt'])
  assert.match(projectile.description, /Projectiles take time.*clear path/)
  assert.match(projectile.description, /does not check enemy health or guarantee a kill/)
  assert.equal(planMacros(config).find((r) => r.role === 'damage')?.requiredSpellIds[0], 12)
  config.player.spellbook = [12]
  assert.equal(planMacros(config).find((r) => r.role === 'damage')?.requiredSpellIds[0], 12)
})

test('finishers exclude damage over time, area effects, unknown durations and unowned or ineligible spells', () => {
  for (const candidate of [dot, ae, spell(8, 'Unknown duration', { durationTicks: undefined }),
    spell(9, 'Area', { targetType: 4 }), spell(10, 'Pet-only', { targetType: 14 })]) {
    assert.equal(spellRoles(candidate).includes('finisher'), false, candidate.name)
  }
  const config = input()
  config.player.spellbook = [801, 903, 1]
  assert.deepEqual(finishers(config).map((r) => r.requiredSpellIds[0]), [801])
  config.player.level = 1
  assert.deepEqual(finishers(config), [])
  config.player.level = 10
  config.player.classes = ['WAR']
  assert.deepEqual(finishers(config), [])
})

test('finisher defaults use current unlocked gem order while a selected family survives gem moves', () => {
  const config = input()
  const selected: MacroSelection[] = [{ role: 'finisher', spellLine: 'flame bolt' }]
  assert.equal(finishers(config)[0].requiredSpellIds[0], 801)
  const before = finishers(config, selected).find((recipe) => recipe.id === 'finisher:flame bolt')!
  assert.deepEqual(before.bindings, [{ line: 1, gem: 4, spellId: 12, name: 'Flame Bolt', castable: true }])
  config.player.memorizedSpells = [12, 903, 1, 801, 77, ...Array<null>(13).fill(null)]
  assert.equal(finishers(config)[0].requiredSpellIds[0], 12)
  const after = finishers(config, selected).find((recipe) => recipe.id === before.id)!
  assert.deepEqual(after.requiredSpellIds, before.requiredSpellIds)
  assert.deepEqual(after.lines, before.lines)
  assert.deepEqual(after.bindings, [{ line: 1, gem: 1, spellId: 12, name: 'Flame Bolt', castable: true }])
  config.castByName = false
  assert.deepEqual(finishers(config, selected).find((recipe) => recipe.id === before.id)?.lines, ['/pause 35, /cast 1'])
})

test('occupied locked slots, empty gems and unknown observations never become ready finishers', () => {
  const config = input()
  config.player.unlockedSpellSlots = [1, 2, 3]
  let projectile = finishers(config).find((recipe) => recipe.requiredSpellIds.includes(12))!
  assert.equal(projectile.status, 'needs-memorizing')
  assert.deepEqual(projectile.lines, [])
  config.player.unlockedSpellSlots = undefined
  assert.ok(finishers(config).every((recipe) => recipe.status === 'unavailable' && recipe.bindings?.length === 0))
  config.player.unlockedSpellSlots = [1, 2, 3, 4]
  config.player.memorizedSpells = undefined
  assert.ok(finishers(config).every((recipe) => !recipe.ready && recipe.lines.length === 0))
  config.player.memorizedSpells = Array<null>(18).fill(null)
  projectile = finishers(config).find((recipe) => recipe.requiredSpellIds.includes(12))!
  assert.equal(projectile.status, 'needs-memorizing')
  config.player.spellbook = undefined
  const selected = finishers(config, [{ role: 'finisher', spellLine: 'flame bolt' }])
  assert.equal(selected[0].status, 'unavailable')
})

test('existing numeric and named bindings show the exact current gem, preserving pause-line numbers', () => {
  const config = input()
  const lines = ['/pause 45, /cast 4', '/target Example', '/cast Test Armor']
  assert.deepEqual(macroBindings(lines, config), [
    { line: 1, gem: 4, spellId: 12, name: 'Flame Bolt', castable: true },
    { line: 3, gem: 5, spellId: 77, name: 'Test Armor', castable: true }
  ])
  config.player.memorizedSpells![3] = 77
  config.player.memorizedSpells![4] = 12
  assert.equal(macroBindings(lines, config)[0].name, 'Test Armor')
  config.player.unlockedSpellSlots = [1, 2, 3]
  assert.equal(macroBindings(['/cast 4'], config)[0].castable, false)
  assert.ok(auditMacro('Buffs', ['/cast 4'], config).some((issue) => issue.code === 'locked-gem'))
  config.player.unlockedSpellSlots = undefined
  assert.deepEqual(macroBindings(lines, config), [])
})

test('Buffs audit warns on a stale hostile binding but preserves friendly buffs and personal text', () => {
  const config = input()
  const lines = ['/pause 45, /cast 4', '/cast 5']
  const original = [...lines]
  const issues = auditMacro('Buffs', lines, config).filter((issue) => issue.code === 'buff-binding-mismatch')
  assert.equal(issues.length, 1)
  assert.equal(issues[0].line, 1)
  assert.match(issues[0].message, /Flame Bolt.*gem 4/)
  assert.deepEqual(lines, original)
  assert.equal(auditMacro('Attack', lines, config).some((issue) => issue.code === 'buff-binding-mismatch'), false)
  config.player.memorizedSpells = undefined
  assert.equal(auditMacro('Buffs', lines, config).some((issue) => issue.code === 'buff-binding-mismatch'), false)
})

test('name prefix binding follows the first gem and refuses incomplete control metadata', () => {
  const config = input()
  config.spells.push(spell(111, 'Flame Bolt II', { targetType: 1 }))
  config.player.memorizedSpells![0] = 111
  assert.deepEqual(macroBindings(['/cast Flame Bolt'], config), [
    { line: 1, gem: 1, spellId: 111, name: 'Flame Bolt II', castable: true }
  ])
  assert.ok(auditMacro('Fire', ['/cast Flame Bolt'], config).some((issue) => issue.code === 'name-ambiguous'))
  config.spells = config.spells.filter((spell) => spell.id !== 111)
  assert.deepEqual(macroBindings(['/cast Flame Bolt'], config), [])
})


test('named binding keeps trailing argument spaces because native prefix lookup compares them', () => {
  const config = input()
  assert.deepEqual(macroBindings(['/pause 45, /cast Flame Bolt '], config), [])
  assert.ok(auditMacro('Fire', ['/cast Flame Bolt '], config).some((issue) => issue.code === 'name-not-memorized'))
  config.spells.push(spell(111, 'Flame Bolt II', { targetType: 1 }))
  config.player.memorizedSpells![0] = 111
  assert.equal(macroBindings(['/cast Flame Bolt '], config)[0].spellId, 111)
})
