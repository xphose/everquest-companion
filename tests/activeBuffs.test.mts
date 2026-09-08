import assert from 'node:assert/strict'
import test from 'node:test'
import React, { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { activeBuffIds, activeBuffNameRequest, activeEffectRows, activeEffectTime, observedActiveBuffs, withoutSupersededSelfRows, type ActiveBuffObservation, type ActiveBuffNames } from '../src/shared/activeBuffs'
import { DEFAULT_BUFF_ALLOW_PREFS } from '../src/shared/buffAllow'
import type { BuffTimerRow } from '../src/shared/buffTimers'
import type { PlayerLocation } from '../src/shared/playerLocation'
import { createActiveBuffMetadata } from '../src/main/activeBuffs/metadata'
import { ActiveSelfEffects } from '../src/renderer/src/overlay/ActiveSelfEffects'
import { useActiveBuffNames } from '../src/renderer/src/overlay/useActiveBuffNames'
import { mountHook } from './hookHost.mts'
import { MODULE_WORLD_CHANGED, type ModuleChanged } from '../src/shared/types'
import { DAMAGE } from './macroServiceFixture.mts'

Object.assign(globalThis, { React })
const player = (patch: Partial<PlayerLocation> = {}): PlayerLocation => ({
  characterName: 'Example', zone: 'test', ns: 0, ew: 0, z: 0, heading: 0, sampledAt: 10_000,
  activeBuffs: [{ spellId: 74089, kind: 'buff', slot: 1, remainingMs: 18_000_000 }], ...patch
})
const observe = (patch: Partial<PlayerLocation> = {}) => observedActiveBuffs(player(patch), 'Example', 10_000)
const row = (id: string, group: BuffTimerRow['group']): BuffTimerRow => ({ id, group, kind: 'buff', name: id, mode: 'elapsed', startedTs: 1 })

test('already-active effects appear without any log rows or spellbook ownership', () => {
  const observation = observe()
  assert.ok(observation)
  const rows = activeEffectRows(observation, { 74089: 'Summon Bristly Boar' }, DEFAULT_BUFF_ALLOW_PREFS, 10_000)
  assert.deepEqual(rows, [{ id: 'buff:1:74089', spellId: 74089, name: 'Summon Bristly Boar', kind: 'buff', time: '~5h' }])
  const html = renderToStaticMarkup(createElement(ActiveSelfEffects, { model: { live: true, rows, hidden: 0 } }))
  assert.match(html, /Active effects on you · Live/)
  assert.match(html, /Summon Bristly Boar/)
  assert.doesNotMatch(html, /progressbar|width:100%|elapsed|permanent|cast/)
})

test('a verified empty table removes logged self duplicates but preserves pet and enemy timers', () => {
  const observation = observe({ activeBuffs: [] })
  assert.ok(observation)
  const logged = [row('self buff', 'self'), row('pet buff', 'target'), { ...row('enemy CC', 'target'), kind: 'cc' as const }]
  assert.deepEqual(withoutSupersededSelfRows(logged, true), logged.slice(1))
  assert.deepEqual(withoutSupersededSelfRows(logged, false), logged)
  const rows = activeEffectRows(observation, {}, DEFAULT_BUFF_ALLOW_PREFS, 10_000)
  assert.deepEqual(rows, [])
  const html = renderToStaticMarkup(createElement(ActiveSelfEffects, { model: { live: true, rows, hidden: 0 } }))
  assert.match(html, /No active effects on you/)
  assert.doesNotMatch(html, /Waiting|cast/)
})

test('missing, stale, malformed, future and other-character observations cannot replace logged timers', () => {
  for (const value of [null, player({ activeBuffs: undefined }), player({ sampledAt: 8_499 }), player({ sampledAt: 10_001 }), player({ characterName: 'Other' }),
    player({ activeBuffs: [{ spellId: 1, kind: 'buff', slot: 63 }] })]) {
    assert.equal(observedActiveBuffs(value, 'Example', 10_000), null)
  }
  assert.equal(observedActiveBuffs(player(), undefined, 10_000), null)
})

test('remaining time is approximate, never invents an initial duration, and zero does not remove a still-active effect', () => {
  const effect = { spellId: 1, kind: 'song' as const, slot: 2, remainingMs: 66_000 }
  assert.equal(activeEffectTime(effect, 10_000, 16_000), '~1m')
  assert.equal(activeEffectTime(effect, 10_000, 20_000), '~1m')
  assert.equal(activeEffectTime(effect, 10_000, 70_000), '~6s')
  assert.equal(activeEffectTime(effect, 10_000, 99_000), '~0s')
  assert.equal(activeEffectTime({ ...effect, remainingMs: undefined }, 10_000, 99_000), 'Active')
  const observation = observe({ activeBuffs: [{ ...effect, remainingMs: 0 }] })
  assert.equal(activeEffectRows(observation, {}, DEFAULT_BUFF_ALLOW_PREFS, 10_000).length, 1)
  assert.equal(activeEffectRows(observe({ activeBuffs: [] }), {}, DEFAULT_BUFF_ALLOW_PREFS, 10_000).length, 0)
})

test('unknown metadata stays visible and explicit tracking choices apply once a spell line is known', () => {
  const observation = observe()
  assert.equal(activeEffectRows(observation, {}, DEFAULT_BUFF_ALLOW_PREFS, 10_000)[0].name, 'Spell 74089')
  const allow = { optIn: true, lines: { 'summon bristly boar': true } }
  assert.equal(activeEffectRows(observation, { 74089: 'Summon Bristly Boar' }, allow, 10_000).length, 1)
  assert.equal(activeEffectRows(observation, { 74089: 'Summon Bristly Boar' }, { optIn: true, lines: {} }, 10_000).length, 0)
  assert.equal(activeEffectRows(observation, {}, { optIn: true, lines: {} }, 10_000).length, 1)
})

test('metadata requests are bounded positive IDs and use the active game world, including unowned effects', async () => {
  for (const spellIds of [[0], ['1'], [1.1], new Array(1), Array.from({ length: 93 }, (_, i) => i + 1)]) {
    assert.equal(activeBuffNameRequest({ characterName: 'Example', spellIds }), null)
  }
  assert.deepEqual(activeBuffNameRequest({ characterName: 'Example', spellIds: [9, 1, 9] })?.spellIds, [1, 9])
  let scope = { root: 'fixture', characterName: 'Example', characterPath: 'one', token: 'one' }
  let finish!: (spells: typeof DAMAGE[]) => void
  const query = createActiveBuffMetadata({ scope: () => ({ ...scope }), spells: async (_root, ids) => {
    assert.deepEqual(ids, [74089])
    return new Promise((resolve) => { finish = resolve })
  } })
  const request = query({ characterName: 'Example', spellIds: [74089] })
  finish([{ ...DAMAGE, id: 74089, name: 'Unowned active effect' }])
  assert.deepEqual(await request, { 74089: 'Unowned active effect' })
  const old = query({ characterName: 'Example', spellIds: [74089] })
  scope = { ...scope, root: 'other', token: 'two' }
  finish([{ ...DAMAGE, id: 74089, name: 'Old world' }])
  await assert.rejects(old, /changed/)
  await assert.rejects(query({ characterName: 'Other', spellIds: [74089] }), /character changed/)
})

test('the metadata hook fetches only changed ID sets and discards old character/world answers', async () => {
  let observation: ActiveBuffObservation | null = observe()
  let changed: ((change: ModuleChanged) => void) | undefined
  let character: (() => void) | undefined
  const reads: { resolve: (names: ActiveBuffNames) => void; reject: (error: Error) => void }[] = []
  const bridge = {
    onModuleChanged: (cb: typeof changed) => { changed = cb; return () => { changed = undefined } },
    onCharacter: (cb: () => void) => { character = cb; return () => { character = undefined } },
    getActiveBuffNames: () => new Promise<ActiveBuffNames>((resolve, reject) => reads.push({ resolve, reject }))
  }
  const previousWindow = globalThis.window
  Object.assign(globalThis, { window: { eqOverlay: bridge } })
  const hook = mountHook(() => useActiveBuffNames(observation))
  try {
    assert.equal(reads.length, 1)
    observation = observe({ sampledAt: 10_500 }); hook.render()
    assert.equal(reads.length, 1, 'A timer tick must not parse the spell table')
    observation = null; hook.render()
    reads[0].resolve({ 74089: 'Old character' }); await Promise.resolve()
    assert.deepEqual(hook.render(), {})
    observation = observe(); hook.render()
    reads[1].resolve({ 74089: 'Current' }); await Promise.resolve()
    assert.equal(hook.render()[74089], 'Current')
    hook.act(() => changed?.({ moduleId: MODULE_WORLD_CHANGED, seq: -1 }))
    assert.deepEqual(hook.value, {})
    assert.equal(reads.length, 3)
    reads[2].reject(new Error('Missing metadata')); await Promise.resolve(); await Promise.resolve()
    assert.deepEqual(hook.render(), {})
    hook.act(() => character?.())
    assert.equal(reads.length, 4)
    assert.deepEqual(activeBuffIds(observation), [74089])
  } finally { hook.unmount(); Object.assign(globalThis, { window: previousWindow }) }
  assert.equal(changed, undefined)
  assert.equal(character, undefined)
})

test('missing metadata recovers without a cast or ID change, with bounded retries only for unresolved names', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const observation = observe({ activeBuffs: [{ spellId: 1, kind: 'buff', slot: 1 }, { spellId: 2, kind: 'song', slot: 1 }] })
  const reads: number[][] = []
  const bridge = {
    onModuleChanged: () => () => undefined, onCharacter: () => () => undefined,
    getActiveBuffNames: async ({ spellIds }: { spellIds: number[] }): Promise<ActiveBuffNames> => {
      reads.push(spellIds)
      if (reads.length === 1) throw new Error('Worker temporarily unavailable')
      if (reads.length === 2) return {}
      return reads.length === 3 ? { 1: 'First' } : { 2: 'Second' }
    }
  }
  const previousWindow = globalThis.window
  Object.assign(globalThis, { window: { eqOverlay: bridge } })
  const hook = mountHook(() => useActiveBuffNames(observation))
  const flush = () => new Promise<void>((resolve) => setImmediate(resolve))
  try {
    await flush()
    context.mock.timers.tick(4999); await flush()
    assert.equal(reads.length, 1)
    context.mock.timers.tick(1); await flush()
    assert.deepEqual(hook.render(), {})
    context.mock.timers.tick(10_000); await flush()
    assert.deepEqual(hook.render(), { 1: 'First' })
    context.mock.timers.tick(20_000); await flush()
    assert.deepEqual(hook.render(), { 1: 'First', 2: 'Second' })
    assert.deepEqual(reads, [[1, 2], [1, 2], [1, 2], [2]])
    context.mock.timers.tick(60_000); await flush()
    assert.equal(reads.length, 4, 'Complete metadata stops retries')
  } finally { hook.unmount(); Object.assign(globalThis, { window: previousWindow }) }
})
