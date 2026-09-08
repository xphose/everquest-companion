import assert from 'node:assert/strict'
import test from 'node:test'
import { createMacroService } from '../src/main/macros/service.ts'
import { worldKey } from '../src/main/macros/settings.ts'
import { preparationFixture } from './macroPreparationServiceFixture.mts'

test('preparation-only completion identifies the actual destination and captured package through restart', async (t) => {
  const f = await preparationFixture(t)
  const pending = (await f.prepare()).snapshot.preparation?.installation
  assert.ok(pending?.packageId)
  assert.equal(pending.completion, undefined)
  await f.install()
  const snapshot = await createMacroService(f.deps).query()
  assert.deepEqual(snapshot.installation.completion?.destination, { bar: 4, page: 2 })
  const receipt = snapshot.preparation?.installation
  assert.ok(receipt)
  assert.equal(receipt.packageId, pending.packageId)
  assert.deepEqual(receipt.completion, { kind: 'written', at: new Date(10_000).toISOString() })
  assert.deepEqual(receipt.destination, { bar: 4, page: 2 })
})

test('mixed combat and preparation destinations omit a misleading singular global destination', async (t) => {
  const f = await preparationFixture(t)
  await f.service.mutate({ action: 'configure', characterId: f.world.characterId, settings: { selections: [{ role: 'loc' }], destination: { bar: 3, page: 1 } } })
  await f.prepare(); await f.install()
  const snapshot = await f.service.query()
  assert.equal(snapshot.installation.completion?.destination, undefined)
  assert.deepEqual(snapshot.preparation?.installation?.destination, { bar: 4, page: 2 })
})

test('repeated unchanged preparation has a new package identity and check receipt while retaining the previous save time', async (t) => {
  const f = await preparationFixture(t)
  const originalId = (await f.prepare()).snapshot.preparation?.installation?.packageId
  await f.install()
  const savedAt = (await f.saved()).preparations?.[f.name].installedAt
  f.deps.now = () => 20_000
  f.observe([94, 93], { sampledAt: 20_000 })
  const pending = (await f.prepare()).snapshot.preparation?.installation
  assert.ok(pending?.packageId)
  assert.notEqual(pending.packageId, originalId)
  assert.equal(pending.completion, undefined)
  await f.install()
  const receipt = (await f.service.query()).preparation?.installation
  assert.ok(receipt)
  assert.equal(receipt.packageId, pending.packageId)
  assert.equal(receipt.at, savedAt)
  assert.deepEqual(receipt.completion, { kind: 'unchanged', at: new Date(20_000).toISOString() })
})

test('canceling a replacement exposes the previously saved package identity, never a receipt for the canceled package', async (t) => {
  const f = await preparationFixture(t)
  await f.prepare(); await f.install(); f.observe()
  const saved = (await f.service.query()).preparation?.installation
  assert.ok(saved?.packageId)
  const before = await f.read()
  const replacing = (await f.prepare([50])).snapshot.preparation?.installation
  assert.ok(replacing?.packageId)
  assert.notEqual(replacing.packageId, saved.packageId)
  const canceled = await f.service.mutate({ action: 'configure', characterId: f.world.characterId, settings: { autoUpdate: false } })
  const retained = canceled.snapshot.preparation?.installation
  assert.ok(retained)
  assert.equal(retained.state, 'saved')
  assert.equal(retained.packageId, saved.packageId)
  assert.notEqual(retained.packageId, replacing.packageId)
  assert.deepEqual(retained.completion, saved.completion)
  assert.equal(await f.read(), before)
  assert.equal((await f.saved()).queued, undefined)
})

test('older saved preparations remain usable without inventing a completion receipt or package identity', async (t) => {
  const f = await preparationFixture(t)
  await f.prepare(); await f.install()
  const saved = await f.saved()
  const prepared = saved.preparations?.[f.name]
  assert.ok(prepared)
  prepared.packageId = undefined
  prepared.completion = undefined
  await f.deps.repository.put(worldKey(f.world), saved)
  const receipt = (await createMacroService(f.deps).query()).preparation?.installation
  assert.ok(receipt)
  assert.equal(receipt.state, 'saved')
  assert.equal(receipt.packageId, undefined)
  assert.equal(receipt.completion, undefined)
  assert.ok(receipt.at)
})

test('first queued preparation retains its invalidated baseline when temporary gems and classes change before installation', async (t) => {
  const f = await preparationFixture(t)
  const captured = (await f.prepare()).snapshot.preparation
  assert.ok(captured?.plan)
  f.observe([null, 50]); await f.service.query()
  f.observe([55, 50], { classes: ['MAG', 'ENC'] })
  const changed = (await f.service.query()).preparation
  assert.ok(changed)
  assert.equal(changed.phase, 'changed')
  assert.deepEqual(changed.plan?.baseline, captured.plan.baseline)
  assert.equal(changed.installation?.packageId, captured.installation?.packageId)
  assert.equal(changed.installation?.completion, undefined)
  assert.equal((await f.saved()).queued, undefined)
  assert.equal((await f.prepare()).ok, false)
  assert.equal((await f.service.mutate({ action: 'queue', characterId: f.world.characterId })).ok, false)
  const restarted = createMacroService(f.deps)
  assert.deepEqual((await restarted.query()).preparation?.plan?.baseline, captured.plan.baseline)
})
