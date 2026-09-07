import { randomUUID } from 'node:crypto'
import type { RecoveryCandidate, RecoveryCapture, RecoveryCommitRequest, RecoveryCommitResult,
  RecoveryDraft, RecoveryObjective, RecoveryRecord, RecoveryScanRequest, RecoveryScanResult } from '../../../shared/questJournal/recovery'
import type { JournalServiceDeps, JournalWorld } from '../service'
import { sameJournalWorld } from '../service'
import { record, safeId, sanitizeProgress } from '../validate'
import { fileCandidates, fileStatuses } from './files'
import { npcJournalScan } from './npcJournal'
import { MAX_CANDIDATES, MAX_RECOVERY } from './records'
import { screenCandidates, type CandidateEvidence } from './screen'

const TTL = 10 * 60 * 1000
interface SavedDraft { draft: RecoveryDraft; world: JournalWorld }
export type RecoveryServiceDeps = JournalServiceDeps & { root: () => string }

function validateRequest(value: unknown): RecoveryCommitRequest | undefined {
  const r = record(value)
  if (!r || !safeId(r.characterId) || r.characterId === 'none') return undefined
  if (r.action === 'forget' && (r.questId === undefined || safeId(r.questId))) {
    return { action: 'forget', characterId: r.characterId, questId: r.questId }
  }
  return validateApply(r, r.characterId)
}

function validateApply(r: Record<string, unknown>, characterId: string): RecoveryCommitRequest | undefined {
  if (r.action !== 'apply' || !safeId(r.draftId) || r.confirmedCharacter !== true) return undefined
  if (!Array.isArray(r.candidateIds) || !r.candidateIds.length || r.candidateIds.length > MAX_CANDIDATES || !r.candidateIds.every(safeId)) return undefined
  if (new Set(r.candidateIds).size !== r.candidateIds.length) return undefined
  if (r.objectiveCandidateId !== undefined && !safeId(r.objectiveCandidateId)) return undefined
  return { action: 'apply', characterId, draftId: r.draftId, candidateIds: r.candidateIds,
    objectiveCandidateId: r.objectiveCandidateId, confirmedCharacter: true }
}

function selectedRecords(candidates: RecoveryCandidate[], now: number): Record<string, RecoveryRecord> {
  const rows: Record<string, RecoveryRecord> = {}
  for (const candidate of [...candidates].sort((a, b) => Number(a.state === 'active') - Number(b.state === 'active'))) {
    const previous = rows[candidate.questId]
    rows[candidate.questId] = { questId: candidate.questId, name: candidate.name, state: candidate.state,
      confidence: candidate.confidence === 'likely' ? 'user-confirmed' : 'confirmed', source: candidate.source,
      evidence: [...(previous?.evidence ?? []), ...candidate.evidence].slice(0, 20), recoveredAt: now,
      objectives: candidate.objectives }
  }
  return rows
}

function mergeRecovery(old: Record<string, RecoveryRecord>, incoming: Record<string, RecoveryRecord>): Record<string, RecoveryRecord> {
  const result = { ...old }
  for (const [id, row] of Object.entries(incoming)) {
    const historical = row.source === 'achievement' || row.source === 'history-window'
    const prior = old[id]
    if (prior && prior.recoveredAt > row.recoveredAt) continue
    result[id] = prior?.state === 'active' && row.state === 'completed' && historical
      ? { ...prior, evidence: [...prior.evidence, ...row.evidence].slice(0, 20) } : row
  }
  return result
}

function prepareCandidates(input: CandidateEvidence[], warnings: string[]): RecoveryCandidate[] {
  const unique = new Map<string, CandidateEvidence>()
  for (const row of input) {
    const key = `${row.questId}\0${row.state}`
    const prior = unique.get(key)
    if (!prior || (prior.confidence === 'likely' && row.confidence === 'confirmed')) unique.set(key, row)
  }
  const states = new Map<string, Set<string>>()
  for (const row of unique.values()) states.set(row.questId, new Set([...(states.get(row.questId) ?? []), row.state]))
  for (const [id, values] of states) if (values.size > 1) warnings.push(`Both active and historical completion evidence exist for ${id}. Selecting both keeps the current task active and retains the history as evidence.`)
  if (unique.size > MAX_CANDIDATES) warnings.push(`Recovery is limited to ${MAX_CANDIDATES} candidates per scan; narrow the source and scan again for additional tasks.`)
  return [...unique.values()].sort((a, b) => Number(b.selectedByDefault) - Number(a.selectedByDefault))
    .slice(0, MAX_CANDIDATES).map((row) => ({ ...row, id: randomUUID() }))
}

