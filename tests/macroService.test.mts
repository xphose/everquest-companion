import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createMacroService } from '../src/main/macros/service.ts'
import { emptyMacroSaved, worldKey } from '../src/main/macros/settings.ts'
import { readMacroModel } from '../src/main/macros/model.ts'
import { DAMAGE, macroFixture, ORIGINAL_INI, STOPPED } from './macroServiceFixture.mts'

test('macro context includes the exact fresh native character name for ordinary client targeting', async (t) => {
  const f = await macroFixture(t)
  const player = f.live()
  if (player.state !== 'live') throw new Error('Expected live fixture.')
  player.location.characterName = 'EXample'
  f.setPlayer(player)
  const model = await readMacroModel(f.deps, f.world, emptyMacroSaved())
  assert.deepEqual(model.input?.player, { characterName: 'EXample', classes: ['MAG', 'SHM', 'ENC'], level: 10,
    spellbook: [94], memorizedSpells: [94, ...Array<null>(17).fill(null)], unlockedSpellSlots: [1, 2, 3, 4, 5, 6, 7, 8] })
})

test('disabled service does no background native work; query observes without installing recommendations', async (t) => {
  const fixture = await macroFixture(t)
  await fixture.service.tick()
  assert.equal(fixture.calls(), 0)
  const snapshot = await fixture.service.query()
  assert.equal(snapshot.context.live, true)
  assert.ok(snapshot.recipes.length > 0)
  assert.equal(snapshot.settings.autoUpdate, false)
  assert.deepEqual(snapshot.settings.selections, [])
  assert.equal(await fixture.read(), ORIGINAL_INI)
  assert.equal(snapshot.existing[0].managed, false)
})

test('explicit one-time queue persists across restart and applies only after two fresh exit confirmations', async (t) => {
  const f = await macroFixture(t)
  assert.equal((await f.service.mutate({ characterId: f.world.characterId, action: 'configure', settings: { selections: [{ role: 'loc' }] } })).ok, true)
  const queued = await f.service.mutate({ characterId: f.world.characterId, action: 'queue' })
  assert.equal(queued.snapshot.installation.state, 'pending')
  assert.equal(await f.read(), ORIGINAL_INI)
  const restarted = createMacroService(f.deps)
  f.setPlayer(STOPPED)
  const before = f.calls()
  await restarted.tick()
  assert.equal(f.calls() - before, 3) // initial observation, first guard, immediately-before-replace guard
  const text = await f.read()
  assert.match(text, /Page1Button2Line1=\/loc/)
  assert.match(text, /\[HotButtons4\]/)
  assert.match(text, /Page1Button1=E1,/)
  assert.ok(text.includes('Page1Button1Line1=/say preserved'))
  assert.ok(text.includes('Accent=\xe9'))
  const backups = await readdir(f.deps.backupDir)
  assert.equal(backups.length, 1)
  assert.equal(await readFile(join(f.deps.backupDir, backups[0]), 'latin1'), ORIGINAL_INI)
  assert.equal((await restarted.query()).installation.state, 'applied')
})

test('unsupported, ambiguous, unavailable and not-in-world observations never authorize writes', async (t) => {
  const f = await macroFixture(t)
  await f.service.mutate({ characterId: f.world.characterId, action: 'configure', settings: { autoUpdate: true, selections: [{ role: 'loc' }] } })
  for (const state of ['unsupported', 'ambiguous', 'unavailable', 'not-in-world'] as const) {
    f.setPlayer({ state, reason: 'Uncertain.' })
    await f.service.tick()
    assert.equal(await f.read(), ORIGINAL_INI)
  }
  assert.equal((await f.service.query()).installation.state, 'pending')
})

test('relaunch between exit checks refuses the pending write', async (t) => {
  const f = await macroFixture(t)
  await f.service.mutate({ characterId: f.world.characterId, action: 'configure', settings: { autoUpdate: true, selections: [{ role: 'loc' }] } })
  let reads = 0
  f.deps.livePlayer = async () => ++reads < 3 ? STOPPED : f.live()
  await f.service.tick()
  assert.equal(await f.read(), ORIGINAL_INI)
  const stored = await f.deps.repository.get(worldKey(f.world))
  assert.equal(stored.status?.state, 'conflict')
  assert.equal(stored.applied, undefined)
})

