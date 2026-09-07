/** Recovery evidence is separate from manual corrections and ordinary log observations. */
export type RecoverySource = 'task-window' | 'history-window' | 'achievement' | 'inventory' | 'npc-journal'
export type RecoveryInput = 'files' | 'game-window' | 'clipboard' | 'image-file'
export interface RecoveryOcrWord { text: string; x: number; y: number; width: number; height: number }
export interface RecoveryOcrLine { text: string; words: RecoveryOcrWord[] }
export interface RecoveryCapture { text: string; lines?: RecoveryOcrLine[]; imageDataUrl?: string }
export interface RecoveryObjective {
  text: string
  current?: number
  required?: number
  complete?: boolean
}
export interface RecoveryRecord {
  questId: string
  name: string
  state: 'active' | 'completed'
  confidence: 'confirmed' | 'user-confirmed'
  source: RecoverySource
  evidence: string[]
  recoveredAt: number
  objectives?: RecoveryObjective[]
}
export interface RecoveryCandidate {
  id: string
  questId: string
  name: string
  state: 'active' | 'completed'
  confidence: 'confirmed' | 'likely'
  source: RecoverySource
  evidence: string[]
  objectives?: RecoveryObjective[]
  selectedByDefault: boolean
}
export interface RecoverySourceStatus {
  label: string
  state: 'available' | 'missing' | 'error'
  message: string
}
export interface RecoveryDraft {
  id: string
  characterId: string
  createdAt: number
  candidates: RecoveryCandidate[]
  sources: RecoverySourceStatus[]
  warnings: string[]
  imageDataUrl?: string
  scannedText?: string
  unassignedObjectives?: RecoveryObjective[]
  objectiveCandidates?: { id: string; name: string }[]
}
export interface RecoveryScanRequest { characterId: string; source: RecoveryInput }
export type RecoveryScanResult = { ok: true; draft: RecoveryDraft } | { ok: false; error: string; cancelled?: boolean }
export type RecoveryCommitRequest =
  | { action: 'apply'; characterId: string; draftId: string; candidateIds: string[]; confirmedCharacter: boolean; objectiveCandidateId?: string }
  | { action: 'forget'; characterId: string; questId?: string }
export type RecoveryCommitResult = { ok: true; applied: number } | { ok: false; error: string }
