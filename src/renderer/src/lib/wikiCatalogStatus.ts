import type { WikiRefreshStatus } from '../../../shared/wikiCatalog'
import { formatCalendarDate, formatDateTime } from './formatDate'

export function wikiDataDate(at: string): string {
  return at.length === 10 ? formatCalendarDate(at) : formatDateTime(Date.parse(at), { dateStyle: 'medium' })
}

export function wikiRefreshMessage(status: WikiRefreshStatus): string {
  if (status.state === 'checking') return 'Checking the wiki…'
  if (status.state === 'downloading') return status.totalPages
    ? `Updating game data… ${status.completedPages ?? 0} of ${status.totalPages} pages`
    : 'Updating game data…'
  if (status.state === 'error') return 'Could not finish updating. Your current data is still available; we will retry automatically.'
  if (status.pendingUpdatedAt) return 'New game data is ready. Restart Companion when convenient to use it in all windows.'
  return status.lastCheckedAt ? 'Your game data is up to date with the last wiki check.' : 'The first automatic wiki check is coming up.'
}
