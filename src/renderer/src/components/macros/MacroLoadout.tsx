import type { JSX } from 'react'
import { Accordion, AccordionDetails, AccordionSummary, Alert, Box, Chip, Paper, Stack, Typography } from '@mui/material'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import MenuBookIcon from '@mui/icons-material/MenuBook'
import type { MacroAssistantSnapshot } from '@shared/macroAssistant'
import type { MacroLoadoutPlan, MacroLoadoutSlot } from '@shared/macros'

const ACTIONS: Record<MacroLoadoutSlot['action'], string> = {
  keep: 'Keep', memorize: 'Memorize', replace: 'Replace', empty: 'Empty'
}

function GemRow({ slot }: { slot: MacroLoadoutSlot }): JSX.Element {
  const current = slot.currentName ?? (slot.currentSpellId ? `Spell ${slot.currentSpellId}` : 'Empty')
  const recommended = slot.name ?? (slot.spellId ? `Spell ${slot.spellId}` : 'Leave empty')
  return <Box data-testid={`macros-loadout-gem-${slot.gem}`} data-action={slot.action} sx={{ p: 1.25,
    border: 1, borderColor: slot.required ? 'primary.dark' : 'divider', borderRadius: 1 }}>
    <Stack direction={{ xs: 'column', sm: 'row' }} gap={1.25} alignItems={{ xs: 'stretch', sm: 'center' }}>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 150 }}>
        <Typography variant="subtitle2">Gem {slot.gem}</Typography>
        <Chip size="small" variant="outlined" color={slot.action === 'keep' ? 'success' : 'default'} label={ACTIONS[slot.action]} />
      </Stack>
      <Box sx={{ flex: 1, minWidth: 0 }}><Typography variant="caption" color="text.secondary">Current</Typography>
        <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{current}</Typography></Box>
      <Box sx={{ flex: 1, minWidth: 0 }}><Typography variant="caption" color="text.secondary">Recommended{slot.required ? ' for selected macros' : ''}</Typography>
        <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{recommended}</Typography></Box>
    </Stack>
  </Box>
}

function PlanDetails({ plan }: { plan: MacroLoadoutPlan }): JSX.Element {
  return <>
      {plan.overflow > 0 && <Alert severity="warning">{plan.overflow} more spell {plan.overflow === 1 ? 'slot is' : 'slots are'} needed for this entire set. Deselect some macros or share spells across roles.</Alert>}
      {plan.omitted.length > 0 && <Box>
        <Typography variant="subtitle2">Spells left out</Typography>
        {plan.omitted.map((spell) => <Typography key={spell.id} variant="body2" color="warning.main">{spell.name}: {spell.reason}</Typography>)}
      </Box>}
      {plan.slots.length > 0 && <Accordion disableGutters elevation={0} sx={{ border: 1, borderColor: 'divider', '&:before': { display: 'none' } }}>
        <AccordionSummary expandIcon={<ExpandMoreIcon />} data-testid="macros-loadout-expand" aria-controls="macros-loadout-gems" id="macros-loadout-summary">
          <Typography variant="body2">Gem-by-gem recommendation</Typography>
        </AccordionSummary>
        <AccordionDetails id="macros-loadout-gems" sx={{ pt: 0 }}><Stack spacing={0.75}>{plan.slots.map((slot) => <GemRow key={slot.gem} slot={slot} />)}</Stack></AccordionDetails>
      </Accordion>}
  </>
}

export function MacroLoadout({ snapshot }: { snapshot: MacroAssistantSnapshot }): JSX.Element {
  const plan = snapshot.loadout
  return <Paper variant="outlined" data-testid="macros-loadout" data-state={plan?.state ?? 'unavailable'} sx={{ p: 1.5 }}>
    <Stack spacing={1.25}>
      <Stack direction="row" gap={1} alignItems="center" flexWrap="wrap" useFlexGap>
        <MenuBookIcon color="primary" fontSize="small" /><Typography variant="h6">Spell loadout</Typography>
        <Chip size="small" variant="outlined" label={`${snapshot.settings.selections.length} selected macros`} />
        {plan && <Chip size="small" variant="outlined" label={`${plan.requiredSpellCount} distinct spells`} />}
        <Chip size="small" variant="outlined" label={plan?.availableSlots === undefined ? 'Slot capacity unknown' : `${plan.availableSlots} usable gems`} />
      </Stack>
      <Typography variant="body2" color="text.secondary">{plan?.message ?? 'Open this character in game to read the unlocked spell slots and recommend a loadout.'}</Typography>
      {plan && <PlanDetails plan={plan} />}
      <Typography variant="caption" color="text.secondary">Macros can share spells, so each distinct spell needs only one gem. Select a macro marked Needs memorizing to plan toward it. Memorize the recommended spells in game; the companion detects changes automatically. Only ready macros install after EverQuest closes.</Typography>
    </Stack>
  </Paper>
}
