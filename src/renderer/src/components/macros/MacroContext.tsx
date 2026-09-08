import type { JSX } from 'react'
import { Box, Chip, Paper, Stack, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material'
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome'
import type { MacroAssistantSnapshot } from '@shared/macroAssistant'
import { isMacroStyle, type MacroStyle } from '@shared/macros'

function Count({ label, value }: { label: string; value: number | undefined }): JSX.Element {
  return <Box sx={{ minWidth: 70 }}><Typography variant="h6" sx={{ fontVariantNumeric: 'tabular-nums', lineHeight: 1.3 }}>{value ?? '—'}</Typography>
    <Typography variant="caption" color="text.secondary">{label}</Typography></Box>
}

export function MacroContext({ snapshot, busy, onStyle }: {
  snapshot: MacroAssistantSnapshot; busy: boolean; onStyle: (style: MacroStyle) => void
}): JSX.Element {
  const { character, context, settings } = snapshot
  return <Paper variant="outlined" data-testid="macros-context" sx={{ p: 2, borderColor: 'primary.dark',
    background: 'linear-gradient(115deg, rgba(180,142,65,0.10), transparent 65%)' }}>
    <Stack direction={{ xs: 'column', lg: 'row' }} spacing={2} justifyContent="space-between">
      <Stack spacing={1} sx={{ minWidth: 0 }}>
        <Stack direction="row" spacing={1} alignItems="center"><AutoAwesomeIcon color="primary" />
          <Typography variant="h5">Macros</Typography><Chip size="small" label={context.live ? 'Live character' : 'Waiting for character'} color={context.live ? 'success' : 'default'} variant="outlined" /></Stack>
        <Typography variant="body2"><strong>{character?.name ?? 'Select a character'}</strong>{character ? ` · ${character.server}` : ''}
          {context.classes.length > 0 ? ` · ${context.classes.join(' / ')}` : ''}</Typography>
        <Typography variant="caption" color="text.secondary">{context.message}</Typography>
      </Stack>
      <Stack direction="row" spacing={3} alignItems="center">
        <Count label="Level" value={context.level} /><Count label="Known spells" value={context.knownSpells} /><Count label="Filled gems" value={context.memorizedSpells} />
      </Stack>
    </Stack>
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ xs: 'flex-start', sm: 'center' }} sx={{ mt: 2 }}>
      <Typography variant="body2" color="text.secondary">Build for</Typography>
      <ToggleButtonGroup exclusive size="small" value={settings.style} disabled={busy || !snapshot.characterId}
        aria-label="Macro play style" onChange={(_, value: unknown) => { if (isMacroStyle(value)) onStyle(value) }}>
        <ToggleButton value="solo">Solo</ToggleButton><ToggleButton value="group">Group</ToggleButton><ToggleButton value="pet">Pet support</ToggleButton>
      </ToggleButtonGroup>
      <Typography variant="caption" color="text.secondary">Suggestions follow your active classes and spells.</Typography>
    </Stack>
  </Paper>
}
