import type { BuffAllowPrefs } from '../../../shared/buffAllow'
import { activeEffectRows, observedActiveBuffs } from '../../../shared/activeBuffs'
import { useOverlayPlayer } from './useOverlayPlayer'
import { useActiveBuffNames } from './useActiveBuffNames'

/** Shares the overlay's existing current-player reader; debuffs need no native self observation. */
export function useActiveSelfEffects(enabled: boolean, allow: BuffAllowPrefs, now: number) {
  const player = useOverlayPlayer(enabled)
  // A native reply can be newer than the last display tick; validate freshness against wall time.
  const observation = observedActiveBuffs(player, player?.characterName, Date.now())
  const names = useActiveBuffNames(observation)
  const rows = activeEffectRows(observation, names, allow, now)
  return { live: observation !== null, rows, hidden: (observation?.effects.length ?? 0) - rows.length,
    epoch: JSON.stringify([observation?.characterName ?? '', observation !== null]) }
}
