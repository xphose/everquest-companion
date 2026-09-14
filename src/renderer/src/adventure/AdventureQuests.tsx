import type { JSX } from 'react'
import { Alert, Box, Button, List, ListItemButton, ListItemText, Stack, Tab, Tabs, TextField, Typography } from '@mui/material'
import type { MapFocus } from '../features/maps/mapFocus'
import { AdventureQuestDetail } from './AdventureQuestDetail'
import type { AdventureJournal, AdventureQuestMode } from './useAdventureJournal'

function QuestRows({ journal }: { journal: AdventureJournal }): JSX.Element {
  const { result, selectedId, select, offset, page } = journal
  return <>
    {result?.rows.length === 0 && <Typography variant="body2" color="text.secondary" sx={{ p: 1 }}>{journal.mode === 'tracked' ? 'No tracked quests yet. Choose Find, open a quest, then Track quest to keep it here.' : 'No quests match. Try Find or a shorter search.'}</Typography>}
    <List dense disablePadding>{result?.rows.map((row) => <ListItemButton key={row.id} selected={selectedId === row.id} onClick={() => select(row.id)} data-testid="adventure-quest-row">
      <ListItemText primary={row.name} secondary={`${row.stateLabel}${row.startZone ? ` · ${row.startZone}` : ''}${row.tracked ? ' · Tracked' : ''}`} />
    </ListItemButton>)}</List>
    {result && result.total > result.limit && <Stack direction="row" justifyContent="space-between" alignItems="center">
      <Button size="small" disabled={offset === 0} onClick={() => page(Math.max(0, offset - result.limit))}>Previous</Button>
      <Typography variant="caption">{offset + 1} - {Math.min(offset + result.limit, result.total)} of {result.total}</Typography>
      <Button size="small" disabled={offset + result.limit >= result.total} onClick={() => page(offset + result.limit)}>Next</Button>
    </Stack>}
  </>
}

function JournalNotice({ journal }: { journal: AdventureJournal }): JSX.Element | null {
  return journal.error ? <Alert severity="warning" action={<Button size="small" onClick={journal.refresh}>Retry</Button>}>{journal.error}</Alert> : null
}

export function AdventureQuests({ journal, onMap }: { journal: AdventureJournal; onMap: (target: MapFocus) => void }): JSX.Element {
  const { result, selectedId, detail, select } = journal
  return <Stack spacing={0.75} sx={{ height: '100%', minHeight: 0 }} data-testid="adventure-quests">
    <JournalNotice journal={journal} />
    {selectedId ? <>
      <Button size="small" onClick={() => select(null)} sx={{ alignSelf: 'flex-start' }}>← Quest list</Button>
      <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto', pr: 0.5 }}>
        {detail?.row?.id === selectedId ? <AdventureQuestDetail detail={detail} mutate={journal.mutate} writing={journal.writing} onMap={onMap} /> : <Typography variant="body2">Reading quest details…</Typography>}
      </Box>
    </> : <>
      <Tabs value={journal.mode} onChange={(_, next: AdventureQuestMode) => journal.setMode(next)} variant="fullWidth" sx={{ minHeight: 34, '& .MuiTab-root': { minHeight: 34, py: 0.5 } }}>
        <Tab label="Tracked" value="tracked" /><Tab label="Active" value="active" /><Tab label="Find" value="todo" /><Tab label="Completed" value="completed" />
      </Tabs>
      <TextField size="small" label="Find a quest" value={journal.search} onChange={(event) => journal.setSearch(event.target.value)} />
      <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}><QuestRows journal={journal} /></Box>
      {!result && <Typography variant="caption">Reading quest journal…</Typography>}
      {result?.context.inventory.state === 'missing' && <Typography variant="caption" color="text.secondary">For item counts, run /outputfile inventory in game. New exports update automatically.</Typography>}
      {result?.context.readiness !== 'ready' && result?.context.message && <Typography variant="caption" color="text.secondary">{result.context.message}</Typography>}
    </>}
  </Stack>
}
