import { useCallback, useEffect, useState } from 'react'
import type { PlayerLocation } from '@shared/playerLocation'
import { usePlayerLocation } from './usePlayerLocation'
import { mapFromLoc } from './mapGeometry'
import type { MapViewport } from './useMapViewport'

function useMapToggle(key: string): [boolean, (value: boolean) => void] {
  const [value, setValue] = useState(() => localStorage.getItem(key) !== '0')
  const change = useCallback((next: boolean) => {
    localStorage.setItem(key, next ? '1' : '0')
    setValue(next)
  }, [key])
  return [value, change]
}

export function useMapPlayer(characterName: string | undefined) {
  const [enabled, setEnabled] = useMapToggle('eq.maps.live')
  const [centered, setCentered] = useMapToggle('eq.maps.centerPlayer')
  const live = usePlayerLocation(enabled, characterName)
  const [centerRequest, setCenterRequest] = useState(0)
  const center = (): void => { setCentered(true); setCenterRequest((value) => value + 1) }
  return { ...live, enabled, setEnabled, centered, setCentered, centerRequest, center }
}

export function usePlayerCentering(
  location: PlayerLocation | null,
  { centered, centerRequest }: { centered: boolean; centerRequest: number },
  vp: MapViewport
): void {
  const { ns, ew } = location ?? {}
  const { centerOn, size, zoomedIn, view } = vp
  const scale = zoomedIn ? undefined : view.scale * 3
  useEffect(() => {
    if (!centered || ns === undefined || ew === undefined || size.w <= 0 || size.h <= 0) return
    const point = mapFromLoc({ ns, ew, z: 0 })
    centerOn(point.x, point.y, scale)
  }, [centered, centerRequest, ns, ew, centerOn, size.w, size.h, scale])
}
