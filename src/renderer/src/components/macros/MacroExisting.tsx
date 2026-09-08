import type { JSX } from 'react'
import { Accordion, AccordionDetails, AccordionSummary, Alert, Box, Chip, Stack, Typography } from '@mui/material'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import type { MacroExistingSocial } from '@shared/macroAssistant'
import { auditIssueCount } from '@shared/macros/presentation'
import { MacroCommands } from './MacroRecipeCard'

function ExistingSocial({ social }: { social: MacroExistingSocial }): JSX.Element {
  return <Accordion disableGutters variant="outlined" sx={{ '&:before': { display: 'none' } }}>
    <AccordionSummary expandIcon={<ExpandMoreIcon />}>
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>{social.name || '(Unnamed social)'}</Typography>
        <Typography variant="caption" color="text.secondary">Socials {social.page} · button {social.button}</Typography>
        <Chip size="small" variant="outlined" label={social.managed ? 'Managed' : 'Personal'} />
        {social.issues.length > 0 && <Chip size="small" color="warning" variant="outlined" label={`${social.issues.length} to review`} />}
      </Stack>
    </AccordionSummary>
    <AccordionDetails><Stack spacing={1}>
      <MacroCommands lines={social.lines} />
      {social.issues.length === 0 && <Typography variant="caption" color="text.secondary">No syntax issues found with the available spell information.</Typography>}
      {social.issues.map((issue, index) => <Alert key={index} severity={issue.severity} sx={{ py: 0.25 }}>
        <Typography variant="body2">{issue.line ? `Line ${issue.line}: ` : ''}{issue.message}</Typography>
        {issue.suggestion && <Typography variant="caption">{issue.suggestion}</Typography>}
      </Alert>)}
    </Stack></AccordionDetails>
  </Accordion>
}

export function MacroExisting({ socials }: { socials: MacroExistingSocial[] }): JSX.Element {
  const issues = auditIssueCount(socials)
  return <Box data-testid="macros-existing">
    <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
      <Typography variant="h6">Your saved socials</Typography>
      <Chip size="small" label={socials.length} />
      {issues > 0 && <Typography variant="caption" color="warning.main">{issues} checks need a look</Typography>}
    </Stack>
    <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
      Open a social to review its commands and suggestions. Personal macros stay yours; only the set you select above is managed.
    </Typography>
    {socials.length === 0 ? <Typography variant="body2" color="text.secondary">No saved socials found in the selected character file.</Typography>
      : <Stack spacing={0.75}>{socials.map((social) => <ExistingSocial key={`${social.page}:${social.button}`} social={social} />)}</Stack>}
  </Box>
}
