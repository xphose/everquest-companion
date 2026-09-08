import test from 'node:test'
import assert from 'node:assert/strict'
import { zoneLabelResolver } from '../src/renderer/src/features/maps/zoneLabelLinks'

const installed = ['steamfont', 'akanon', 'lfaydark', 'gfaydark', 'mistmoore', 'airplane', 'permafrost']

test('actual installed purple exit-label spellings resolve to available destinations', () => {
  const resolve = zoneLabelResolver(installed, 'steamfont')
  assert.deepEqual(resolve("to_Ak'Anon"), { zone: 'akanon', name: "Ak'Anon" })
  assert.equal(resolve('to_The_Lesser_Faydark')?.zone, 'lfaydark')
  const lesser = zoneLabelResolver(installed, 'lfaydark')
  assert.equal(lesser('to_The_Castle_of_Mistmoore')?.zone, 'mistmoore')
  assert.equal(lesser('to_The_Steamfont_Mountains')?.zone, 'steamfont')
  assert.equal(lesser('to_The_Greater_Faydark')?.zone, 'gfaydark')
  assert.equal(zoneLabelResolver(installed, 'akanon')('to_The_Steamfont_Mountains')?.zone, 'steamfont')
})

test('whole canonical names, documented aliases and exact installed stems work without fuzzy guessing', () => {
  const resolve = zoneLabelResolver(installed, 'steamfont')
  for (const name of ["Ak'Anon", "  TO  Ak'Anon  ", 'AKANON', 'AkAnon']) assert.equal(resolve(name)?.zone, 'akanon')
  assert.equal(resolve('Mistmoore Castle')?.zone, 'mistmoore')
  assert.equal(resolve('The Permafrost Caverns')?.zone, 'permafrost')
  assert.equal(resolve('The Plane of Sky')?.zone, 'airplane')
  assert.deepEqual(zoneLabelResolver(['custommap'], 'steamfont')('custommap'), { zone: 'custommap', name: 'custommap' })
})

test('current, unavailable, ambiguous and non-zone labels remain ordinary map text', () => {
  const resolve = zoneLabelResolver(installed, 'steamfont')
  for (const name of ['to_The_Steamfont_Mountains', 'to_North_Freeport', 'to_Freeport', 'to_Kaladim', 'Neriak',
    'Banker', 'Ak\'Anon Bank', "Ak'Anon (Banker)", 'AkAnonn', 'Mistmoor', 'to the', '', 'The_Lesser_Faydark_exit', 'Path to Ak\'Anon']) {
    assert.equal(resolve(name), null, name)
  }
})

test('ambiguous aliases stay unresolved even if only one candidate map is installed', () => {
  const catalog = [{ short: 'one', name: 'First', aliases: ['Shared'] }, { short: 'two', name: 'Second', aliases: ['Shared'] }]
  assert.equal(zoneLabelResolver(['one'], 'current', catalog)('to Shared'), null)
  assert.equal(zoneLabelResolver(['one', 'two'], 'current', catalog)('Shared'), null)
  assert.equal(zoneLabelResolver(['one', 'shared'], 'current', catalog)('shared'), null)
})
