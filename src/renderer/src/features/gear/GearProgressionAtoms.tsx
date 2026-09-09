import type { JSX } from 'react'
import { Box, Chip, Stack, Typography } from '@mui/material'
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome'
import type { GearMergeAdvice, GearRecommendation } from '@shared/gearProgression'
import { planSlotLabel, type PlanSlotId } from '@shared/planner/types'
import { itemIconUrl } from '../../lib/ItemWindow'

export const friendlySlot = (slot: PlanSlotId): string => planSlotLabel(slot).toLowerCase().replace(/^./, letter => letter.toUpperCase())

export function GearProgressionIcon({ iconId }: { iconId?: number }): JSX.Element {
  return <Box sx={{ width: 64, height: 64, flexShrink: 0, border: 1, borderColor: 'divider', borderRadius: 2,
    display: 'grid', placeItems: 'center', bgcolor: 'action.hover' }}>
    {iconId === undefined ? <AutoAwesomeIcon color="primary" sx={{ fontSize: 32 }} /> : <Box component="img"
      src={itemIconUrl(iconId)} alt="" sx={{ width: 48, height: 48, imageRendering: 'pixelated' }}
      onError={(event: React.SyntheticEvent<HTMLImageElement>) => { event.currentTarget.style.visibility = 'hidden' }} />}
  </Box>
}

const EFFORT: Record<GearRecommendation['effort'], string> = {
  owned: 'Already yours', easier: 'Lower-level source', 'near-level': 'Near your level', harder: 'Higher-level source', unknown: 'Difficulty unknown'
}
export function GearEffortChip({ effort }: { effort: GearRecommendation['effort'] }): JSX.Element {
  return <Chip size="small" variant="outlined" label={EFFORT[effort]} title={effort === 'owned' ? 'Listed in your inventory export.' : 'An estimate from recorded source levels, not a guarantee that the fight is safe.'} />
}

export function GearMergeDetails({ merge }: { merge: GearMergeAdvice }): JSX.Element {
  const range = merge.xp.min === merge.xp.max ? String(merge.xp.min) : `${merge.xp.min} - ${merge.xp.max}`
  return <Stack spacing={0.75} data-testid="gear-merge-details">
    <Typography variant="subtitle2">Improve +{merge.fromTier} → +{merge.toTier}</Typography>
    <Typography variant="body2">{merge.benefit}</Typography>
    <Typography variant="body2">{range} upgrade XP needed. Your export lists {merge.availableCopies} spare {merge.availableCopies === 1 ? 'copy' : 'copies'} ({merge.availableXp} XP).</Typography>
    {merge.unlocks.map(text => <Typography variant="body2" key={text}>{text}</Typography>)}
    {merge.warnings.map(text => <Typography variant="caption" color="text.secondary" key={text}>{text}</Typography>)}
    <Typography variant="caption" color="text.secondary">Check the in-game merge preview before using an item. Exaltations has the advanced effect-transfer planner.</Typography>
  </Stack>
}
