import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createMacroService } from '../src/main/macros/service.ts'
import { preparationFixture } from './macroPreparationServiceFixture.mts'
import { ORIGINAL_INI, STOPPED } from './macroServiceFixture.mts'

test('preparation persists one immutable pair and separate named use buttons, then atomically installs and restores both', async (t) => {
  const f = await preparationFixture(t)
  const defaults = '[SpellLoadouts]\r\nSpellLoadout1.inuse=0\r\nSpellLoadout2.name=Personal Default\r\n'
  await writeFile(join(f.root, 'defaults.ini'), defaults)
  const result = await f.prepare()
  assert.equal(result.ok, true)
  const prepared = result.snapshot.preparation
  assert.ok(prepared?.installation?.buttons && prepared.plan)
  assert.equal(prepared.installation.state, 'pending')
  assert.deepEqual(prepared.plan.replacements.map((slot) => [slot.gem, slot.originalSpellId, slot.spellId]), [[2, 93, 50], [1, 94, 55]])
  assert.deepEqual(prepared.installation.buttons.filter((button) => /memspellset/.test(button.lines.join())).map((button) => button.lines), [['/memspellset 3'], ['/memspellset 4']])
  assert.ok(prepared.installation.buttons.some((button) => button.lines.some((line) => line.endsWith('/cast Summon Food'))))
  assert.equal(await f.read(), ORIGINAL_INI)
  const restarted = createMacroService(f.deps)
  f.setPlayer(STOPPED); await restarted.tick()
  const installed = await f.read()
  assert.match(installed, /SpellLoadout3.slot1=55\r\nSpellLoadout3.slot2=50\r\nSpellLoadout3.slot3=-1/)
  assert.match(installed, /SpellLoadout4.slot1=94\r\nSpellLoadout4.slot2=93/)
  assert.match(installed, /Line1=\/memspellset 3/)
  assert.ok(ORIGINAL_INI.trimEnd().split('\r\n').every((line) => installed.includes(line + '\r\n')))
  assert.equal(await readFile(join(f.root, 'defaults.ini'), 'utf8'), defaults)
  const snapshot = await restarted.query()
  assert.equal(snapshot.preparation?.installation?.state, 'saved')
  assert.ok(snapshot.preparation?.installation?.at)
  assert.equal((await f.saved()).setManaged?.[f.name].length, 2)
  const restored = await restarted.mutate({ action: 'restore', characterId: f.world.characterId })
  assert.equal(restored.ok, true)
  assert.equal(await f.read(), ORIGINAL_INI)
  assert.equal((await f.saved()).preparations?.[f.name], undefined)
  assert.deepEqual((await f.saved()).setManaged?.[f.name], [])
})

test('utility and partial layouts freeze remembered combat macros but current readiness stays honest; return resumes normal queues preserving preparation', async (t) => {
  const f = await preparationFixture(t)
  await f.service.mutate({ action: 'configure', characterId: f.world.characterId, settings: { autoUpdate: true, selections: [{ role: 'buff', spellLine: 'spirit wolf' }] } })
  assert.equal((await f.prepare()).ok, true)
  const baseline = (await f.saved()).queued?.preparation?.plan.baseline
  await f.install()
  const installed = await f.read()
  for (const gems of [[55, 50], [null, 50]]) {
    f.observe(gems)
    const snapshot = await f.service.query()
    assert.ok(['utility-ready', 'changing'].includes(snapshot.preparation?.phase ?? ''))
    assert.equal(snapshot.recipes.find((recipe) => recipe.selection.spellLine === 'spirit wolf')?.ready, false)
    assert.equal((await f.saved()).recipes?.find((recipe) => recipe.selection.spellLine === 'spirit wolf')?.ready, true)
    assert.deepEqual((await f.saved()).preparations?.[f.name].plan.baseline, baseline)
    assert.equal((await f.saved()).queued, undefined)
    assert.equal((await f.service.mutate({ action: 'queue', characterId: f.world.characterId })).ok, false)
    assert.equal((await f.prepare()).ok, false)
  }
  f.observe()
  const combat = await f.service.query()
  assert.equal(combat.preparation?.phase, 'combat')
  const queued = await f.service.mutate({ action: 'queue', characterId: f.world.characterId })
  assert.equal(queued.ok, true)
  assert.ok((await f.saved()).queued?.requests.some((request) => request.id === 'preparation-combat'))
  await f.install()
  assert.equal(await f.read(), installed)
})

