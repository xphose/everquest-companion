import { useCallback, useEffect, useRef, useState } from 'react'
import type { RecoveryCommitRequest, RecoveryDraft, RecoveryInput } from '@shared/questJournal/recovery'
import { allRecoveryCandidates, recoverySelection, toggleRecoveryCandidate } from './recoverySelection'

type Busy = 'scan' | 'apply' | 'forget' | null
const errorMessage = (cause: unknown): string => cause instanceof Error ? cause.message : String(cause)

export function useQuestRecovery(characterId: string | null, refresh: () => void) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<Busy>(null)
  const [scanSource, setScanSource] = useState<RecoveryInput | null>(null)
  const [draft, setDraft] = useState<RecoveryDraft | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirmed, setConfirmed] = useState(false)
  const [objectiveCandidateId, setObjectiveCandidateId] = useState('')
  const [forgetConfirmation, setForgetConfirmation] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const generation = useRef(0)
  const invalidate = useCallback(() => { generation.current++ }, [])
  const discard = useCallback(() => {
    invalidate()
    setOpen(false); setBusy(null); setScanSource(null); setDraft(null); setSelected(new Set())
    setConfirmed(false); setObjectiveCandidateId(''); setForgetConfirmation(false); setError(null)
  }, [invalidate])
  useEffect(() => {
    const off = window.eq.onCharacter(discard)
    return () => { invalidate(); off() }
  }, [discard, invalidate])
  const close = (): void => { if (busy !== 'apply' && busy !== 'forget') discard() }
  const scan = async (source: RecoveryInput): Promise<void> => {
    if (!characterId || busy) return
    const current = ++generation.current
    setBusy('scan'); setScanSource(source); setError(null); setDraft(null); setSelected(new Set()); setConfirmed(false); setObjectiveCandidateId(''); setForgetConfirmation(false)
    try {
      const response = await window.eq.questJournalRecoverScan({ characterId, source })
      if (generation.current !== current) return
      if (!response.ok) { if (!response.cancelled) setError(response.error); return }
      if (response.draft.characterId !== characterId) return
      setDraft(response.draft); setSelected(recoverySelection(response.draft.candidates, true))
    } catch (cause) { if (generation.current === current) setError(errorMessage(cause)) }
    finally { if (generation.current === current) { setBusy(null); setScanSource(null) } }
  }
  const begin = (): void => {
    if (!characterId) return
    discard(); setNotice(null); setOpen(true)
    void scan('files')
  }
  const commit = async (request: RecoveryCommitRequest): Promise<void> => {
    const current = ++generation.current
    setBusy(request.action); setScanSource(null); setError(null)
    try {
      const response = await window.eq.questJournalRecoverCommit(request)
      if (generation.current !== current) return
      if (!response.ok) { setError(response.error); return }
      discard()
      setNotice(request.action === 'forget' ? 'Recovered quest data cleared.' : `Saved ${response.applied} recovered ${response.applied === 1 ? 'quest' : 'quests'}.`)
      refresh()
    } catch (cause) { if (generation.current === current) setError(errorMessage(cause)) }
    finally { if (generation.current === current) setBusy(null) }
  }
  const apply = (): void => {
    if (!characterId || !draft || busy || !confirmed || !selected.size) return
    if (objectiveCandidateId && !selected.has(objectiveCandidateId)) return
    void commit({ action: 'apply', characterId, draftId: draft.id, candidateIds: [...selected], confirmedCharacter: confirmed,
      objectiveCandidateId: objectiveCandidateId || undefined })
  }
  const forget = (): void => {
    if (!characterId || busy || !forgetConfirmation) return
    void commit({ action: 'forget', characterId })
  }
  const toggle = (id: string, checked: boolean): void => setSelected((previous) => toggleRecoveryCandidate(previous, id, checked))
  const selectConfirmed = (): void => setSelected(recoverySelection(draft?.candidates ?? [], false))
  const selectAll = (): void => setSelected(allRecoveryCandidates(draft?.candidates ?? []))
  const clear = (): void => setSelected(new Set())
  const objectiveSelectionValid = objectiveCandidateId === '' || selected.has(objectiveCandidateId)
  return { open, busy, scanSource, draft, selected, confirmed, setConfirmed, objectiveCandidateId, setObjectiveCandidateId, objectiveSelectionValid, forgetConfirmation, setForgetConfirmation,
    error, notice, dismissNotice: () => setNotice(null), begin, close, scan, apply, forget, toggle, selectConfirmed, selectAll, clear }
}

export type QuestRecoveryController = ReturnType<typeof useQuestRecovery>
