import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { RecoveryCandidate } from '../src/shared/questJournal/recovery'
import { allRecoveryCandidates, recoverySelection, toggleRecoveryCandidate } from '../src/renderer/src/features/questJournal/recoverySelection'

const candidate = (id: string, confidence: RecoveryCandidate['confidence'], selectedByDefault: boolean): RecoveryCandidate => ({
  id, questId: id, name: id, state: 'active', source: 'task-window', evidence: ['A visible task row'], confidence, selectedByDefault
})

test('default recovery selection never includes likely candidates even if a source asks for it', () => {
  const rows = [candidate('exact', 'confirmed', true), candidate('review', 'confirmed', false), candidate('uncertain', 'likely', true)]
  assert.deepEqual([...recoverySelection(rows, true)], ['exact'])
  assert.deepEqual([...recoverySelection(rows, false)], ['exact', 'review'])
  assert.deepEqual([...allRecoveryCandidates(rows)], ['exact', 'review', 'uncertain'])
  assert.deepEqual(rows.map((row) => row.id), ['exact', 'review', 'uncertain'])
})

test('each likely recovery is an explicit selection and selection changes do not mutate the previous review', () => {
  const previous = new Set(['exact'])
  const selected = toggleRecoveryCandidate(previous, 'likely', true)
  assert.deepEqual([...selected], ['exact', 'likely'])
  assert.deepEqual([...previous], ['exact'])
  assert.deepEqual([...toggleRecoveryCandidate(selected, 'likely', false)], ['exact'])
  assert.deepEqual([...recoverySelection([], true)], [])
})
