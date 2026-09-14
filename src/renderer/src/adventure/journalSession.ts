import type { QuestJournalDetailResult, QuestJournalQueryResult } from '../../../shared/questJournal/journal'

export interface AdventureJournalReading {
  result: QuestJournalQueryResult | null
  detail: QuestJournalDetailResult | null
  error: string | null
}
export const EMPTY_JOURNAL: AdventureJournalReading = { result: null, detail: null, error: null }

/** Observation timestamps are not quest facts. Keep the exact held objects on unchanged polls. */
function facts(value: unknown): string {
  return JSON.stringify(value, (key, content: unknown) => key === 'refreshedAt' ? undefined : content)
}
function retain<T>(previous: T, next: T): T { return facts(previous) === facts(next) ? previous : next }

export function adventureJournalSession(deps: {
  read: () => Promise<Omit<AdventureJournalReading, 'error'>>
  publish: (reading: AdventureJournalReading) => void
}) {
  let alive = true
  let pending = false
  let again = false
  let generation = 0
  let expected: string | null | undefined
  let held = EMPTY_JOURNAL
  const publish = (next: AdventureJournalReading): void => {
    if (next.result === held.result && next.detail === held.detail && next.error === held.error) return
    held = next
    deps.publish(held)
  }
  const refresh = (): void => {
    if (!alive) return
    if (pending) { again = true; return }
    pending = true
    const current = generation
    const timer = setTimeout(() => {
      if (alive && current === generation) publish({ ...held, error: 'The journal is taking longer than usual. Waiting for its current read…' })
    }, 10_000)
    void deps.read().then((next) => {
      if (!alive || current !== generation) return
      if (expected !== undefined && next.result?.context.characterId !== expected) return
      if (next.detail && next.detail.context.characterId !== next.result?.context.characterId) return
      expected = next.result?.context.characterId
      publish({ result: retain(held.result, next.result), detail: retain(held.detail, next.detail), error: null })
    }).catch(() => {
      if (alive && current === generation) publish({ ...held, error: 'Could not refresh quests. Retrying automatically in a few seconds.' })
    }).finally(() => {
      clearTimeout(timer)
      pending = false
      if (again && alive) { again = false; refresh() }
    })
  }
  return {
    refresh,
    invalidate: (): void => { generation++; refresh() },
    character: (id: string | null): void => {
      generation++
      if (expected !== id) publish(EMPTY_JOURNAL)
      expected = id
      refresh()
    },
    stop: (): void => { alive = false; generation++ }
  }
}
