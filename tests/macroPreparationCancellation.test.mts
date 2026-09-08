import assert from 'node:assert/strict'
import test from 'node:test'
import { createMacroService } from '../src/main/macros/service.ts'
import { preparationFixture } from './macroPreparationServiceFixture.mts'
import { ORIGINAL_INI } from './macroServiceFixture.mts'

test('configuration cancellation preserves a first pending temporary baseline across restart and blocks recapture', async (t) => {
  const f = await preparationFixture(t)
  const captured = (await f.prepare()).snapshot.preparation?.plan
  assert.ok(captured)
  f.observe([null, 50])
  const canceled = await f.service.mutate({ action: 'configure', characterId: f.world.characterId, settings: { autoUpdate: false } })
  assert.equal(canceled.ok, true)
  assert.deepEqual(canceled.snapshot.preparation?.plan?.baseline, captured.baseline)
  assert.equal((await f.saved()).queued, undefined)
  assert.equal((await f.prepare()).ok, false)
  assert.equal((await f.service.mutate({ action: 'queue', characterId: f.world.characterId })).ok, false)
  assert.deepEqual((await createMacroService(f.deps).query()).preparation?.plan?.baseline, captured.baseline)
  assert.equal(await f.read(), ORIGINAL_INI)
})

test('restore cancellation preserves temporary combat baseline before and after restoring an ordinary macro backup', async (t) => {
  const f = await preparationFixture(t)
  await f.service.mutate({ action: 'configure', characterId: f.world.characterId, settings: { selections: [{ role: 'loc' }] } })
  await f.service.mutate({ action: 'queue', characterId: f.world.characterId }); await f.install(); f.observe()
  const captured = (await f.prepare()).snapshot.preparation?.plan
  assert.ok(captured)
  f.observe([55, 50])
  const restored = await f.service.mutate({ action: 'restore', characterId: f.world.characterId })
  assert.equal(restored.ok, true)
  assert.deepEqual(restored.snapshot.preparation?.plan?.baseline, captured.baseline)
  assert.equal((await f.saved()).queued, undefined)
  await f.install()
  assert.equal(await f.read(), ORIGINAL_INI)
  f.observe([55, 50])
  assert.deepEqual((await createMacroService(f.deps).query()).preparation?.plan?.baseline, captured.baseline)
  assert.equal((await f.prepare()).ok, false)
})

test('canceling a replacement with freshly restored combat gems keeps the prior installed package and receipt', async (t) => {
  const f = await preparationFixture(t)
  await f.prepare(); await f.install(); f.observe()
  const installed = (await f.service.query()).preparation
  await f.prepare([50])
  const canceled = await f.service.mutate({ action: 'configure', characterId: f.world.characterId, settings: { autoUpdate: false } })
  assert.deepEqual(canceled.snapshot.preparation, installed)
  assert.equal((await f.saved()).queued, undefined)
})

test('unavailable observations cannot erase a temporary layout already seen before cancellation', async (t) => {
  const f = await preparationFixture(t)
  const captured = (await f.prepare()).snapshot.preparation?.plan
  f.observe([55, 50]); await f.service.query()
  f.setPlayer({ state: 'unavailable', reason: 'Observation temporarily unavailable.' })
  const canceled = await f.service.mutate({ action: 'configure', characterId: f.world.characterId, settings: { autoUpdate: false } })
  assert.deepEqual(canceled.snapshot.preparation?.plan?.baseline, captured?.baseline)
  assert.equal((await f.saved()).queued, undefined)
  f.observe([55, 50])
  assert.equal((await f.prepare()).ok, false)
})

test('restoring an already installed package keeps the combat baseline when its utility gems remain active', async (t) => {
  const f = await preparationFixture(t)
  const captured = (await f.prepare()).snapshot.preparation?.plan
  await f.install(); f.observe([55, 50]); await f.service.query()
  await f.service.mutate({ action: 'restore', characterId: f.world.characterId })
  await f.install()
  assert.equal(await f.read(), ORIGINAL_INI)
  f.observe([55, 50])
  const snapshot = await f.service.query()
  assert.deepEqual(snapshot.preparation?.plan?.baseline, captured?.baseline)
  assert.deepEqual(snapshot.preparation?.installation?.buttons, [])
  assert.equal((await f.prepare()).ok, false)
  f.observe()
  assert.equal((await f.prepare()).ok, true, 'Restored combat gems permit an explicit fresh capture')
})
