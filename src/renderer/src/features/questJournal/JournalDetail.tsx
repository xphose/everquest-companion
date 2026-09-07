import type { JSX } from 'react'
import { Accordion, AccordionDetails, AccordionSummary, Alert, Box, Button, Chip, Divider, Paper, Stack, Typography } from '@mui/material'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import type { QuestJournalDetailResult } from '@shared/questJournal/journal'
import { formatDateTime } from '../../lib/formatDate'
import { JournalStatus } from './JournalList'
import { JournalLocations } from './JournalLocations'
import { JournalGuide, ProgressCorrection } from './JournalGuides'
import { JournalRewards } from './JournalRewards'
import { JournalReference } from './JournalReference'
import { RecoveredProgress } from './RecoveredProgress'
import type { JournalAction } from './useQuestJournal'
import type { JournalNavigation } from './navigation'

const FIT_LABELS = { suitable: 'Minimum level met', later: 'For a later level', 'other-class': 'Other class', unknown: 'Suitability not known' }

function TrackingDetails({ detail }: { detail: QuestJournalDetailResult }): JSX.Element {
  return <Accordion disableGutters elevation={0} slotProps={{ transition: { unmountOnExit: true } }}>
    <AccordionSummary expandIcon={<ExpandMoreIcon />}><Typography variant="subtitle2">Why this recommendation / Tracking details</Typography></AccordionSummary>
    <AccordionDetails><Stack spacing={0.75}>
    {detail.row?.recommendation.reasons.map((reason, index) => <Typography key={index} variant="body2">{reason}</Typography>)}
    {detail.entry?.minLevelText && <Typography variant="body2" color="text.secondary">Source level notes: {detail.entry.minLevelText}. Enemy levels and requirements can differ.</Typography>}
    {detail.evidence.map((evidence, index) => <Typography key={index} variant="body2" color="text.secondary" data-testid="quest-journal-evidence">{evidence}</Typography>)}
    {detail.observed?.lastObservedAt && <Typography variant="caption" color="text.secondary">Last game record: {formatDateTime(detail.observed.lastObservedAt)}</Typography>}
    </Stack></AccordionDetails>
  </Accordion>
}

function EntryLocations({ detail, navigation }: { detail: QuestJournalDetailResult; navigation: JournalNavigation }): JSX.Element | null {
  const entry = detail.entry
  if (!entry) return null
  const final = entry.guide?.steps.at(-1)
  return <Stack spacing={1.5}>
    <Box><Typography variant="subtitle2">Where to begin</Typography><JournalLocations locations={entry.pickupLocations} navigation={navigation} /></Box>
    <Box data-testid="quest-journal-final-turn-in"><Typography variant="subtitle2">Where to turn in</Typography>
      {final?.kind === 'turn-in' ? <><Typography variant="body2">{final.text}</Typography><JournalLocations locations={final.locations} navigation={navigation} /></>
        : <Typography variant="body2" color="text.secondary">See the source walkthrough for the final recipient. The starting NPC may be different.</Typography>}
    </Box>
  </Stack>
}

export function JournalDetail({ detail, selectedId, navigation, mutate }: {
  detail: QuestJournalDetailResult | null; selectedId: string | null; navigation: JournalNavigation; mutate: (action: JournalAction) => Promise<void>
}): JSX.Element {
  if (!detail) return <Paper variant="outlined" sx={{ p: 3 }}><Typography color="text.secondary">{selectedId ? 'Reading quest details…' : 'Choose a quest to see its next action, locations and rewards.'}</Typography></Paper>
  const row = detail.row
  if (!row) return <Alert severity="info">This quest is no longer available for the selected character. Choose another quest from the list.</Alert>
  return <Paper variant="outlined" data-testid="quest-journal-detail" data-quest-id={row.id}
    sx={{ p: { xs: 1.5, lg: 2 }, minWidth: 0, maxHeight: 'calc(100vh - 220px)', minHeight: 420, overflow: 'auto' }}>
    <Stack spacing={2}>
      <Stack spacing={0.75}>
        <Typography variant="caption" color="text.secondary">Selected quest · stays open while you browse filters and pages</Typography>
        <Typography variant="h5" data-testid="quest-journal-title" sx={{ overflowWrap: 'anywhere' }}>{row.name}</Typography>
        <Stack direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap">
          <JournalStatus row={row} />
          <Button size="small" variant={row.tracked ? 'contained' : 'outlined'} disabled={!detail.context.characterId}
            data-testid="quest-journal-track" onClick={() => void mutate({ action: 'track', id: row.id, value: !row.tracked })}>
            {row.tracked ? 'Tracking' : 'Track quest'}
          </Button>
        </Stack>
      </Stack>
      {detail.nextStep && <Alert severity="info" icon={false} data-testid="quest-journal-next-step"><Typography variant="subtitle2">Next action</Typography>{detail.nextStep}</Alert>}
      <RecoveredProgress record={detail.recovered} />
      <Stack direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap">
        <Chip size="small" variant="outlined" label={FIT_LABELS[row.recommendation.fit]} />
        {detail.entry?.minLevel !== undefined && <Typography variant="caption" color="text.secondary">Source minimum: level {detail.entry.minLevel}</Typography>}
      </Stack>
      <Divider />
      <EntryLocations detail={detail} navigation={navigation} />
      <JournalGuide detail={detail} navigation={navigation} />
      <Divider />
      {detail.entry && <JournalRewards detail={detail} navigation={navigation} />}
      <TrackingDetails detail={detail} />
      {detail.entry && <JournalReference entry={detail.entry} navigation={navigation} />}
      {!detail.entry && <Typography variant="body2" color="text.secondary">This task was read from the game log. Its walkthrough and reward data are not in the bundled catalog yet.</Typography>}
      <ProgressCorrection detail={detail} mutate={mutate} />
    </Stack>
  </Paper>
}
