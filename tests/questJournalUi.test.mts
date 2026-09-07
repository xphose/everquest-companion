import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_JOURNAL_PREFS, journalPreferenceKey, journalQuery, normalizeJournalPreferences } from '../src/renderer/src/features/questJournal/preferences'
import { journalMapFocus, journalMobTarget, locationText } from '../src/renderer/src/features/questJournal/navigation'
import { afterBack, afterLink, originTop } from '../src/renderer/src/navOrigin'

test('journal preferences recover malformed values without leaking one character or catalog into another', () => {
  assert.deepEqual(normalizeJournalPreferences(null), DEFAULT_JOURNAL_PREFS)
  const cleaned = normalizeJournalPreferences({ search: 4, state: 'finished', offset: -20, sort: 'spoof', selectedId: false })
  assert.deepEqual(cleaned, DEFAULT_JOURNAL_PREFS)
  assert.notEqual(journalPreferenceKey('Ada@freeport'), journalPreferenceKey('Bob@freeport'))
  assert.notEqual(journalPreferenceKey(null), journalPreferenceKey('Ada@freeport'))
  assert.equal(normalizeJournalPreferences({ search: 'a'.repeat(700) }).search.length, 500)
})

test('journal search, status, facets, order and paging are forwarded to the main service unchanged', () => {
  const prefs = normalizeJournalPreferences({ search: 'Blackburrow', state: 'tracked', zone: 'Surefall Glade', className: 'Druid', level: '12', sort: 'name', offset: 40, selectedId: 'Blackburrow Brewers' })
  assert.deepEqual(journalQuery(prefs), { search: 'Blackburrow', state: 'tracked', zone: 'Surefall Glade', className: 'Druid', level: 12, sort: 'name', offset: 40, limit: 20 })
  assert.equal(journalQuery({ ...prefs, level: 'NaN' }).level, undefined)
  assert.equal(journalQuery({ ...prefs, level: '' }).level, undefined)
  assert.equal(journalQuery({ ...prefs, level: '-1' }).level, undefined)
})

test('a quest location opens only an exact catalog zone with the native map coordinate convention', () => {
  const location = { name: 'Larsk Juton', page: 'Larsk Juton', zone: 'Surefall Glade', sourceUrl: 'https://eqlwiki.com/Larsk_Juton' }
  assert.deepEqual(journalMapFocus(location, { ns: 244, ew: -18 }), {
    zone: 'qrg', at: { x: 18, y: -244 }, label: 'Larsk Juton · Surefall Glade'
  })
  assert.equal(journalMapFocus({ ...location, zone: 'A zone the catalog does not identify' }, { ns: 1, ew: 2 }), null)
  assert.equal(journalMapFocus({ ...location, zone: undefined }), null)
  assert.equal(journalMapFocus(location)?.at, null)
  assert.equal(locationText({ ns: 244, ew: -18 }), '244, -18')
  assert.equal(locationText({ ns: 244, ew: -18, z: 3 }), '244, -18, 3')
  assert.equal(journalMobTarget(location).entry?.page, location.page)
})

test('anchored Map / Item Back journeys return to the journal in stack order', () => {
  const origin = { view: 'questJournal' as const, label: 'Quest journal' }
  const map = afterLink([], origin, 'maps', true)
  assert.deepEqual(originTop(map), origin)
  const item = afterLink(map, { view: 'maps', label: 'Maps' }, 'loot', true)
  assert.equal(originTop(item)?.view, 'maps')
  assert.deepEqual(originTop(afterBack(item)), origin)
  assert.deepEqual(afterBack(map), [])
})
