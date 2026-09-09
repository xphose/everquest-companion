import assert from 'node:assert/strict'
import { test } from 'node:test'
import { gameConnection } from '../src/shared/gameConnection'
import { GameConnectionSession } from '../src/renderer/src/lib/gameConnectionSession'
import type { PlayerLocationResult } from '../src/shared/playerLocation'

const live = (sampledAt = 1000, characterName = 'Samplehero'): PlayerLocationResult => ({ state: 'live', location: {
  characterName, sampledAt, zone: 'qeynos2', ns: 1, ew: 2, z: 3, heading: 0
} })
const unavailable: PlayerLocationResult = { state: 'unavailable', reason: 'Access denied.' }
function deferred() {
  let resolve!: (result: PlayerLocationResult) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<PlayerLocationResult>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

test('game connection distinguishes closed, character select, unsupported and uncertain observations', () => {
  assert.equal(gameConnection(undefined, undefined, 1000).state, 'checking')
  for (const [state, expected] of [['not-running', 'closed'], ['not-in-world', 'waiting'],
    ['unsupported', 'unsupported'], ['ambiguous', 'ambiguous'], ['unavailable', 'unknown']] as const) {
    assert.equal(gameConnection({ state, reason: 'Synthetic observation.' }, undefined, 1000).state, expected)
  }
  assert.equal(gameConnection(unavailable, undefined, 1000).label, 'Game status unknown')
  assert.match(gameConnection({ state: 'unsupported', reason: 'Unsupported platform.' }, undefined, 1000).label, /unsupported/i)
})

test('only a current matching player is connected; future, expired and wrong-character samples are not', () => {
  assert.equal(gameConnection(live(), 'SAMPLEHERO', 1000).state, 'connected')
  assert.equal(gameConnection(live(), undefined, 1000).state, 'connected')
  assert.equal(gameConnection(live(), 'Samplehero', 2500).state, 'connected')
  for (const now of [999, 2501, Number.NaN, Infinity]) {
    assert.equal(gameConnection(live(), 'Samplehero', now).state, 'unknown')
  }
  assert.equal(gameConnection(live(), 'Otherhero', 1000).state, 'other-character')
})

test('polling coalesces requests and expires a live badge against current wall time while a read stalls', async () => {
  let now = 1000, calls = 0
  let next = deferred()
  const values: string[] = []
  const session = new GameConnectionSession(() => { calls++; return next.promise }, (value) => values.push(value.status.state), () => now)
  session.setContext('first', 'Samplehero')
  const first = session.read()
  session.tick(); session.tick()
  assert.equal(calls, 1)
  next.resolve(live())
  await first
  assert.equal(values.at(-1), 'connected')
  next = deferred()
  now = 1500; session.tick()
  now = 2501; session.tick()
  assert.equal(calls, 2)
  assert.equal(values.at(-1), 'unknown')
  next.resolve(live(now))
  await session.read()
  assert.equal(values.at(-1), 'connected')
  session.dispose()
})

test('context changes clear immediately and reject replies from the prior character or configuration', async () => {
  const next = deferred()
  let calls = 0
  const values: { contextKey: string; status: { state: string } }[] = []
  const session = new GameConnectionSession(() => { calls++; return calls === 1 ? next.promise : Promise.resolve(live(1000, 'Otherhero')) }, value => values.push(value), () => 1000)
  session.setContext('old-world', 'Samplehero')
  const pending = session.read()
  session.setContext('new-world', 'Otherhero')
  assert.equal(values.at(-1)?.status.state, 'checking')
  next.resolve(live())
  await pending
  assert.equal(values.some(value => value.contextKey === 'new-world' && value.status.state === 'connected'), false)
  await session.read()
  assert.equal(values.at(-1)?.status.state, 'connected')
  session.invalidate()
  assert.equal(values.at(-1)?.status.state, 'checking')
  session.dispose()
})

test('timeouts do not call the game closed or create overlapping IPC; late replies are ignored and a new read recovers', async () => {
  let now = 1000, calls = 0
  const next = deferred()
  const values: string[] = []
  const session = new GameConnectionSession(() => { calls++; return calls === 1 ? next.promise : Promise.resolve(live(now)) }, value => values.push(value.status.state), () => now)
  session.setContext('world', 'Samplehero')
  const pending = session.read()
  now = 7000; session.tick(); session.tick()
  assert.equal(values.at(-1), 'unknown')
  assert.equal(calls, 1)
  next.resolve(live(now))
  await pending
  assert.equal(values.at(-1), 'unknown')
  await session.read()
  assert.equal(values.at(-1), 'connected')
  session.dispose()
})

test('failed reads recover; disposal discards pending replies and stops subsequent reads', async () => {
  let next = deferred(), calls = 0
  const values: string[] = []
  const session = new GameConnectionSession(() => { calls++; return next.promise }, value => values.push(value.status.state), () => 1000)
  session.setContext('world', 'Samplehero')
  const pending = session.read()
  next.reject(new Error('Synthetic IPC failure'))
  await pending
  assert.equal(values.at(-1), 'unknown')
  next = deferred()
  const recovery = session.read()
  next.resolve(live())
  await recovery
  assert.equal(values.at(-1), 'connected')
  next = deferred()
  const final = session.read()
  session.dispose()
  const count = values.length
  next.resolve({ state: 'not-running', reason: 'Game has closed.' })
  await final
  session.tick(); await session.read()
  assert.equal(values.length, count)
  assert.equal(calls, 3)
})

test('an over-deadline completion is refused even before the next timer tick', async () => {
  let now = 1000
  const next = deferred()
  const values: string[] = []
  const session = new GameConnectionSession(() => next.promise, value => values.push(value.status.state), () => now)
  session.setContext('world', 'Samplehero')
  const pending = session.read()
  now = 5001
  next.resolve(live(now))
  await pending
  assert.equal(values.at(-1), 'unknown')
  session.dispose()
})

test('identical live observations do not notify the UI on every tick', async () => {
  let now = 1000
  const values: string[] = []
  const session = new GameConnectionSession(() => Promise.resolve(live(now)), value => values.push(value.status.state), () => now)
  session.setContext('world', 'Samplehero')
  await session.read()
  const count = values.length
  for (let i = 0; i < 10; i++) { now += 500; await session.read(); session.expire() }
  assert.equal(values.length, count)
  session.dispose()
})
