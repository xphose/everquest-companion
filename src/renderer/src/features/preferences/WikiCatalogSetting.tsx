import type { JSX } from 'react'
import { Alert, Button, LinearProgress, Stack, Typography } from '@mui/material'
import { useWikiCatalogStatus } from '../../lib/useWikiCatalogStatus'
import { wikiDataDate, wikiRefreshMessage } from '../../lib/wikiCatalogStatus'
import { formatDateTime } from '../../lib/formatDate'
import { usePrefsSeed } from './prefsHydration'
import type { PrefItem } from './PreferencesView'
import type { WikiRefreshStatus } from '@shared/wikiCatalog'

export function wikiCatalogItem(): PrefItem {
  return { id: 'game-data', label: 'Game data', keywords: 'wiki quest quests items mobs drops locations walkthrough reference automatic daily cadence refresh patch', content: <WikiCatalogSetting /> }
}

function UpdateFacts({ status }: { status: WikiRefreshStatus }): JSX.Element {
  const busy = status.state === 'checking' || status.state === 'downloading'
  const percent = status.totalPages ? Math.min(100, (status.completedPages ?? 0) / status.totalPages * 100) : undefined
  return <>
      <Typography variant="body1" fontWeight={700} data-testid="wiki-active-date">Using data updated {wikiDataDate(status.activeUpdatedAt)}</Typography>
      <Typography variant="caption" color="text.secondary" data-testid="wiki-last-checked">
        {status.lastCheckedAt ? `Last checked ${formatDateTime(Date.parse(status.lastCheckedAt))}` : 'Not checked yet'}
        {status.nextCheckAt ? ` · Next check ${formatDateTime(Date.parse(status.nextCheckAt))}` : ''}
      </Typography>
      {status.pendingUpdatedAt && <Typography variant="body2" data-testid="wiki-pending-date">Downloaded update: {wikiDataDate(status.pendingUpdatedAt)}. It will be used on the next Companion launch.</Typography>}
      <Typography role="status" variant="body2" data-testid="wiki-refresh-message">{wikiRefreshMessage(status)}</Typography>
      {busy && <LinearProgress aria-label="Game data update progress" variant={percent === undefined ? 'indeterminate' : 'determinate'} value={percent} />}
    </>
}

export function WikiCatalogSetting(): JSX.Element {
  const { status, unavailable, requesting, refresh } = useWikiCatalogStatus(usePrefsSeed().wikiCatalog)
  const busy = requesting || status?.state === 'checking' || status?.state === 'downloading'
  return <Stack spacing={1.5} data-testid="wiki-catalog-setting">
    <Typography variant="body2">Quest guides, item details, and mob locations check for wiki updates every day while Companion is open.</Typography>
    {status && <UpdateFacts status={status} />}
    {unavailable && <Alert severity="warning">Update status could not be read. Your current game data is still available.</Alert>}
    <Button onClick={refresh} disabled={busy} variant="outlined" data-testid="wiki-refresh-now" sx={{ alignSelf: 'flex-start', textTransform: 'none' }}>{busy ? 'Updating…' : status?.state === 'error' || unavailable ? 'Try again' : 'Check now'}</Button>
  </Stack>
}