test('multiple matching loadouts require an observed basename; arbitrary names and another character are refused', async (t) => {
  const f = await macroFixture(t)
  await writeFile(join(f.root, 'Example_test_LO2.ini'), ORIGINAL_INI)
  await writeFile(join(f.root, 'UI_Example_test.ini'), 'irrelevant')
  await writeFile(join(f.root, 'Example_test_LO1_Backup.ini'), 'irrelevant')
  const initial = await f.service.query()
  assert.deepEqual(initial.installation.targetFiles, [f.name, 'Example_test_LO2.ini'])
  assert.equal(initial.installation.targetFile, undefined)
  assert.equal((await f.service.mutate({ characterId: f.world.characterId, action: 'queue' })).ok, false)
  assert.equal((await f.service.mutate({ characterId: 'Other@test', action: 'configure', settings: {} })).ok, false)
  for (const targetFile of ['../Example_test_LO1.ini', 'Other_test.ini', 'UI_Example_test.ini']) {
    assert.equal((await f.service.mutate({ characterId: f.world.characterId, action: 'configure', settings: { targetFile } })).ok, false)
  }
  assert.equal((await f.service.mutate({ characterId: f.world.characterId, action: 'configure', settings: { targetFile: f.name } })).ok, true)
})

test('stale and wrong-character player observations cannot create executable pending plans', async (t) => {
  const f = await macroFixture(t)
  for (const change of [{ sampledAt: 8499 }, { characterName: 'Other' }]) {
    const player = f.live()
    if (player.state === 'live') Object.assign(player.location, change)
    f.setPlayer(player)
    const result = await f.service.mutate({ characterId: f.world.characterId, action: 'queue' })
    assert.equal(result.ok, false)
    assert.equal(await f.read(), ORIGINAL_INI)
  }
})

test('world switches during spell parsing cannot save settings or queue a cross-character plan', async (t) => {
  const f = await macroFixture(t)
  f.deps.spells = async () => { f.world.token = 'world-two'; return [] }
  const result = await f.service.mutate({ characterId: f.world.characterId, action: 'configure', settings: { autoUpdate: true } })
  assert.equal(result.ok, false)
  assert.match(result.error!, /changed/)
  assert.equal((await f.deps.repository.get(worldKey(f.world))).settings.autoUpdate, false)
})

test('unmemorized selected spells are reported and never falsely marked applied', async (t) => {
  const f = await macroFixture(t)
  const player = f.live()
  if (player.state === 'live') player.location.memorizedSpells = Array<null>(18).fill(null)
  f.setPlayer(player)
  const planned = await f.service.mutate({ characterId: f.world.characterId, action: 'configure', settings: { autoUpdate: true, selections: [{ role: 'damage', spellLine: 'test flame' }] } })
  assert.equal(planned.snapshot.loadout?.state, 'needs-memorizing')
  assert.equal(planned.snapshot.loadout?.requiredSpellCount, 1)
  assert.equal(planned.snapshot.loadout?.slots[0].spellId, 94)
  assert.equal(planned.snapshot.loadout?.slots[0].action, 'memorize')
  const saved = await f.deps.repository.get(worldKey(f.world))
  assert.deepEqual(saved.queued?.requests, [], 'The proposed gem assignment is not an executable pending request')
  f.setPlayer(STOPPED)
  await f.service.tick()
  const result = await f.service.query()
  assert.equal(result.installation.state, 'conflict')
  assert.ok(result.installation.conflicts.some((reason) => /Memorize/.test(reason)))
  assert.equal(await f.read(), ORIGINAL_INI)
})

test('context distinguishes unlocked castable slots from occupied locked and out-of-range entries', async (t) => {
  const f = await macroFixture(t)
  const player = f.live()
  if (player.state !== 'live') throw new Error('Expected live fixture.')
  player.location.unlockedSpellSlots = [1, 2, 3, 14, 15, 18]
  player.location.memorizedSpells![8] = 94
  player.location.memorizedSpells![17] = 94
  f.setPlayer(player)
  const snapshot = await f.service.query()
  assert.equal(snapshot.context.availableSpellSlots, 4)
  assert.equal(snapshot.context.filledSpellSlots, 1)
  assert.equal(snapshot.context.emptySpellSlots, 3)
  assert.equal(snapshot.context.memorizedSpells, 3)
  assert.equal(snapshot.loadout?.availableSlots, 4)
  assert.deepEqual(snapshot.loadout?.slots.map((slot) => slot.gem), [1, 2, 3, 14])
})

