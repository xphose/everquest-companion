import assert from 'node:assert/strict'
import test from 'node:test'
import { readdir } from 'node:fs/promises'
import { createMacroService } from '../src/main/macros/service'
import { worldKey } from '../src/main/macros/settings'
import { macroFixture, STOPPED } from './macroServiceFixture.mts'

test('written and unchanged completions persist separately without inventing another write or backup', async (t) => {
  const f = await macroFixture(t)
  await f.service.mutate({ characterId: f.world.characterId, action: 'configure', settings: { selections: [{ role: 'loc' }] } })
  const queued = await f.service.mutate({ characterId: f.world.characterId, action: 'queue' })
  assert.equal(queued.snapshot.installation.state, 'pending')
  assert.equal(queued.snapshot.installation.completion, undefined)
  assert.match(queued.snapshot.installation.message, /not written yet/)
  f.setPlayer(STOPPED)
  await f.service.tick()
  const written = await createMacroService(f.deps).query()
  assert.equal(written.installation.completion?.kind, 'written')
  assert.equal(written.installation.completion?.at, written.installation.appliedAt)
  assert.equal(written.installation.completion?.targetFile, f.name)
  assert.deepEqual(written.installation.completion?.destination, { bar: 4, page: 1 })
  const bytes = await f.read()
  const backups = await readdir(f.deps.backupDir)
  f.deps.now = () => 20_000
  const live = f.live()
  if (live.state !== 'live') throw new Error('Expected a live fixture')
  live.location.sampledAt = 20_000
  f.setPlayer(live)
  await f.service.mutate({ characterId: f.world.characterId, action: 'queue' })
  f.setPlayer(STOPPED)
  await f.service.tick()
  const checked = await createMacroService(f.deps).query()
  assert.equal(checked.installation.completion?.kind, 'unchanged')
  assert.equal(checked.installation.completion?.at, new Date(20_000).toISOString())
  assert.equal(checked.installation.appliedAt, written.installation.appliedAt)
  assert.equal(await f.read(), bytes)
  assert.deepEqual(await readdir(f.deps.backupDir), backups)
})

test('a partial install conflict has no successful completion receipt', async (t) => {
  const f = await macroFixture(t)
  const live = f.live()
  if (live.state !== 'live') throw new Error('Expected a live fixture')
  live.location.memorizedSpells = Array<null>(18).fill(null)
  f.setPlayer(live)
  await f.service.mutate({ characterId: f.world.characterId, action: 'configure', settings: { autoUpdate: true,
    selections: [{ role: 'loc' }, { role: 'damage' }] } })
  f.setPlayer(STOPPED)
  await f.service.tick()
  const state = await f.service.query()
  assert.equal(state.installation.state, 'conflict')
  assert.equal(state.installation.completion, undefined)
  assert.ok(state.installation.conflicts.length > 0)
  assert.match(await f.read(), /\/loc/)
  assert.doesNotMatch(await f.read(), /\/cast/)
})

test('legacy persisted outcomes remain readable without a fabricated receipt', async (t) => {
  const f = await macroFixture(t)
  const saved = await f.deps.repository.get(worldKey(f.world))
  saved.status = { state: 'applied', message: 'The managed hotbuttons already match this plan.', conflicts: [] }
  await f.deps.repository.put(worldKey(f.world), saved)
  const state = await createMacroService(f.deps).query()
  assert.equal(state.installation.message, saved.status.message)
  assert.equal(state.installation.completion, undefined)
})
