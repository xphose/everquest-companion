import { test } from 'node:test'
import assert from 'node:assert/strict'
import { currentOverviewLevel } from '../src/renderer/src/features/overview/currentOverviewLevel'
import { overviewLeveling } from '../src/renderer/src/features/overview/overviewLevelingData'
import { EMPTY_PROGRESSION } from '../src/renderer/src/features/leveling/progressionDelta'

test('Overview live level replaces only current facts and withholds an incompatible historical ETA', () => {
  const logged = {
    ...overviewLeveling(EMPTY_PROGRESSION), level: 5, levelCue: '/who', levelTitle: 'Logged statement.',
    eta: 'ten minutes', history: 'level 4 to 5', tiles: [
      { id: 'level' as const, value: '5', unit: '', label: 'level', title: 'Logged statement.' },
      { id: 'eta' as const, value: '10', unit: 'min', label: 'next level', title: 'Old estimate.' }
    ]
  }
  const live = currentOverviewLevel(logged, 10, 5)
  assert.equal(live.level, 10)
  assert.equal(live.levelCue, 'Live')
  assert.equal(live.tiles.find(tile => tile.id === 'level')?.value, '10')
  assert.equal(live.eta, null)
  assert.equal(live.tiles.some(tile => tile.id === 'eta'), false)
  assert.equal(live.history, logged.history)
  assert.equal(live.spark, logged.spark)
  assert.equal(logged.level, 5)
  assert.equal(currentOverviewLevel(logged, 5, 5).eta, logged.eta)
  const fallback = currentOverviewLevel(logged, undefined, 5)
  assert.equal(fallback.level, 5)
  assert.equal(fallback.levelCue, 'From log · /who')
})
