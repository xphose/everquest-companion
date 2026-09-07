import type { JSX } from 'react'
import { Alert, MenuItem, Stack, TextField, Typography } from '@mui/material'
import type { RecoveryDraft } from '@shared/questJournal/recovery'
import type { QuestRecoveryController } from './useQuestRecovery'

export function RecoveryObjectives({ draft, controller }: { draft: RecoveryDraft; controller: QuestRecoveryController }): JSX.Element | null {
  if (!draft.unassignedObjectives?.length) return null
  return <Stack spacing={1} data-testid="quest-recovery-objectives">
    <Typography variant="subtitle2">Visible objectives</Typography>
    {draft.unassignedObjectives.map((objective, index) => <Typography key={index} variant="body2">
      {objective.text}{objective.current !== undefined && objective.required !== undefined ? ` · ${objective.current}/${objective.required}` : ''}{objective.complete ? ' · Done' : ''}
    </Typography>)}
    <TextField select size="small" label="These visible objectives belong to" value={controller.objectiveCandidateId}
      disabled={!!controller.busy} data-testid="quest-recovery-objective-owner" onChange={(event) => controller.setObjectiveCandidateId(event.target.value)}
      slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}>
      <MenuItem value="">Leave unassigned</MenuItem>
      {draft.objectiveCandidates?.map((candidate) => <MenuItem key={candidate.id} value={candidate.id}>{candidate.name}</MenuItem>)}
    </TextField>
    <Typography variant="caption" color="text.secondary">Optional: choose the task whose progress pane is shown in the image. Leaving this blank still recovers the selected quest entries.</Typography>
    {!controller.objectiveSelectionValid && <Alert severity="warning" sx={{ py: 0 }}>Select that quest in the review above, or leave its objectives unassigned.</Alert>}
  </Stack>
}