test('unknown slot readings preserve the last trusted queued plan and cannot queue a retirement', async (t) => {
  const f = await macroFixture(t)
  await f.service.mutate({ characterId: f.world.characterId, action: 'configure', settings: { autoUpdate: true, selections: [{ role: 'damage' }] } })
  const before = await f.deps.repository.get(worldKey(f.world))
  assert.equal(before.queued?.requests.length, 1)
  const player = f.live()
  if (player.state !== 'live') throw new Error('Expected live fixture.')
  delete player.location.unlockedSpellSlots
  f.setPlayer(player)
  await f.service.tick()
  const snapshot = await f.service.query()
  assert.equal(snapshot.context.live, true)
  assert.equal(snapshot.context.availableSpellSlots, undefined)
  assert.equal(snapshot.context.filledSpellSlots, undefined)
  assert.equal(snapshot.context.emptySpellSlots, undefined)
  assert.equal(snapshot.loadout?.state, 'unavailable')
  assert.equal(snapshot.installation.state, 'pending')
  assert.match(snapshot.context.message, /existing trusted queued plans are preserved/)
  const refused = await f.service.mutate({ characterId: f.world.characterId, action: 'queue' })
  assert.equal(refused.ok, false)
  assert.match(refused.error!, /verified observation/)
  const after = await f.deps.repository.get(worldKey(f.world))
  assert.deepEqual(after.queued, before.queued)
  assert.deepEqual(after.recipes, before.recipes)
  assert.equal(await f.read(), ORIGINAL_INI)
  f.setPlayer(STOPPED)
  await f.service.tick()
  assert.match(await f.read(), /\/cast Test Flame/)
})

test('unknown slot readings after installation leave managed spells and ownership intact', async (t) => {
  const f = await macroFixture(t)
  await f.service.mutate({ characterId: f.world.characterId, action: 'configure', settings: { autoUpdate: true, selections: [{ role: 'damage' }] } })
  f.setPlayer(STOPPED)
  await f.service.tick()
  const installed = await f.read()
  const before = await f.deps.repository.get(worldKey(f.world))
  const player = f.live()
  if (player.state !== 'live') throw new Error('Expected live fixture.')
  delete player.location.unlockedSpellSlots
  f.setPlayer(player)
  await f.service.tick()
  const after = await f.deps.repository.get(worldKey(f.world))
  assert.equal(after.queued, undefined)
  assert.deepEqual(after.managed, before.managed)
  assert.deepEqual(after.recipes, before.recipes)
  f.setPlayer(STOPPED)
  await f.service.tick()
  assert.equal(await f.read(), installed)
})

test('memorizing a selected planned spell automatically makes the loadout and real install request ready', async (t) => {
  const f = await macroFixture(t)
  const player = f.live()
  if (player.state !== 'live') throw new Error('Expected live fixture.')
  player.location.memorizedSpells = Array<null>(18).fill(null)
  f.setPlayer(player)
  const planned = await f.service.mutate({ characterId: f.world.characterId, action: 'configure', settings: { autoUpdate: true, selections: [{ role: 'damage' }] } })
  assert.equal(planned.snapshot.loadout?.state, 'needs-memorizing')
  assert.deepEqual((await f.deps.repository.get(worldKey(f.world))).queued?.requests, [])
  player.location.memorizedSpells[2] = 94
  f.setPlayer(player)
  await f.service.tick()
  const observed = await f.service.query()
  assert.equal(observed.loadout?.state, 'ready')
  assert.equal(observed.context.filledSpellSlots, 1)
  assert.equal(observed.loadout?.slots.find((slot) => slot.required)?.gem, 3)
  const saved = await f.deps.repository.get(worldKey(f.world))
  assert.equal(saved.queued?.requests.length, 1)
  assert.ok(saved.queued?.requests[0].lines.some((line) => line.endsWith('/cast Test Flame')))
  assert.equal(await f.read(), ORIGINAL_INI)
})

test('disabling automatic updates cancels automatic queued changes', async (t) => {
  const f = await macroFixture(t)
  await f.service.mutate({ characterId: f.world.characterId, action: 'configure', settings: { autoUpdate: true, selections: [{ role: 'loc' }] } })
  await f.service.mutate({ characterId: f.world.characterId, action: 'configure', settings: { autoUpdate: false } })
  f.setPlayer(STOPPED)
  await f.service.tick()
  assert.equal(await f.read(), ORIGINAL_INI)
})

