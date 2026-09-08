import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { MacroPlanInput, MacroRole, MacroSpell } from '../src/shared/macros'
import { isMacroRole, isMacroSelection, isMacroStyle, macroSelectionKey } from '../src/shared/macros'
import { planMacros } from '../src/shared/macros/planner'
import { compileMacro, castCommand } from '../src/shared/macros/compiler'
import { auditMacro } from '../src/shared/macros/audit'
import { spellRoles } from '../src/shared/macros/spells'

// Authored table rows, not copied or derived from the distributable game database.
function spell(id: number, name: string, changes: Partial<MacroSpell> = {}): MacroSpell {
  return { id, name, classLevels: { MAG: 1 }, castMs: 2000, recoveryMs: 1500, recastMs: 8000,
    mana: 10, targetType: 5, effects: [{ effect: 0, base: -20 }], ...changes }
}
const ember = spell(900, 'Ember I')
const ember2 = spell(12, 'Ember II', { mana: 15 })
const mez = spell(7, 'Quiet Mind', { classLevels: { ENC: 1 }, effects: [{ effect: 31, base: 1 }] })
const heal = spell(8, 'Mend Friend', { classLevels: { SHM: 1 }, effects: [{ effect: 0, base: 20 }] })
const pet = spell(9, 'Call Helper', { targetType: 6, effects: [{ effect: 33, base: 1 }] })
const buff = spell(10, 'Iron Skin', { classLevels: { SHM: 1 }, effects: [{ effect: 1, base: 20 }] })
function input(changes: Partial<MacroPlanInput['player']> = {}): MacroPlanInput {
  return { player: { characterName: 'Example', classes: ['MAG', 'SHM'], level: 10, spellbook: [900, 7, 8, 9, 10],
    memorizedSpells: [900, 7, 8, 9, 10, ...Array<null>(13).fill(null)], unlockedSpellSlots: Array.from({ length: 14 }, (_, i) => i + 1), ...changes },
    spells: [ember, ember2, mez, heal, pet, buff], style: 'solo' }
}
function memorize(config: MacroPlanInput, ...ids: number[]): void {
  const gems = config.player.memorizedSpells!
  for (const id of ids) {
    const empty = gems.indexOf(null)
    assert.notEqual(empty, -1, 'Fixture has an empty gem for the observation')
    gems[empty] = id
  }
}
function role(config: MacroPlanInput, name: MacroRole) {
  const found = planMacros(config).find((recipe) => recipe.role === name)
  assert.ok(found, `Expected ${name}`)
  return found
}

