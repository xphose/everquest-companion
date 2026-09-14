import { type JSX, useState } from 'react'
import { Box, Button, IconButton, Popover, Stack } from '@mui/material'
import ZoomInIcon from '@mui/icons-material/ZoomIn'
import ZoomOutIcon from '@mui/icons-material/ZoomOut'
import CenterFocusStrongIcon from '@mui/icons-material/CenterFocusStrong'
import TuneIcon from '@mui/icons-material/Tune'
import MapToolbar, { type MapToolbarProps } from './MapToolbar'
import ZoneSelect from './MapZoneSelect'

/** Drawing options live in a popover so even the minimum overlay has a useful canvas. */
export function CompactMapToolbar(props: MapToolbarProps): JSX.Element {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  return <>
    <Stack direction="row" spacing={0.5} alignItems="center" data-testid="maps-toolbar" sx={{ flexShrink: 0, minWidth: 0 }}>
      <Box sx={{ flex: 1, minWidth: 0, '& > .MuiAutocomplete-root': { width: '100%', minWidth: 0 } }}>
        <ZoneSelect zones={props.zones} zone={props.zone} onPick={props.onPick} />
      </Box>
      <Button size="small" onClick={props.onFollowCurrent} data-testid="maps-follow-current" title={props.mode === 'follow' ? 'Following your current zone' : 'Return to your current zone'} sx={{ flexShrink: 0 }}>Current</Button>
      <IconButton size="small" aria-label="Zoom in" data-testid="maps-zoom-in" onClick={() => props.onZoom(1.35)}><ZoomInIcon fontSize="small" /></IconButton>
      <IconButton size="small" aria-label="Zoom out" data-testid="maps-zoom-out" onClick={() => props.onZoom(1 / 1.35)}><ZoomOutIcon fontSize="small" /></IconButton>
      <IconButton size="small" aria-label="Fit the whole zone" data-testid="maps-fit" onClick={props.onFit}><CenterFocusStrongIcon fontSize="small" /></IconButton>
      <IconButton size="small" aria-label="Map options" onClick={(event) => setAnchor(event.currentTarget)}><TuneIcon fontSize="small" /></IconButton>
    </Stack>
    <Popover open={anchor !== null} anchorEl={anchor} onClose={() => setAnchor(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }}>
      <Box sx={{ p: 1.5, maxWidth: 'min(480px, calc(100vw - 24px))' }}><MapToolbar {...props} /></Box>
    </Popover>
  </>
}
