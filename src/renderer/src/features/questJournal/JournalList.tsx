import type { JSX } from 'react'
import { Box, Button, Chip, List, ListItemButton, Paper, Stack, Typography } from '@mui/material'
import type { QuestJournalQueryResult, QuestJournalRow, QuestJournalState } from '@shared/questJournal/journal'
import { JOURNAL_PAGE_SIZE } from './preferences'

const STATE_COLOR: Record<QuestJournalState, 'success' | 'warning' | 'info' | 'default'> = {
  completed: 'success', ready: 'warning', active: 'info', unknown: 'default'
}
export function JournalStatus({ row }: { row: QuestJournalRow }): JSX.Element {
  return <Chip size="small" label={row.stateLabel} color={STATE_COLOR[row.state]} variant="outlined" sx={{ height: 'auto', minHeight: 22, '& .MuiChip-label': { whiteSpace: 'normal' } }} />
}

function QuestRow({ row, selected, select }: { row: QuestJournalRow; selected: boolean; select: () => void }): JSX.Element {
  return (
    <ListItemButton selected={selected} onClick={select} data-testid="quest-journal-row" data-quest-id={row.id}
      sx={{ alignItems: 'flex-start', borderBottom: 1, borderColor: 'divider', px: 1.5, py: 1.25 }}>
      <Stack spacing={0.65} sx={{ minWidth: 0, width: '100%' }}>
        <Typography variant="subtitle2" sx={{ overflowWrap: 'anywhere' }}>{row.tracked ? '★ ' : ''}{row.name}</Typography>
        <Typography variant="caption" color="text.secondary">{row.startZone ?? 'Start location unknown'}{row.minLevel !== undefined ? ` · Min. ${row.minLevel}` : ''}</Typography>
        <Box><JournalStatus row={row} /></Box>
        {row.rewardNames.length > 0 && <Typography variant="caption" noWrap title={row.rewardNames.join(', ')}>{row.rewardNames.join(', ')}</Typography>}
        {row.recommendation.reasons[0] && <Typography variant="caption" color="text.secondary">{row.recommendation.reasons[0]}</Typography>}
      </Stack>
    </ListItemButton>
  )
}

export function JournalList({ result, selectedId, select, page }: {
  result: QuestJournalQueryResult | null
  selectedId: string | null
  select: (id: string) => void
  page: (offset: number) => void
}): JSX.Element {
  return (
    <Paper variant="outlined" data-testid="quest-journal-list" sx={{ minWidth: 0 }}>
      <Typography variant="subtitle2" data-testid="quest-journal-count" sx={{ p: 1.5, borderBottom: 1, borderColor: 'divider' }}>
        {result ? `${result.total} ${result.total === 1 ? 'quest' : 'quests'}` : 'Loading quests…'}
      </Typography>
      <List disablePadding sx={{ height: { xs: 300, lg: 550 }, overflow: 'auto' }}>
        {result?.rows.map((row) => <QuestRow key={row.id} row={row} selected={row.id === selectedId} select={() => select(row.id)} />)}
        {result?.rows.length === 0 && <Typography color="text.secondary" sx={{ p: 2 }}>No quests match these filters.</Typography>}
      </List>
      {result && <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ p: 0.5, borderTop: 1, borderColor: 'divider' }}>
        <Button size="small" data-testid="quest-journal-prev" disabled={result.offset === 0}
          onClick={() => page(Math.max(0, result.offset - JOURNAL_PAGE_SIZE))}>Previous</Button>
        <Typography variant="caption">{result.total === 0 ? '0' : `${result.offset + 1} - ${result.offset + result.rows.length}`}</Typography>
        <Button size="small" data-testid="quest-journal-next" disabled={result.offset + result.rows.length >= result.total}
          onClick={() => page(result.offset + JOURNAL_PAGE_SIZE)}>Next</Button>
      </Stack>}
    </Paper>
  )
}
