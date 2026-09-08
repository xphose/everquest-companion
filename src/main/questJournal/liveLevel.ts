import type { PlayerLocationResult } from '../../shared/playerLocation'
import type { QuestJournalContext } from '../../shared/questJournal/journal'
import { currentPlayerLocation } from '../../shared/currentPlayer'

export function journalLevel(manual: number | undefined, live: number | undefined, logged: number | undefined): Pick<QuestJournalContext, 'level' | 'levelSource'> {
  if (manual !== undefined) return { level: manual, levelSource: 'manual' }
  if (live !== undefined) return { level: live, levelSource: 'live' }
  return logged === undefined ? {} : { level: logged, levelSource: 'log' }
}

/** A stale sample or another character must never replace this journal's logged level. */
export function liveJournalLevel(result: PlayerLocationResult | undefined, name: string | undefined, now: number): number | undefined {
  if (!name) return undefined
  const { level } = currentPlayerLocation(result, name, now) ?? {}
  return level !== undefined && Number.isInteger(level) && level >= 1 && level <= 125 ? level : undefined
}
