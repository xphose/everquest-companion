import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import type { PlayerLocation, PlayerLocationResult } from '../src/shared/playerLocation'
import type { ActiveBuffNames } from '../src/shared/activeBuffs'
import { DEFAULT_BUFF_ALLOW_PREFS } from '../src/shared/buffAllow'
import { LOCATION_MAX_AGE_MS } from '../src/shared/currentPlayer'
import { useActiveSelfEffects } from '../src/renderer/src/overlay/useActiveSelfEffects'
import { mountHook } from './hookHost.mts'

const flush = () => new Promise<void>((resolve) => setImmediate(resolve))
const player = (patch: Partial<PlayerLocation> = {}): PlayerLocation => ({
  characterName: 'Example', zone: 'test', ns: 0, ew: 0, z: 0, heading: 0, sampledAt: Date.now(),
  activeBuffs: [{ spellId: 900001, kind: 'buff', slot: 1, remainingMs: 18_000 }], ...patch
})

async function fixture(context: TestContext) {
  context.mock.timers.enable({ apis: ['Date', 'setInterval', 'setTimeout'], now: 10_000 })
  let displayNow = Date.now(), nameReads = 0
  const replies: ((result: PlayerLocationResult) => void)[] = []
  const states: boolean[] = []
  const bridge = {
    getCharacter: async () => ({ name: 'Example', server: 'fixture', logPath: 'example.log' }),
    getPlayerLocation: () => new Promise<PlayerLocationResult>((resolve) => replies.push(resolve)),
    onCharacter: () => () => undefined, onModuleChanged: () => () => undefined,
    getActiveBuffNames: async (): Promise<ActiveBuffNames> => { nameReads++; return { 900001: 'Test Enduring Light' } }
  }
  const previousWindow = globalThis.window
  Object.assign(globalThis, { window: { eqOverlay: bridge } })
  const hook = mountHook(() => {
    const model = useActiveSelfEffects(true, DEFAULT_BUFF_ALLOW_PREFS, displayNow)
    states.push(model.live)
    return model
  })
  context.after(() => { hook.unmount(); Object.assign(globalThis, { window: previousWindow }) })
  await flush()
  return {
    hook, states, nameReads: () => nameReads,
    displayTick: () => { displayNow = Date.now(); return hook.render() },
    reply: async (location: PlayerLocation | null = player()) => {
      const respond = replies.shift()
      assert.ok(respond, 'A real overlay poll must be pending')
      respond(location ? { state: 'live', location } : { state: 'not-running', reason: 'Staged disconnect' })
      await flush(); hook.render(); await flush()
      return hook.render()
    }
  }
}

test('native samples between display ticks keep live rows and metadata through every render', async (context) => {
  const f = await fixture(context)
  const first = await f.reply()
  assert.equal(first.live, true)
  assert.equal(first.rows[0].name, 'Test Enduring Light')
  const times = new Set([first.rows[0].time])
  f.states.length = 0
  for (let tick = 0; tick < 8; tick++) {
    // The display interval fires first; the native worker answers a quarter second later.
    context.mock.timers.tick(tick ? 750 : 1000)
    f.displayTick()
    context.mock.timers.tick(250)
    const current = await f.reply(player({ activeBuffs: [
      { spellId: 900001, kind: 'buff', slot: 1, remainingMs: 28_000 - Date.now() }
    ] }))
    assert.equal(current.live, true, 'A newly received sample is newer than the display tick, not in the future')
    assert.equal(current.epoch, first.epoch)
    assert.equal(current.rows[0].id, first.rows[0].id)
    assert.equal(current.rows[0].name, first.rows[0].name)
    times.add(current.rows[0].time)
  }
  assert.ok(f.states.every(Boolean), 'No intermediate render may fall back to log rows')
  assert.equal(f.nameReads(), 1, 'Unchanged effect IDs must not reload their names on timer ticks')
  assert.ok(times.size > 1, 'The retained row still counts down')
})

test('native effects still expire and reject future, wrong-character, missing and disconnected samples', async (context) => {
  const f = await fixture(context)
  const first = await f.reply()
  context.mock.timers.tick(LOCATION_MAX_AGE_MS + 1)
  assert.equal(f.hook.render().live, false, 'An unanswered poll cannot keep expired effects live')
  assert.deepEqual(f.hook.value.rows, [])
  const recovery = await f.reply()
  assert.equal(recovery.live, true)
  assert.equal(recovery.epoch, first.epoch)
  for (const patch of [
    () => player({ sampledAt: Date.now() + 1 }),
    () => player({ sampledAt: Date.now() - LOCATION_MAX_AGE_MS - 1 }),
    () => player({ characterName: 'Other' }),
    () => player({ activeBuffs: undefined }),
    () => null
  ]) {
    context.mock.timers.tick(1000)
    const current = await f.reply(patch())
    assert.equal(current.live, false)
    assert.deepEqual(current.rows, [])
  }
  context.mock.timers.tick(1000)
  const removed = await f.reply(player({ activeBuffs: [] }))
  assert.equal(removed.live, true, 'A verified empty table remains authoritative')
  assert.deepEqual(removed.rows, [])
  context.mock.timers.tick(1000)
  const restored = await f.reply()
  assert.equal(restored.live, true)
  assert.equal(restored.rows.length, 1)
  assert.equal(restored.epoch, removed.epoch, 'A real effect addition/removal is not a source reset')
})
