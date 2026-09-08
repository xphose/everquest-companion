import type { JSX } from 'react'
import { Box } from '@mui/material'
import type { PlayerLocation } from '@shared/playerLocation'
import { mapFromLoc } from './mapGeometry'
import { formatLoc } from './locMarker'
import type { MapViewport } from './useMapViewport'

/** The live player uses a filled green dot; saved /loc markers remain blue crosshairs. */
export function MapPlayerMarker({ location, vp }: { location: PlayerLocation; vp: MapViewport }): JSX.Element {
  const at = mapFromLoc(location)
  const p = vp.toScreen(at.x, at.y)
  return (
    <Box data-testid="maps-player-marker" data-loc={formatLoc(location)} data-zone={location.zone}
      title={`${location.characterName} - /loc ${formatLoc(location)}`}
      sx={{ position: 'absolute', left: p.px, top: p.py, transform: 'translate(-50%, -50%)',
        width: 14, height: 14, borderRadius: '50%', bgcolor: 'success.light', border: '2px solid white',
        boxShadow: '0 0 0 4px rgba(0,0,0,0.65)', pointerEvents: 'none', zIndex: 5 }}>
      <Box component="span" sx={{ position: 'absolute', top: 18, left: '50%', transform: 'translateX(-50%)',
        px: 0.6, borderRadius: 0.5, bgcolor: 'rgba(0,0,0,0.8)', color: '#fff', fontSize: 11 }}>You</Box>
    </Box>
  )
}
