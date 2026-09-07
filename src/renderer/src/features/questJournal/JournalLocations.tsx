import type { JSX } from 'react'
import { Box, Button, Link, Stack, Typography } from '@mui/material'
import MapIcon from '@mui/icons-material/Map'
import type { QuestJournalLocation } from '@shared/questJournal/catalog'
import { journalMapFocus, journalMobTarget, locationText, type JournalNavigation } from './navigation'

function LocationRow({ location, navigation }: { location: QuestJournalLocation; navigation: JournalNavigation }): JSX.Element {
  const zoneTarget = journalMapFocus(location)
  return (
    <Box sx={{ py: 0.75 }} data-testid="quest-journal-location">
      <Stack direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap">
        <Link component="button" underline="hover" onClick={() => navigation.openMob(journalMobTarget(location))}
          sx={{ textAlign: 'left', overflowWrap: 'anywhere' }}>{location.name}</Link>
        <Typography variant="body2" color="text.secondary">{location.zone ?? 'Zone unknown'}{location.level ? ` · Level ${location.level}` : ''}</Typography>
        {zoneTarget && !location.loc?.length && <Button size="small" startIcon={<MapIcon />} onClick={() => navigation.openMap(zoneTarget)}>Zone map</Button>}
      </Stack>
      <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap">
        {location.loc?.map((point, index) => {
          const target = journalMapFocus(location, point)
          return <Button key={index} size="small" startIcon={<MapIcon />} disabled={!target}
            data-testid="quest-journal-map-link" onClick={() => { if (target) navigation.openMap(target) }}
            sx={{ textTransform: 'none', fontFamily: 'monospace' }}>/loc {locationText(point)}</Button>
        })}
      </Stack>
      {location.note && <Typography variant="caption" color="text.secondary">{location.note}</Typography>}
      {!location.loc?.length && <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>Exact coordinates are not recorded.</Typography>}
    </Box>
  )
}

export function JournalLocations({ locations, navigation, empty = 'Location not recorded in this source.' }: {
  locations: QuestJournalLocation[]; navigation: JournalNavigation; empty?: string
}): JSX.Element {
  return <Box sx={{ minWidth: 0, maxHeight: 320, overflow: 'auto' }}>
    {locations.length ? locations.map((location, index) => <LocationRow key={`${location.page ?? location.name}:${index}`} location={location} navigation={navigation} />)
      : <Typography variant="body2" color="text.secondary">{empty}</Typography>}
  </Box>
}
