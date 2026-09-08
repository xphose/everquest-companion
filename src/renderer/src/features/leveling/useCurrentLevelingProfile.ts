import { useMemo } from 'react'
import type { ProgressionSnap } from '../../../../shared/types'
import { useStatedLevel } from './useStatedLevel'
import { useOverlayPlayer } from '../../overlay/useOverlayPlayer'
import { currentLevelingProfile } from './currentLevelingProfile'

export function useCurrentLevelingProfile(prog: ProgressionSnap) {
  const logged = useStatedLevel(prog)
  const player = useOverlayPlayer(true, window.eq)
  return useMemo(() => currentLevelingProfile(logged, player), [logged, player])
}
