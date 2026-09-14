import type { JSX } from 'react'
import { Accordion, AccordionDetails, AccordionSummary, Alert, Box, Button, Checkbox, Chip, Stack, Typography } from '@mui/material'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import type { QuestJournalDetailResult } from '@shared/questJournal/journal'
import type { MapFocus } from '../features/maps/mapFocus'
import type { JournalAction } from '../features/questJournal/useQuestJournal'
import { AdventureLocations } from './AdventureLocations'

interface Props {
  detail: QuestJournalDetailResult
  writing: boolean
  mutate: (action: JournalAction) => Promise<void>
  onMap: (target: MapFocus) => void
}
const SOURCES = { manual: 'Your checkmark', inventory: 'Inventory export', log: 'Game log', unknown: 'Not observed' }

function Objectives({ detail, writing, mutate, onMap }: Props): JSX.Element {
  const id = detail.row?.id ?? ''
  return <Stack spacing={1}>
    <Typography variant="subtitle2">Objectives</Typography>
    {detail.steps.map((step) => <Box key={step.id} data-testid="adventure-objective" sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 0.75 }}>
      <Stack direction="row" alignItems="flex-start" spacing={0.5}>
        <Checkbox size="small" checked={step.complete} disabled={writing || !detail.context.characterId}
          slotProps={{ input: { 'aria-label': `Manually mark ${step.text}` } }}
          onChange={(_, value) => void mutate({ action: 'step', id, stepId: step.id, value })} />
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography variant="body2">{step.text}</Typography>
          <Typography variant="caption" color="text.secondary">{SOURCES[step.source]}{step.held !== undefined ? ` · ${step.held}/${step.required ?? '?'} held` : ''}</Typography>
          {detail.manual.steps[step.id] !== undefined && <Button size="small" onClick={() => void mutate({ action: 'step', id, stepId: step.id, value: null })} disabled={writing}>Undo my checkmark</Button>}
        </Box>
      </Stack>
      <AdventureLocations locations={detail.entry?.guide?.steps.find((entry) => entry.id === step.id)?.locations ?? []} onMap={onMap} />
    </Box>)}
    {detail.steps.length === 0 && <Typography variant="body2" color="text.secondary">No trackable objectives are published for this quest. Read its walkthrough below; completion is only claimed when the game records it or you confirm it.</Typography>}
    <Typography variant="caption" color="text.secondary">Clicking an objective records your own checkmark. “Undo” restores the game or inventory observation.</Typography>
  </Stack>
}

function QuestReference({ detail }: { detail: QuestJournalDetailResult }): JSX.Element {
  return <Accordion disableGutters elevation={0}>
    <AccordionSummary expandIcon={<ExpandMoreIcon />}><Typography variant="subtitle2">Walkthrough & sources</Typography></AccordionSummary>
    <AccordionDetails><Stack spacing={1}>
      {detail.entry?.walkthrough?.map((section, index) => <Box key={index}>
        {section.heading && <Typography variant="subtitle2">{section.heading}</Typography>}
        <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{section.text}</Typography>
      </Box>)}
      {detail.entry?.guide?.notes.map((note, index) => <Typography key={index} variant="body2">{note}</Typography>)}
      {detail.evidence.map((note, index) => <Typography key={index} variant="caption" color="text.secondary">{note}</Typography>)}
      {detail.entry && <Typography variant="caption" color="text.secondary">Bundled source snapshot: {detail.entry.source.snapshotAt}. {detail.entry.source.url}</Typography>}
      {!detail.entry && <Typography variant="body2">The game log named this task. Its walkthrough is not in the bundled catalog yet.</Typography>}
    </Stack></AccordionDetails>
  </Accordion>
}

function QuestPlaces({ detail, onMap }: Pick<Props, 'detail' | 'onMap'>): JSX.Element {
  const final = detail.entry?.guide?.steps.at(-1)
  const turnIn = final?.kind === 'turn-in' ? final : undefined
  return <>
    <Box><Typography variant="subtitle2">Where to begin</Typography><AdventureLocations locations={detail.entry?.pickupLocations ?? []} onMap={onMap} /></Box>
    <Box><Typography variant="subtitle2">Where to turn in</Typography>
      {turnIn ? <><Typography variant="body2">{turnIn.text}</Typography><AdventureLocations locations={turnIn.locations} onMap={onMap} /></> : <Typography variant="caption" color="text.secondary">The source does not identify a final turn-in here. Check the walkthrough.</Typography>}
    </Box>
  </>
}

export function AdventureQuestDetail(props: Props): JSX.Element {
  const { detail, mutate, writing } = props
  const disabled = writing || !detail.context.characterId
  const row = detail.row
  if (!row) return <Alert severity="info">This quest is no longer available. Choose another quest.</Alert>
  return <Stack spacing={1.25} data-testid="adventure-quest-detail" data-quest-id={row.id}>
    <Typography variant="h6" sx={{ overflowWrap: 'anywhere' }}>{row.name}</Typography>
    <Stack direction="row" spacing={1} alignItems="center">
      <Chip size="small" variant="outlined" label={row.stateLabel} />
      <Button size="small" variant={row.tracked ? 'contained' : 'outlined'} disabled={writing || !detail.context.characterId}
        data-testid="adventure-track" onClick={() => void mutate({ action: 'track', id: row.id, value: !row.tracked })}>{row.tracked ? 'Untrack quest' : 'Track quest'}</Button>
    </Stack>
    {detail.nextStep && <Alert severity="info" icon={false} data-testid="adventure-next-action"><Typography variant="subtitle2">Next action</Typography>{detail.nextStep}</Alert>}
    <QuestPlaces {...props} />
    <Objectives {...props} />
    <Box><Typography variant="subtitle2">Possible rewards</Typography><Typography variant="body2">{row.rewardNames.join(' · ') || 'No reward is stated in the catalog.'}</Typography></Box>
    <QuestReference detail={detail} />
    <Accordion disableGutters elevation={0}>
      <AccordionSummary expandIcon={<ExpandMoreIcon />}><Typography variant="subtitle2">Correct quest status</Typography></AccordionSummary>
      <AccordionDetails><Stack spacing={0.75}>
        <Typography variant="caption">These are your own statements, separate from observed game progress.</Typography>
        <Stack direction="row" useFlexGap flexWrap="wrap" spacing={0.5}>
          <Button size="small" disabled={disabled} onClick={() => void mutate({ action: 'status', id: row.id, value: 'active' })}>Mark active</Button>
          <Button size="small" disabled={disabled} onClick={() => void mutate({ action: 'status', id: row.id, value: 'completed' })}>Mark complete</Button>
          <Button size="small" disabled={disabled} onClick={() => void mutate({ action: 'status', id: row.id, value: 'unknown' })}>Use game records</Button>
        </Stack>
      </Stack></AccordionDetails>
    </Accordion>
  </Stack>
}
