import type { JSX } from 'react'
import { Box, Button, Checkbox, Chip, FormControlLabel, Stack, Typography } from '@mui/material'
import type { RecoveryCandidate, RecoveryDraft } from '@shared/questJournal/recovery'
import { RECOVERY_SOURCE_LABELS } from './recoverySelection'
import type { QuestRecoveryController } from './useQuestRecovery'

function Candidate({ candidate, checked, toggle, disabled }: {
  candidate: RecoveryCandidate; checked: boolean; toggle: (id: string, checked: boolean) => void; disabled: boolean
}): JSX.Element {
  return <Box data-testid="quest-recovery-candidate" data-candidate-id={candidate.id} data-confidence={candidate.confidence}
    sx={{ p: 1.25, border: 1, borderColor: checked ? 'primary.dark' : 'divider', borderRadius: 1 }}>
    <FormControlLabel sx={{ m: 0, alignItems: 'flex-start', '& .MuiFormControlLabel-label': { minWidth: 0 } }}
      control={<Checkbox size="small" checked={checked} disabled={disabled} onChange={(_, value) => toggle(candidate.id, value)}
        slotProps={{ input: { 'aria-label': `Recover ${candidate.name}` } }} />}
      label={<Stack spacing={0.5} sx={{ pt: 0.5 }}>
        <Typography variant="subtitle2" sx={{ overflowWrap: 'anywhere' }}>{candidate.name}</Typography>
        <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap">
          <Chip size="small" variant="outlined" label={candidate.state === 'completed' ? 'Completed' : 'In progress'} />
          <Chip size="small" color={candidate.confidence === 'confirmed' ? 'success' : 'warning'} variant="outlined"
            label={candidate.confidence === 'confirmed' ? 'Confirmed evidence' : 'Likely · check before selecting'} />
          <Typography variant="caption" color="text.secondary">{RECOVERY_SOURCE_LABELS[candidate.source]}</Typography>
        </Stack>
      </Stack>} />
    <Stack spacing={0.25} sx={{ pl: 4 }}>
      {candidate.evidence.map((text, index) => <Typography key={index} variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>{text}</Typography>)}
      {candidate.objectives?.map((objective, index) => <Typography key={index} variant="body2">
        {objective.text}{objective.current !== undefined && objective.required !== undefined ? ` · ${objective.current}/${objective.required}` : ''}{objective.complete ? ' · Done' : ''}
      </Typography>)}
    </Stack>
  </Box>
}

export function RecoveryCandidates({ draft, controller }: { draft: RecoveryDraft; controller: QuestRecoveryController }): JSX.Element {
  return <Stack spacing={1}>
    <Stack direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap">
      <Typography variant="subtitle2" sx={{ flexGrow: 1 }} data-testid="quest-recovery-count">{controller.selected.size} selected · {draft.candidates.length} found</Typography>
      <Button size="small" disabled={!!controller.busy} onClick={controller.selectConfirmed}>Select confirmed</Button>
      <Button size="small" disabled={!!controller.busy} onClick={controller.selectAll}>Select all suggestions too</Button>
      <Button size="small" disabled={!!controller.busy} onClick={controller.clear}>Clear selection</Button>
    </Stack>
    <Typography variant="caption" color="text.secondary">Likely matches start unselected. Selecting suggestions confirms their proposed quest names and states, including when you select them all.</Typography>
    <Stack spacing={1} sx={{ maxHeight: 340, overflow: 'auto' }} data-testid="quest-recovery-candidates">
      {draft.candidates.map((candidate) => <Candidate key={candidate.id} candidate={candidate} checked={controller.selected.has(candidate.id)} toggle={controller.toggle} disabled={!!controller.busy} />)}
      {draft.candidates.length === 0 && <Typography variant="body2" sx={{ p: 1 }}>No recoverable entries were found in this source. Open another journal page or try saved files.</Typography>}
    </Stack>
  </Stack>
}
