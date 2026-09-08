import assert from 'node:assert/strict'
import test from 'node:test'
import React, { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { MacroAssistantSnapshot } from '../src/shared/macroAssistant'
import { MacroSession, type MacroSessionState } from '../src/renderer/src/components/macros/macroSession'
import { installationFeedback } from '../src/renderer/src/components/macros/macroFeedback'
import { MacroStatus } from '../src/renderer/src/components/macros/MacroStatus'
import { MacroInstallation } from '../src/renderer/src/components/macros/MacroInstallation'

Object.assign(globalThis, { React }) // Isolated node JSX runtime; the renderer uses react-jsx.

function snapshot(state: MacroAssistantSnapshot['installation']['state'] = 'pending'): MacroAssistantSnapshot {
  return { character: { name: 'Example', server: 'test', logPath: 'fixture.log' }, characterId: 'Example@test',
    context: { live: true, message: 'Current', classes: ['MAG'], availableSpellSlots: 8 },
    settings: { autoUpdate: true, style: 'solo', selections: [{ role: 'loc' }], destination: { bar: 2, page: 1 } },
    recipes: [], existing: [], installation: { state, message: 'Fixture status', targetFiles: [], pendingCount: 1, canRestore: false, conflicts: [] } }
}
function completed(kind: 'written' | 'unchanged' = 'written'): MacroAssistantSnapshot {
  const state = snapshot('applied')
  state.installation.completion = { kind, at: '2026-09-08T18:00:00.000Z', targetFile: 'Example_test_LO1.ini', destination: { bar: 2, page: 1 } }
  return state
}
function fixture(initial = snapshot()) {
  let value = initial
  let current: MacroSessionState = { snapshot: null, busy: false, error: null }
  const session = new MacroSession({ getMacroAssistant: async () => value,
    mutateMacroAssistant: async () => ({ ok: true, snapshot: value }) }, (next) => { current = next })
  return { session, state: () => current, set: (next: MacroAssistantSnapshot) => { value = next } }
}

test('each successful Queue click acknowledges even when the plan was already pending', async () => {
  const f = fixture()
  await f.session.read()
  assert.equal(f.state().notice, null)
  await f.session.mutate({ characterId: 'Example@test', action: 'queue' })
  const first = f.state().notice!
  assert.match(first.feedback.title, /Queued, not written yet/)
  assert.match(first.feedback.message, /wait for Saved or Already up to date before relaunching/)
  await f.session.mutate({ characterId: 'Example@test', action: 'queue' })
  assert.ok(f.state().notice!.id > first.id)
  f.session.dismissNotice(first.id)
  assert.ok(f.state().notice, 'An older Snackbar timer must not dismiss the newer acknowledgement')
})

test('pending completion replaces the queue toast once and polling never resurrects a dismissed toast', async () => {
  const f = fixture()
  await f.session.read()
  await f.session.mutate({ characterId: 'Example@test', action: 'queue' })
  const queued = f.state().notice!.id
  f.set(completed())
  await f.session.read()
  const saved = f.state().notice!
  assert.ok(saved.id > queued)
  assert.equal(saved.feedback.title, 'Saved to character settings')
  await f.session.read()
  assert.equal(f.state().notice!.id, saved.id)
  f.session.dismissNotice(saved.id)
  await f.session.read()
  assert.equal(f.state().notice, null)
})

test('newly mounted or switched characters do not announce old completion and configure does not spam', async () => {
  const f = fixture(completed())
  await f.session.read()
  assert.equal(f.state().notice, null)
  await f.session.mutate({ characterId: 'Example@test', action: 'configure', settings: { autoUpdate: false } })
  assert.equal(f.state().notice, null)
  f.set(snapshot())
  await f.session.read()
  await f.session.mutate({ characterId: 'Example@test', action: 'queue' })
  f.session.reset()
  assert.equal(f.state().notice, null)
  const next = completed(); next.characterId = 'Other@test'
  f.set(next)
  await f.session.read()
  assert.equal(f.state().notice, null)
})

test('a different-character poll and a partial conflict cannot leave a queued success toast', async () => {
  const f = fixture()
  await f.session.read()
  await f.session.mutate({ characterId: 'Example@test', action: 'queue' })
  const next = completed(); next.characterId = 'Other@test'
  f.set(next); await f.session.read()
  assert.equal(f.state().notice, null)
  f.set(snapshot()); await f.session.read()
  const conflict = completed(); conflict.installation.state = 'conflict'; conflict.installation.message = 'One user-edited macro was preserved.'
  f.set(conflict); await f.session.read()
  assert.equal(f.state().notice?.feedback.severity, 'warning')
  assert.equal(f.state().notice?.feedback.title, 'Needs your attention')
})

test('queue errors suppress acknowledgements and remain authoritative across polls', async () => {
  let state: MacroSessionState = { snapshot: null, busy: false, error: null }
  const session = new MacroSession({ getMacroAssistant: async () => snapshot(),
    mutateMacroAssistant: async () => ({ ok: false, error: 'The active character changed.', snapshot: snapshot() }) }, (next) => { state = next })
  await session.read()
  await session.mutate({ characterId: 'Example@test', action: 'queue' })
  await session.read()
  assert.equal(state.error, 'The active character changed.')
  assert.equal(state.notice, null)
})

test('a late successful queue response after a character reset cannot announce the old character', async () => {
  let answer!: (value: { ok: boolean; snapshot: MacroAssistantSnapshot }) => void
  let dispatched!: () => void
  const pending = new Promise<{ ok: boolean; snapshot: MacroAssistantSnapshot }>((resolve) => { answer = resolve })
  const sent = new Promise<void>((resolve) => { dispatched = resolve })
  let state: MacroSessionState = { snapshot: null, busy: false, error: null }
  const session = new MacroSession({ getMacroAssistant: async () => snapshot(),
    mutateMacroAssistant: () => { dispatched(); return pending } }, (next) => { state = next })
  await session.read()
  const operation = session.mutate({ characterId: 'Example@test', action: 'queue' })
  await sent
  session.reset()
  answer({ ok: true, snapshot: snapshot() })
  await operation
  assert.equal(state.snapshot, null)
  assert.equal(state.notice, null)
})

test('written status includes destination and real write time; unchanged labels only its check time', () => {
  const written = renderToStaticMarkup(createElement(MacroStatus, { snapshot: completed() }))
  assert.ok(written.includes('role="status"'))
  assert.ok(written.includes('Saved to character settings'))
  assert.ok(written.includes('Hotbar 2 · Page 1'))
  assert.ok(written.includes('dateTime="2026-09-08T18:00:00.000Z"'))
  const unchanged = completed('unchanged'); unchanged.installation.appliedAt = '2000-01-01T00:00:00.000Z'
  const feedback = installationFeedback(unchanged)
  assert.equal(feedback.title, 'Already up to date')
  assert.equal(feedback.timestamp?.label, 'Last checked')
  assert.ok(feedback.message.includes('If these macros are already visible in game'))
  const html = renderToStaticMarkup(createElement(MacroStatus, { snapshot: unchanged }))
  assert.ok(!html.includes('2000-01-01'))
})

test('legacy applied messages stay readable and a busy queue never claims a file is being written', () => {
  const legacy = snapshot('applied'); legacy.installation.message = 'The managed hotbuttons already match this plan.'
  legacy.installation.appliedAt = '2000-01-01T00:00:00.000Z'
  const feedback = installationFeedback(legacy)
  assert.equal(feedback.message, legacy.installation.message)
  assert.equal(feedback.timestamp, undefined)
  const html = renderToStaticMarkup(createElement(MacroInstallation, { snapshot: snapshot(), busy: true, busyAction: 'queue',
    configure: () => assert.fail('Rendering cannot configure'), action: () => assert.fail('Rendering cannot queue') }))
  assert.ok(html.includes('Queuing request'))
  assert.ok(!html.includes('Saving…'))
  assert.ok(html.includes('Fully exit EverQuest'))
})