test('restore disables updates, survives restart and restores exact original bytes', async (t) => {
  const f = await macroFixture(t)
  await f.service.mutate({ characterId: f.world.characterId, action: 'configure', settings: { autoUpdate: true, selections: [{ role: 'loc' }] } })
  f.setPlayer(STOPPED)
  await f.service.tick()
  assert.notEqual(await f.read(), ORIGINAL_INI)
  f.setPlayer(f.live())
  const requested = await f.service.mutate({ characterId: f.world.characterId, action: 'restore' })
  assert.equal(requested.snapshot.settings.autoUpdate, false)
  f.setPlayer(STOPPED)
  await createMacroService(f.deps).tick()
  assert.equal(await f.read(), ORIGINAL_INI)
  await f.service.tick()
  assert.equal(await f.read(), ORIGINAL_INI)
})

test('restore refuses any external file edit after installation', async (t) => {
  const f = await macroFixture(t)
  await f.service.mutate({ characterId: f.world.characterId, action: 'configure', settings: { autoUpdate: true, selections: [{ role: 'loc' }] } })
  f.setPlayer(STOPPED)
  await f.service.tick()
  const edited = (await f.read()) + '; user edit\r\n'
  await f.write(edited)
  const result = await f.service.mutate({ characterId: f.world.characterId, action: 'restore' })
  assert.equal(result.snapshot.installation.state, 'conflict')
  assert.equal(result.snapshot.settings.autoUpdate, false)
  assert.equal(await f.read(), edited)
})

test('explicit queue after pending restore replaces that action without a restore-then-reinstall cycle', async (t) => {
  const f = await macroFixture(t)
  await f.service.mutate({ characterId: f.world.characterId, action: 'configure', settings: { autoUpdate: true, selections: [{ role: 'loc' }] } })
  f.setPlayer(STOPPED)
  await f.service.tick()
  const installed = await f.read()
  f.setPlayer(f.live())
  await f.service.mutate({ characterId: f.world.characterId, action: 'restore' })
  const queued = await f.service.mutate({ characterId: f.world.characterId, action: 'queue' })
  assert.equal(queued.ok, true)
  assert.equal(queued.snapshot.settings.autoUpdate, false)
  const saved = await f.deps.repository.get(worldKey(f.world))
  assert.equal(saved.restoreRequested, false)
  assert.ok(saved.queued)
  f.setPlayer(STOPPED)
  await f.service.tick()
  assert.equal(await f.read(), installed)
  await f.service.tick()
  assert.equal(await f.read(), installed)
})

test('class change retires an unchanged managed spell while preserving the user social', async (t) => {
  const f = await macroFixture(t)
  await f.service.mutate({ characterId: f.world.characterId, action: 'configure', settings: { autoUpdate: true, selections: [{ role: 'damage', spellLine: 'test flame' }] } })
  f.setPlayer(STOPPED)
  await f.service.tick()
  assert.match(await f.read(), /\/cast Test Flame/)
  const player = f.live()
  if (player.state === 'live') player.location.classes = ['WAR', 'MNK']
  f.setPlayer(player)
  await f.service.tick()
  f.setPlayer(STOPPED)
  await f.service.tick()
  assert.doesNotMatch(await f.read(), /\/cast Test Flame/)
  assert.ok((await f.read()).includes('/say preserved'))
})

test('a newly learned and memorized rank replaces the pending automatic plan before exit', async (t) => {
  const f = await macroFixture(t)
  await f.service.mutate({ characterId: f.world.characterId, action: 'configure', settings: { autoUpdate: true, selections: [{ role: 'damage', spellLine: 'test flame' }] } })
  let saved = await f.deps.repository.get(worldKey(f.world))
  assert.ok(saved.queued?.requests[0].lines.some((line) => line.endsWith('/cast Test Flame')))
  const upgraded = { ...DAMAGE, id: 95, name: 'Test Flame II' }
  f.deps.spells = async () => [DAMAGE, upgraded]
  const player = f.live()
  if (player.state === 'live') {
    player.location.spellbook = [94, 95]
    player.location.memorizedSpells = [null, 95, ...Array<null>(16).fill(null)]
  }
  f.setPlayer(player)
  await f.service.tick()
  saved = await f.deps.repository.get(worldKey(f.world))
  assert.ok(saved.queued?.requests[0].lines.some((line) => line.endsWith('/cast Test Flame II')))
  f.setPlayer(STOPPED)
  await f.service.tick()
  assert.match(await f.read(), /\/cast Test Flame II\r\n/)
  assert.doesNotMatch(await f.read(), /\/cast Test Flame\r\n/)
})
