import { useState, type JSX } from 'react'
import { Box, Button, Stack, Typography } from '@mui/material'

function checked(at: number | null): string {
  return at === null ? 'waiting for first check' : `checked ${new Date(at).toLocaleTimeString()}`
}

/** A completed check is not a new export or a changed recommendation. Keep this status quiet. */
export function GearRefreshStatus({ characterAt, inventoryAt, error, refresh }: {
  characterAt: number | null; inventoryAt: number | null; error: string | null; refresh: () => void
}): JSX.Element {
  const [requested, setRequested] = useState<number | null>(null)
  const complete = requested !== null && (characterAt ?? 0) >= requested && (inventoryAt ?? 0) >= requested
  return <Stack direction="row" gap={1} alignItems="center" justifyContent="space-between" data-testid="gear-refresh-status">
    <Box>
      <Typography variant="body2">Auto updates · character every 2 seconds · equipment every 30 seconds</Typography>
      <Typography variant="caption" color="text.secondary" data-testid="gear-refresh-checked"
        data-character-checked={characterAt ?? ''} data-inventory-checked={inventoryAt ?? ''}>
        Character {checked(characterAt)} · Equipment {checked(inventoryAt)}. New exports update immediately.
      </Typography>
      {requested !== null && <Typography variant="caption" display="block" role="status" color={error ? 'warning.main' : 'text.secondary'} data-testid="gear-refresh-feedback">
        {complete ? 'Refresh complete.' : error ? 'Could not finish refreshing. Retrying automatically.' : 'Refreshing your character and equipment…'}
      </Typography>}
    </Box>
    <Button size="small" onClick={() => { setRequested(Date.now()); refresh() }} data-testid="gear-refresh-now" sx={{ flexShrink: 0, textTransform: 'none' }}>Refresh now</Button>
  </Stack>
}
