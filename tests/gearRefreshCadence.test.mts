import { test } from 'node:test'
import assert from 'node:assert/strict'
import { gearInventorySession, type GearInventoryReading } from '../src/renderer/src/features/gear/gearInventorySession'
import { gearRefreshCadence, GEAR_CHARACTER_INTERVAL, GEAR_INVENTORY_INTERVAL } from '../src/renderer/src/features/gear/gearRefreshCadence'
import type { PlannerInventory } from '../src/shared/planner/inventorySlots'
import { NO_OWNERSHIP, type OwnershipPayload } from '../src/shared/planner/ownership'

const drain = async (): Promise<void> => { for (let index = 0; index < 8; index++) await Promise.resolve() }
const pair = (tier = 0, loadedAt = '2026-01-01T00:00:00Z'): [PlannerInventory, OwnershipPayload] => [
  { path: 'synthetic-inventory.txt', loadedAt, hosts: [{ slot: 'HEAD', name: 'Cloth Cap', key: 'cloth cap', tier }] },
  { ...NO_OWNERSHIP, path: 'synthetic-inventory.txt', loadedAt }
]
function fixture() {
  const states: GearInventoryReading[] = []
  const pending: { resolve: (value: [PlannerInventory | null, OwnershipPayload]) => void; reject: (error: Error) => void }[] = []
  let now = 1000
  const session = gearInventorySession({ now: () => now++, publish: state => states.push(state),
    read: () => new Promise((resolve, reject) => pending.push({ resolve, reject })) })
  return { session, states, pending }
}

test('inventory watcher, manual and resume bursts stay single-flight and coalesce into one fresh read', async () => {
  const f = fixture()
  f.session.tick()
  for (let count = 0; count < 5; count++) { f.session.invalidate(); f.session.refresh(); f.session.tick() }
  assert.equal(f.pending.length, 1)
  f.pending[0].resolve(pair()); await drain()
  assert.equal(f.states.length, 0, 'invalidated file pair is discarded')
  assert.equal(f.pending.length, 2)
  f.pending[1].resolve(pair(1)); await drain()
  assert.equal(f.states.at(-1)?.inventory?.hosts[0].tier, 1)
  assert.equal(f.pending.length, 2, 'burst does not leave extra queued work')
})

test('unchanged checks advance checked time while retaining recommendation inputs and export provenance', async () => {
  const f = fixture()
  f.session.tick(); f.pending[0].resolve(pair()); await drain()
  const first = f.states.at(-1)!
  f.session.tick(); f.pending[1].resolve(pair()); await drain()
  const second = f.states.at(-1)!
  assert.equal(second.inventory, first.inventory)
  assert.equal(second.ownership, first.ownership)
  assert.ok(second.checkedAt! > first.checkedAt!)
  f.session.tick(); f.pending[2].resolve(pair(0, '2026-01-02T00:00:00Z')); await drain()
  const exported = f.states.at(-1)!
  assert.equal(exported.inventory?.hosts, first.inventory?.hosts)
  assert.equal(exported.ownership.entries, first.ownership.entries)
  assert.equal(exported.inventory?.loadedAt, '2026-01-02T00:00:00Z')
  f.session.tick(); f.pending[3].resolve(pair(1)); await drain()
  assert.notEqual(f.states.at(-1)?.inventory?.hosts, first.inventory?.hosts)
})

test('failed or mixed exports retain the last successful read and recover on the next cadence', async () => {
  const f = fixture()
  f.session.tick(); f.pending[0].resolve(pair()); await drain()
  const first = f.states.at(-1)!
  f.session.tick(); f.pending[1].reject(new Error('temporarily unreadable')); await drain()
  assert.equal(f.states.at(-1)?.inventory, first.inventory)
  assert.equal(f.states.at(-1)?.checkedAt, first.checkedAt)
  assert.match(f.states.at(-1)?.error ?? '', /Retrying automatically/)
  f.session.tick()
  const [inventory, ownership] = pair(2)
  f.pending[2].resolve([inventory, { ...ownership, loadedAt: '2026-01-03T00:00:00Z' }]); await drain()
  assert.equal(f.states.at(-1)?.inventory, first.inventory)
  assert.equal(f.pending.length, 3, 'mismatched exports never cause a tight retry loop')
  f.session.tick(); f.pending[3].resolve(pair(2)); await drain()
  assert.equal(f.states.at(-1)?.error, null)
  assert.equal(f.states.at(-1)?.inventory?.hosts[0].tier, 2)
})

test('same-character invalidations keep working; disposed and switched-character reads never publish', async () => {
  const f = fixture()
  f.session.tick(); f.pending[0].resolve(pair()); await drain()
  f.session.invalidate(); f.pending[1].resolve(pair(1)); await drain()
  assert.equal(f.states.at(-1)?.inventory?.hosts[0].tier, 1)
  f.session.tick(); f.session.refresh(); f.session.stop()
  f.pending[2].resolve(pair(2)); await drain()
  f.session.tick()
  assert.equal(f.states.length, 2)
  assert.equal(f.pending.length, 3)
})

function surface() {
  const events = new EventTarget()
  const document = Object.assign(new EventTarget(), { hidden: false })
  const timers = new Map<number, { tick: () => void; interval: number }>()
  let next = 0
  const window = Object.assign(events, {
    setInterval: (tick: () => void, interval: number): number => { timers.set(++next, { tick, interval }); return next },
    clearInterval: (id: number): void => { timers.delete(id) }
  })
  return { window, document, timers }
}

test('the declared cadence keeps visible gameplay current, resumes immediately and removes every listener and timer', async () => {
  const f = surface()
  let ticks = 0
  let refreshes = 0
  const stop = gearRefreshCadence({ ...f, interval: GEAR_INVENTORY_INTERVAL, tick: () => { ticks++ }, refresh: () => { refreshes++ } })
  assert.equal(GEAR_CHARACTER_INTERVAL, 2000)
  assert.equal(f.timers.values().next().value?.interval, 30_000)
  assert.equal(ticks, 1, 'mount checks immediately')
  f.timers.forEach(timer => timer.tick())
  assert.equal(ticks, 2, 'visible but unfocused gameplay is not paused')
  f.document.hidden = true
  f.timers.forEach(timer => timer.tick())
  f.document.dispatchEvent(new Event('visibilitychange')); await drain()
  assert.equal(ticks, 2); assert.equal(refreshes, 0)
  f.document.hidden = false
  f.document.dispatchEvent(new Event('visibilitychange')); f.window.dispatchEvent(new Event('focus')); await drain()
  assert.equal(refreshes, 1, 'resume and focus in a burst share one refresh')
  f.window.dispatchEvent(new Event('focus')); stop(); await drain()
  f.window.dispatchEvent(new Event('focus')); f.document.dispatchEvent(new Event('visibilitychange')); await drain()
  assert.equal(refreshes, 1, 'even already queued resume work is canceled on teardown')
  assert.equal(f.timers.size, 0)
})
