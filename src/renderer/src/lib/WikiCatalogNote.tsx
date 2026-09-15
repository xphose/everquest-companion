import type { JSX } from 'react'
import { Typography } from '@mui/material'
import { useWikiCatalogStatus } from './useWikiCatalogStatus'
import { wikiDataDate } from './wikiCatalogStatus'

/** Quiet reference-data status, distinct from live character and inventory refreshes. */
export function WikiCatalogNote(): JSX.Element | null {
  const { status } = useWikiCatalogStatus()
  if (!status) return null
  return <Typography variant="caption" color="text.secondary" display="block" data-testid="wiki-catalog-note">
    Wiki data: {wikiDataDate(status.activeUpdatedAt)} · Checks daily.
    {status.pendingUpdatedAt ? ' Update ready for your next Companion restart.' :
      status.state === 'error' ? ' Update will retry automatically.' :
        status.state === 'checking' || status.state === 'downloading' ? ' Updating in the background…' : ''}
  </Typography>
}
