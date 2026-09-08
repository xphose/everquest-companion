import type { JSX } from 'react'
import { Alert, AlertTitle, Stack, Typography } from '@mui/material'
import type { MacroPreparationSnapshot } from '@shared/macroPreparation'
import { preparationFeedback, type MacroFeedback } from './macroFeedback'

function PreparationTime({ timestamp }: { timestamp: MacroFeedback['timestamp'] }): JSX.Element | null {
  if (!timestamp) return null
  return <Typography variant="caption" component="div">{timestamp.label}: <time dateTime={timestamp.value}>{new Date(timestamp.value).toLocaleString()}</time></Typography>
}

export function MacroPreparationStatus({ preparation }: { preparation: MacroPreparationSnapshot }): JSX.Element {
  const installed = preparation.installation
  const feedback = preparationFeedback(preparation)
  return <Stack spacing={1}>
    {installed && <Alert severity={feedback.severity}
      role="status" data-testid="macros-preparation-status" data-state={installed.state}>
      <AlertTitle>{feedback.title}</AlertTitle>
      <Typography variant="body2">{feedback.message}</Typography>
      {feedback.detail && <Typography variant="body2">{feedback.detail}</Typography>}
      {installed.destination && <Typography variant="body2">Show Hotbar {installed.destination.bar}, page {installed.destination.page} in EverQuest to find these buttons.</Typography>}
      <PreparationTime timestamp={feedback.timestamp} />
    </Alert>}
    <Alert severity={preparation.phase === 'changed' ? 'warning' : preparation.phase === 'utility-ready' ? 'success' : 'info'}
      role="status" data-testid="macros-preparation-phase" data-phase={preparation.phase}>
      {preparation.message}
    </Alert>
  </Stack>
}
