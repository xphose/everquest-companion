import type { JSX } from 'react'
import { Button, MenuItem, Stack, TextField } from '@mui/material'
import type { QuestJournalFilter, QuestJournalQueryResult } from '@shared/questJournal/journal'
import { DEFAULT_JOURNAL_PREFS, type JournalPreferences } from './preferences'

const FILTERS: { value: QuestJournalFilter; label: string }[] = [
  { value: 'all', label: 'All quests' }, { value: 'tracked', label: 'Tracked' },
  { value: 'active', label: 'In progress' }, { value: 'ready', label: 'Ready to turn in' },
  { value: 'completed', label: 'Completed' }, { value: 'unknown', label: 'Not yet known' }
]

export function JournalFilters({ prefs, result, update }: {
  prefs: JournalPreferences
  result: QuestJournalQueryResult | null
  update: (change: Partial<JournalPreferences>) => void
}): JSX.Element {
  const filter = (change: Partial<JournalPreferences>): void => update({ ...change, offset: 0 })
  return (
    <Stack spacing={1} data-testid="quest-journal-filters">
      <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
        <TextField size="small" label="Search quests, rewards, NPCs" value={prefs.search}
          data-testid="quest-journal-search" sx={{ flex: '1 1 260px' }} onChange={(event) => filter({ search: event.target.value })} />
        <TextField select size="small" label="Show" value={prefs.state} sx={{ minWidth: 175 }}
          data-testid="quest-journal-status-filter" onChange={(event) => filter({ state: event.target.value as QuestJournalFilter })}>
          {FILTERS.map((option) => <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>)}
        </TextField>
        <TextField select size="small" label="Order" value={prefs.sort} sx={{ minWidth: 165 }}
          onChange={(event) => filter({ sort: event.target.value as JournalPreferences['sort'] })}>
          <MenuItem value="recommended">Suggested for you</MenuItem><MenuItem value="name">Quest name</MenuItem>
        </TextField>
      </Stack>
      <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
        <TextField select size="small" label="Zone" value={prefs.zone} sx={{ flex: '1 1 170px', maxWidth: 280 }}
          data-testid="quest-journal-zone-filter" onChange={(event) => filter({ zone: event.target.value })}>
          <MenuItem value="">All zones</MenuItem>
          {result?.zones.map((value) => <MenuItem key={value} value={value}>{value}</MenuItem>)}
        </TextField>
        <TextField select size="small" label="Class" value={prefs.className} sx={{ flex: '1 1 140px', maxWidth: 220 }}
          data-testid="quest-journal-class-filter" onChange={(event) => filter({ className: event.target.value })}>
          <MenuItem value="">All classes</MenuItem>
          {result?.classes.map((value) => <MenuItem key={value} value={value}>{value}</MenuItem>)}
        </TextField>
        <TextField size="small" type="number" label="Minimum level up to" value={prefs.level}
          data-testid="quest-journal-level-filter" sx={{ width: 165 }} slotProps={{ htmlInput: { min: 1, max: 125 } }}
          onChange={(event) => filter({ level: event.target.value })} />
        <Button size="small" onClick={() => update({ ...DEFAULT_JOURNAL_PREFS, selectedId: prefs.selectedId })}>Clear filters</Button>
      </Stack>
    </Stack>
  )
}
