import type { JSX } from 'react'
import { Accordion, AccordionDetails, AccordionSummary, Box, Button, Chip, Stack, Typography } from '@mui/material'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import type { QuestJournalDetailResult } from '@shared/questJournal/journal'
import type { QuestJournalStep } from '@shared/questJournal/catalog'
import { JournalLocations } from './JournalLocations'
import type { JournalNavigation } from './navigation'
import type { JournalAction } from './useQuestJournal'

function GuideStep({ step, index, detail, navigation }: {
  step: QuestJournalStep; index: number; detail: QuestJournalDetailResult; navigation: JournalNavigation
}): JSX.Element {
  const progress = detail.steps.find((value) => value.id === step.id)
  return <Box data-testid="quest-journal-step" sx={{ borderLeft: 2, borderColor: progress?.complete ? 'success.main' : 'divider', pl: 1.5, py: 0.5 }}>
    <Stack direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap">
      <Typography variant="subtitle2">{index + 1}. {step.kind === 'turn-in' ? 'Turn in' : step.kind === 'collect' ? 'Collect' : 'Speak to the NPC'}</Typography>
      {progress && <Chip size="small" variant="outlined" color={progress.complete ? 'success' : 'default'}
        label={progress.complete ? `Recorded · ${progress.source}` : progress.held !== undefined ? `${progress.held} / ${progress.required ?? '?'} held` : 'Not yet observed'} />}
    </Stack>
    <Typography variant="body2" sx={{ mt: 0.5 }}>{step.text}</Typography>
    {step.items?.map((item, itemIndex) => <Typography key={itemIndex} variant="caption" sx={{ display: 'block', mt: 0.25 }}>
      {item.quantity} × <Button size="small" sx={{ textTransform: 'none', p: 0, minWidth: 0 }} onClick={() => navigation.openLoot(item.name)}>{item.name}</Button>{item.variant ? ` · ${item.variant}` : ''}
    </Typography>)}
    <JournalLocations locations={step.locations} navigation={navigation} />
  </Box>
}

export function JournalGuide({ detail, navigation }: { detail: QuestJournalDetailResult; navigation: JournalNavigation }): JSX.Element | null {
  const guide = detail.entry?.guide
  if (!guide) return null
  return <Stack spacing={1.5} data-testid="quest-journal-guide">
    <Typography variant="h6">Quest steps</Typography>
    {guide.steps.map((step, index) => <GuideStep key={step.id} step={step} index={index} detail={detail} navigation={navigation} />)}
    <Accordion disableGutters elevation={0} slotProps={{ transition: { unmountOnExit: true } }}>
      <AccordionSummary expandIcon={<ExpandMoreIcon />}><Typography variant="body2">Requirements and source notes</Typography></AccordionSummary>
      <AccordionDetails><Stack spacing={1}>{guide.notes.map((note, index) => <Typography key={index} variant="body2" color="text.secondary">{note}</Typography>)}</Stack></AccordionDetails>
    </Accordion>
  </Stack>
}

export function ProgressCorrection({ detail, mutate }: { detail: QuestJournalDetailResult; mutate: (action: JournalAction) => Promise<void> }): JSX.Element | null {
  if (!detail.context.characterId || !detail.row) return null
  const id = detail.row.id
  return <Accordion disableGutters elevation={0} data-testid="quest-journal-correction" slotProps={{ transition: { unmountOnExit: true } }}>
    <AccordionSummary expandIcon={<ExpandMoreIcon />}><Typography variant="body2">Correct progress</Typography></AccordionSummary>
    <AccordionDetails><Stack spacing={1.5}>
      <Typography variant="caption" color="text.secondary">Use a correction for history that the game has not recorded. Automatic observations continue in the background.</Typography>
      <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
        <Button size="small" onClick={() => void mutate({ action: 'status', id, value: 'active' })}>Mark in progress</Button>
        <Button size="small" onClick={() => void mutate({ action: 'status', id, value: 'completed' })}>Mark completed</Button>
        <Button size="small" onClick={() => void mutate({ action: 'status', id, value: 'unknown' })}>Use automatic status</Button>
      </Stack>
      {detail.steps.map((step) => <Stack key={step.id} spacing={0.5}>
        <Typography variant="caption">{step.text}</Typography>
        <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap">
          <Button size="small" onClick={() => void mutate({ action: 'step', id, stepId: step.id, value: true })}>Done</Button>
          <Button size="small" onClick={() => void mutate({ action: 'step', id, stepId: step.id, value: false })}>Not done</Button>
          <Button size="small" onClick={() => void mutate({ action: 'step', id, stepId: step.id, value: null })}>Use automatic tracking</Button>
        </Stack>
      </Stack>)}
    </Stack></AccordionDetails>
  </Accordion>
}
