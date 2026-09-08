import type { JSX } from 'react'
import { Accordion, AccordionDetails, AccordionSummary, Box, Chip, Stack, Typography } from '@mui/material'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import type { MacroPreparationPlan as Plan, MacroPreparationSnapshot } from '@shared/macroPreparation'
import { MacroCommands } from './MacroRecipeCard'

export function MacroPreparationPlan({ plan, installation, preview }: {
  plan: Plan; installation?: MacroPreparationSnapshot['installation']; preview: boolean
}): JSX.Element {
  return <Stack spacing={1}>
    <Typography variant="subtitle2">{preview ? 'Preview of the next package' : 'Captured preparation package'}</Typography>
    <Typography variant="body2" color="text.secondary">{plan.utilities.length} utility buttons · {plan.replacements.length} temporary gem swaps · {plan.classes.join(' / ')}</Typography>
    {plan.replacements.length === 0 ? <Typography variant="body2">These utilities already occupy their gems. This package needs no Load Prep or Restore Combat buttons.</Typography>
      : <Box component="ol" sx={{ my: 0, pl: 2.5, '& li': { mb: 0.5 } }}>
        <li><Typography variant="body2">Press <strong>Load Prep</strong> in game, then wait for <strong>Utility spells are ready</strong> below.</Typography></li>
        <li><Typography variant="body2">{plan.suppliesButton ? <>Press <strong>Make Supplies</strong> to make food and drink, or use their individual buttons for one item.</> : 'Press the utility buttons below as needed.'} You control every cast.</Typography></li>
        <li><Typography variant="body2">Press <strong>Restore Combat</strong>, then wait for <strong>Combat gems are restored</strong>.</Typography></li>
      </Box>}
    <Accordion disableGutters elevation={0} sx={{ border: 1, borderColor: 'divider', '&:before': { display: 'none' } }}>
      <AccordionSummary expandIcon={<ExpandMoreIcon />} data-testid="macros-preparation-details"><Typography variant="body2">Review gem swaps and exact button commands</Typography></AccordionSummary>
      <AccordionDetails><Stack spacing={1.5}>
        {plan.replacements.map((slot) => <Typography key={slot.gem} variant="body2" data-testid={`macros-preparation-gem-${slot.gem}`}>
          <strong>Gem {slot.gem}:</strong> {slot.originalName ?? `Spell ${slot.originalSpellId}`} → {slot.name} → restore {slot.originalName ?? `Spell ${slot.originalSpellId}`}
        </Typography>)}
        {plan.suppliesButton && <Stack spacing={0.5} data-testid="macros-preparation-supplies">
          <Typography variant="subtitle2">Make Supplies · {plan.suppliesButton.mana} mana</Typography>
          <MacroCommands lines={plan.suppliesButton.lines} />
          <Typography variant="caption" color="text.secondary">Makes food, stows it, then makes drink and stows it. Keep the cursor clear and leave free bag space; repeat an individual button if its cast fizzles.</Typography>
        </Stack>}
        {plan.utilities.map((utility) => <Stack key={utility.spellId} spacing={0.5}>
          <Stack direction="row" gap={1} alignItems="center" flexWrap="wrap" useFlexGap><Chip size="small" label={utility.buttonName} />
            <Typography variant="body2">{utility.name} · Gem {utility.gem} · {utility.mana} mana</Typography></Stack>
          <MacroCommands lines={utility.lines} />
          {utility.guidance.map((message) => <Typography key={message} variant="caption" color="text.secondary">{message}</Typography>)}
        </Stack>)}
        {!preview && installation?.buttons && <Box>
          <Typography variant="subtitle2">Saved hotbuttons</Typography>
          {installation.buttons.map((button) => <Box key={button.id} sx={{ mt: 1 }}><Typography variant="body2">{button.name}</Typography><MacroCommands lines={button.lines} /></Box>)}
        </Box>}
      </Stack></AccordionDetails>
    </Accordion>
  </Stack>
}
