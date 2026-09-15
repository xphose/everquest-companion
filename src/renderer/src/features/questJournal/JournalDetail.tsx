import { useId, useRef, useState, type JSX } from 'react'
import { Accordion, AccordionDetails, AccordionSummary, Alert, Box, Button, Chip, Divider, Paper, Stack, Tab, Tabs, Typography } from '@mui/material'
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
const DETAIL_TABS = ['Next steps', 'Rewards', 'Walkthrough', 'History'] as const

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

function NextSteps({ detail, navigation }: { detail: QuestJournalDetailResult; navigation: JournalNavigation }): JSX.Element {
  return <Stack spacing={2}>
    {detail.nextStep && <Alert severity="info" icon={false} data-testid="quest-journal-next-step"><Typography variant="subtitle2">Next action</Typography>{detail.nextStep}</Alert>}
    <RecoveredProgress record={detail.recovered} />
    {detail.row && <Stack direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap">
      <Chip size="small" variant="outlined" label={FIT_LABELS[detail.row.recommendation.fit]} />
      {detail.entry?.minLevel !== undefined && <Typography variant="caption" color="text.secondary">Source minimum: level {detail.entry.minLevel}</Typography>}
    </Stack>}
    <EntryLocations detail={detail} navigation={navigation} />
    <JournalGuide detail={detail} navigation={navigation} />
    {!detail.entry && <Typography variant="body2" color="text.secondary">This task was read from the game log. Check the in-game task instructions for its next steps.</Typography>}
  </Stack>
}

function DetailTab({ tab, detail, navigation, mutate, resetScroll }: {
  tab: number; detail: QuestJournalDetailResult; navigation: JournalNavigation; mutate: (action: JournalAction) => Promise<void>; resetScroll: () => void
}): JSX.Element {
  if (tab === 0) return <NextSteps detail={detail} navigation={navigation} />
  if (tab === 1) return detail.entry ? <JournalRewards detail={detail} navigation={navigation} />
    : <Typography variant="body2" color="text.secondary">Reward data for this task is not in the bundled catalog yet.</Typography>
  if (tab === 2) return detail.entry ? <JournalReference entry={detail.entry} navigation={navigation} resetScroll={resetScroll} />
    : <Typography variant="body2" color="text.secondary">A walkthrough for this task is not in the bundled catalog yet. Its recorded progress is in History.</Typography>
  return <Stack spacing={2}><TrackingDetails detail={detail} /><ProgressCorrection detail={detail} mutate={mutate} /></Stack>
}

export function JournalDetail({ detail, selectedId, navigation, mutate }: {
  detail: QuestJournalDetailResult | null; selectedId: string | null; navigation: JournalNavigation; mutate: (action: JournalAction) => Promise<void>
}): JSX.Element {
  const [tab, setTab] = useState(0)
  const tabId = useId()
  const activePanel = useRef<HTMLDivElement>(null)
  if (!detail) return <Paper variant="outlined" sx={{ p: 3 }}><Typography color="text.secondary">{selectedId ? 'Reading quest details…' : 'Choose a quest to see its next action, locations and rewards.'}</Typography></Paper>
  const row = detail.row
  if (!row) return <Alert severity="info">This quest is no longer available for the selected character. Choose another quest from the list.</Alert>
  return <Paper variant="outlined" data-testid="quest-journal-detail" data-quest-id={row.id}
    sx={{ minWidth: 0, height: 'max(320px, calc(100dvh - 220px))', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <Stack spacing={0.75} data-testid="journal-detail-header" sx={{ p: { xs: 1.5, lg: 2 }, flexShrink: 0 }}>
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
      <Tabs value={tab} onChange={(_, value: number) => setTab(value)} aria-label="Quest details" variant="scrollable" scrollButtons="auto" allowScrollButtonsMobile
        data-testid="journal-detail-tabs" sx={{ flexShrink: 0, minWidth: 0 }}>
        {DETAIL_TABS.map((label, index) => <Tab key={label} label={label} id={`${tabId}-tab-${index}`} aria-controls={`${tabId}-panel-${index}`} />)}
      </Tabs>
      <Divider />
      {DETAIL_TABS.map((label, index) => <Box key={label} role="tabpanel" hidden={tab !== index} id={`${tabId}-panel-${index}`}
        ref={tab === index ? activePanel : undefined}
        aria-labelledby={`${tabId}-tab-${index}`} tabIndex={0} data-testid="journal-detail-panel"
        sx={{ p: { xs: 1.5, lg: 2 }, flex: 1, minHeight: 0, minWidth: 0, overflowY: 'auto', overflowWrap: 'anywhere' }}>
        {tab === index && <DetailTab tab={tab} detail={detail} navigation={navigation} mutate={mutate} resetScroll={() => activePanel.current?.scrollTo({ top: 0 })} />}
      </Box>)}
  </Paper>
}
