import { useMemo } from 'react'
import { isClassAbbr, resolvedClasses, type ClassAbbr } from '@shared/classCombo'
import { currentPlayerClasses } from '@shared/currentPlayer'
import type { CharacterSnap } from '@shared/types'
import { useModule } from '../../lib/useModule'
import { useComboSnap } from '../profiles/ClassComboData'
import { usePlayerLocation } from '../maps/usePlayerLocation'

/** A mounted Gear view asks the same current-player worker as Maps and journal. The native
 * selection wins only while fresh; the existing combo remains the fallback and history owner. */
export function useDetectedGearClasses(): { classes: ClassAbbr[]; source: 'live' | 'log' } {
  const current = useComboSnap().current
  const characterName = useModule<CharacterSnap>('character')?.character?.name
  const player = usePlayerLocation(Boolean(characterName), characterName)
  const nativeKey = currentPlayerClasses(player.result, characterName, Date.now())?.join('/') ?? ''
  // Repeated position samples with unchanged classes must not refilter the entire gear corpus.
  return useMemo(() => nativeKey
    ? { classes: nativeKey.split('/').filter(isClassAbbr), source: 'live' }
    : { classes: current ? resolvedClasses(current) : [], source: 'log' }, [nativeKey, current])
}
