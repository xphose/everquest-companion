// Gear now starts with an explained next step; the original searchable corpus stays intact in Browse all.
import { useMemo, type JSX } from 'react'
import { Alert, Box, Button, Chip, Stack, Tab, Tabs, Typography } from '@mui/material'
import { classDisplayName } from '@shared/spellLevels'
import { recommendGear, type GearProgressionContext, type GearProgressionResult, type GearRecommendation } from '@shared/gearProgression'
import type { MapFocus } from '../maps/mapFocus'
import GearBrowseView from './GearBrowseView'
import { useGearIndex } from './gearData'
import { gearAcquisitions } from './gearAcquisitionData'
import { useGearProgressionCharacter, useGearProgressionInventory } from './useGearProgressionData'
import { useGearProgressionPrefs } from './useGearProgressionPrefs'
import { GearNextUpgrade } from './GearNextUpgrade'
import { GearOwnedProgression, GearInventoryNotice } from './GearOwnedProgression'
import { GearProgressionOptionsPanel } from './GearProgressionOptions'
import type { GearSection } from './gearProgressionPrefs'

export interface GearViewProps { onOpenLoot?: (item: string) => void; onOpenMap?: (target: MapFocus) => void }
const EFFORT_ORDER = { owned: 0, easier: 1, 'near-level': 2, harder: 3, unknown: 4 }
const EMPTY_CHARACTER: GearProgressionContext = { characterId: null, classes: [], source: 'none', message: 'Waiting for your character.' }

/** Unknown difficulty is not a known harder fight; the button only offers a measured lower-level source. */
function easierOption(rows: GearRecommendation[], current: GearRecommendation): GearRecommendation | undefined {
  if (current.effort === 'unknown') return undefined
  return rows.find(row => row.id !== current.id && row.effort !== 'unknown' && EFFORT_ORDER[row.effort] < EFFORT_ORDER[current.effort])
}

function CharacterHeading({ context, result, preview }: { context: GearProgressionContext; result: GearProgressionResult; preview: boolean }): JSX.Element {
  return <Stack spacing={1}>
    <Stack direction="row" useFlexGap flexWrap="wrap" gap={1} alignItems="center">
      <Typography variant="h5" fontWeight={750}>{result.level ? `Level ${result.level}` : 'Your adventure'}</Typography>
      <Chip size="small" label={preview ? 'Planning ahead' : context.source === 'live' ? 'Live character' : context.source === 'log' ? 'From your log' : 'Waiting for character'}
        variant="outlined" color={context.source === 'live' && !preview ? 'success' : 'default'} data-testid="gear-character-source" />
    </Stack>
    <Typography variant="body1" data-testid="gear-character-classes">{context.classes.map(classDisplayName).join(' + ') || 'Waiting to detect your classes.'}</Typography>
    {result.band && <Typography variant="caption" color="text.secondary" data-testid="gear-current-band">Level range {result.band.label} · evaluated at exact level {result.level}</Typography>}
  </Stack>
}

function RecommendedBody({ result, selected, scrapedAt, choose, ...navigation }: GearViewProps & {
  result: GearProgressionResult; selected: string | null; scrapedAt: string | null; choose: (rec: GearRecommendation) => void
}): JSX.Element {
  const rec = result.recommendations.find(item => item.id === selected) ?? result.recommendations[0]
  return <Stack spacing={2} data-testid="gear-recommended-view">
    <Box><Typography variant="h4" fontWeight={750}>Your next upgrade</Typography>
      <Typography color="text.secondary" sx={{ mt: 0.5 }}>One useful step for your classes, with a place to start.</Typography></Box>
    {rec ? <GearNextUpgrade recommendation={rec} easier={easierOption(result.recommendations, rec)} scrapedAt={scrapedAt} limits={result.limits} onChoose={choose} {...navigation} />
      : <Alert severity="info" data-testid="gear-no-recommendations">{result.classes.length === 0 || result.level === undefined
        ? 'Waiting for your level and classes. You can browse all items while your character is being detected.'
        : 'No upgrade was found for these settings. Your current items may still be useful. Try another level range or browse all items.'}</Alert>}
    {result.recommendations.length > 1 && <Stack direction="row" useFlexGap flexWrap="wrap" gap={1}>
      {result.recommendations.slice(0, 4).map(item => item.id !== rec?.id && <Button key={item.id} size="small" variant="text" onClick={() => choose(item)}
        data-testid="gear-other-option" sx={{ textTransform: 'none' }}>Consider {item.item.name}</Button>)}
    </Stack>}
  </Stack>
}

