import { useId, useState, type JSX } from 'react'
import { Alert, Box, Button, Link, Stack, Tab, Tabs, Typography } from '@mui/material'
import type { QuestJournalCatalogEntry } from '@shared/questJournal/catalog'
import { formatDate } from '../../lib/formatDate'
import { JournalLocations } from './JournalLocations'
import type { JournalNavigation } from './navigation'

const REFERENCE_TABS = ['Guide', 'People', 'Items'] as const

function ReferenceGuide({ entry }: { entry: QuestJournalCatalogEntry }): JSX.Element {
  return <Stack spacing={2} data-testid="quest-journal-walkthrough">
    <Typography variant="h6">Source walkthrough</Typography>
    <Typography variant="caption" color="text.secondary">eqlwiki.com snapshot · {formatDate(Date.parse(entry.source.snapshotAt))}. Source descriptions may include older game mechanics.</Typography>
    {entry.walkthrough?.map((section, index) => <Box key={index}>
      {section.heading && <Typography variant="subtitle2" sx={{ mb: 0.5 }}>{section.heading}</Typography>}
      <Typography variant="body2" sx={{ whiteSpace: 'pre-line', overflowWrap: 'anywhere' }}>{section.text}</Typography>
    </Box>)}
    {!entry.walkthrough?.length && <Typography variant="body2">No readable walkthrough is bundled for this entry. The source page may contain additional instructions.</Typography>}
    {entry.walkthroughTruncated && <Alert severity="info">This long source is shortened here. Open the source page for the remaining instructions.</Alert>}
    <Link href={entry.source.url} target="_blank" rel="noreferrer">Open quest source</Link>
  </Stack>
}

function ReferenceItems({ entry, selectedName, select, navigation }: {
  entry: QuestJournalCatalogEntry; selectedName: string | undefined; select: (name: string) => void; navigation: JournalNavigation
}): JSX.Element {
  const selected = entry.referencedItems.find(item => item.name === selectedName) ?? entry.referencedItems[0]
  return <Stack spacing={1.5} data-testid="quest-journal-item-sources">
    <Typography variant="caption" color="text.secondary">Items mentioned in the source. Use the Guide for exact requirements and quantities.</Typography>
    <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap" aria-label="Source items">
      {entry.referencedItems.map(item => <Button key={item.name} size="small" variant={selected?.name === item.name ? 'contained' : 'outlined'}
        aria-pressed={selected?.name === item.name} onClick={() => select(item.name)} sx={{ textTransform: 'none', overflowWrap: 'anywhere' }}>{item.name}</Button>)}
    </Stack>
    {selected ? <Box>
      <Stack direction="row" alignItems="center" spacing={1} useFlexGap flexWrap="wrap">
        <Typography variant="h6">{selected.name}</Typography>
        <Button size="small" onClick={() => navigation.openLoot(selected.name)}>Open item</Button>
      </Stack>
      <JournalLocations locations={selected.sources} navigation={navigation} empty="A drop location is not recorded for this item." />
    </Box> : <Typography variant="body2" color="text.secondary">No item references are recorded in this source.</Typography>}
  </Stack>
}

export function JournalReference({ entry, navigation, resetScroll }: {
  entry: QuestJournalCatalogEntry; navigation: JournalNavigation; resetScroll: () => void
}): JSX.Element {
  const [tab, setTab] = useState(0)
  const [selectedName, setSelectedName] = useState(entry.referencedItems[0]?.name)
  const id = useId()
  return <Stack spacing={2}>
    <Tabs value={tab} onChange={(_, value: number) => { setTab(value); resetScroll() }} aria-label="Walkthrough sections" variant="scrollable" scrollButtons="auto" allowScrollButtonsMobile
      data-testid="journal-reference-tabs" sx={{ position: 'sticky', top: 0, bgcolor: 'background.paper', zIndex: 1, minWidth: 0, borderBottom: 1, borderColor: 'divider' }}>
      {REFERENCE_TABS.map((label, index) => <Tab key={label} label={label} id={`${id}-tab-${index}`} aria-controls={`${id}-panel-${index}`} />)}
    </Tabs>
    {REFERENCE_TABS.map((label, index) => <Box key={label} role="tabpanel" hidden={tab !== index} id={`${id}-panel-${index}`} aria-labelledby={`${id}-tab-${index}`} tabIndex={0}>
      {tab === index && index === 0 && <ReferenceGuide entry={entry} />}
      {tab === index && index === 1 && <Stack spacing={1}>
        <Typography variant="h6">People named in the source</Typography>
        <JournalLocations locations={entry.relatedNpcs} navigation={navigation} empty="No other NPC locations are recorded in this source." />
      </Stack>}
      {tab === index && index === 2 && <ReferenceItems entry={entry} selectedName={selectedName}
        select={name => { setSelectedName(name); resetScroll() }} navigation={navigation} />}
    </Box>)}
  </Stack>
}