test('adding Enchanter to MAG/SHM unlocks only owned eligible class roles', () => {
  const config = input()
  assert.equal(planMacros(config).some((r) => r.role === 'mez'), false)
  config.player.classes.push('ENC')
  assert.deepEqual(role(config, 'mez').lines, ['/attack off', '/pause 37, /cast 2'])
  config.player.classes = ['MAG', 'SHM']
  assert.equal(planMacros(config).some((r) => r.role === 'mez'), false)
})
test('learning a higher rank keeps a ready lower rank and proposes only a same-line upgrade', () => {
  const config = input()
  config.player.spellbook!.push(12)
  const first = role(config, 'damage')
  assert.equal(first.ready, true)
  assert.deepEqual(first.requiredSpellIds, [900])
  assert.equal(first.upgrade?.to.id, 12)
  config.player.memorizedSpells![0] = 12
  const upgraded = role(config, 'damage')
  assert.deepEqual(upgraded.requiredSpellIds, [12])
  assert.equal(upgraded.upgrade, undefined)
  assert.equal(upgraded.id, first.id)
  assert.equal(upgraded.mana, 15)
})
test('spell catalog presence and character level never prove ownership', () => {
  const config = input()
  config.spells.push(spell(1, 'Ember III', { classLevels: { MAG: 20 } }))
  config.player.level = 50
  assert.deepEqual(role(config, 'damage').requiredSpellIds, [900])
  config.player.spellbook!.push(1)
  config.player.level = 10
  assert.equal(role(config, 'damage').upgrade, undefined)
})
test('owned unmemorized spells are suggested but never compile an executable partial macro', () => {
  const config = input({ memorizedSpells: Array<null>(18).fill(null) })
  const recipe = role(config, 'damage')
  assert.equal(recipe.status, 'needs-memorizing')
  assert.deepEqual(recipe.missingSpellIds, [900])
  assert.deepEqual(recipe.lines, [])
  assert.equal(recipe.ready, false)
})
test('unavailable observations are distinct from a verified empty book or gem list', () => {
  assert.deepEqual(planMacros(input({ spellbook: undefined })).map((r) => r.role), ['loc', 'export'])
  assert.equal(role(input({ memorizedSpells: undefined }), 'damage').status, 'unavailable')
  assert.deepEqual(planMacros(input({ level: undefined })).map((r) => r.role), ['loc', 'export'])
})
test('numeric casts follow reordered gems and never address profile slots 15 through 18', () => {
  const config = input()
  config.player.memorizedSpells = [null, 900, ...Array<null>(16).fill(null)]
  assert.deepEqual(role(config, 'damage').lines, ['/pause 37, /cast 2'])
  config.player.memorizedSpells = [...Array(14).fill(null), 900]
  assert.equal(role(config, 'damage').status, 'needs-memorizing')
  config.player.spellbook!.push(12)
  config.player.memorizedSpells = [900, ...Array(13).fill(null), 12]
  assert.deepEqual(role(config, 'damage').requiredSpellIds, [900])
  assert.equal(role(config, 'damage').ready, true)
  assert.equal(role(config, 'damage').upgrade?.to.id, 12)
})
test('name casting uses the full unquoted name and falls back on prefix collisions or unknown gem names', () => {
  const config = input()
  config.castByName = true
  assert.equal(castCommand(ember, config), '/cast Ember I')
  config.player.spellbook!.push(12)
  memorize(config, 12)
  // “Ember I” prefixes “Ember II”, even though both are exact table names.
  assert.equal(castCommand(ember, config), '/cast 1')
  memorize(config, 123456)
  assert.equal(castCommand(heal, config), '/cast 3')
})
test('selected lines do not drift into another family, and unavailable selections stay explicit', () => {
  const config = input()
  config.spells.push(spell(4, 'Aardvark Bolt'))
  config.player.spellbook!.push(4)
  memorize(config, 4)
  const selected = [{ role: 'damage' as const, spellLine: 'ember' }]
  assert.deepEqual(planMacros(config, selected).find((r) => r.role === 'damage')!.requiredSpellIds, [900])
  config.player.spellbook = [4]
  const missing = planMacros(config, selected).find((r) => r.role === 'damage')!
  assert.equal(missing.ready, false)
  assert.equal(missing.selection.spellLine, 'ember')
})
test('an explicit bare role follows current spell families without changing its selection or managed ID', () => {
  const config = input()
  config.spells.push(spell(40, 'Zephyr', { classLevels: { SHM: 1 } }))
  config.player.spellbook!.push(40)
  memorize(config, 40)
  const selected = [{ role: 'damage' as const }]
  const current = () => planMacros(config, selected).find((recipe) => recipe.id === 'damage')!
  assert.equal(current().ready, true)
  assert.deepEqual(current().selection, selected[0])
  assert.deepEqual(current().requiredSpellIds, [900])
  config.player.memorizedSpells = [null, 40, ...Array<null>(16).fill(null)]
  assert.equal(current().ready, true)
  assert.deepEqual(current().requiredSpellIds, [40])
  assert.deepEqual(current().selection, selected[0])
  config.player.classes = ['SHM', 'ENC']
  assert.equal(current().ready, true)
  assert.equal(current().id, 'damage')
  assert.deepEqual(current().selection, selected[0])
  config.player.classes = ['WAR', 'MNK']
  assert.equal(current().ready, false)
  assert.equal(current().id, 'damage')
  assert.deepEqual(current().selection, selected[0])
  assert.equal(role(input(), 'damage').id, 'damage:ember')
})
test('a bare buff role follows one family without also inventing that family as a duplicate recommendation', () => {
  const config = input()
  config.spells.push(spell(40, 'Zephyr Guard', { classLevels: { SHM: 1 }, effects: [{ effect: 1, base: 20 }] }))
  config.player.spellbook!.push(40)
  memorize(config, 40)
  const selected = [{ role: 'buff' as const }]
  const buffs = () => planMacros(config, selected).filter((recipe) => recipe.role === 'buff')
  assert.deepEqual(buffs().map((recipe) => recipe.id), ['buff', 'buff:zephyr guard'])
  assert.deepEqual(buffs()[0].selection, selected[0])
  config.player.memorizedSpells = [40, ...Array<null>(17).fill(null)]
  assert.deepEqual(buffs().map((recipe) => recipe.id), ['buff', 'buff:iron skin'])
  assert.deepEqual(buffs()[0].requiredSpellIds, [40])
  config.player.classes = ['WAR', 'MNK']
  assert.deepEqual(buffs().map((recipe) => recipe.id), ['buff'])
  assert.equal(buffs()[0].ready, false)
})
test('playstyles prioritize useful roles and every pure melee class still gets universal utilities', () => {
  const config = input({ classes: ['MAG', 'SHM', 'ENC'] })
  assert.equal(planMacros(config)[0].role, 'heal-self')
  config.style = 'group'
  assert.equal(planMacros(config)[0].role, 'heal-target')
  config.style = 'pet'
  assert.equal(planMacros(config)[0].role, 'summon-pet')
  config.player.classes = ['WAR', 'ROG', 'MNK']
  assert.deepEqual(planMacros(config).map((r) => r.role), ['loc', 'export'])
})
test('heals and pet actions have deliberate targets and no unsolicited chat', () => {
  const config = input()
  assert.equal(role(config, 'heal-self').lines[0], '/pause 3, /target Example')
  assert.equal(role(config, 'heal-pet').lines[0], '/pause 3, /pet target')
  assert.deepEqual(role(config, 'pet-attack').lines, ['/pet attack'])
  assert.deepEqual(role(config, 'pet-backoff').lines, ['/pet back off'])
  assert.equal(planMacros(config).some((r) => r.lines.some((line) => /\/(say|gsay|tell|shout)\b/u.test(line))), false)
})
test('pet opener combines a pet command with the chosen known damage family and keeps selection stable', () => {
  const config = input()
  const recipe = role(config, 'pet-opener')
  assert.deepEqual(recipe.lines, ['/pet attack', '/pause 37, /cast 1'])
  assert.equal(recipe.selection.spellLine, 'ember')
  config.player.spellbook!.push(12)
  config.player.memorizedSpells![0] = 12
  const next = planMacros(config, [recipe.selection]).find((r) => r.id === recipe.id)!
  assert.deepEqual(next.requiredSpellIds, [12])
  config.player.spellbook = [12]
  assert.equal(planMacros(config).some((r) => r.role === 'pet-opener'), false)
  assert.equal(planMacros(config, [recipe.selection]).find((r) => r.id === recipe.id)?.ready, false)
})
test('self buffs combine at most four distinct memorized self-compatible lines with truthful total mana', () => {
  const config = input()
  const extra = [spell(20, 'Iron Skin II', { effects: [{ effect: 1, base: 30 }], mana: 15 }),
    ...[21, 22, 23, 24].map((id) => spell(id, `Guard ${id}`, { effects: [{ effect: 4, base: 10 }] })),
    spell(25, 'Pet Guard', { targetType: 14, effects: [{ effect: 1, base: 20 }] })]
  config.spells.push(...extra)
  config.player.spellbook!.push(...extra.map((s) => s.id))
  memorize(config, ...extra.map((s) => s.id))
  const recipe = role(config, 'self-buffs')
  assert.equal(recipe.lines.length, 5)
  assert.equal(recipe.lines[0], '/pause 3, /target Example')
  assert.equal(recipe.requiredSpellIds.length, 4)
  assert.equal(recipe.requiredSpellIds.includes(25), false)
  assert.equal(recipe.requiredSpellIds.includes(10), false)
  assert.equal(recipe.mana, recipe.requiredSpellIds.reduce((sum, id) => sum + config.spells.find((s) => s.id === id)!.mana, 0))
  assert.equal(recipe.pauseTenths, 3 + 37 * 4)
  assert.equal(planMacros(input()).some((r) => r.role === 'self-buffs'), false)
  const buffs = planMacros(config).filter((r) => r.role === 'buff')
  assert.equal(new Set(buffs.map((r) => r.id)).size, 6)
  assert.equal(new Set(buffs.map((r) => r.name)).size, 6)
})
test('Legends target 51 supports friendly heals and buffs, including the self-buff chain, never hostile roles', () => {
  // Root compared installed Strengthen/Spirit of Wolf rows with their Single Friendly (or Self)
  // target labels. These authored rows retain only that verified target/effect shape.
  const config = input()
  const friendlyHeal = spell(30, 'Friendly Mend', { targetType: 51, effects: [{ effect: 0, base: 10 }] })
  const friendlyBuff = spell(31, 'Friendly Vigor', { targetType: 51, effects: [{ effect: 4, base: 10 }] })
  config.spells.push(friendlyHeal, friendlyBuff)
  config.player.spellbook!.push(30, 31)
  memorize(config, 30, 31)
  assert.deepEqual(spellRoles(friendlyHeal), ['heal-self', 'heal-target', 'heal-pet'])
  assert.deepEqual(spellRoles(friendlyBuff), ['buff'])
  assert.deepEqual(spellRoles(spell(32, 'Not Hostile', { targetType: 51 })), [])
  assert.deepEqual(spellRoles(spell(33, 'Not Debuff', { targetType: 51, effects: [{ effect: 11, base: 50 }] })), [])
  assert.deepEqual(role(config, 'self-buffs').requiredSpellIds, [31, 10])
})
test('self-targeting uses the observed name and refuses absent or unsafe names without partial lines', () => {
  const config = input({ characterName: 'Samplehero' })
  const extra = spell(31, 'Friendly Vigor', { targetType: 51, effects: [{ effect: 4, base: 10 }] })
  config.spells.push(extra)
  config.player.spellbook!.push(31)
  memorize(config, 31)
  for (const name of ['Samplehero', 'A'.repeat(64)]) {
    config.player.characterName = name
    assert.equal(role(config, 'heal-self').lines[0], `/pause 3, /target ${name}`)
    assert.equal(role(config, 'self-buffs').lines[0], `/pause 3, /target ${name}`)
  }
  for (const name of [undefined, '', 'A'.repeat(65), 'Paul zac', 'Samplehero\n/quit', 'Samplehero, /quit', 'Paulzac1']) {
    config.player.characterName = name
    for (const kind of ['heal-self', 'self-buffs'] as const) {
      const recipe = role(config, kind)
      assert.equal(recipe.status, 'unavailable')
      assert.equal(recipe.ready, false)
      assert.deepEqual(recipe.lines, [])
      assert.ok(recipe.reasons.some((reason) => reason.includes('observed character name')))
    }
  }
})
test('a native self-only heal needs no explicit target command or character name', () => {
  const config = input({ characterName: undefined })
  const selfHeal = { ...heal, targetType: 6 }
  config.spells = [selfHeal]
  const recipe = role(config, 'heal-self')
  assert.equal(recipe.ready, true)
  assert.deepEqual(recipe.lines, ['/pause 37, /cast 3'])
})
test('compiler enforces five lines, printable short labels, safe commands, and full post-cast waits', () => {
  const config = input()
  const cast = { kind: 'cast' as const, spellId: 900 }
  const valid = compileMacro('Five', [cast, ...Array(4).fill({ kind: 'command', command: '/loc' })], config)
  assert.equal(valid.lines.length, 5)
  assert.equal(valid.pauseTenths, 37)
  assert.equal(compileMacro('Six', Array(6).fill(cast), config).ready, false)
  assert.equal(compileMacro('A name far too long', [cast], config).ready, false)
  assert.equal(compileMacro('Injected', [{ kind: 'command', command: '/loc\n/quit' }], config).ready, false)
  assert.equal(compileMacro('Injected', [{ kind: 'command', command: '/loc, /quit' }], config).ready, false)
})
test('repeating a spell reserves its reuse delay but unrelated spells do not inherit that timer', () => {
  const config = input()
  const cast = { kind: 'cast' as const, spellId: 900 }
  assert.equal(compileMacro('Repeat', [cast, cast], config).lines[0], '/pause 102, /cast 1')
  assert.equal(compileMacro('Mixed', [cast, { kind: 'cast', spellId: 8 }], config).lines[0], '/pause 37, /cast 1')
})
test('audit finds missing slash, empty internal lines, empty gems and short pauses without mutating text', () => {
  const config = input({ memorizedSpells: [900, ...Array<null>(17).fill(null)] })
  const lines = ['/pet attack', '/pause 30, cast 1', '', '/cast 2', '/loc']
  const before = [...lines]
  const issues = auditMacro('Pet Opener', lines, config)
  assert.equal(issues.find((i) => i.code === 'missing-slash')?.suggestion, '/pause 30, /cast 1')
  assert.equal(issues.find((i) => i.code === 'empty-line')?.line, 3)
  assert.equal(issues.find((i) => i.code === 'empty-gem')?.line, 4)
  assert.deepEqual(lines, before)
  assert.ok(auditMacro('Quick', ['/pause 20, /cast 1', '/loc'], config).some((i) => i.code === 'short-pause'))
  assert.equal(auditMacro('Wait', ['/cast 1', '/pause 37', '/loc'], config).some((i) => i.code === 'short-pause'), false)
})
test('audit respects client name-prefix matching, unmemorized names, and cast slot range', () => {
  const config = input()
  config.castByName = true
  memorize(config, 12)
  assert.ok(auditMacro('Ambiguous', ['/cast Ember I'], config).some((i) => i.code === 'name-ambiguous'))
  assert.ok(auditMacro('Missing', ['/cast Unlearned'], config).some((i) => i.code === 'name-not-memorized'))
  assert.ok(auditMacro('Quoted', ['/cast "Ember I"'], config).some((i) => i.code === 'quoted-name'))
  assert.ok(auditMacro('Out of range', ['/cast 15'], config).some((i) => i.code === 'gem-range'))
  memorize(config, 123456)
  const partial = auditMacro('Partial data', ['/cast Unlearned'], config)
  assert.ok(partial.some((i) => i.code === 'spell-data-unavailable' && i.severity === 'warning'))
  assert.equal(partial.some((i) => i.code === 'name-not-memorized'), false)
})
test('audit corrects the unsupported myself keyword only when an observed safe name is available', () => {
  const config = input({ characterName: 'Samplehero' })
  const issue = auditMacro('Self Heal', ['/pause 3, /target myself', '/cast 3'], config)
    .find((item) => item.code === 'unsupported-self-target')!
  assert.equal(issue.line, 1)
  assert.equal(issue.suggestion, '/pause 3, /target Samplehero')
  assert.equal(auditMacro('Other Target', ['/target Friendlynpc'], config).some((item) => item.code === 'unsupported-self-target'), false)
  for (const characterName of [undefined, 'Samplehero\n/quit']) {
    config.player.characterName = characterName
    const unavailable = auditMacro('Self Heal', ['/target myself'], config).find((item) => item.code === 'unsupported-self-target')!
    assert.equal(unavailable.suggestion, undefined)
  }
})
test('selection validators keep runtime requests bounded and selected IDs stable', () => {
  assert.equal(isMacroRole('pet-opener'), true)
  assert.equal(isMacroStyle('group'), true)
  assert.equal(isMacroStyle('raid'), false)
  assert.equal(isMacroSelection({ role: 'damage', spellLine: 'ember' }), true)
  assert.equal(isMacroSelection({ role: 'self-buffs' }), true)
  for (const value of [null, [], { role: 'bogus' }, { role: 'damage', spellLine: 'x\n/quit' },
    { role: 'damage', spellLine: 'X' }, { role: 'damage', spellLine: 'x'.repeat(121) }, { role: 'loc', execute: true }]) {
    assert.equal(isMacroSelection(value), false)
  }
  const recipe = role(input(), 'damage')
  assert.equal(macroSelectionKey(recipe.selection), recipe.id)
})
