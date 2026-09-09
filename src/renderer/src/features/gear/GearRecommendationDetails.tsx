import { useMemo, type JSX } from 'react'
import { Accordion, AccordionDetails, AccordionSummary, Button, Divider, Link, Stack, Typography } from '@mui/material'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import type { GearAcquisition } from '@shared/gearAcquisition'
import { gearAcquisitionNotes, gearCatalogCaveat, gearKnownPatchNotes } from '@shared/gearAcquisitionRules'
import type { GearExaltationAdvice, GearRecommendation } from '@shared/gearProgression'
import { classDisplayName } from '@shared/spellLevels'
import { wikiPageUrl } from '@shared/wiki'
import { GearMergeDetails } from './GearProgressionAtoms'
import { scaleGearRow } from '@shared/planner/gearScale'

function SourceDetails({ source }: { source: GearAcquisition }): JSX.Element {
  const url = wikiPageUrl(source.page)
  return <Stack spacing={0.5}>
    <Typography variant="body2" fontWeight={600}>{source.kind === 'quest' ? 'Quest' : 'Dropped by'}: {source.name}</Typography>
    <Typography variant="body2">{source.zone ?? 'Zone not recorded'}{source.minLevel ? ` · ${source.kind === 'quest' ? 'Minimum quest level' : 'NPC level'} ${source.minLevel}${source.maxLevel && source.maxLevel !== source.minLevel ? ` - ${source.maxLevel}` : ''}` : ''}</Typography>
    {source.loc && <Typography variant="caption">/loc {source.loc.ns}, {source.loc.ew}{source.loc.z === undefined ? '' : `, ${source.loc.z}`}</Typography>}
    {source.requirements.map(text => <Typography variant="caption" color="text.secondary" key={text}>{text}</Typography>)}
    {url && <Link href={url} target="_blank" rel="noreferrer" variant="body2">Read the source on the wiki</Link>}
  </Stack>
}

function ExaltationDetails({ choices }: { choices: GearExaltationAdvice[] }): JSX.Element {
  return <Stack spacing={1}>
    <Typography variant="subtitle2">Effects you could add</Typography>
    {choices.map(choice => <Stack spacing={0.5} key={`${choice.donorKey}:${choice.socket}:${choice.effect}`}>
      <Typography variant="body2"><strong>{choice.effect}</strong> from {choice.donorName}</Typography>
      <Typography variant="caption">{choice.socket} effect · host +{choice.hostTier}, donor +{choice.donorTier} · {choice.baseCopies} extra base {choice.baseCopies === 1 ? 'copy' : 'copies'}, plus the donor item. Keep the host separate.</Typography>
      <Typography variant="caption">Usable classes after transfer: {choice.classes.map(classDisplayName).join(', ')}.</Typography>
      {choice.source && <SourceDetails source={choice.source} />}
      {choice.warnings.map(text => <Typography variant="caption" color="text.secondary" key={text}>{text}</Typography>)}
    </Stack>)}
  </Stack>
}

export function GearRecommendationDetails({ recommendation: rec, scrapedAt, limits, onOpenLoot, expanded, onExpand }: {
  recommendation: GearRecommendation; scrapedAt: string | null; limits: string[]; onOpenLoot?: (name: string) => void
  expanded: boolean; onExpand: (next: boolean) => void
}): JSX.Element {
  const stats = useMemo(() => scaleGearRow(rec.item, { full: rec.tier, fraction: 0 }).stats, [rec.item, rec.tier])
  const notes = useMemo(() => [...(rec.source ? gearAcquisitionNotes(rec.source) : []), ...gearKnownPatchNotes(rec.item)], [rec.source, rec.item])
  return <Accordion disableGutters elevation={0} expanded={expanded} onChange={(_event, next) => onExpand(next)} sx={{ bgcolor: 'transparent', '&:before': { display: 'none' } }}>
    <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ px: 0 }} data-testid="gear-more-details">
      <Typography variant="body2" fontWeight={600}>More details</Typography>
    </AccordionSummary>
    <AccordionDetails sx={{ px: 0 }}>
      <Stack spacing={1.5} data-testid="gear-recommendation-details">
        <Stack spacing={0.5}>
          <Typography variant="subtitle2">Why this item?</Typography>
          {rec.reasons.map(text => <Typography variant="body2" key={text}>{text}</Typography>)}
          {rec.comparedWith && <Typography variant="body2">Compared with {rec.comparedWith}.</Typography>}
          {!rec.comparisonKnown && <Typography variant="body2">This is a candidate to check. We cannot yet verify that it improves what you wear.</Typography>}
          <Typography variant="caption" color="text.secondary">Item stats at +{rec.tier}, before any partial upgrade progress: {Object.entries(stats).map(([key, value]) => `${key.replace(/_/g, ' ')} ${value}`).join(' · ') || 'Not recorded.'}</Typography>
        </Stack>
        {rec.merge && <><Divider /><GearMergeDetails merge={rec.merge} /></>}
        {!!rec.exaltations?.length && <><Divider /><ExaltationDetails choices={rec.exaltations} /></>}
        <Divider />
        {rec.source ? <SourceDetails source={rec.source} /> : <Typography variant="body2">A confirmed source is not recorded for this item.</Typography>}
        {rec.alternatives.map(source => source.id !== rec.source?.id && <SourceDetails source={source} key={source.id} />)}
        {[...rec.cautions, ...limits].map(text => <Typography variant="caption" color="text.secondary" key={text}>{text}</Typography>)}
        <Divider />
        <Typography variant="caption" color="text.secondary">{gearCatalogCaveat(scrapedAt)}</Typography>
        {notes.map(note => <Typography key={note.id} variant="caption" color="text.secondary">
          <Link href={note.sourceUrl} target="_blank" rel="noreferrer">{note.title}</Link>: {note.text}
        </Typography>)}
        {onOpenLoot && <Button variant="outlined" onClick={() => onOpenLoot(rec.item.name)} sx={{ alignSelf: 'flex-start' }}>Full item details</Button>}
      </Stack>
    </AccordionDetails>
  </Accordion>
}
