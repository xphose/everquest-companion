import type { JSX } from 'react'
import { Alert, Button, Stack, Typography } from '@mui/material'
import type { MacroExistingSocial } from '@shared/macroAssistant'
import { MacroCommands } from './MacroRecipeCard'

export function MacroRepair({ social, busy, onRepair }: {
  social: MacroExistingSocial; busy?: boolean; onRepair?: (social: MacroExistingSocial) => void
}): JSX.Element | null {
  if (!social.repair) return null
  return <Alert severity="info" icon={false} data-testid={`macros-repair-${social.page}-${social.button}`}>
    <Stack spacing={1}>
      <Typography variant="subtitle2">Replace with your current Self Buffs</Typography>
      <Typography variant="body2">Review the replacement below. This social keeps its name and existing hotbar positions.
        The companion will back up the file and save after you fully exit EverQuest.</Typography>
      <MacroCommands lines={social.repair.lines} />
      <Button variant="outlined" size="small" disabled={Boolean(busy) || !onRepair} onClick={() => onRepair?.(social)}>
        Replace with Self Buffs
      </Button>
    </Stack>
  </Alert>
}
