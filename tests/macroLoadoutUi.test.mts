import assert from 'node:assert/strict'
import test from 'node:test'
import React, { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { MacroAssistantSnapshot } from '../src/shared/macroAssistant'
import type { MacroLoadoutPlan, MacroRecipe } from '../src/shared/macros'
import { MacroContext } from '../src/renderer/src/components/macros/MacroContext'
import { MacroLoadout } from '../src/renderer/src/components/macros/MacroLoadout'
import { MacroInstallation } from '../src/renderer/src/components/macros/MacroInstallation'
import { MacroRecipeCard } from '../src/renderer/src/components/macros/MacroRecipeCard'

// This isolated node test uses tsx's classic JSX transform, unlike the renderer build.
Object.assign(globalThis, { React })

function snapshot(loadout?: MacroLoadoutPlan): MacroAssistantSnapshot {
  return { character: { name: 'Example', server: 'test', logPath: 'fixture.log' }, characterId: 'Example@test',
    context: { live: true, message: 'Current character', classes: ['MAG'], level: 10, knownSpells: 62, memorizedSpells: 12 },
    settings: { autoUpdate: false, style: 'solo', selections: [{ role: 'damage' }, { role: 'pet-opener' }], destination: { bar: 4, page: 1 } },
    recipes: [], loadout, existing: [], installation: { state: 'ready', message: 'Ready', targetFiles: [], pendingCount: 0, canRestore: false, conflicts: [] } }
}

function plan(): MacroLoadoutPlan {
  return { state: 'needs-memorizing', message: 'One spell needs memorizing.', availableSlots: 3, requiredSpellCount: 2, missingSpellCount: 1,
    overflow: 0, omitted: [], slots: [
      { gem: 1, action: 'keep', required: true, spellId: 1, name: 'Flame', currentSpellId: 1, currentName: 'Flame' },
      { gem: 2, action: 'replace', required: true, spellId: 2, name: 'Shield', currentSpellId: 3, currentName: 'Light' },
      { gem: 5, action: 'empty', required: false }
    ] }
}

function card(): MacroRecipe {
  return { id: 'buff:shield', role: 'buff', name: 'Shield', description: 'A synthetic shield.', selection: { role: 'buff', spellLine: 'shield' },
    lines: [], requiredSpellIds: [2], missingSpellIds: [2], mana: 10, pauseTenths: 0, ready: false, status: 'needs-memorizing', reasons: ['Memorize Shield.'] }
}

test('unknown loadout capacity is explicit and does not claim a fit or show invented gem rows', () => {
  const state = snapshot({ ...plan(), state: 'unavailable', message: 'Unlocked spell slots are not verified.', availableSlots: undefined, slots: [] })
  const html = renderToStaticMarkup(createElement(MacroLoadout, { snapshot: state }))
  assert.ok(html.includes('data-state="unavailable"'))
  assert.ok(html.includes('Slot capacity unknown'))
  assert.ok(html.includes('Unlocked spell slots are not verified'))
  assert.ok(!html.includes('macros-loadout-gem-'))
  assert.ok(!html.includes('Gem-by-gem recommendation'))
  const header = renderToStaticMarkup(createElement(MacroContext, { snapshot: state, busy: false, onStyle: () => assert.fail('Render cannot change style') }))
  assert.ok(header.includes('Unknown'))
  assert.ok(header.includes('Unlocked slots'))
  assert.ok(header.includes('Filled slots'))
  assert.ok(header.includes('Empty slots'))
  assert.ok(!header.includes('Memorized entries'))
})

test('limited non-contiguous gems render exact assignments and spell sharing instructions', () => {
  const html = renderToStaticMarkup(createElement(MacroLoadout, { snapshot: snapshot(plan()) }))
  assert.ok(html.includes('3 usable gems'))
  assert.ok(html.includes('2 distinct spells'))
  assert.ok(html.includes('macros-loadout-expand'))
  for (const gem of [1, 2, 5]) assert.ok(html.includes(`macros-loadout-gem-${gem}`))
  assert.ok(!html.includes('macros-loadout-gem-4'))
  for (const value of ['Keep', 'Replace', 'Empty', 'Flame', 'Shield', 'Light']) assert.ok(html.includes(value))
  assert.ok(html.includes('each distinct spell needs only one gem'))
  assert.ok(html.includes('Memorize the recommended spells in game'))
})

test('overflow names omitted spells and the exact shortfall instead of claiming the full set fits', () => {
  const state = snapshot({ ...plan(), state: 'over-capacity', requiredSpellCount: 4, overflow: 1,
    omitted: [{ id: 4, name: 'Mending', reason: 'No unlocked spell slot remains.' }] })
  const html = renderToStaticMarkup(createElement(MacroLoadout, { snapshot: state }))
  assert.ok(html.includes('data-state="over-capacity"'))
  assert.ok(html.includes('1 more spell slot is needed'))
  assert.ok(html.includes('Spells left out'))
  assert.ok(html.includes('Mending: No unlocked spell slot remains.'))
})

test('owned unmemorized cards may be selected for planning while their commands cannot be copied', () => {
  const html = renderToStaticMarkup(createElement(MacroRecipeCard, { recipe: card(), selected: false, busy: false,
    onSelect: () => assert.fail('Render cannot select') }))
  const input = html.match(/<input[^>]+data-testid="macros-select-buff:shield"[^>]*>/)?.[0] ?? ''
  assert.ok(input)
  assert.equal(input.includes('disabled'), false)
  const copy = html.match(/<button[^>]+aria-label="Copy Shield commands"[^>]*>/)?.[0] ?? ''
  assert.ok(copy.includes('disabled'))
  const unavailable = renderToStaticMarkup(createElement(MacroRecipeCard, { recipe: { ...card(), status: 'unavailable' }, selected: false, busy: false,
    onSelect: () => assert.fail('Render cannot select') }))
  assert.ok(unavailable.match(/<input[^>]+data-testid="macros-select-buff:shield"[^>]*>/)?.[0].includes('disabled'))
})

test('live but unverified slot observations disable new queues with a visible explanation', () => {
  const html = renderToStaticMarkup(createElement(MacroInstallation, { snapshot: snapshot(), busy: false,
    configure: () => assert.fail('Render cannot configure'), action: () => assert.fail('Render cannot queue') }))
  assert.ok(html.match(/<button[^>]+data-testid="macros-queue"[^>]*>/)?.[0].includes('disabled'))
  assert.ok(html.includes('verified unlocked spell slots'))
  assert.ok(html.includes('Existing queued plans still install'))
})
