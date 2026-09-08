import assert from 'node:assert/strict'
import test from 'node:test'
import { createMacroService } from '../src/main/macros/service'
import { currentRecipes, macroSnapshot, readMacroModel } from '../src/main/macros/model'
import { emptyMacroSaved, worldKey } from '../src/main/macros/settings'
import { macroFixture, STOPPED } from './macroServiceFixture.mts'

test('saved personal socials expose only fresh gem bindings and follow gem changes', async (t) => {
  const f = await macroFixture(t)
  await f.write('[Socials]\r\nPage2Button9Name=Buffs\r\nPage2Button9Line1=/cast 1\r\n')
  let snapshot = await f.service.query()
  assert.deepEqual(snapshot.existing[0].bindings, [{ line: 1, gem: 1, spellId: 94, name: 'Test Flame', castable: true }])
  assert.equal(snapshot.existing[0].managed, false)
  assert.ok(snapshot.existing[0].issues.some((issue) => issue.code === 'buff-binding-mismatch'))
  const player = f.live()
  if (player.state !== 'live') throw new Error('Expected live fixture.')
  player.location.memorizedSpells = [null, 94, ...Array<null>(16).fill(null)]
  f.setPlayer(player)
  snapshot = await f.service.query()
  assert.deepEqual(snapshot.existing[0].bindings, [])
  assert.ok(snapshot.existing[0].issues.some((issue) => issue.code === 'empty-gem'))
  f.setPlayer({ state: 'unavailable', reason: 'No current observation.' })
  snapshot = await f.service.query()
  assert.equal(snapshot.existing[0].bindings, undefined)
  assert.ok(snapshot.existing[0].issues.some((issue) => issue.code === 'slots-unavailable'))
})

test('unavailable cached previews have no current bindings or executable lines without mutating saved recipes', async (t) => {
  const f = await macroFixture(t)
  await f.service.query()
  const saved = await f.deps.repository.get(worldKey(f.world))
  const original = structuredClone(saved.recipes)
  assert.ok(original?.some((recipe) => recipe.ready && recipe.lines.length > 0 && recipe.bindings?.length))
  f.setPlayer({ state: 'unsupported', reason: 'Unknown build.' })
  const model = await readMacroModel(f.deps, f.world, saved)
  assert.equal(model.input, undefined)
  for (const recipe of currentRecipes(model)) {
    assert.equal(recipe.ready, false)
    assert.equal(recipe.status, 'unavailable')
    assert.equal(recipe.bindings, undefined)
    assert.deepEqual(recipe.lines, [])
    assert.match(recipe.reasons.join(' '), /fresh observation/)
  }
  assert.deepEqual(saved.recipes, original)
  const snapshot = await macroSnapshot(model)
  assert.equal(snapshot.context.live, false)
  assert.ok(snapshot.recipes.every((recipe) => !recipe.ready && recipe.lines.length === 0))
})

test('wrong-character and expired observations cannot attach bindings to existing socials', async (t) => {
  const f = await macroFixture(t)
  await f.write('[Socials]\r\nPage1Button1Name=Personal\r\nPage1Button1Line1=/cast 1\r\n')
  for (const change of [{ characterName: 'Other' }, { sampledAt: 8499 }]) {
    const player = f.live()
    if (player.state !== 'live') throw new Error('Expected live fixture.')
    Object.assign(player.location, change)
    f.setPlayer(player)
    const model = await readMacroModel(f.deps, f.world, emptyMacroSaved())
    const snapshot = await macroSnapshot(model)
    assert.equal(snapshot.context.live, false)
    assert.equal(snapshot.existing[0].bindings, undefined)
  }
})

test('blanking a stale preview preserves trusted queued commands across restart and verified exit', async (t) => {
  const f = await macroFixture(t)
  await f.service.mutate({ characterId: f.world.characterId, action: 'configure', settings: { selections: [{ role: 'damage' }] } })
  const queued = await f.service.mutate({ characterId: f.world.characterId, action: 'queue' })
  assert.equal(queued.ok, true)
  const before = await f.deps.repository.get(worldKey(f.world))
  assert.ok(before.queued?.requests[0].lines.some((line) => line.includes('/cast Test Flame')))
  f.setPlayer({ state: 'unavailable', reason: 'Temporary read failure.' })
  const restarted = createMacroService(f.deps)
  const snapshot = await restarted.query()
  assert.equal(snapshot.installation.state, 'pending')
  assert.ok(snapshot.recipes.every((recipe) => !recipe.ready && !recipe.lines.length && !recipe.bindings))
  const after = await f.deps.repository.get(worldKey(f.world))
  assert.deepEqual(after.queued, before.queued)
  assert.deepEqual(after.recipes, before.recipes)
  f.setPlayer(STOPPED)
  await restarted.tick()
  assert.match(await f.read(), /\/cast Test Flame/)
  assert.equal((await restarted.query()).installation.state, 'applied')
})
