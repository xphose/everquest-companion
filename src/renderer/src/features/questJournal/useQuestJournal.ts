import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import type {
  QuestJournalContext, QuestJournalDetailResult, QuestJournalMutation, QuestJournalQueryResult
} from '@shared/questJournal/journal'
import { journalQuery, readJournalPreferences, writeJournalPreferences, type JournalPreferences } from './preferences'

type WithoutCharacter<T> = T extends unknown ? Omit<T, 'characterId'> : never
export type JournalAction = WithoutCharacter<QuestJournalMutation>
const messageOf = (error: unknown): string => error instanceof Error ? error.message : String(error)

/** Discover identity before reading per-character UI preferences. Character events invalidate replies immediately. */
export function useJournalContext(): { context: QuestJournalContext | null; error: string | null; retry: () => void } {
  const [context, setContext] = useState<QuestJournalContext | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  const retry = useCallback(() => setRevision((value) => value + 1), [])
  useEffect(() => {
    let generation = 0
    const read = (): void => {
      const current = ++generation
      setContext(null)
      void window.eq.questJournalQuery({ limit: 1 }).then((result) => {
        if (generation === current) { setContext(result.context); setError(null) }
      }).catch((cause: unknown) => { if (generation === current) setError(messageOf(cause)) })
    }
    const off = window.eq.onCharacter(read)
    read()
    return () => { generation++; off() }
  }, [revision])
  return { context, error, retry }
}

function useJournalDetail(characterId: string | null, id: string | null, revision: number): {
  detail: QuestJournalDetailResult | null; error: string | null
} {
  const [held, setHeld] = useState<{ id: string; detail: QuestJournalDetailResult } | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    const off = window.eq.onCharacter(() => { alive = false; setHeld(null) })
    setError(null)
    if (id) void window.eq.questJournalDetail({ characterId, id }).then((result) => {
      if (!alive || result.context.characterId !== characterId) return
      setHeld({ id, detail: result }); setError(null)
    }).catch((cause: unknown) => { if (alive) setError(messageOf(cause)) })
    return () => { alive = false; off() }
  }, [characterId, id, revision])
  return { detail: held?.id === id ? held.detail : null, error }
}

/** Requests are windowed by main. A mounted poll keeps task/inventory observations current without user clicks. */
export function useQuestJournal(context: QuestJournalContext) {
  const characterId = context.characterId
  const [prefs, setPrefs] = useState(() => readJournalPreferences(characterId))
  const [result, setResult] = useState<QuestJournalQueryResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  const [detailRevision, setDetailRevision] = useState(0)
  const alive = useRef(true)
  const refresh = useCallback(() => setRevision((value) => value + 1), [])
  const deferred = useDeferredValue(prefs.search)
  const { state, zone, className, level, sort, offset } = prefs
  const query = useMemo(() => journalQuery({ search: deferred, state, zone, className, level, sort, offset, selectedId: null }),
    [deferred, state, zone, className, level, sort, offset])
  const update = useCallback((change: Partial<JournalPreferences>) => {
    setPrefs((previous) => {
      const next = { ...previous, ...change }
      writeJournalPreferences(characterId, next)
      return next
    })
  }, [characterId])
  const selectFirst = useCallback((id: string) => {
    setPrefs((previous) => {
      if (previous.selectedId) return previous
      const next = { ...previous, selectedId: id }
      writeJournalPreferences(characterId, next)
      return next
    })
  }, [characterId])
  useEffect(() => {
    alive.current = true
    const timer = setInterval(refresh, 5000)
    const offInventory = window.eq.onInventoryReload(refresh)
    const offCharacter = window.eq.onCharacter(() => { alive.current = false; setResult(null) })
    return () => { alive.current = false; clearInterval(timer); offInventory(); offCharacter() }
  }, [refresh])
  useEffect(() => {
    let current = true
    void window.eq.questJournalQuery(query).then((reply) => {
      if (!current || !alive.current || reply.context.characterId !== characterId) return
      setResult(reply); setError(null); setDetailRevision((value) => value + 1)
      if (reply.rows[0]) selectFirst(reply.rows[0].id)
    }).catch((cause: unknown) => { if (current && alive.current) setError(messageOf(cause)) })
    return () => { current = false }
  }, [query, revision, characterId, selectFirst])
  const detail = useJournalDetail(characterId, prefs.selectedId, detailRevision)
  const mutate = useCallback(async (action: JournalAction): Promise<void> => {
    if (!characterId) return
    try {
      const response = await window.eq.questJournalMutate({ ...action, characterId })
      if (!alive.current) return
      if (!response.ok) setError(response.error)
      else refresh()
    } catch (cause) { if (alive.current) setError(messageOf(cause)) }
  }, [characterId, refresh])
  return { prefs, update, result, detail: detail.detail, error: error ?? detail.error, refresh, mutate }
}
