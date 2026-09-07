import type { QuestJournalFilter, QuestJournalQuery } from '../../../../shared/questJournal/journal'

export const JOURNAL_PAGE_SIZE = 20
export interface JournalPreferences {
  search: string
  state: QuestJournalFilter
  zone: string
  className: string
  level: string
  sort: 'recommended' | 'name'
  offset: number
  selectedId: string | null
}

const STATES: readonly string[] = ['all', 'tracked', 'active', 'ready', 'completed', 'unknown']
export const DEFAULT_JOURNAL_PREFS: JournalPreferences = {
  search: '', state: 'all', zone: '', className: '', level: '', sort: 'recommended', offset: 0, selectedId: null
}

export function journalPreferenceKey(characterId: string | null): string {
  return `eq.questJournal.${encodeURIComponent(characterId ?? 'catalog')}`
}

export function normalizeJournalPreferences(value: unknown): JournalPreferences {
  if (!value || typeof value !== 'object') return { ...DEFAULT_JOURNAL_PREFS }
  const row = value as Record<string, unknown>
  const text = (key: string): string => typeof row[key] === 'string' ? row[key].slice(0, 500) : ''
  return {
    search: text('search'), zone: text('zone'), className: text('className'), level: text('level'),
    state: STATES.includes(text('state')) ? text('state') as QuestJournalFilter : 'all',
    sort: row.sort === 'name' ? 'name' : 'recommended',
    offset: typeof row.offset === 'number' && Number.isSafeInteger(row.offset) && row.offset >= 0 ? row.offset : 0,
    selectedId: typeof row.selectedId === 'string' ? row.selectedId.slice(0, 500) : null
  }
}

export function readJournalPreferences(characterId: string | null): JournalPreferences {
  try {
    return normalizeJournalPreferences(JSON.parse(localStorage.getItem(journalPreferenceKey(characterId)) ?? '{}'))
  } catch {
    return { ...DEFAULT_JOURNAL_PREFS }
  }
}

export function writeJournalPreferences(characterId: string | null, prefs: JournalPreferences): void {
  localStorage.setItem(journalPreferenceKey(characterId), JSON.stringify(prefs))
}

/** UI serialization only. Main owns filtering, suitability, ordering and page bounds. */
export function journalQuery(prefs: JournalPreferences): QuestJournalQuery {
  const level = Number(prefs.level)
  return {
    search: prefs.search, state: prefs.state, zone: prefs.zone, className: prefs.className,
    level: prefs.level && Number.isFinite(level) && level >= 1 ? level : undefined,
    sort: prefs.sort, offset: prefs.offset, limit: JOURNAL_PAGE_SIZE
  }
}
