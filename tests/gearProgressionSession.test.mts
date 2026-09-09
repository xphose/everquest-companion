import { test } from 'node:test'
import assert from 'node:assert/strict'
import { gearProgressionSession, type GearCharacterReading } from '../src/renderer/src/features/gear/gearProgressionSession'
import { gearProgressionStorageKey, sanitizeGearProgressionPrefs } from '../src/renderer/src/features/gear/gearProgressionPrefs'
import type { GearProgressionContext } from '../src/shared/gearProgression'

const facts = (over: Partial<GearProgressionContext> = {}): GearProgressionContext => ({
  characterId: 'synthetic-one', classes: ['MAG', 'SHM'], level: 10, source: 'live', sampledAt: 1000, message: 'Synthetic live character.', ...over
})
const drain = async (): Promise<void> => { for (let index = 0; index < 5; index++) await Promise.resolve() }
function fixture() {
  let at = 1000
  const states: GearCharacterReading[] = []
  const pending: { resolve: (value: GearProgressionContext) => void; reject: (error: Error) => void }[] = []
  const session = gearProgressionSession({ now: () => at, publish: state => states.push(state),
    read: () => new Promise((resolve, reject) => pending.push({ resolve, reject })) })
  return { session, states, pending, advance: (value: number): void => { at = value } }
}

test('position ticks do not republish or rescore unchanged gear facts; a level or class change does', async () => {
  const f = fixture()
  f.session.tick(); f.pending[0].resolve(facts()); await drain()
  f.advance(2500); f.session.tick(); f.pending[1].resolve(facts({ sampledAt: 2500 })); await drain()
  assert.equal(f.states.length, 1)
  f.session.tick(); f.pending[2].resolve(facts({ sampledAt: 2500, level: 11, classes: ['MAG', 'SHM', 'ENC'] })); await drain()
  assert.equal(f.states.length, 2)
  assert.equal(f.states.at(-1)?.context?.level, 11)
})

test('an in-flight old character cannot overwrite a new character, including rejection', async () => {
  const f = fixture()
  f.session.tick(); f.session.invalidate(); f.session.tick()
  assert.equal(f.pending.length, 1, 'invalidation never overlaps requests')
  f.pending[0].reject(new Error('old character failed')); await drain()
  assert.equal(f.states.length, 1)
  assert.equal(f.states[0].pending, true)
  f.session.tick(); f.pending[1].resolve(facts({ characterId: 'synthetic-two' })); await drain()
  assert.equal(f.states.at(-1)?.context?.characterId, 'synthetic-two')
  f.session.stop(); f.session.tick()
  assert.equal(f.pending.length, 2)
})

test('timeout and error recover when the same valid character facts return', async () => {
  const f = fixture()
  f.session.tick(); f.pending[0].resolve(facts()); await drain()
  f.session.tick(); f.advance(14000); f.session.tick()
  assert.equal(f.states.at(-1)?.context, null)
  assert.match(f.states.at(-1)?.error ?? '', /longer/)
  f.pending[1].resolve(facts({ sampledAt: 14000 })); await drain()
  assert.equal(f.states.at(-1)?.context, null, 'timed-out completion is discarded')
  f.session.tick(); f.pending[2].resolve(facts({ sampledAt: 14000 })); await drain()
  assert.equal(f.states.at(-1)?.context?.level, 10, 'identical facts recover after timeout')
  f.session.tick(); f.pending[3].reject(new Error('temporary failure')); await drain()
  f.session.tick(); f.pending[4].resolve(facts({ sampledAt: 14000 })); await drain()
  assert.equal(f.states.at(-1)?.context?.level, 10)
})

test('stale and future native samples are withheld, and slow completions cannot claim fresh live data', async () => {
  for (const sampledAt of [-6000, 1001, 2000, undefined]) {
    const f = fixture()
    f.session.tick(); f.pending[0].resolve(facts({ sampledAt })); await drain()
    assert.equal(f.states.at(-1)?.context, null)
  }
  const f = fixture()
  f.session.tick(); f.advance(14000); f.pending[0].resolve(facts({ sampledAt: 14000 })); await drain()
  assert.equal(f.states.at(-1)?.context, null)
  assert.match(f.states.at(-1)?.error ?? '', /too long/)
})

test('planning preferences are bounded, discard unrelated values and remain character scoped', () => {
  assert.deepEqual(sanitizeGearProgressionPrefs({ section: 'owned', selected: 'known-item', unrelated: 'discard',
    options: { goal: 'pets', mode: 'potential', level: 15, targetTier: 10, difficulty: 4, character: 'discard' } }), {
    section: 'owned', selected: 'known-item', options: { goal: 'pets', mode: 'potential', level: 15, targetTier: 10, difficulty: 4 }
  })
  const safe = sanitizeGearProgressionPrefs({ section: 'other', selected: 'x'.repeat(501), options: { goal: 'hack', level: 125, targetTier: -1, difficulty: 5 } })
  assert.equal(safe.section, 'recommended'); assert.equal(safe.selected, null); assert.equal(safe.options.level, undefined)
  assert.equal(safe.options.goal, 'auto'); assert.equal(safe.options.difficulty, 0)
  assert.equal(gearProgressionStorageKey(null), null)
  assert.notEqual(gearProgressionStorageKey('synthetic-one'), gearProgressionStorageKey('synthetic-two'))
})