function buildDraft(deps: RecoveryServiceDeps, request: RecoveryScanRequest, capture: RecoveryCapture | undefined): SavedDraft {
  const world = deps.world()
  if (!world.character || world.characterId !== request.characterId) throw new Error('The active character changed. Scan again.')
  const createdAt = captureTime(capture, deps.now())
  const files = deps.files(world.character)
  const npc = npcJournalScan(deps.root(), world.character, deps.catalog())
  const warnings: string[] = [...npc.warnings]
  let evidence = [...fileCandidates(deps.catalog(), files), ...npc.candidates]
  let unassignedObjectives: RecoveryObjective[] | undefined
  const sources = [...fileStatuses(files), npc.status]
  if (request.source !== 'files') {
    const screenshot = checkedCapture(capture)
    const screen = screenCandidates(deps.catalog(), screenshot)
    evidence = [...screen.candidates, ...evidence]
    unassignedObjectives = screen.unassignedObjectives
    warnings.push(...screen.warnings)
    sources.push({ label: 'Captured quest window', state: 'available', message: `${screen.candidates.length} task rows recognized. Only the visible portion of the table can be recovered.` })
  }
  if (!sameJournalWorld(world, deps.world())) throw new Error('The active character or engine changed. Scan again.')
  const candidates = prepareCandidates(evidence, warnings)
  const objectiveCandidates = unassignedObjectives?.length ? candidates.filter((row) => row.state === 'active' && row.source === 'task-window').map(({ id, name }) => ({ id, name })) : undefined
  return { world, draft: { id: randomUUID(), characterId: request.characterId, createdAt,
    candidates, unassignedObjectives, objectiveCandidates, sources, warnings: warnings.slice(0, 100),
    imageDataUrl: capture?.imageDataUrl, scannedText: capture?.text } }
}

function captureTime(capture: RecoveryCapture | undefined, now: number): number {
  const createdAt = capture?.capturedAt ?? now
  if (!Number.isFinite(createdAt) || createdAt <= 0 || createdAt > now || now - createdAt >= TTL) throw new Error('The captured image is stale. Capture again.')
  return createdAt
}

function checkedCapture(capture: RecoveryCapture | undefined): RecoveryCapture {
  if (!capture?.text.trim() || capture.text.length > 200000) throw new Error('No readable bounded screenshot text was supplied.')
  if (capture.imageDataUrl && (capture.imageDataUrl.length > 8 * 1024 * 1024 || !/^data:image\/(?:png|jpeg);base64,/u.test(capture.imageDataUrl))) throw new Error('The screenshot preview is not supported.')
  if (capture.lines && (capture.lines.length > 10000 || capture.lines.reduce((sum, line) => sum + line.words.length, 0) > 25000)) throw new Error('The screenshot has too many text regions.')
  return capture
}

function applyDraft(deps: RecoveryServiceDeps, saved: SavedDraft, request: Extract<RecoveryCommitRequest, { action: 'apply' }>): number {
  if (!sameJournalWorld(saved.world, deps.world())) throw new Error('The character or engine changed after this scan. Scan again.')
  const candidates = request.candidateIds.map((id) => saved.draft.candidates.find((row) => row.id === id))
  if (candidates.some((row) => !row)) throw new Error('The selection contains a candidate that is not in this scan.')
  const stored = deps.getProgress(request.characterId)
  const journal = sanitizeProgress(stored.questJournal)
  const selected = associateSelection(saved.draft, candidates as RecoveryCandidate[], request.objectiveCandidateId)
  const recovered = selectedRecords(selected, saved.draft.createdAt)
  const recovery = mergeRecovery(journal.recovery ?? {}, recovered)
  if (Object.keys(recovery).length > MAX_RECOVERY) throw new Error('The saved recovery limit has been reached. Forget older recovery records first.')
  if (!sameJournalWorld(saved.world, deps.world())) throw new Error('The character changed. No recovery records were saved.')
  deps.setProgress(request.characterId, { ...stored, questJournal: { ...journal, recovery } })
  return Object.keys(recovered).length
}

