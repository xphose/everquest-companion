import assert from 'node:assert/strict'
import test from 'node:test'
import { writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { preparationFixture } from './macroPreparationServiceFixture.mts'
import { ORIGINAL_INI, STOPPED } from './macroServiceFixture.mts'

test('a full personal spell-set table or destination hotbar refuses the whole preparation preview', async (t) => {
  const f = await preparationFixture(t)
  const sets = '[SpellLoadouts]\n' + Array.from({ length: 59 }, (_, index) => `SpellLoadout${index + 1}.inuse=0\n`).join('')
  const hotbar = '[HotButtons4]\n' + Array.from({ length: 12 }, (_, index) => `Page2Button${index + 1}=personal\n`).join('')
  for (const extra of [sets, hotbar]) {
    const original = ORIGINAL_INI + extra
    await f.write(original)
    assert.equal((await f.prepare()).ok, false)
    assert.equal((await f.saved()).queued, undefined)
    assert.equal(await f.read(), original)
  }
})

test('new personal/default allocation conflicts and a newly full social destination refuse the entire offline package', async (t) => {
  for (const conflict of ['character', 'defaults', 'social']) {
    const f = await preparationFixture(t)
    assert.equal((await f.prepare()).ok, true)
    const extra = conflict === 'social' ? '[HotButtons4]\n' + Array.from({ length: 12 }, (_, index) => `Page2Button${index + 1}=personal\n`).join('')
      : '[SpellLoadouts]\nSpellLoadout1.inuse=0\n'
    if (conflict === 'defaults') await writeFile(join(f.root, 'defaults.ini'), extra)
    else await f.write(ORIGINAL_INI + extra)
    const before = await f.read()
    await f.install()
    assert.equal(await f.read(), before)
    const snapshot = await f.service.query()
    assert.equal(snapshot.installation.state, 'conflict')
    assert.equal(snapshot.preparation?.installation?.state, 'conflict')
    assert.equal((await f.saved()).applied, undefined)
    assert.equal((await f.saved()).queued, undefined)
  }
})

test('defaults creation or changes during the final exit confirmation prevent compare-and-replace', async (t) => {
  for (const original of [undefined, '[Other]\nPreserve=1\n']) {
    const f = await preparationFixture(t)
    if (original) await writeFile(join(f.root, 'defaults.ini'), original)
    await f.prepare()
    let reads = 0
    const changed = '[SpellLoadouts]\nSpellLoadout1.name=New Personal Default\n'
    f.deps.livePlayer = async () => { if (++reads === 3) await writeFile(join(f.root, 'defaults.ini'), changed); return STOPPED }
    await f.service.tick()
    assert.equal(await f.read(), ORIGINAL_INI)
    assert.equal(await readFile(join(f.root, 'defaults.ini'), 'utf8'), changed)
    assert.match((await f.saved()).status?.message ?? '', /Default spell sets changed/)
  }
})

test('edited managed set and social fields are preserved when a later complete package update conflicts', async (t) => {
  for (const field of ['set', 'social']) {
    const f = await preparationFixture(t)
    await f.prepare(); await f.install(); f.observe()
    assert.equal((await f.service.mutate({ action: 'queue', characterId: f.world.characterId })).ok, true)
    const original = await f.read()
    const changed = field === 'set' ? original.replace('SpellLoadout1.slot1=55', 'SpellLoadout1.slot1=777')
      : original.replace('/memspellset 1', '/say My changed button')
    await f.write(changed)
    await f.install()
    assert.equal(await f.read(), changed)
    assert.equal((await f.saved()).status?.state, 'conflict')
  }
})

test('an explicit Use-only replacement retires both old owned sets and swap buttons while keeping the ready utility', async (t) => {
  const f = await preparationFixture(t)
  f.observe([94, 50])
  const initial = await f.prepare([50, 55])
  assert.equal(initial.ok, true)
  await f.install(); f.observe([94, 50])
  const replacement = await f.prepare([50])
  assert.equal(replacement.ok, true)
  assert.deepEqual(replacement.snapshot.preparation?.plan?.replacements, [])
  assert.equal(replacement.snapshot.preparation?.installation?.loadSetIndex, undefined)
  await f.install()
  const text = await f.read()
  assert.doesNotMatch(text, /\/memspellset|SpellLoadout\d+\./)
  assert.match(text, /\/cast Summon Food/)
  assert.doesNotMatch(text, /\/cast Summon Drink/)
  assert.deepEqual((await f.saved()).setManaged?.[f.name], [])
})

test('prepare mutations reject raw commands, unobserved targets, duplicate IDs and malformed destinations', async (t) => {
  const f = await preparationFixture(t)
  const base = { action: 'prepare', characterId: f.world.characterId, spellIds: [50], destination: { bar: 4, page: 2 } }
  for (const patch of [{ spellIds: [50, 50] }, { spellIds: [] }, { spellIds: [0] }, { spellIds: ['50'] },
    { lines: ['/say injected'] }, { targetFile: '..\\other.ini' }, { destination: { bar: 4, page: 11 } }, { characterId: 'Other@test' }]) {
    assert.equal((await f.service.mutate({ ...base, ...patch })).ok, false)
    assert.equal(await f.read(), ORIGINAL_INI)
  }
})