test('fresh class changes cannot recapture temporary gems; restoring positive combat gems allows atomic preparation retirement and combat updates', async (t) => {
  const f = await preparationFixture(t)
  await f.service.mutate({ action: 'configure', characterId: f.world.characterId, settings: { autoUpdate: true, selections: [{ role: 'loc' }] } })
  await f.prepare(); await f.install()
  const installed = await f.read()
  f.observe([55, 50], { classes: ['MAG', 'ENC'] })
  assert.equal((await f.service.query()).preparation?.phase, 'changed')
  assert.equal((await f.prepare()).ok, false)
  assert.equal((await f.saved()).queued, undefined)
  f.observe([94, 93], { classes: ['MAG', 'ENC'] })
  await f.service.query()
  assert.equal((await f.saved()).queued?.preparation?.retired, true)
  await f.install()
  const retired = await f.read()
  assert.notEqual(retired, installed)
  assert.doesNotMatch(retired, /\/memspellset|SpellLoadout\d+\./)
  assert.match(retired, /Line1=\/loc/)
  f.observe([94, 93], { classes: ['MAG', 'ENC'] })
  const snapshot = await f.service.query()
  assert.equal(snapshot.preparation?.phase, 'changed')
  assert.equal((await f.saved()).queued, undefined, 'An already retired package does not requeue every poll')
})

test('an unmemorized combat selection warns separately while valid food preparation still saves', async (t) => {
  const f = await preparationFixture(t)
  assert.equal((await f.service.mutate({ action: 'configure', characterId: f.world.characterId, settings: { selections: [{ role: 'heal-self', spellLine: 'minor healing' }] } })).ok, true)
  assert.equal((await f.prepare()).ok, true)
  await f.install()
  const snapshot = await f.service.query()
  assert.equal(snapshot.installation.state, 'conflict')
  assert.equal(snapshot.preparation?.installation?.state, 'saved')
  assert.ok(snapshot.preparation?.installation?.at)
  assert.match(await f.read(), /\/memspellset/)
  assert.doesNotMatch(await f.read(), /\/cast Minor Healing/)
})

test('unknown observations preserve the queued package across restart and never authorize writes', async (t) => {
  const f = await preparationFixture(t)
  await f.prepare()
  const queued = (await f.saved()).queued
  const restarted = createMacroService(f.deps)
  for (const state of ['unavailable', 'unsupported', 'not-in-world', 'ambiguous'] as const) {
    f.setPlayer({ state, reason: 'No verified observation.' })
    await restarted.tick()
    assert.deepEqual((await f.saved()).queued, queued)
    assert.equal(await f.read(), ORIGINAL_INI)
  }
  f.observe([94, 93], { unlockedSpellSlots: undefined }); await restarted.tick()
  assert.deepEqual((await f.saved()).queued, queued)
  f.setPlayer(STOPPED); await restarted.tick()
  assert.match(await f.read(), /\/memspellset/)
})

test('fresh entitlement and manually changed combat layouts invalidate rather than silently recapture', async (t) => {
  const f = await preparationFixture(t)
  await f.prepare(); await f.install()
  const original = (await f.saved()).preparations?.[f.name].plan.baseline
  f.observe([94, 50, 92], { unlockedSpellSlots: [1, 2, 3] })
  assert.equal((await f.service.query()).preparation?.phase, 'changed')
  assert.equal((await f.prepare()).ok, false, 'An invalidated package with one temporary gem cannot become a new baseline')
  f.observe()
  assert.equal((await f.service.query()).preparation?.phase, 'changed', 'Invalidation remains explicit even after classes/slots return')
  assert.deepEqual((await f.saved()).preparations?.[f.name].plan.baseline, original)
  assert.equal((await f.prepare()).ok, true, 'Explicit rebuild is allowed once temporary gems are gone')
})

test('repeating an unchanged preparation preserves its actual saved timestamp and reports already up to date', async (t) => {
  const f = await preparationFixture(t)
  await f.prepare(); await f.install()
  const at = (await f.saved()).preparations?.[f.name].installedAt
  const original = await f.read()
  f.deps.now = () => 20_000
  f.observe([94, 93], { sampledAt: 20_000 })
  assert.equal((await f.prepare()).ok, true)
  await f.install()
  const snapshot = await f.service.query()
  assert.equal(snapshot.preparation?.installation?.at, at)
  assert.equal(snapshot.preparation?.installation?.state, 'saved')
  assert.match(snapshot.preparation?.installation?.message ?? '', /already up to date/)
  assert.equal(await f.read(), original)
})
