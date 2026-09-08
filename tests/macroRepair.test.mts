import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { MacroAssistantMutation } from '../src/shared/macroAssistant'
import { createMacroService } from '../src/main/macros/service'
import { worldKey, macroMutation } from '../src/main/macros/settings'
import { macroFixture, DAMAGE, STOPPED } from './macroServiceFixture.mts'
import { repairFingerprint } from '../src/main/macros/repairOwnership'

const ORIGINAL = '[Socials]\r\nPage2Button9Name=Buffs\r\nPage2Button9Color=3\r\nPage2Button9Line1=/pause 45, /cast 1\r\nPage2Button9Line2=/cast 2\r\nPage1Button1Name=Personal\r\nPage1Button1Line1=/loc\r\n[HotButtons2]\r\nPage1Button1=E20,@-1,0000000000000000,0,My Buffs,\r\n[HotButtons3]\r\nPage2Button4=E20,@-1,0000000000000000,0,Alias,\r\n[Other]\r\nAccent=\xe9\r\n'
async function fixture(t: TestContext) {
  const f = await macroFixture(t)
  await f.write(ORIGINAL)
  f.deps.spells = async () => [DAMAGE,
    { ...DAMAGE, id: 95, name: 'Test Ward', targetType: 6, effects: [{ effect: 1, base: 10 }], durationTicks: 30 },
    { ...DAMAGE, id: 96, name: 'Test Strength', targetType: 51, effects: [{ effect: 4, base: 10 }], durationTicks: 30 }]
  const player = f.live()
  if (player.state !== 'live') throw new Error('Expected live fixture.')
  player.location.spellbook = [94, 95, 96]
  player.location.memorizedSpells = [94, 95, 96, ...Array<null>(15).fill(null)]
  f.setPlayer(player)
  const snapshot = await f.service.query()
  const social = snapshot.existing.find((item) => item.page === 2 && item.button === 9)!
  assert.ok(social.repair)
  const mutation: Extract<MacroAssistantMutation, { action: 'repair' }> = {
    action: 'repair', characterId: f.world.characterId!, targetFile: f.name, page: 2, button: 9,
    fingerprint: social.repair.fingerprint, recipeId: social.repair.recipeId
  }
  return { ...f, player, mutation }
}

test('explicit repair survives restart, preserves aliases/personal fields, and creates an exact backup', async (t) => {
  const f = await fixture(t)
  const result = await f.service.mutate(f.mutation)
  assert.equal(result.ok, true, result.error)
  assert.equal(result.snapshot.installation.state, 'pending')
  assert.equal(await f.read(), ORIGINAL)
  assert.equal(result.snapshot.existing.find((item) => item.page === 2 && item.button === 9)?.repair, undefined)
  f.setPlayer(STOPPED)
  const restarted = createMacroService(f.deps)
  await restarted.tick()
  const written = await f.read()
  assert.match(written, /Page2Button9Name=Buffs\r\nPage2Button9Color=3/)
  assert.match(written, /Page2Button9Line1=\/pause 3, \/target Example/)
  assert.match(written, /\/cast Test Strength/)
  assert.match(written, /\/cast Test Ward/)
  assert.ok(written.includes(ORIGINAL.slice(ORIGINAL.indexOf('[HotButtons2]'))))
  assert.match(written, /Page1Button1Name=Personal\r\nPage1Button1Line1=\/loc/)
  const backups = await readdir(f.deps.backupDir)
  assert.equal(backups.length, 1)
  assert.equal(await readFile(join(f.deps.backupDir, backups[0]), 'latin1'), ORIGINAL)
  const stored = await f.deps.repository.get(worldKey(f.world))
  assert.deepEqual(stored.repairs?.[f.name], [{ id: 'repair:2:9', selection: { role: 'self-buffs' } }])
  assert.equal(stored.managed[f.name].find((item) => item.id === 'repair:2:9')?.hotbutton, undefined)
  assert.equal((await restarted.query()).installation.completion?.kind, 'written')
  const restored = await restarted.mutate({ characterId: f.world.characterId!, action: 'restore' })
  assert.equal(restored.ok, true, restored.error)
  assert.equal(await f.read(), ORIGINAL)
  const undone = await f.deps.repository.get(worldKey(f.world))
  assert.deepEqual(undone.repairs?.[f.name], [])
  assert.deepEqual(undone.managed[f.name], [])
})

test('social fields or hotbutton references changed after queue cause a whole-package conflict', async (t) => {
  for (const change of [ORIGINAL.replace('/cast 2', '/cast 3'), ORIGINAL.replace('0,Alias,', '0,Changed,')]) {
    const f = await fixture(t)
    assert.equal((await f.service.mutate(f.mutation)).ok, true)
    await f.write(change)
    f.setPlayer(STOPPED)
    await f.service.tick()
    assert.equal(await f.read(), change)
    assert.match((await f.service.query()).installation.message, /changed after review/)
    assert.equal((await f.deps.repository.get(worldKey(f.world))).applied, undefined)
  }
})

