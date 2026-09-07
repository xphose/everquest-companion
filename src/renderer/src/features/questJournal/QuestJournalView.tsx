import { useRef, type JSX } from 'react'
import { Alert, Box, Button, CircularProgress, Stack, useMediaQuery, useTheme } from '@mui/material'
import type { QuestJournalContext } from '@shared/questJournal/journal'
import { useJournalContext, useQuestJournal } from './useQuestJournal'
import { JournalContext } from './JournalContext'
import { JournalFilters } from './JournalFilters'
import { JournalList } from './JournalList'
import { JournalDetail } from './JournalDetail'
import type { JournalNavigation } from './navigation'

function JournalSession({ context, navigation }: { context: QuestJournalContext; navigation: JournalNavigation }): JSX.Element {
  const journal = useQuestJournal(context)
  const detailHost = useRef<HTMLDivElement>(null)
  const narrow = useMediaQuery(useTheme().breakpoints.down('lg'))
  const select = (selectedId: string): void => {
    journal.update({ selectedId })
    if (narrow) detailHost.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }
  return <Stack spacing={1.5} data-testid="quest-journal" data-character-id={context.characterId ?? 'catalog'} sx={{ minWidth: 0, p: 0.5 }}>
    <JournalContext context={journal.result?.context ?? context} refresh={journal.refresh} mutate={journal.mutate} />
    {journal.error && <Alert severity="error" action={<Button size="small" onClick={journal.refresh}>Retry</Button>}>{journal.error}</Alert>}
    <JournalFilters prefs={journal.prefs} result={journal.result} update={journal.update} />
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: '300px minmax(0, 1fr)' }, gap: 1.5, alignItems: 'start', minWidth: 0 }}>
      <JournalList result={journal.result} selectedId={journal.prefs.selectedId}
        select={select} page={(offset) => journal.update({ offset })} />
      <Box ref={detailHost} sx={{ minWidth: 0 }}>
        <JournalDetail key={journal.prefs.selectedId} detail={journal.detail} selectedId={journal.prefs.selectedId} navigation={navigation} mutate={journal.mutate} />
      </Box>
    </Box>
  </Stack>
}

export default function QuestJournalView({ navigation }: { navigation: JournalNavigation }): JSX.Element {
  const { context, error, retry } = useJournalContext()
  if (error) return <Alert severity="error" action={<Button onClick={retry}>Retry</Button>}>{error}</Alert>
  if (!context) return <Stack direction="row" spacing={1} alignItems="center"><CircularProgress size={18} /><span>Reading quest journal…</span></Stack>
  return <JournalSession key={context.characterId ?? 'catalog'} context={context} navigation={navigation} />
}