/** Remount only on character identity, preserving choices across sample ticks and normal map round trips. */
function GearCharacterView({ context, ...navigation }: GearViewProps & { context: GearProgressionContext }): JSX.Element {
  const index = useGearIndex()
  const reading = useGearProgressionInventory(context.characterId)
  const [prefs, setPrefs] = useGearProgressionPrefs(context.characterId)
  const acquisitions = useMemo(() => gearAcquisitions(index.rows), [index.rows])
  const result = useMemo(() => recommendGear({ rows: index.rows, acquisitions, character: context,
    equipped: reading.inventory?.hosts ?? null, ownership: reading.ownership.entries, options: prefs.options }),
  [index.rows, acquisitions, context, reading.inventory, reading.ownership.entries, prefs.options])
  const choose = (rec: GearRecommendation): void => setPrefs({ ...prefs, selected: rec.id, section: 'recommended',
    options: prefs.options.slot && prefs.options.slot !== rec.slot ? { ...prefs.options, slot: rec.slot } : prefs.options })
  return <Stack sx={{ height: '100%', minHeight: 0, minWidth: 0 }} spacing={1.5} data-testid="gear-view">
    <Tabs value={prefs.section} onChange={(_event, value: GearSection) => setPrefs({ ...prefs, section: value })} aria-label="Gear sections"
      variant="scrollable" allowScrollButtonsMobile sx={{ flexShrink: 0 }}>
      <Tab value="recommended" label="Recommended" data-testid="gear-section-recommended" />
      <Tab value="owned" label="My gear" data-testid="gear-section-owned" />
      <Tab value="browse" label="Browse all" data-testid="gear-section-browse" />
    </Tabs>
    {prefs.section === 'browse' ? <GearBrowseView onOpenLoot={navigation.onOpenLoot} /> : <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto', px: 0.5, pb: 2 }} data-testid="gear-progression-scroll">
      <Stack spacing={2.5} sx={{ maxWidth: 1050, mx: 'auto' }}>
        <CharacterHeading context={context} result={result} preview={prefs.options.level !== undefined} />
        {!index.ready ? <Alert severity="info">Reading the item database…</Alert> : index.refused ? <Alert severity="warning">This build cannot read the item database version.</Alert>
          : prefs.section === 'owned' ? <GearOwnedProgression advice={result.myGear} reading={reading} onChoose={choose} />
            : <><RecommendedBody result={result} selected={prefs.selected} scrapedAt={index.scrapedAt} choose={choose} {...navigation} />
              <GearInventoryNotice reading={reading} /></>}
        <GearProgressionOptionsPanel options={prefs.options} level={context.level} onChange={options => setPrefs({ ...prefs, options, selected: null })} />
      </Stack>
    </Box>}
  </Stack>
}

export default function GearView(props: GearViewProps = {}): JSX.Element {
  const reading = useGearProgressionCharacter()
  const context = reading.context ?? EMPTY_CHARACTER
  return <Stack spacing={1} sx={{ height: '100%', minHeight: 0 }}>
    {!reading.context && <Alert severity={reading.error ? 'warning' : 'info'} data-testid="gear-context-waiting">
      {reading.error ?? 'Reading your current character…'}
    </Alert>}
    <GearCharacterView key={context.characterId ?? 'none'} context={context} {...props} />
  </Stack>
}