test('stale previews, wrong files, managed slots, invalid payloads, and unavailable profiles cannot adopt', async (t) => {
  const f = await fixture(t)
  for (const mutation of [{ ...f.mutation, fingerprint: '0'.repeat(64) }, { ...f.mutation, targetFile: 'Other_test.ini' },
    { ...f.mutation, recipeId: 'damage' }, { ...f.mutation, page: 11 }, { ...f.mutation, rawCommands: ['/loc'] }]) {
    const result = await f.service.mutate(mutation)
    assert.equal(result.ok, false)
    assert.equal(await f.read(), ORIGINAL)
  }
  assert.equal(macroMutation({ ...f.mutation, button: 13 }), null)
  assert.equal(macroMutation({ ...f.mutation, targetFile: '../Example_test.ini' }), null)
  f.setPlayer({ state: 'unavailable', reason: 'Not fresh.' })
  assert.equal((await f.service.mutate(f.mutation)).ok, false)
  assert.equal(await f.read(), ORIGINAL)
})

test('ordinary updates keep repaired IDs separate and follow fresh self-buff gems without moving aliases', async (t) => {
  const f = await fixture(t)
  await f.service.mutate({ characterId: f.world.characterId!, action: 'configure', settings: { autoUpdate: true, selections: [{ role: 'self-buffs' }] } })
  const result = await f.service.mutate(f.mutation)
  assert.equal(result.ok, true, result.error)
  f.setPlayer(STOPPED)
  await f.service.tick()
  const first = await f.deps.repository.get(worldKey(f.world))
  assert.deepEqual(first.managed[f.name].map((item) => item.id).sort(), ['repair:2:9', 'self-buffs'])
  const alias = ORIGINAL.slice(ORIGINAL.indexOf('[HotButtons2]'), ORIGINAL.indexOf('[Other]'))
  f.player.location.memorizedSpells = [96, 94, 95, ...Array<null>(15).fill(null)]
  f.setPlayer(f.player)
  const ready = await f.service.query()
  assert.equal(ready.existing.find((item) => item.page === 2 && item.button === 9)?.managed, true)
  assert.equal(ready.installation.state, 'applied', 'Unchanged live bindings do not requeue a completed repair')
  assert.ok((await f.read()).includes(alias))
  const spells = await f.deps.spells(f.root, [])
  f.deps.spells = async () => [...spells, { ...DAMAGE, id: 97, name: 'Test Focus', targetType: 51, effects: [{ effect: 5, base: 10 }] }]
  f.player.location.spellbook!.push(97)
  f.player.location.memorizedSpells![3] = 97
  f.setPlayer(f.player)
  assert.equal((await f.service.query()).installation.state, 'pending')
  f.setPlayer(STOPPED)
  await f.service.tick()
  assert.match(await f.read(), /Page2Button9Line2=\/pause 42, \/cast Test Focus/)
  assert.ok((await f.read()).includes(alias))
  // A new class without the buffs preserves the aliased social and reports its unavailable recipe.
  f.player.location.classes = ['WAR', 'ROG']
  f.setPlayer(f.player)
  await f.service.query()
  f.setPlayer(STOPPED)
  await f.service.tick()
  assert.match(await f.read(), /Page2Button9Name=Buffs/)
  assert.ok((await f.read()).includes(alias))
  assert.equal((await f.service.query()).installation.state, 'conflict')
})

test('fingerprints reserve all aliases and refuse unknown or ambiguous social fields', () => {
  const slot = { page: 2, button: 9 }
  assert.ok(repairFingerprint(ORIGINAL, slot))
  assert.notEqual(repairFingerprint(ORIGINAL, slot), repairFingerprint(ORIGINAL.replace('E20,@', 'E020,@'), slot))
  assert.equal(repairFingerprint(ORIGINAL.replace('Page2Button9Color=3', 'Page2Button9Unknown=3'), slot), undefined)
  assert.equal(repairFingerprint(ORIGINAL.replace('Page2Button9Color=3', 'Page2Button9Color=3\r\nPage2Button9Color=4'), slot), undefined)
})


test('a fresh incompatible profile cancels a one-time repair instead of adopting stale casts', async (t) => {
  const f = await fixture(t)
  assert.equal((await f.service.mutate(f.mutation)).ok, true)
  f.player.location.classes = ['WAR', 'ROG']
  f.setPlayer(f.player)
  const changed = await f.service.query()
  assert.equal(changed.installation.state, 'conflict')
  assert.match(changed.installation.message, /setup changed after review/)
  assert.equal((await f.deps.repository.get(worldKey(f.world))).queued, undefined)
  f.setPlayer(STOPPED)
  await f.service.tick()
  assert.equal(await f.read(), ORIGINAL)
})


test('automatic updates revalidate a first repair even when no ordinary macro is selected yet', async (t) => {
  const f = await fixture(t)
  await f.service.mutate({ characterId: f.world.characterId!, action: 'configure', settings: { autoUpdate: true } })
  assert.equal((await f.service.mutate(f.mutation)).ok, true)
  f.player.location.classes = ['WAR', 'ROG']
  f.setPlayer(f.player)
  await f.service.query()
  const saved = await f.deps.repository.get(worldKey(f.world))
  assert.deepEqual(saved.queued?.repairs, [])
  assert.ok(saved.queued?.problems.some((problem) => problem.includes('Self Buffs')))
  f.setPlayer(STOPPED)
  await f.service.tick()
  assert.equal(await f.read(), ORIGINAL)
  assert.equal((await f.deps.repository.get(worldKey(f.world))).repairs, undefined)
})
