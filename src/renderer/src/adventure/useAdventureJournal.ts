import { useCallback, useEffect, useRef, useState } from 'react'
import type { CharacterRef } from '@shared/types'
import type { QuestJournalQuery } from '@shared/questJournal/journal'
import type { JournalAction } from '../features/questJournal/useQuestJournal'
import { adventureJournalSession, EMPTY_JOURNAL } from './journalSession'

const characterId = (character: CharacterRef | null): string | null => character ? `${character.name}_${character.server}`.toLowerCase() : null
export type AdventureQuestMode = 'tracked' | 'active' | 'todo' | 'completed'

/** A small per-window query state over the main journal service; no second progress store. */
export function useAdventureJournal() {
  const [reading, setReading] = useState(EMPTY_JOURNAL)
  const [mode, setMode] = useState<AdventureQuestMode>('tracked')
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [offset, setOffset] = useState(0)
  const [writeError, setWriteError] = useState<string | null>(null)
  const [writing, setWriting] = useState(false)
  const latest = useRef({ mode, search, selectedId, offset })
  latest.current = { mode, search, selectedId, offset }
  const current = useRef<ReturnType<typeof adventureJournalSession> | null>(null)
  const identity = reading.result?.context.characterId
  const identityRef = useRef(identity)
  identityRef.current = identity
  useEffect(() => {
    const session = adventureJournalSession({
      read: async () => {
        const args = latest.current
        const query: QuestJournalQuery = { state: args.mode, search: args.search, sort: 'recommended', limit: 40, offset: args.offset }
        const [result, character] = await Promise.all([window.eq.questJournalQuery(query), window.eq.getCharacter()])
        if (result.context.characterId !== characterId(character)) throw new Error('Character changed')
        const detail = args.selectedId ? await window.eq.questJournalDetail({ characterId: result.context.characterId, id: args.selectedId }) : null
        return { result, detail }
      },
      publish: setReading
    })
    current.current = session
    const rebuild = (character: CharacterRef | null): void => {
      const next = characterId(character)
      if (identityRef.current !== next) { setSelectedId(null); setSearch(''); setOffset(0); setWriteError(null) }
      identityRef.current = next
      session.character(next)
    }
    const offCharacter = window.eq.onCharacter(rebuild)
    const offInventory = window.eq.onInventoryReload(session.refresh)
    const offProgress = window.eq.onProgress(session.refresh)
    const offModule = window.eq.onModuleChanged(({ moduleId }) => {
      if (['*', 'tasks', 'turnins', 'loot'].includes(moduleId)) session.refresh()
    })
    const timer = setInterval(session.refresh, 5000)
    window.addEventListener('focus', session.refresh)
    session.refresh()
    return () => {
      session.stop(); current.current = null; clearInterval(timer)
      offCharacter(); offInventory(); offProgress(); offModule()
      window.removeEventListener('focus', session.refresh)
    }
  }, [])
  useEffect(() => { current.current?.invalidate() }, [mode, search, selectedId, offset])
  const mutate = useCallback(async (action: JournalAction): Promise<void> => {
    const session = current.current
    const id = identity
    if (!session || !id || identityRef.current !== id) return
    setWriting(true)
    try {
      const response = await window.eq.questJournalMutate({ ...action, characterId: id })
      if (current.current !== session || identityRef.current !== id) return
      setWriteError(response.ok ? null : response.error)
      if (response.ok) session.invalidate()
    } catch { if (current.current === session && identityRef.current === id) setWriteError('Your change could not be saved. Please try again.') }
    finally { if (current.current === session) setWriting(false) }
  }, [identity])
  return {
    ...reading, error: writeError ?? reading.error, mode, search, selectedId, offset, writing, mutate,
    setMode: (next: AdventureQuestMode): void => { setMode(next); setOffset(0) },
    setSearch: (next: string): void => { setSearch(next); setOffset(0) },
    select: setSelectedId, page: setOffset, refresh: (): void => current.current?.refresh()
  }
}
export type AdventureJournal = ReturnType<typeof useAdventureJournal>
