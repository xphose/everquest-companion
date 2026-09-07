import type { JSX } from 'react'
import { Accordion, AccordionDetails, AccordionSummary, Alert, Box, Button, Link, Stack, Typography } from '@mui/material'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import type { QuestJournalCatalogEntry } from '@shared/questJournal/catalog'
import { formatDate } from '../../lib/formatDate'
import { JournalLocations } from './JournalLocations'
import type { JournalNavigation } from './navigation'

export function JournalReference({ entry, navigation }: { entry: QuestJournalCatalogEntry; navigation: JournalNavigation }): JSX.Element {
  return <Stack spacing={1}>
    <Accordion disableGutters elevation={0} defaultExpanded={!entry.guide} slotProps={{ transition: { unmountOnExit: true } }} data-testid="quest-journal-walkthrough">
      <AccordionSummary expandIcon={<ExpandMoreIcon />}><Typography variant="h6">Source walkthrough</Typography></AccordionSummary>
      <AccordionDetails sx={{ maxHeight: 520, overflow: 'auto' }}>
        <Stack spacing={2}>
          <Typography variant="caption" color="text.secondary">eqlwiki.com snapshot · {formatDate(Date.parse(entry.source.snapshotAt))}. Source descriptions may include older game mechanics.</Typography>
          {entry.walkthrough?.map((section, index) => <Box key={index}>
            {section.heading && <Typography variant="subtitle2" sx={{ mb: 0.5 }}>{section.heading}</Typography>}
            <Typography variant="body2" sx={{ whiteSpace: 'pre-line', overflowWrap: 'anywhere' }}>{section.text}</Typography>
          </Box>)}
          {!entry.walkthrough?.length && <Typography variant="body2">No readable walkthrough is bundled for this entry. The source page may contain additional instructions.</Typography>}
          {entry.walkthroughTruncated && <Alert severity="info">This long source is shortened here. Open the source page for the remaining instructions.</Alert>}
          <Link href={entry.source.url} target="_blank" rel="noreferrer">Open quest source</Link>
        </Stack>
      </AccordionDetails>
    </Accordion>
    <Accordion disableGutters elevation={0} slotProps={{ transition: { unmountOnExit: true } }} data-testid="quest-journal-item-sources">
      <AccordionSummary expandIcon={<ExpandMoreIcon />}><Typography variant="body2">Items mentioned in the source · {entry.referencedItems.length}</Typography></AccordionSummary>
      <AccordionDetails sx={{ maxHeight: 460, overflow: 'auto' }}>
        <Typography variant="caption" color="text.secondary">These are source references. Use the walkthrough for the exact requirements and quantities.</Typography>
        {entry.referencedItems.map((item) => <Accordion key={item.name} disableGutters elevation={0} slotProps={{ transition: { unmountOnExit: true } }}>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}><Typography variant="body2">{item.name}</Typography></AccordionSummary>
          <AccordionDetails>
            <Button size="small" onClick={() => navigation.openLoot(item.name)}>Open item</Button>
            <JournalLocations locations={item.sources} navigation={navigation} empty="A drop location is not recorded for this item." />
          </AccordionDetails>
        </Accordion>)}
      </AccordionDetails>
    </Accordion>
    <Accordion disableGutters elevation={0} slotProps={{ transition: { unmountOnExit: true } }}>
      <AccordionSummary expandIcon={<ExpandMoreIcon />}><Typography variant="body2">Other NPCs named in the source</Typography></AccordionSummary>
      <AccordionDetails><JournalLocations locations={entry.relatedNpcs} navigation={navigation} /></AccordionDetails>
    </Accordion>
  </Stack>
}
