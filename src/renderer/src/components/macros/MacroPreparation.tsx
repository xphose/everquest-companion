import type { JSX } from 'react'
import { Accordion, AccordionDetails, AccordionSummary, Alert, Box, Button, Checkbox, Chip, FormControlLabel, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import BackpackIcon from '@mui/icons-material/Backpack'
import type { MacroPreparationSnapshot } from '@shared/macroPreparation'
import { changePreparationSelection, foodDrinkPreset } from '../../../../shared/macros/preparation'
import { preparationSpellLabel } from '../../../../shared/macros/preparationOptions'
import { MacroPreparationPlan } from './MacroPreparationPlan'
import { MacroPreparationStatus } from './MacroPreparationStatus'
import { useMacroPreparation } from './useMacroPreparation'

function UtilityChoices({ preparation, selected, busy, select }: {
  preparation: MacroPreparationSnapshot; selected: number[]; busy: boolean; select: (ids: number[]) => void
}): JSX.Element {
  return <Accordion disableGutters elevation={0} sx={{ border: 1, borderColor: 'divider', '&:before': { display: 'none' } }}>
    <AccordionSummary expandIcon={<ExpandMoreIcon />} data-testid="macros-preparation-options"><Typography variant="body2">Choose other utility spells ({preparation.options.length})</Typography></AccordionSummary>
    <AccordionDetails><Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 0.5 }}>
      {preparation.options.map((option) => <FormControlLabel key={option.spellId} sx={{ alignItems: 'flex-start', m: 0 }} control={<Checkbox size="small"
        checked={selected.includes(option.spellId)} disabled={busy || !selected.includes(option.spellId) && selected.length >= 4}
        onChange={(_, checked) => select(changePreparationSelection(selected, option.spellId, checked))}
        slotProps={{ input: { 'aria-label': `Prepare ${option.name}`, ...{ 'data-testid': `macros-preparation-select-${option.spellId}` } } }} />}
        label={<Box><Typography variant="body2">{option.name}</Typography><Typography variant="caption" color="text.secondary">{option.category} · {option.classes.join(' / ')}</Typography></Box>} />)}
    </Box></AccordionDetails>
  </Accordion>
}

export function MacroPreparation({ preparation, busy, prepare }: {
  preparation: MacroPreparationSnapshot; busy: boolean; prepare: (spellIds: number[], destination: { bar: number; page: number }) => void
}): JSX.Element {
  const { selected, destination, setChoice, setTarget, captureAllowed, result, preview, shown } = useMacroPreparation(preparation)
  const canQueue = !busy && captureAllowed && result?.ok === true
  return <Paper variant="outlined" data-testid="macros-preparation" sx={{ p: 2, borderColor: 'primary.dark' }}><Stack spacing={1.5}>
    <Stack direction="row" gap={1} alignItems="center" flexWrap="wrap" useFlexGap><BackpackIcon color="primary" /><Typography variant="h6">Adventure preparation</Typography>
      <Chip size="small" variant="outlined" label={`${selected.length}/4 utilities`} /></Stack>
    <Typography variant="body2" color="text.secondary">Make supplies or prepare useful spells, then return to your captured combat gems. Each button is pressed by you in game.</Typography>
    <Stack direction="row" gap={1} flexWrap="wrap" useFlexGap>
      <Button size="small" variant="outlined" data-testid="macros-preparation-food-drink" disabled={busy || foodDrinkPreset(preparation.options).length === 0}
        onClick={() => setChoice(foodDrinkPreset(preparation.options))}>Food &amp; drink preset</Button>
      {selected.map((id) => <Chip key={id} label={preparationSpellLabel(preparation, id)} size="small" onDelete={busy ? undefined : () => setChoice(changePreparationSelection(selected, id, false))} />)}
    </Stack>
    <UtilityChoices preparation={preparation} selected={selected} busy={busy} select={setChoice} />
    <Stack direction="row" gap={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
      <TextField select size="small" label="Prep hotbar" value={destination.bar} disabled={busy} sx={{ width: 115 }} data-testid="macros-preparation-bar"
        onChange={(event) => setTarget({ ...destination, bar: Number(event.target.value) })}>
        {Array.from({ length: 10 }, (_, i) => <MenuItem key={i + 1} value={i + 1}>{i + 1}</MenuItem>)}
      </TextField>
      <TextField select size="small" label="Prep page" value={destination.page} disabled={busy} sx={{ width: 105 }} data-testid="macros-preparation-page"
        onChange={(event) => setTarget({ ...destination, page: Number(event.target.value) })}>
        {Array.from({ length: 10 }, (_, i) => <MenuItem key={i + 1} value={i + 1}>{i + 1}</MenuItem>)}
      </TextField>
      <Button variant="contained" size="small" data-testid="macros-preparation-queue" disabled={!canQueue}
        onClick={() => prepare(selected, destination)}>{busy ? 'Updating…' : 'Queue preparation'}</Button>
    </Stack>
    <MacroPreparationStatus preparation={preparation} />
    <Typography variant="caption" color="text.secondary">Queue captures the combat gems you have now. Keep the companion open when exiting EverQuest so it can save the package. Existing combat macro selections stay unchanged.</Typography>
    {result && !result.ok && <Alert severity="info">{result.reasons.map((reason) => <Typography key={reason} variant="body2">{reason}</Typography>)}</Alert>}
    {!captureAllowed && <Typography variant="body2" color="warning.main" data-testid="macros-preparation-restore-first">Wait for a fresh combat layout before capturing another package. Restore Combat first if utility gems are active.</Typography>}
    {shown && <MacroPreparationPlan plan={shown} installation={preparation.installation} preview={preview} />}
  </Stack></Paper>
}
