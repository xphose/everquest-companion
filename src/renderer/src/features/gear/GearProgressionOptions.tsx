import type { JSX } from 'react'
import { Accordion, AccordionDetails, AccordionSummary, Button, MenuItem, Stack, TextField, Typography } from '@mui/material'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import { GEAR_GOAL_LABELS, gearLevelBand, type GearProgressionOptions, type GearProgressionGoal } from '@shared/gearProgression'
import { PLAN_SLOTS, isAnyCell, planSlotLabel, type PlanSlotId } from '@shared/planner/types'

interface Props { options: GearProgressionOptions; level?: number; onChange: (next: GearProgressionOptions) => void }

/** Advanced planning stays behind one door; a band preview always names its exact evaluated level. */
export function GearProgressionOptionsPanel({ options, level, onChange }: Props): JSX.Element {
  const evaluated = options.level ?? level
  const band = evaluated ? gearLevelBand(evaluated) : null
  const update = (over: Partial<GearProgressionOptions>): void => onChange({ ...options, ...over })
  return <Accordion disableGutters elevation={0} sx={{ border: 1, borderColor: 'divider', borderRadius: '8px !important', '&:before': { display: 'none' } }}>
    <AccordionSummary expandIcon={<ExpandMoreIcon />} data-testid="gear-more-options">
      <Typography variant="body2" fontWeight={600}>More options</Typography>
    </AccordionSummary>
    <AccordionDetails>
      <Stack spacing={2}>
        <Typography variant="body2" color="text.secondary">Plan ahead or choose what matters to you. Your detected classes are always used together.</Typography>
        <Stack direction="row" useFlexGap flexWrap="wrap" gap={1.5}>
          <TextField select size="small" label="Level range" value={band?.max ?? ''} sx={{ minWidth: 145 }} data-testid="gear-band"
            onChange={event => update({ level: Number(event.target.value) })}>
            {!band && <MenuItem value="">Waiting for level</MenuItem>}
            {Array.from({ length: 10 }, (_, index) => (index + 1) * 5).map(max => <MenuItem key={max} value={max}>{max - 4} - {max}</MenuItem>)}
          </TextField>
          <TextField size="small" type="number" label="Exact level" value={evaluated ?? ''} sx={{ width: 115 }}
            slotProps={{ htmlInput: { min: 1, max: 50 } }} data-testid="gear-exact-level"
            onChange={event => { const value = Number(event.target.value); if (Number.isInteger(value) && value >= 1 && value <= 50) update({ level: value }) }} />
          <TextField select size="small" label="What matters most?" value={options.goal} sx={{ minWidth: 200 }} data-testid="gear-goal"
            onChange={event => update({ goal: event.target.value as GearProgressionGoal })}>
            {Object.entries(GEAR_GOAL_LABELS).map(([value, label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}
          </TextField>
          <TextField select size="small" label="Planning style" value={options.mode} sx={{ minWidth: 175 }} data-testid="gear-mode"
            onChange={event => update({ mode: event.target.value as GearProgressionOptions['mode'] })}>
            <MenuItem value="attainable">Achievable now</MenuItem><MenuItem value="potential">Maximum potential</MenuItem>
          </TextField>
        </Stack>
        <Stack direction="row" useFlexGap flexWrap="wrap" gap={1.5} alignItems="center">
          <TextField select size="small" label="Gear slot" value={options.slot ?? ''} sx={{ minWidth: 145 }} data-testid="gear-plan-slot"
            onChange={event => update({ slot: (event.target.value || undefined) as PlanSlotId | undefined })}>
            <MenuItem value="">Any normal slot</MenuItem>
            {PLAN_SLOTS.map(slot => !isAnyCell(slot) && <MenuItem key={slot} value={slot}>{planSlotLabel(slot)}</MenuItem>)}
          </TextField>
          <TextField select size="small" label="Upgrade target" value={options.targetTier ?? 1} disabled={options.mode !== 'potential'} sx={{ minWidth: 145 }} data-testid="gear-tier"
            onChange={event => update({ targetTier: Number(event.target.value) })}>
            {Array.from({ length: 11 }, (_, tier) => <MenuItem key={tier} value={tier}>+{tier}</MenuItem>)}
          </TextField>
          <TextField select size="small" label="Difficulty to learn about" value={options.difficulty ?? 0} sx={{ minWidth: 195 }} data-testid="gear-difficulty"
            onChange={event => update({ difficulty: Number(event.target.value) as 0 | 1 | 2 | 3 | 4 })}>
            {[0, 1, 2, 3, 4].map(value => <MenuItem key={value} value={value}>{value === 0 ? 'Normal' : `+${value}`}</MenuItem>)}
          </TextField>
          <Button onClick={() => onChange({ goal: 'auto', mode: 'attainable', targetTier: 1, difficulty: 0 })} data-testid="gear-follow-character">Follow my character</Button>
        </Stack>
        <Typography variant="caption" color="text.secondary" data-testid="gear-planning-level">
          {options.level ? `Previewing exact level ${options.level}. Choosing a range uses its last level.` : `Following your exact level${level ? `: ${level}` : ' when detected'}.`}
          {' '}Upgrade target applies to Maximum potential. Any Slot interactions need manual comparison. The difficulty choice adds drop-tier guidance to details; it does not change encounter ratings or guarantee an item.
        </Typography>
      </Stack>
    </AccordionDetails>
  </Accordion>
}
