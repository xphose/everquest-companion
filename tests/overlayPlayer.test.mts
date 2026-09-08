import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { PlayerLocation, PlayerLocationResult } from '../src/shared/playerLocation'
import { LOCATION_MAX_AGE_MS } from '../src/shared/currentPlayer'
import { OverlayPlayerSession } from '../src/renderer/src/overlay/overlayPlayerSession'
import { overlayCurrentZone } from '../src/renderer/src/overlay/overlayCurrentData'
import { respawnInZone } from '../src/shared/respawn'

const character = (name = 'Example') => ({ name, server: 'fixture', logPath: `${name}.log` })
function live(now: number, patch: Partial<PlayerLocation> = {}): PlayerLocationResult {
  return { state: 'live', location: { characterName: 'Example', level: 10, zone: 'befallen', ns: 0, ew: 0, z: 0, heading: 0, sampledAt: now, ...patch } }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

test('live overlay reads initial identity before native facts and clears stale, wrong-character, disconnected and failed observations', async () => {
  let now = 1000, calls = 0
  let player: PlayerLocation | null = null
  let result = live(now)
  let fail = false
  const session = new OverlayPlayerSession({ getCharacter: async () => character(), getPlayerLocation: async () => {
    calls++; if (fail) throw new Error('disconnected'); return result
  } }, (value) => { player = value }, () => now)
  await session.read()
  assert.equal(player!.level, 10)
  now += LOCATION_MAX_AGE_MS + 1
  session.expire()
  assert.equal(player, null)
  result = live(now, { characterName: 'Other' })
  await session.read()
  assert.equal(player, null)
  result = { state: 'not-running', reason: 'closed' }
  await session.read()
  assert.equal(player, null)
  fail = true
  await session.read()
  assert.equal(player, null)
  fail = false; result = live(now, { level: 11, zone: 'gukbottom' })
  await session.read()
  assert.equal(player!.level, 11)
  assert.equal(player!.zone, 'gukbottom')
  assert.equal(calls, 5)
  session.dispose()
})

test('overlay polling is single-flight and a character switch discards a late native reply', async () => {
  const first = deferred<PlayerLocationResult>()
  let calls = 0, player: PlayerLocation | null = null
  const session = new OverlayPlayerSession({ getCharacter: async () => character(), getPlayerLocation: () => {
    calls++; return calls === 1 ? first.promise : Promise.resolve(live(1000, { characterName: 'Other', level: 20 }))
  } }, (value) => { player = value }, () => 1000)
  const pending = session.read()
  assert.equal(session.read(), pending)
  await Promise.resolve()
  assert.equal(calls, 1)
  session.setCharacter(character('Other'))
  first.resolve(live(1000))
  await pending
  await Promise.resolve()
  assert.equal(calls, 2)
  assert.equal(player!.characterName, 'Other')
  assert.equal(player!.level, 20)
  session.dispose()
})

test('no selected character cannot authorize a native read, and late initial identity cannot replace a switch', async () => {
  let nativeCalls = 0
  const initial = deferred<ReturnType<typeof character> | null>()
  let player: PlayerLocation | null = null
  const session = new OverlayPlayerSession({ getCharacter: () => initial.promise,
    getPlayerLocation: async () => { nativeCalls++; return live(1000, { characterName: 'Other' }) }
  }, (value) => { player = value }, () => 1000)
  const pending = session.read()
  session.setCharacter(character('Other'))
  initial.resolve(character())
  await pending; await Promise.resolve()
  assert.equal(player!.characterName, 'Other')
  assert.equal(nativeCalls, 1)
  session.dispose()
  const empty = new OverlayPlayerSession({ getCharacter: async () => null,
    getPlayerLocation: async () => { throw new Error('Must not read without identity') } }, (value) => assert.equal(value, null))
  await empty.read()
  empty.dispose()
})

test('live zone mapping preserves a matching logged tier and never transfers it to another zone', () => {
  const result = live(1000)
  assert.equal(result.state, 'live')
  if (result.state !== 'live') return
  const log = 'Befallen 1 (Awakened)'
  const current = overlayCurrentZone(log, result.location)
  assert.equal(current.zone, log)
  assert.equal(current.message, 'Live zone · tier from log')
  const moved = overlayCurrentZone(log, { ...result.location, zone: 'gukbottom' })
  assert.equal(moved.source, 'live')
  assert.ok(!moved.zone.includes('Awakened'))
  const rows = [{ id: 1, zone: log }, { id: 2, zone: moved.zone }]
  assert.deepEqual(respawnInZone(rows, moved.zone).map((row) => row.id), [2])
  assert.equal(rows.length, 2)
  assert.deepEqual(overlayCurrentZone(log, { ...result.location, zone: 'unknown-zone' }),
    { zone: log, source: 'log', message: 'Log zone · live zone name unavailable' })
  assert.equal(overlayCurrentZone(log, null).source, 'log')
})