function associateSelection(draft: RecoveryDraft, candidates: RecoveryCandidate[], objectiveId: string | undefined): RecoveryCandidate[] {
  if (objectiveId === undefined) return candidates
  const chosen = candidates.find((row) => row.id === objectiveId)
  if (chosen?.source !== 'task-window' || chosen.state !== 'active' || !draft.unassignedObjectives?.length) {
    throw new Error('Associate objectives only with a selected current-task candidate from this scan.')
  }
  return candidates.map((row) => row.id === objectiveId ? { ...row, objectives: draft.unassignedObjectives,
    evidence: [...row.evidence, 'You associated the visible objective pane with this task during recovery review.'] } : row)
}

function forget(deps: RecoveryServiceDeps, request: Extract<RecoveryCommitRequest, { action: 'forget' }>): number {
  const world = deps.world()
  const stored = deps.getProgress(request.characterId)
  const journal = sanitizeProgress(stored.questJournal)
  const recovery = { ...journal.recovery }
  const ids = request.questId ? [request.questId] : Object.keys(recovery)
  let removed = 0
  for (const id of ids) if (Object.hasOwn(recovery, id)) { Reflect.deleteProperty(recovery, id); removed++ }
  if (!sameJournalWorld(world, deps.world())) throw new Error('The character changed. No recovery records were removed.')
  deps.setProgress(request.characterId, { ...stored, questJournal: { ...journal, recovery } })
  return removed
}

/** Draft contents never round-trip through renderer authority. A commit resolves opaque IDs once. */
export function createRecoveryService(deps: RecoveryServiceDeps): {
  scan: (request: RecoveryScanRequest, capture?: RecoveryCapture) => Promise<RecoveryScanResult>
  commit: (request: unknown) => Promise<RecoveryCommitResult>
} {
  const drafts = new Map<string, SavedDraft>()
  const invalidate = (characterId: string): void => {
    for (const [id, saved] of drafts) if (saved.draft.characterId === characterId) drafts.delete(id)
  }
  const scan = (request: RecoveryScanRequest, capture?: RecoveryCapture): RecoveryScanResult => {
      try {
        if (!request || !safeId(request.characterId) || request.characterId === 'none' ||
          !['files', 'game-window', 'clipboard', 'image-file'].includes(request.source)) throw new Error('Invalid recovery scan.')
        for (const [id, saved] of drafts) if (deps.now() - saved.draft.createdAt >= TTL) drafts.delete(id)
        const saved = buildDraft(deps, request, capture)
        while (drafts.size >= 4) {
          const first = drafts.keys().next().value
          if (first) drafts.delete(first)
        }
        drafts.set(saved.draft.id, saved)
        return { ok: true, draft: structuredClone(saved.draft) }
      } catch (error) { return { ok: false, error: error instanceof Error ? error.message : 'Unable to recover quest evidence.' } }
    }
  const commit = (raw: unknown): RecoveryCommitResult => {
      try {
        const request = validateRequest(raw)
        if (!request) throw new Error('Confirm the character and select valid recovery candidates.')
        if (deps.world().characterId !== request.characterId) throw new Error('The active character changed. No recovery records were changed.')
        if (request.action === 'forget') {
          const applied = forget(deps, request)
          invalidate(request.characterId)
          return { ok: true, applied }
        }
        const saved = drafts.get(request.draftId)
        if (saved?.draft.characterId !== request.characterId || deps.now() - saved.draft.createdAt >= TTL) throw new Error('This recovery scan expired or was already applied. Scan again.')
        const applied = applyDraft(deps, saved, request)
        invalidate(request.characterId)
        return { ok: true, applied }
      } catch (error) { return { ok: false, error: error instanceof Error ? error.message : 'Unable to save recovered progress.' } }
    }
  return { scan: (request, capture) => Promise.resolve(scan(request, capture)), commit: (request) => Promise.resolve(commit(request)) }
}
