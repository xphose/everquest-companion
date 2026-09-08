import assert from 'node:assert/strict'
import { test } from 'node:test'
import React, { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { MacroAssistantSnapshot } from '../src/shared/macroAssistant'
import type { MacroPlanInput, MacroSpell } from '../src/shared/macros'
import { planMacroPreparation, preparationOptions } from '../src/shared/macros/preparation'
import { MacroPreparation } from '../src/renderer/src/components/macros/MacroPreparation'
import { MacroSession, type MacroSessionState } from '../src/renderer/src/components/macros/macroSession'

Object.assign(globalThis, { React }) // Node tests use classic JSX; the renderer uses react-jsx.
function spell(id: number, name: string, effect = 32): MacroSpell {
  return { id, name, classLevels: { MAG: 1, SHM: 1 }, castMs: 2000, recoveryMs: 1500, recastMs: 0, mana: 10,
    targetType: 6, effects: [{ effect, base: effect === 32 ? 100 : -10 }] }
}
function snapshot(captured = false): MacroAssistantSnapshot {
  const input: MacroPlanInput = { player: { characterName: 'Example', classes: ['MAG', 'SHM'], level: 10,
    spellbook: [1, 2, 50, 211], memorizedSpells: [1, 2, ...Array<null>(16).fill(null)], unlockedSpellSlots: [1, 2] },
  spells: [spell(1, 'Combat One', 0), spell(2, 'Combat Two', 0), spell(50, 'Summon Food'), spell(211, 'Summon Drink')], style: 'solo' }
  const compiled = planMacroPreparation(input, [50, 211])
  assert.ok(compiled.ok)
  return { character: { name: 'Example', server: 'test', logPath: 'fixture.log' }, characterId: 'Example@test',
    context: { live: true, message: 'Live', classes: ['MAG', 'SHM'], level: 10, availableSpellSlots: 2 },
    settings: { autoUpdate: true, style: 'solo', selections: [{ role: 'damage' }], destination: { bar: 4, page: 1 } },
    recipes: [], existing: [], installation: { state: 'ready', message: 'Ready', targetFiles: [], pendingCount: 0, canRestore: false, conflicts: [] },
    preparation: { options: preparationOptions(input), previewInput: input, phase: 'combat', message: 'Combat gems are restored.', readySpellIds: [],
      ...(captured ? { plan: compiled.plan, installation: { state: 'pending', message: 'Queued', destination: { bar: 7, page: 2 } } } : {}) } }
}
function render(state: MacroAssistantSnapshot): string {
  return renderToStaticMarkup(createElement(MacroPreparation, { preparation: state.preparation!, busy: false,
    prepare: () => assert.fail('Rendering cannot queue or cast') }))
}
function queueButton(html: string): string { return html.match(/<button[^>]+data-testid="macros-preparation-queue"[^>]*>/)?.[0] ?? '' }

test('new preparation defaults to food and drink and previews exact swaps without changing combat choices', () => {
  const state = snapshot()
  const before = structuredClone(state.settings)
  const html = render(state)
  assert.ok(html.includes('Adventure preparation'))
  assert.ok(html.includes('2/4 utilities'))
  assert.ok(html.includes('Summon Food') && html.includes('Summon Drink'))
  assert.ok(html.includes('MAG / SHM'))
  assert.ok(html.includes('Make Supplies'))
  assert.ok(html.includes('Combat One') && html.includes('Combat Two'))
  assert.ok(queueButton(html) && !queueButton(html).includes('disabled'))
  assert.deepEqual(state.settings, before)
})
test('captured temporary or partially emptied gems disable recapture even when another change invalidated the plan', () => {
  for (const emptied of [false, true]) {
    const state = snapshot(true)
    const prep = state.preparation!
    const slot = prep.plan!.replacements[0]
    prep.phase = 'changed'
    prep.previewInput!.player.memorizedSpells![slot.gem - 1] = emptied ? null : slot.spellId
    const html = render(state)
    assert.ok(queueButton(html).includes('disabled'))
    assert.ok(html.includes('Restore Combat first'))
    assert.ok(html.includes('Captured preparation package'))
    assert.ok(html.includes('Combat One') && html.includes('Combat Two'))
  }
})
test('persistent preparation status reports its custom destination and offline queue remains disabled', () => {
  const state = snapshot(true)
  state.preparation!.previewInput = undefined
  const html = render(state)
  assert.ok(html.includes('Preparation queued, not written yet'))
  assert.ok(html.includes('Hotbar 7') && html.includes('Page 2'))
  assert.ok(html.includes('Keep the companion open'))
  assert.ok(queueButton(html).includes('disabled'))
})
test('already loaded utilities display the use-only package without claiming a swap is required', () => {
  const state = snapshot()
  const prep = state.preparation!
  prep.previewInput!.player.memorizedSpells = [50, 211, ...Array<null>(16).fill(null)]
  const html = render(state)
  assert.ok(html.includes('needs no Load Prep or Restore Combat buttons'))
  assert.ok(html.includes('Make Supplies'))
})
test('manual prepare acknowledges repeated pending requests and polling announces the saved destination once', async () => {
  let value = snapshot(true)
  let current: MacroSessionState = { snapshot: null, busy: false, error: null }
  const session = new MacroSession({ getMacroAssistant: async () => value,
    mutateMacroAssistant: async () => ({ ok: true, snapshot: value }) }, (state) => { current = state })
  await session.read()
  const action = { characterId: 'Example@test', action: 'prepare' as const, spellIds: [50, 211], destination: { bar: 7, page: 2 } }
  await session.mutate(action)
  const first = current.notice!
  assert.equal(first.feedback.title, 'Preparation queued, not written yet')
  assert.equal(first.feedback.detail, 'Hotbar 7 · Page 2')
  await session.mutate(action)
  assert.ok(current.notice!.id > first.id)
  value = structuredClone(value)
  value.preparation!.installation = { state: 'saved', message: 'Written', destination: { bar: 7, page: 2 }, at: '2026-09-08T18:00:00.000Z' }
  await session.read()
  assert.equal(current.notice!.feedback.title, 'Preparation saved')
  assert.equal(current.notice!.feedback.timestamp?.label, 'Saved')
  const saved = current.notice!.id
  session.dismissNotice(saved)
  await session.read()
  assert.equal(current.notice, null)
  session.dispose()
})
test('failed preparation suppresses queued feedback across polls and character reset drops the captured UI state', async () => {
  let current: MacroSessionState = { snapshot: null, busy: false, error: null }
  const session = new MacroSession({ getMacroAssistant: async () => snapshot(true),
    mutateMacroAssistant: async () => ({ ok: false, error: 'Restore combat gems first.', snapshot: snapshot(true) }) }, (state) => { current = state })
  await session.read()
  await session.mutate({ characterId: 'Example@test', action: 'prepare', spellIds: [50, 211], destination: { bar: 3, page: 1 } })
  await session.read()
  assert.equal(current.notice, null)
  assert.equal(current.error, 'Restore combat gems first.')
  session.reset()
  assert.equal(current.snapshot, null)
  assert.equal(current.error, null)
})
