import assert from 'node:assert/strict'
import { test } from 'node:test'
import React, { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { MacroAssistantSnapshot } from '../src/shared/macroAssistant'
import type { MacroRecipe, MacroRole } from '../src/shared/macros'
import { macroSelectionKey } from '../src/shared/macros'
import { changeSelection, recipePresentation, starterSelections } from '../src/shared/macros/presentation'
import { MacroSession, type MacroBridge, type MacroSessionState } from '../src/renderer/src/components/macros/macroSession'
import { MacroRecipeCard } from '../src/renderer/src/components/macros/MacroRecipeCard'
import { MacroInstallation } from '../src/renderer/src/components/macros/MacroInstallation'

// tsx uses the root solution config's classic JSX transform in node tests; the renderer build
// uses react-jsx. Supply that classic runtime only within this isolated test process.
Object.assign(globalThis, { React })

function snapshot(characterId = 'Example@server'): MacroAssistantSnapshot {
  return { character: { name: 'Example', server: 'server', logPath: 'fixture.log' }, characterId,
    context: { live: true, message: 'Current character', classes: ['MAG'], level: 10 },
    settings: { autoUpdate: false, style: 'solo', selections: [], destination: { bar: 4, page: 1 } }, recipes: [], existing: [],
    installation: { state: 'ready', message: 'Ready', targetFiles: ['Example_server_LO1.ini'], pendingCount: 0, canRestore: false, conflicts: [] } }
}

function recipe(role: MacroRole, ids: number[] = []): MacroRecipe {
  return { id: role, role, name: role, description: 'A synthetic test macro.', selection: { role }, lines: ['/cast 1'],
    requiredSpellIds: ids, missingSpellIds: [], mana: 10, pauseTenths: 5, ready: true, status: 'ready', reasons: [] }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

test('overlapping polls share one request and do not race the snapshot', async () => {
  const pending = deferred<MacroAssistantSnapshot>()
  let reads = 0
  const states: MacroSessionState[] = []
  const session = new MacroSession({ getMacroAssistant: () => { reads++; return pending.promise },
    mutateMacroAssistant: async () => ({ ok: true, snapshot: snapshot() }) }, (state) => states.push(state))
  const first = session.read()
  const second = session.read()
  assert.equal(first, second)
  assert.equal(reads, 1)
  pending.resolve(snapshot()); await first
  assert.equal(states.length, 1)
  session.dispose()
})

test('an edit waits for a poll, discards its stale answer, and prevents overlapping edits', async () => {
  const states: MacroSessionState[] = []
  const old = snapshot()
  const fresh = snapshot(); fresh.settings.autoUpdate = true
  const pending = deferred<MacroAssistantSnapshot>()
  let reads = 0
  let edits = 0
  const bridge: MacroBridge = { getMacroAssistant: () => ++reads === 1 ? Promise.resolve(old) : pending.promise,
    mutateMacroAssistant: async () => { edits++; return { ok: true, snapshot: fresh } } }
  const session = new MacroSession(bridge, (state) => states.push(state))
  await session.read()
  const poll = session.read()
  const edit = session.mutate({ characterId: old.characterId!, action: 'configure', settings: { autoUpdate: true } })
  await session.mutate({ characterId: old.characterId!, action: 'queue' })
  assert.equal(edits, 0)
  const stale = snapshot(); stale.context.message = 'This stale poll must never appear'
  pending.resolve(stale); await poll; await edit
  assert.equal(edits, 1)
  assert.equal(states.at(-1)?.snapshot, fresh)
  assert.equal(states.at(-1)?.busy, false)
  assert.ok(states.every((state) => state.snapshot?.context.message !== stale.context.message))
})

test('character switching cancels a queued mutation and drops the old poll', async () => {
  const old = snapshot()
  const pending = deferred<MacroAssistantSnapshot>()
  let reads = 0
  let edits = 0
  const states: MacroSessionState[] = []
  const session = new MacroSession({ getMacroAssistant: () => ++reads === 1 ? Promise.resolve(old) : pending.promise,
    mutateMacroAssistant: async () => { edits++; return { ok: true, snapshot: old } } }, (state) => states.push(state))
  await session.read()
  const poll = session.read()
  const edit = session.mutate({ characterId: old.characterId!, action: 'queue' })
  session.reset()
  pending.resolve(old); await poll; await edit
  assert.equal(edits, 0)
  assert.equal(states.at(-1)?.snapshot, null)
})

test('unmount drops an in-flight result and a mismatched character cannot submit', async () => {
  const pending = deferred<MacroAssistantSnapshot>()
  const states: MacroSessionState[] = []
  let edits = 0
  const session = new MacroSession({ getMacroAssistant: () => pending.promise,
    mutateMacroAssistant: async () => { edits++; return { ok: true, snapshot: snapshot() } } }, (state) => states.push(state))
  const reading = session.read()
  await session.mutate({ characterId: 'Other', action: 'queue' })
  session.dispose(); pending.resolve(snapshot()); await reading
  assert.equal(states.length, 0)
  assert.equal(edits, 0)
})

test('failed mutations remain visible across background polls and clear on explicit refresh', async () => {
  const states: MacroSessionState[] = []
  const session = new MacroSession({ getMacroAssistant: async () => snapshot(),
    mutateMacroAssistant: async () => ({ ok: false, error: 'Destination is full.', snapshot: snapshot() }) }, (state) => states.push(state))
  await session.read()
  await session.mutate({ characterId: 'Example@server', action: 'queue' })
  await session.read()
  assert.equal(states.at(-1)?.error, 'Destination is full.')
  await session.read(true)
  assert.equal(states.at(-1)?.error, null)
})

test('missing selected recipes remain visible and can be removed without affecting other selections', () => {
  const selected = [{ role: 'buff' as const, spellLine: 'old blessing' }, { role: 'pet-attack' as const }]
  const result = recipePresentation([recipe('pet-attack')], selected, 'selected')
  assert.equal(result.displayed.length, 2)
  assert.equal(result.ready, 1)
  const missing = result.displayed.find((entry) => entry.selection.spellLine === 'old blessing')!
  assert.equal(missing.ready, false)
  assert.equal(result.selected.has(macroSelectionKey(missing.selection)), true)
  assert.deepEqual(changeSelection(selected, missing.selection, false), [{ role: 'pet-attack' }])
})

test('starter set favors combo macros and preserves a buff not contained in the combo', () => {
  const covered = { ...recipe('buff', [1]), id: 'buff:covered', selection: { role: 'buff' as const, spellLine: 'covered' } }
  const extra = { ...recipe('buff', [5]), id: 'buff:extra', selection: { role: 'buff' as const, spellLine: 'extra' } }
  const choices = starterSelections([recipe('pet-attack'), covered, recipe('self-buffs', [1, 2, 3, 4]),
    extra, recipe('pet-opener', [8]), { ...recipe('mez'), ready: false }], [{ role: 'loc' }])
  const keys = choices.map(macroSelectionKey)
  assert.deepEqual(keys, ['loc', 'pet-opener', 'self-buffs', 'buff:extra'])
  assert.equal(keys.includes('pet-attack'), false)
  assert.equal(keys.includes('buff:covered'), false)
})

test('starter set remains compact and never selects unavailable suggestions', () => {
  const choices = starterSelections(['damage', 'heal-self', 'heal-target', 'heal-pet', 'debuff', 'mez', 'summon-pet', 'loc', 'export']
    .map((role) => recipe(role as MacroRole)), [])
  assert.equal(choices.length, 8)
})

test('selected unavailable cards expose an enabled deselection input and disable copying', () => {
  const unavailable = { ...recipe('mez'), ready: false, status: 'unavailable' as const }
  const html = renderToStaticMarkup(createElement(MacroRecipeCard, { recipe: unavailable, selected: true, busy: false, onSelect: () => assert.fail('Rendering cannot edit a selection') }))
  const input = html.match(/<input[^>]+data-testid="macros-select-mez"[^>]*>/)?.[0] ?? ''
  assert.ok(input.includes('checked'))
  assert.equal(input.includes('disabled'), false)
  assert.ok(html.includes('Copy commands'))
  assert.ok(html.includes('macros-recipe-mez'))
})

test('installation status exposes its state, correct checkbox handle, and next-launch instructions', () => {
  const state = snapshot(); state.installation.state = 'pending'; state.installation.message = 'Queued for next launch.'
  const html = renderToStaticMarkup(createElement(MacroInstallation, { snapshot: state, busy: false,
    configure: () => assert.fail('Rendering cannot configure'), action: () => assert.fail('Rendering cannot queue') }))
  assert.ok(html.includes('data-state="pending"'))
  assert.ok(html.match(/<input[^>]+data-testid="macros-auto-update"/))
  assert.ok(html.includes('you press their hotbuttons in game'))
  assert.ok(html.includes('Leave the companion open'))
})

test('starter additions preserve eight existing choices and stop at twelve total', () => {
  const existing = Array.from({ length: 8 }, (_, index) => ({ role: 'buff' as const, spellLine: `existing ${index}` }))
  const suggestions = ['damage', 'heal-self', 'heal-target', 'heal-pet', 'debuff', 'mez', 'summon-pet', 'loc', 'export'].map((role) => recipe(role as MacroRole))
  const choices = starterSelections(suggestions, existing)
  assert.equal(choices.length, 12)
  assert.deepEqual(choices.slice(0, 8), existing)
  assert.deepEqual(changeSelection(choices, { role: 'mez' }, true), choices)
})

test('offline cached recipes cannot queue a new plan, while the pending explanation remains visible', () => {
  const state = snapshot(); state.context.live = false; state.installation.state = 'pending'
  const html = renderToStaticMarkup(createElement(MacroInstallation, { snapshot: state, busy: false,
    configure: () => assert.fail('Rendering cannot configure'), action: () => assert.fail('Rendering cannot queue') }))
  const button = html.match(/<button[^>]+data-testid="macros-queue"[^>]*>/)?.[0] ?? ''
  assert.ok(button.includes('disabled'))
  assert.ok(html.includes('Existing queued plans still install'))
})

test('starter spell roles follow available classes while manual family choices remain explicit', () => {
  const damage = { ...recipe('damage', [1]), selection: { role: 'damage' as const, spellLine: 'flame' } }
  const heal = { ...recipe('heal-self', [2]), selection: { role: 'heal-self' as const, spellLine: 'mending' } }
  assert.deepEqual(starterSelections([damage, heal], []), [{ role: 'damage' }, { role: 'heal-self' }])
  assert.deepEqual(changeSelection([], damage.selection, true), [damage.selection])
  const manual = { role: 'damage' as const, spellLine: 'frost' }
  assert.deepEqual(starterSelections([damage, heal], [manual]), [manual, { role: 'heal-self' }])
})
