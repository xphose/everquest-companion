import { useMemo } from 'react'
import type { ProgressionSnap } from '../../../../shared/types'
import { useStatedLevel } from './useStatedLevel'
import { useCurrentClasses } from '../../lib/useCurrentClasses'

export function useCurrentLevelingProfile(prog: ProgressionSnap) {
  const logged = useStatedLevel(prog)
  const current = useCurrentClasses()
  return useMemo(() => ({
    level: current.liveLevel === undefined ? { ...logged, cue: `From log${logged.cue ? ` · ${logged.cue}` : ''}` }
      : { level: current.liveLevel, cue: 'Live', title: 'Current level read from the active game character.' },
    classes: current.source === 'live' ? current.combo : null
  }), [logged, current])
}
