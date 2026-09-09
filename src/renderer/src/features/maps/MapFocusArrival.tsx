import { useEffect, useRef, useState, type JSX } from 'react'
import { Button, Stack, Typography } from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import type { NavBack } from '../../appRouting'
import { useBackTarget } from '../../appBack'
import type { MapFocus } from './mapFocus'
import type { JumpTarget } from './crossZone'
import type { ZoneShort } from '@shared/maps'

export interface MapFocusProps {
  focus?: MapFocus | null
  focusNonce?: number
  onFocusConsumed?: () => void
  nav?: NavBack
}

export function useMapFocusArrival(props: MapFocusProps, onJump: (target: JumpTarget) => void): MapFocus | null {
  const seen = useRef(-1)
  const [target, setTarget] = useState<MapFocus | null>(null)
  const { focus, focusNonce = 0, onFocusConsumed } = props
  useEffect(() => {
    if (!focus || seen.current === focusNonce) return
    seen.current = focusNonce
    setTarget(focus)
    onJump(focus)
    onFocusConsumed?.()
  }, [focus, focusNonce, onFocusConsumed, onJump])
  return target
}

function locationLabel(focus: MapFocus | null, zone: ZoneShort | null): string | undefined {
  return focus?.zone === zone ? focus?.label : undefined
}

export function MapFocusArrival({ nav, focus, zone }: { nav?: NavBack; focus: MapFocus | null; zone: ZoneShort | null }): JSX.Element | null {
  const label = locationLabel(focus, zone)
  const gear = focus?.source === 'gear'
  const back = (): boolean => nav?.back() ?? false
  useBackTarget(back)
  if (!nav?.origin && !label) return null
  return <Stack direction="row" spacing={1} alignItems="center" sx={{ flexShrink: 0, minWidth: 0 }}>
    {nav?.origin && <Button size="small" startIcon={<ArrowBackIcon />} data-testid="maps-origin-back" onClick={back} sx={{ flexShrink: 0 }}>
      Back to {nav.origin.label}
    </Button>}
    {label && <Typography variant="caption" noWrap title={label} data-testid={gear ? 'maps-gear-focus' : 'maps-quest-focus'}>{gear ? 'Gear source' : 'Quest location'}: {label}</Typography>}
  </Stack>
}
