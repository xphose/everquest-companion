import assert from 'node:assert/strict'
import test from 'node:test'
import { readGearProgressionContext, type GearContextDeps, type GearContextWorld } from '../src/main/gearProgression/context.ts'
import type { PlayerLocationResult } from '../src/shared/playerLocation.ts'
import type { MacroSpell } from '../src/shared/macros.ts'
import { parseOwnedSpells } from '../src/main/macros/spellParser.ts'

function setup(): { deps: GearContextDeps; world: GearContextWorld; player: Extract<PlayerLocationResult, { state: 'live' }>; advance: (ms: number) => void } {
  let now = 10000
  const world: GearContextWorld = { characterId: 'example:demo', name: 'Example', root: 'synthetic-install', token: 'world-1' }
  const player: Extract<PlayerLocationResult, { state: 'live' }> = { state: 'live', location: {
    characterName: 'Example', zone: 'Steamfont Mountains', ns: 0, ew: 0, z: 0, heading: 0,
    level: 10, classes: ['MAG', 'SHM', 'WAR'], spellbook: [1001, 1002], sampledAt: now } }
  const spells: MacroSpell[] = [{ id: 1001, name: 'Example Flame +2', classLevels: { MAG: 5 },
    castMs: 2000, recastMs: 0, recoveryMs: 1500, mana: 5, targetType: 5, effects: [{ effect: 0, base: -40 }] },
  { id: 1002, name: 'Example Future Heal', classLevels: { SHM: 20 },
    castMs: 2000, recastMs: 0, recoveryMs: 1500, mana: 5, targetType: 5, effects: [{ effect: 0, base: 40 }] }]
  const deps: GearContextDeps = { world: () => world, now: () => now, livePlayer: async () => player,
    logged: async () => ({ classes: ['MAG', 'SHM'], level: 5 }), spells: async () => spells,
    focus: () => ({ focusByEffect: {}, wornFocus: [] }) }
  return { deps, world, player, advance: (ms) => { now += ms } }
}

test('read-only gear context detects a third class and level, sends only actual eligible owned spell IDs', async () => {
  const { deps } = setup()
  const result = await readGearProgressionContext(deps)
  assert.equal(result.source, 'live')
  assert.equal(result.level, 10)
  assert.deepEqual(result.classes, ['MAG', 'SHM', 'WAR'])
  assert.deepEqual(result.spells?.map((spell) => [spell.id, spell.name]), [[1001, 'Example Flame +2']])
  assert.equal('root' in result, false)
  assert.equal('name' in result, false)
})

test('complete native profile never waits for an unavailable or slow log fallback', { timeout: 2000 }, async () => {
  const { deps } = setup()
  let reads = 0
  deps.logged = () => { reads++; return new Promise(() => { /* A deliberately unresolved fallback must never be requested. */ }) }
  const result = await readGearProgressionContext(deps)
  assert.equal(result.source, 'live')
  assert.equal(result.level, 10)
  assert.equal(reads, 0)
})

test('single native class works and a verified empty book is distinct from a missing book', async () => {
  const { deps, player } = setup()
  player.location.classes = ['WAR']; player.location.spellbook = []
  deps.spells = async () => []
  assert.deepEqual((await readGearProgressionContext(deps)).spells, [])
  player.location.spellbook = undefined
  assert.equal((await readGearProgressionContext(deps)).spells, undefined)
})

test('wrong-character, stale, future and game-closed observations use labelled log fallback without stale spells', async () => {
  for (const kind of ['wrong', 'stale', 'future', 'closed'] as const) {
    const { deps, player, advance } = setup()
    if (kind === 'wrong') player.location.characterName = 'OtherExample'
    if (kind === 'stale') advance(1501)
    if (kind === 'future') player.location.sampledAt += 1
    if (kind === 'closed') deps.livePlayer = async () => ({ state: 'not-running', reason: 'Game closed' })
    const context = await readGearProgressionContext(deps)
    assert.equal(context.source, 'log', kind)
    assert.equal(context.level, 5, kind)
    assert.equal(context.spells, undefined, kind)
    assert.deepEqual(context.classes, ['MAG', 'SHM'], kind)
  }
})

test('missing native level never advertises the old log level as live', async () => {
  const { deps, player } = setup(); player.location.level = undefined
  const context = await readGearProgressionContext(deps)
  assert.equal(context.level, 5)
  assert.equal(context.source, 'log')
  assert.match(context.message, /out of date/)
})

test('profile changes invalidate in-flight context, including token-only changes', async () => {
  for (const change of ['character', 'token', 'root'] as const) {
    const { deps, world } = setup()
    deps.spells = async () => {
      if (change === 'character') world.characterId = 'other:demo'
      if (change === 'token') world.token = 'world-2'
      if (change === 'root') world.root = 'other-synthetic-install'
      return []
    }
    const result = await readGearProgressionContext(deps)
    assert.equal(result.source, 'none', change)
    assert.deepEqual(result.classes, [], change)
    assert.equal(result.spells, undefined, change)
  }
})

test('slow success and slow failure both expire native context; quick missing spell file keeps fresh profile', async () => {
  for (const rejected of [false, true]) {
    const { deps, advance } = setup()
    deps.spells = async () => { advance(1600); if (rejected) throw new Error('synthetic unavailable'); return [] }
    const result = await readGearProgressionContext(deps)
    assert.equal(result.source, 'none')
    assert.equal(result.level, undefined)
    assert.equal(result.spells, undefined)
  }
  const { deps } = setup(); deps.spells = async () => { throw new Error('synthetic unavailable') }
  const fresh = await readGearProgressionContext(deps)
  assert.equal(fresh.source, 'live')
  assert.equal(fresh.spells, undefined)
})

test('client spell parser preserves duration formula independently of duration cap', () => {
  const fields = Array<string>(173).fill('0')
  fields[0] = '1001'; fields[1] = 'Example Flame'; fields[11] = '1'; fields[12] = '100'
  fields[30] = '5'; fields[48] = '5'; fields[172] = '1|0|-40|0|100|40$'
  const parsed = parseOwnedSpells(fields.join('^'), [1001])[0]
  assert.equal(parsed.durationFormula, 1)
  assert.equal(parsed.durationTicks, 100)
  fields[11] = 'invalid'
  assert.throws(() => parseOwnedSpells(fields.join('^'), [1001]), /spell field/)
})
