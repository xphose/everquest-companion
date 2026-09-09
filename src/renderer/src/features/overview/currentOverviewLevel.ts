import type { OverviewLevelingState } from './overviewLevelingData'

function validLevel(level: number | undefined): level is number {
  return level !== undefined && Number.isInteger(level) && level >= 1 && level <= 125
}

/** A current level changes the headline, never the measured hour or level-up history. A
 * different level invalidates an ETA anchored in the old log; memory does not supply XP %. */
export function currentOverviewLevel(
  logged: OverviewLevelingState, liveLevel: number | undefined, anchor: number | undefined
): OverviewLevelingState {
  const native = validLevel(liveLevel)
  const level = native ? liveLevel : logged.level
  const levelCue = native ? 'Live' : `From log${logged.levelCue ? ` · ${logged.levelCue}` : ''}`
  const levelTitle = native ? 'Current level read from the active game character.' : logged.levelTitle
  const waiting = native && (liveLevel !== logged.level || liveLevel !== anchor)
  const tiles = logged.tiles.filter(tile => !waiting || tile.id !== 'eta').map(tile => tile.id === 'level'
    ? { ...tile, value: String(level), label: `level · ${levelCue}`, title: levelTitle } : tile)
  if (native && !tiles.some(tile => tile.id === 'level')) {
    tiles.unshift({ id: 'level', value: String(level), unit: '', label: 'level · Live', title: levelTitle })
  }
  return {
    ...logged, level, levelCue, levelTitle, tiles,
    eta: waiting ? null : logged.eta,
    etaTitle: waiting ? `Awaiting logged progress at level ${liveLevel}; the previous level cannot locate your current experience bar.` : logged.etaTitle
  }
}
