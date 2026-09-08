import { useMemo, useState, type JSX } from 'react'
import { Alert, Box, Button, Chip, CircularProgress, Stack, Tab, Tabs, Typography } from '@mui/material'
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome'
import RefreshIcon from '@mui/icons-material/Refresh'
import { macroSelectionKey } from '@shared/macros'
import { MacroContext } from './MacroContext'
import { MacroInstallation } from './MacroInstallation'
import { MacroLoadout } from './MacroLoadout'
import { MacroRecipeCard } from './MacroRecipeCard'
import { MacroExisting } from './MacroExisting'
import { changeSelection, starterSelections, recipePresentation, MACRO_SELECTION_LIMIT } from '@shared/macros/presentation'
import { useMacroAssistant } from './useMacroAssistant'
import type { View } from '../../appViews'

/** Keep routing's per-view conditions outside the shared content switch's complexity limit. */
export function MacrosDestination({ view, viewKey }: { view: View; viewKey: string }): JSX.Element | null {
  return view === 'macros' ? <MacrosView key={viewKey} /> : null
}

export default function MacrosView(): JSX.Element {
  const assistant = useMacroAssistant()
  const { snapshot, busy, error, mutate, refresh } = assistant
  const [filter, setFilter] = useState('all')
  const { all: recipes, selected, ready, displayed } = useMemo(() =>
    recipePresentation(snapshot?.recipes ?? [], snapshot?.settings.selections ?? [], filter), [snapshot, filter])
  if (!snapshot) return <Stack spacing={1.5} data-testid="macros-view">
    <Typography variant="h5">Macros</Typography>
    {error ? <Alert severity="error" action={<Button onClick={refresh}>Retry</Button>}>{error}</Alert>
      : <Stack direction="row" spacing={1} alignItems="center"><CircularProgress size={18} /><Typography variant="body2">Reading your character and saved macros…</Typography></Stack>}
  </Stack>
  return <Stack spacing={2} data-testid="macros-view" data-character-id={snapshot.characterId ?? ''} sx={{ minWidth: 0, pb: 2 }}>
    <MacroContext snapshot={snapshot} busy={busy} onStyle={(style) => mutate({ style })} />
    {error && <Alert severity="error" action={<Button disabled={busy} onClick={refresh}>Retry</Button>}>{error}</Alert>}
    <MacroInstallation snapshot={snapshot} busy={busy} configure={mutate} action={mutate} />
    <MacroLoadout snapshot={snapshot} />
    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
      <Typography variant="h6">Build your hotbar</Typography>
      <Chip size="small" variant="outlined" label={`${selected.size} selected`} />
      <Box sx={{ flexGrow: 1 }} />
      <Button size="small" startIcon={<RefreshIcon />} disabled={busy} onClick={refresh}>Refresh</Button>
      <Button variant="outlined" size="small" startIcon={<AutoAwesomeIcon />} disabled={busy || !snapshot.characterId || ready === 0 || selected.size >= MACRO_SELECTION_LIMIT}
        data-testid="macros-starter-set" onClick={() => mutate({ selections: starterSelections(recipes, snapshot.settings.selections) })}>Add starter set</Button>
    </Stack>
    <Typography variant="body2" color="text.secondary">
      Starter macros follow your active classes and memorized spells. Choose individual cards to keep a particular spell line. Each hotbar page holds 12 buttons; deselect a macro to make room when your set is full.
    </Typography>
    <Tabs value={filter} onChange={(_, value: string) => setFilter(value)} aria-label="Macro suggestions" sx={{ minHeight: 36, '& .MuiTab-root': { minHeight: 36 } }}>
      <Tab value="all" label={`All suggestions (${recipes.length})`} /><Tab value="ready" label={`Ready (${ready})`} /><Tab value="selected" label={`Selected (${selected.size})`} />
    </Tabs>
    {displayed.length === 0 && <Alert severity="info">{filter === 'selected' ? 'Choose a macro or add the starter set to begin.' : 'No suggestions in this group yet. Your active classes and learned spells will fill it in.'}</Alert>}
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: 'repeat(2, minmax(0, 1fr))' }, gap: 1.5 }}>
      {displayed.map((recipe) => <MacroRecipeCard key={recipe.id} recipe={recipe} selected={selected.has(macroSelectionKey(recipe.selection))}
        selectionFull={selected.size >= MACRO_SELECTION_LIMIT}
        busy={busy || !snapshot.characterId} onSelect={(checked) => mutate({ selections: changeSelection(snapshot.settings.selections, recipe.selection, checked) })} />)}
    </Box>
    <Alert severity="info" icon={false} sx={{ py: 0.5 }}>
      <Typography variant="body2"><strong>Macro tip:</strong> A /pause value is in tenths of a second. On a combined line, the command runs first and the pause follows. Spells still need mana, a valid target and any required reagents.</Typography>
    </Alert>
    <MacroExisting socials={snapshot.existing} />
  </Stack>
}
