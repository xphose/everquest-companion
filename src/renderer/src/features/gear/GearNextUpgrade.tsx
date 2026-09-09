import { useState, type JSX } from 'react'
import { Box, Button, Paper, Stack, Typography } from '@mui/material'
import MapIcon from '@mui/icons-material/Map'
import ArrowForwardIcon from '@mui/icons-material/ArrowForward'
import type { GearRecommendation } from '@shared/gearProgression'
import type { MapFocus } from '../maps/mapFocus'
import { friendlySlot, GearEffortChip, GearProgressionIcon } from './GearProgressionAtoms'
import { gearMapFocus } from './gearProgressionNavigation'
import { GearRecommendationDetails } from './GearRecommendationDetails'

export interface GearNextUpgradeProps {
  recommendation: GearRecommendation
  easier?: GearRecommendation
  scrapedAt: string | null
  limits: string[]
  onChoose: (rec: GearRecommendation) => void
  onOpenMap?: (target: MapFocus) => void
  onOpenLoot?: (name: string) => void
}

function actionLabel(rec: GearRecommendation): string {
  if (rec.action === 'improve') return 'Improve what you have'
  if (rec.action === 'equip') return 'Check your inventory'
  return rec.comparisonKnown ? 'Next upgrade' : 'An item to consider'
}

function sourceSentence(rec: GearRecommendation): string {
  if (rec.action === 'improve') return 'Use spare copies to improve this item.'
  if (rec.action === 'equip') return 'Your inventory export already lists this item.'
  if (!rec.source) return 'Where to get it is not yet confirmed.'
  return `${rec.source.kind === 'quest' ? 'Quest: ' : 'Dropped by '}${rec.source.name}${rec.source.zone ? ` in ${rec.source.zone}` : ''}.`
}

function mapHint(target: MapFocus | null): string {
  if (!target) return 'A map is available when a source zone is known.'
  return target.at ? 'Opens the source zone and marks its recorded location.' : 'Opens the source zone. Exact coordinates are not recorded.'
}

/** One real next step. Details explain the evidence without crowding the action. */
export function GearNextUpgrade({ recommendation: rec, easier, scrapedAt, limits, onChoose, onOpenMap, onOpenLoot }: GearNextUpgradeProps): JSX.Element {
  const target = gearMapFocus(rec.source)
  const [expanded, setExpanded] = useState(false)
  return <Paper variant="outlined" data-testid="gear-next-upgrade" data-recommendation-id={rec.id}
    sx={{ p: { xs: 2, md: 3 }, borderRadius: 3, borderColor: 'primary.main', borderTopWidth: 3,
      backgroundImage: theme => `linear-gradient(125deg, ${theme.palette.action.hover}, transparent 70%)` }}>
    <Stack spacing={2}>
      <Stack direction="row" useFlexGap gap={2} alignItems="center">
        <GearProgressionIcon iconId={rec.item.iconId} />
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="overline" color="text.secondary">{actionLabel(rec)} · {friendlySlot(rec.slot)}</Typography>
          <Typography variant="h5" fontWeight={750} sx={{ overflowWrap: 'anywhere' }} data-testid="gear-recommendation-name">{rec.item.name}{rec.tier > 0 ? ` +${rec.tier}` : ''}</Typography>
        </Box>
      </Stack>
      <Typography variant="h6" sx={{ lineHeight: 1.45, fontWeight: 500 }} data-testid="gear-recommendation-benefit">{rec.benefit}</Typography>
      <Stack spacing={0.75} alignItems="flex-start">
        <Typography variant="body1" data-testid="gear-recommendation-source">
          {sourceSentence(rec)}
        </Typography>
        <GearEffortChip effort={rec.effort} />
      </Stack>
      <Stack direction="row" useFlexGap flexWrap="wrap" gap={1.5}>
        {rec.action === 'find' ? <Button size="large" variant="contained" startIcon={<MapIcon />} disabled={!target || !onOpenMap}
          onClick={() => { if (target) onOpenMap?.(target) }} data-testid="gear-show-where" sx={{ minHeight: 48, textTransform: 'none', px: 3 }}>Show me where</Button>
          : <Button size="large" variant="contained" onClick={() => setExpanded(true)} data-testid="gear-show-how" sx={{ minHeight: 48, textTransform: 'none', px: 3 }}>{rec.action === 'improve' ? 'Show me how' : 'Why this item?'}</Button>}
        {easier && <Button size="large" variant="outlined" endIcon={<ArrowForwardIcon />} onClick={() => onChoose(easier)} data-testid="gear-something-easier"
          sx={{ minHeight: 48, textTransform: 'none' }}>Something easier</Button>}
      </Stack>
      {rec.action === 'find' && <Typography variant="caption" color="text.secondary">{mapHint(target)}</Typography>}
      <GearRecommendationDetails recommendation={rec} scrapedAt={scrapedAt} limits={limits} onOpenLoot={onOpenLoot} expanded={expanded} onExpand={setExpanded} />
    </Stack>
  </Paper>
}
