import type { RecoveryCandidate, RecoverySource } from '../../../../shared/questJournal/recovery'

export const RECOVERY_SOURCE_LABELS: Record<RecoverySource, string> = {
  'task-window': 'Active task journal', 'history-window': 'Completed quest history',
  achievement: 'Achievement export', inventory: 'Inventory export', 'npc-journal': 'NPC journal'
}

/** Selection is a review decision only; candidates retain the main service's order and meaning. */
export function recoverySelection(candidates: RecoveryCandidate[], defaultsOnly: boolean): Set<string> {
  const selected = new Set<string>()
  for (const candidate of candidates) {
    if (candidate.confidence === 'confirmed' && (!defaultsOnly || candidate.selectedByDefault)) selected.add(candidate.id)
  }
  return selected
}

export function toggleRecoveryCandidate(selected: ReadonlySet<string>, id: string, checked: boolean): Set<string> {
  const next = new Set(selected)
  if (checked) next.add(id)
  else next.delete(id)
  return next
}

/** Explicit bulk review action, never used to initialize a draft. */
export function allRecoveryCandidates(candidates: RecoveryCandidate[]): Set<string> {
  return new Set(candidates.map((candidate) => candidate.id))
}
