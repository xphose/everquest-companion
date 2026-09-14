import type { JSX } from 'react'
import { Button, Chip, FormControlLabel, Stack, Switch, Typography } from '@mui/material'
import MyLocationIcon from '@mui/icons-material/MyLocation'
import type { PlayerLocation, PlayerLocationResult } from '@shared/playerLocation'
import { formatLoc } from './locMarker'

interface Props {
  compact?: boolean
  enabled: boolean
  centered: boolean
  location: PlayerLocation | null
  result: PlayerLocationResult
  onEnabled: (value: boolean) => void
  onCentered: (value: boolean) => void
  onCenter: () => void
}

export function MapLiveControls(props: Props): JSX.Element {
  const { enabled, centered, location, result, onEnabled, onCentered, onCenter } = props
  const status = result.state === 'live' ? 'Waiting for a fresh position…' : result.reason
  if (props.compact) return <Stack direction="row" spacing={0.5} alignItems="center" data-testid="maps-live-controls" sx={{ minWidth: 0, flexShrink: 0 }}>
    <FormControlLabel sx={{ m: 0, '& .MuiFormControlLabel-label': { fontSize: 12 } }} label="Live" control={<Switch size="small" checked={enabled} onChange={(_, value) => onEnabled(value)} slotProps={{ input: { 'aria-label': 'Live location' } }} />} />
    <Typography variant="caption" noWrap data-testid="maps-live-status" title={location ? `Live · ${formatLoc(location)}` : enabled ? status : 'Live location is off'} sx={{ minWidth: 0, flex: 1 }}>
      {location ? `Live · ${formatLoc(location)}` : enabled ? status : 'Live location off'}
    </Typography>
    <Button size="small" disabled={!location} onClick={onCenter} data-testid="maps-center-player" sx={{ flexShrink: 0 }}>Center me</Button>
    <FormControlLabel sx={{ m: 0, '& .MuiFormControlLabel-label': { fontSize: 12 } }} label="Follow" control={<Switch size="small" checked={centered} onChange={(_, value) => onCentered(value)} title="Keep centered on me" slotProps={{ input: { 'aria-label': 'Keep centered' } }} />} />
  </Stack>
  return (
    <Stack direction="row" spacing={1} alignItems="center" flexWrap="nowrap" useFlexGap
      data-testid="maps-live-controls" sx={{ minHeight: 32, minWidth: 0, flexShrink: 0 }}>
      <FormControlLabel sx={{ mr: 0, flexShrink: 0 }} label="Live location" control={
        <Switch size="small" checked={enabled} onChange={(_, value) => onEnabled(value)}
          slotProps={{ input: { 'aria-label': 'Live location' } }} />
      } />
      {enabled && <>
        <Chip size="small" color={location ? 'success' : 'default'} variant="outlined"
          data-testid="maps-live-status" label={location ? `Live · ${formatLoc(location)}` : status}
          title={location ? `${location.characterName} in ${location.zone}` : status}
          sx={{ maxWidth: 360, minWidth: 0, flexShrink: 1 }} />
        <Button size="small" startIcon={<MyLocationIcon />} disabled={!location} onClick={onCenter}
          data-testid="maps-center-player" sx={{ flexShrink: 0, whiteSpace: 'nowrap' }}>Center on me</Button>
        <FormControlLabel sx={{ mr: 0, flexShrink: 0 }} label="Keep centered" control={
          <Switch size="small" checked={centered} onChange={(_, value) => onCentered(value)}
            slotProps={{ input: { 'aria-label': 'Keep centered' } }} />
        } />
      </>}
      {!enabled && <Typography variant="caption" color="text.secondary" noWrap>Paste /loc below to place a saved marker.</Typography>}
    </Stack>
  )
}
