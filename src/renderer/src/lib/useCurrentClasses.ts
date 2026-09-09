import { useMemo } from 'react'
import type { CharacterSnap } from '@shared/types'
import { currentClassFacts, currentClassesOf, type CurrentClasses } from '@shared/currentClasses'
import { useComboSnap } from '../features/profiles/ClassComboData'
import { useOverlayPlayer } from '../overlay/useOverlayPlayer'
import { useModule } from './useModule'

/** All current-only class displays use the same reader and selection rules. Its main-process
 * worker is shared; the session rejects superseded character replies and expires stalled reads. */
export function useCurrentClasses(): CurrentClasses {
  const logged = useComboSnap().current
  const characterName = useModule<CharacterSnap>('character')?.character?.name
  const player = useOverlayPlayer(Boolean(characterName), window.eq)
  const { classKey, level } = currentClassFacts(player, characterName, Date.now())
  // Position/timestamp-only samples must not refilter entire item or spell catalogs.
  return useMemo(() => currentClassesOf(logged, { classKey, level }), [logged, classKey, level])
}
