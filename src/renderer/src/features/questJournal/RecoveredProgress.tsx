import type { JSX } from 'react'
import { Accordion, AccordionDetails, AccordionSummary, Box, Stack, Typography } from '@mui/material'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import type { RecoveryRecord } from '@shared/questJournal/recovery'
import { formatDateTime } from '../../lib/formatDate'
import { RECOVERY_SOURCE_LABELS } from './recoverySelection'

export function RecoveredProgress({ record }: { record?: RecoveryRecord }): JSX.Element | null {
  if (!record) return null
  return <Stack spacing={0.75} data-testid="quest-journal-recovered">
    <Typography variant="subtitle2">Recovered journal snapshot</Typography>
    <Typography variant="caption" color="text.secondary">{RECOVERY_SOURCE_LABELS[record.source]} · {formatDateTime(record.recoveredAt)}</Typography>
    {record.objectives?.map((objective, index) => <Box key={index} sx={{ borderLeft: 2, borderColor: objective.complete ? 'success.main' : 'divider', pl: 1 }}>
      <Typography variant="body2">{objective.text}</Typography>
      {objective.current !== undefined && objective.required !== undefined && <Typography variant="caption" color="text.secondary">{objective.current} / {objective.required}{objective.complete ? ' · Complete' : ''}</Typography>}
    </Box>)}
    <Accordion disableGutters elevation={0} slotProps={{ transition: { unmountOnExit: true } }}>
      <AccordionSummary expandIcon={<ExpandMoreIcon />}><Typography variant="caption">Recovery evidence</Typography></AccordionSummary>
      <AccordionDetails><Stack spacing={0.5}>
        {record.evidence.map((line, index) => <Typography key={index} variant="body2" color="text.secondary">{line}</Typography>)}
      </Stack></AccordionDetails>
    </Accordion>
  </Stack>
}
