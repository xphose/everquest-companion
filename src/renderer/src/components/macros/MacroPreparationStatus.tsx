import type { JSX } from 'react'
import { Alert, AlertTitle, Stack, Typography } from '@mui/material'
import type { MacroPreparationSnapshot } from '@shared/macroPreparation'

function PreparationTime({ installation }: { installation: NonNullable<MacroPreparationSnapshot['installation']> }): JSX.Element | null {
  if (installation.state !== 'saved' || !installation.at) return null
  return <Typography variant="caption" component="div">Saved: <time dateTime={installation.at}>{new Date(installation.at).toLocaleString()}</time></Typography>
}

export function MacroPreparationStatus({ preparation }: { preparation: MacroPreparationSnapshot }): JSX.Element {
  const installed = preparation.installation
  return <Stack spacing={1}>
    {installed && <Alert severity={installed.state === 'conflict' ? 'warning' : installed.state === 'saved' ? 'success' : 'info'}
      role="status" data-testid="macros-preparation-status" data-state={installed.state}>
      <AlertTitle>{installed.state === 'pending' ? 'Preparation queued, not written yet' : installed.state === 'saved' ? 'Preparation saved' : 'Preparation needs attention'}</AlertTitle>
      <Typography variant="body2">{installed.message}</Typography>
      {installed.state === 'pending' && <Typography variant="body2">Keep the companion open. Fully exit EverQuest, wait for Preparation saved, then launch the game to load the buttons.</Typography>}
      {installed.state === 'saved' && <Typography variant="body2">Start or restart EverQuest to load the saved preparation buttons.</Typography>}
      {installed.destination && <Typography variant="body2">Hotbar {installed.destination.bar} · Page {installed.destination.page}</Typography>}
      <PreparationTime installation={installed} />
    </Alert>}
    <Alert severity={preparation.phase === 'changed' ? 'warning' : preparation.phase === 'utility-ready' ? 'success' : 'info'}
      role="status" data-testid="macros-preparation-phase" data-phase={preparation.phase}>
      {preparation.message}
    </Alert>
  </Stack>
}
