import type { JSX } from 'react'
import { Alert, Box, Button, FormControlLabel, MenuItem, Paper, Stack, Switch, TextField, Typography } from '@mui/material'
import SaveAltIcon from '@mui/icons-material/SaveAlt'
import RestoreIcon from '@mui/icons-material/Restore'
import type { MacroAssistantMutation, MacroAssistantSettings, MacroAssistantSnapshot } from '@shared/macroAssistant'
import { MacroStatus } from './MacroStatus'

const BUSY_LABELS = {
  queue: 'Queuing request…', restore: 'Requesting restore…', configure: 'Updating preferences…', prepare: 'Queuing preparation…'
}
function busyLabel(action: MacroAssistantMutation['action'] | undefined): string { return BUSY_LABELS[action ?? 'configure'] }

export function MacroInstallation({ snapshot, busy, busyAction, configure, action }: {
  snapshot: MacroAssistantSnapshot; busy: boolean; configure: (settings: Partial<MacroAssistantSettings>) => void
  busyAction?: MacroAssistantMutation['action']
  action: (action: 'queue' | 'restore') => void
}): JSX.Element {
  const { settings, installation } = snapshot
  const disabled = busy || !snapshot.characterId
  const observationReady = snapshot.context.live && snapshot.context.availableSpellSlots !== undefined
  return <Paper variant="outlined" data-testid="macros-installation" data-state={installation.state} sx={{ p: 1.5 }}>
    <Stack spacing={1.5}>
      <MacroStatus snapshot={snapshot} />
      {busy && <Typography variant="caption" color="primary" role="status">{busyLabel(busyAction)}</Typography>}
      <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
        <FormControlLabel label="Automatic updates" control={<Switch size="small" checked={settings.autoUpdate} disabled={disabled}
          onChange={(_, checked) => configure({ autoUpdate: checked })}
          slotProps={{ input: { 'aria-label': 'Automatic macro updates', ...{ 'data-testid': 'macros-auto-update' } } }} />} />
        <TextField select size="small" label="Hotbar" value={settings.destination.bar} disabled={disabled} sx={{ width: 100 }}
          onChange={(event) => configure({ destination: { ...settings.destination, bar: Number(event.target.value) } })}>
          {Array.from({ length: 10 }, (_, i) => <MenuItem key={i + 1} value={i + 1}>{i + 1}</MenuItem>)}
        </TextField>
        <TextField select size="small" label="Page" value={settings.destination.page} disabled={disabled} sx={{ width: 90 }}
          onChange={(event) => configure({ destination: { ...settings.destination, page: Number(event.target.value) } })}>
          {Array.from({ length: 10 }, (_, i) => <MenuItem key={i + 1} value={i + 1}>{i + 1}</MenuItem>)}
        </TextField>
        <Box sx={{ flexGrow: 1 }} />
        <Button size="small" startIcon={<RestoreIcon />} disabled={disabled || !installation.canRestore}
          data-testid="macros-restore" onClick={() => action('restore')}>Restore last install</Button>
        <Button variant="contained" size="small" startIcon={<SaveAltIcon />} disabled={disabled || !observationReady || installation.state === 'unavailable'}
          data-testid="macros-queue" onClick={() => action('queue')}>{busyAction === 'queue' ? 'Queuing request…' : 'Queue selected macros'}</Button>
      </Stack>
      {installation.targetFiles.length > 1 && <TextField select size="small" label="Character loadout file"
        value={settings.targetFile ?? ''} disabled={disabled} onChange={(event) => configure({ targetFile: event.target.value })}>
        <MenuItem value="" disabled>Choose the loadout to update</MenuItem>
        {installation.targetFiles.map((file) => <MenuItem key={file} value={file}>{file}</MenuItem>)}
      </TextField>}
      <Typography variant="caption" color="text.secondary">
        Leave the companion open when you close EverQuest. Your macros are installed for the next launch; you press their hotbuttons in game.
        {' '}Personal buttons are preserved, and every installation has a backup.
      </Typography>
      {!observationReady && <Typography variant="caption" color="warning.main">A fresh in-game character observation with verified unlocked spell slots is needed to queue a new plan. Existing queued plans still install after EverQuest closes.</Typography>}
      {installation.conflicts.length > 0 && <Alert severity="warning">
        {installation.conflicts.map((message, index) => <Typography key={index} variant="body2">{message}</Typography>)}
      </Alert>}
    </Stack>
  </Paper>
}
