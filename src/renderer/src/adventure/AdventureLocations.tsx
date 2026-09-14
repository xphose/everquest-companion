import type { JSX } from 'react'
import { Button, Stack, Typography } from '@mui/material'
import type { QuestJournalLocation } from '@shared/questJournal/catalog'
import { journalMapFocus, locationText } from '../features/questJournal/navigation'
import type { MapFocus } from '../features/maps/mapFocus'

export function AdventureLocations({ locations, onMap }: { locations: QuestJournalLocation[]; onMap: (target: MapFocus) => void }): JSX.Element {
  return <Stack spacing={0.75}>
    {locations.length === 0 && <Typography variant="caption" color="text.secondary">The source does not identify a location.</Typography>}
    {locations.map((location, index) => {
      const focus = journalMapFocus(location, location.loc?.[0])
      return <Stack key={`${location.name}-${index}`} spacing={0.25}>
        <Typography variant="body2">{location.name}{location.zone ? ` · ${location.zone}` : ''}</Typography>
        <Stack direction="row" spacing={0.75} alignItems="center" useFlexGap flexWrap="wrap">
          {focus && <Button size="small" variant="outlined" onClick={() => onMap(focus)} data-testid="adventure-quest-map">Show on map</Button>}
          <Typography variant="caption" color="text.secondary">{location.loc?.[0] ? `/loc ${locationText(location.loc[0])}` : 'Exact position unknown'}</Typography>
        </Stack>
        {location.note && <Typography variant="caption" color="text.secondary">{location.note}</Typography>}
      </Stack>
    })}
  </Stack>
}
