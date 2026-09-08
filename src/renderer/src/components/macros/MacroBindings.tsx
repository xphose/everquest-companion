import type { JSX } from 'react'
import { Box, Typography } from '@mui/material'
import type { MacroCastBinding } from '@shared/macros'

export function MacroBindings({ bindings, live }: { bindings?: readonly MacroCastBinding[]; live: boolean }): JSX.Element | null {
  if (!live) return <Typography variant="caption" color="text.secondary">Current gem bindings are unavailable.</Typography>
  if (!bindings?.length) return null
  return <Box data-testid="macros-bindings">
    <Typography variant="caption" color="text.secondary">Current gem bindings</Typography>
    {bindings.map((binding) => <Typography key={binding.line} variant="body2" color={binding.castable ? 'text.primary' : 'warning.main'}>
      Line {binding.line} → Gem {binding.gem}: {binding.name}{binding.castable ? '' : ' (locked)'}
    </Typography>)}
  </Box>
}
