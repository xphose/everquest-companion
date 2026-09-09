import type { JSX } from 'react'
import { Accordion, AccordionDetails, AccordionSummary, Alert, Box, Button, Chip, Stack, Typography } from '@mui/material'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import type { GearOwnedAdvice, GearRecommendation } from '@shared/gearProgression'
import { GearMergeDetails, friendlySlot } from './GearProgressionAtoms'
import type { GearInventoryReading } from './useGearProgressionData'

const LABELS: Record<GearOwnedAdvice['action'], string> = { keep: 'Keep', improve: 'Improve', replace: 'Replace', unknown: 'Needs details' }

export function GearInventoryNotice({ reading }: { reading: GearInventoryReading }): JSX.Element {
  if (!reading.ready) return <Alert severity="info">Reading your equipment export…</Alert>
  if (reading.error) return <Alert severity="warning">{reading.error} Run <strong>/outputfile inventory</strong> in game to try again.</Alert>
  if (!reading.inventory) return <Alert severity="info" data-testid="gear-inventory-missing">
    Let’s see what you own. Type <strong>/outputfile inventory</strong> in game. Your equipment and spare copies will appear here automatically.
  </Alert>
  return <Typography variant="caption" color="text.secondary" data-testid="gear-inventory-date">
    Equipment export: {new Date(reading.inventory.loadedAt).toLocaleString()}. Run /outputfile inventory after changing gear; this page updates automatically.
  </Typography>
}

function OwnedRow({ advice, onChoose }: { advice: GearOwnedAdvice; onChoose: (rec: GearRecommendation) => void }): JSX.Element {
  return <Accordion disableGutters elevation={0} data-testid="gear-owned-row" data-slot={advice.slot}
    sx={{ border: 1, borderColor: 'divider', borderRadius: '8px !important', '&:before': { display: 'none' } }}>
    <AccordionSummary expandIcon={<ExpandMoreIcon />}>
      <Stack direction="row" alignItems="center" useFlexGap gap={1.5} sx={{ width: '100%', minWidth: 0 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="caption" color="text.secondary">{friendlySlot(advice.slot)}</Typography>
          <Typography variant="body1" fontWeight={600} sx={{ overflowWrap: 'anywhere' }}>{advice.name}{advice.tier === undefined ? '' : ` +${advice.tier}`}</Typography>
          <Typography variant="body2" color="text.secondary">{advice.benefit}</Typography>
        </Box>
        <Chip label={LABELS[advice.action]} size="small" color={advice.action === 'keep' ? 'success' : advice.action === 'unknown' ? 'default' : 'primary'} variant="outlined" />
      </Stack>
    </AccordionSummary>
    <AccordionDetails>
      <Stack spacing={1}>
        {advice.reasons.map(text => <Typography variant="body2" key={text}>{text}</Typography>)}
        {advice.merge && <GearMergeDetails merge={advice.merge} />}
        {advice.recommendation && <Button variant="outlined" sx={{ alignSelf: 'flex-start' }} onClick={() => { if (advice.recommendation) onChoose(advice.recommendation) }}>See this upgrade</Button>}
      </Stack>
    </AccordionDetails>
  </Accordion>
}

export function GearOwnedProgression({ advice, reading, onChoose }: { advice: GearOwnedAdvice[]; reading: GearInventoryReading; onChoose: (rec: GearRecommendation) => void }): JSX.Element {
  return <Stack spacing={1.5} data-testid="gear-owned-view">
    <Typography variant="h5" fontWeight={700}>Make the most of your gear</Typography>
    <Typography color="text.secondary">Keep useful items. Improve the ones worth growing. Replace them when a better choice is known.</Typography>
    <GearInventoryNotice reading={reading} />
    {reading.inventory && advice.map(item => <OwnedRow key={item.id} advice={item} onChoose={onChoose} />)}
    {reading.inventory && advice.length === 0 && <Alert severity="info">This export has no recorded worn items to compare. Check that you exported inventory for the current character.</Alert>}
  </Stack>
}
