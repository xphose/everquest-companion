import { useState, type JSX } from 'react'
import { Alert, Box, Button, Checkbox, Chip, FormControlLabel, Paper, Stack, Typography } from '@mui/material'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import UpgradeIcon from '@mui/icons-material/Upgrade'
import type { MacroRecipe } from '@shared/macros'
import { copyText } from '../../lib/clipboard'

export function MacroCommands({ lines }: { lines: readonly string[] }): JSX.Element {
  return <Box component="pre" sx={{ m: 0, p: 1.25, bgcolor: 'rgba(0,0,0,0.25)', borderRadius: 1,
    overflowX: 'auto', fontFamily: 'monospace', fontSize: 12, lineHeight: 1.8, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
    {lines.map((line, index) => <Box component="span" key={index} sx={{ display: 'block' }}>
      <Box component="span" aria-hidden="true" sx={{ color: 'text.disabled', mr: 1.5, userSelect: 'none' }}>{index + 1}</Box>
      <Box component="code">{line || '\u00a0'}</Box>
    </Box>)}
  </Box>
}

function CopyCommands({ recipe }: { recipe: MacroRecipe }): JSX.Element {
  const [copied, setCopied] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const text = recipe.lines.join('\n')
  const copy = async (): Promise<void> => {
    const ok = await copyText(text)
    setCopied(ok ? text : null); setFailed(!ok)
  }
  return <Stack direction="row" spacing={1} alignItems="center">
    <Button size="small" startIcon={<ContentCopyIcon />} disabled={!recipe.ready || text.length === 0} onClick={() => { void copy() }}
      aria-label={`Copy ${recipe.name} commands`}>{copied === text ? 'Copied' : 'Copy commands'}</Button>
    {failed && <Typography variant="caption" color="error" role="status">Could not copy. Try again.</Typography>}
  </Stack>
}

function RecipeInformation({ recipe }: { recipe: MacroRecipe }): JSX.Element {
  return <>
    <Typography variant="body2" color="text.secondary">{recipe.description}</Typography>
    {recipe.requiredSpellIds.length > 0 && !recipe.selection.spellLine && <Typography variant="caption" color="primary">Follows available spells for this role.</Typography>}
    {recipe.upgrade && <Alert severity="info" icon={<UpgradeIcon fontSize="inherit" />} sx={{ py: 0.25 }}>
      <Typography variant="body2"><strong>Upgrade available:</strong> {recipe.upgrade.from.name} → {recipe.upgrade.to.name}</Typography>
      <Typography variant="caption">{recipe.upgrade.reason}</Typography>
    </Alert>}
    {recipe.reasons.length > 0 && <Box>{recipe.reasons.map((reason, index) =>
      <Typography key={index} variant="body2" color={recipe.ready ? 'text.secondary' : 'warning.main'}>{reason}</Typography>)}</Box>}
  </>
}

export function MacroRecipeCard({ recipe, selected, busy, selectionFull = false, onSelect }: {
  recipe: MacroRecipe; selected: boolean; busy: boolean; selectionFull?: boolean; onSelect: (checked: boolean) => void
}): JSX.Element {
  const label = recipe.ready ? 'Ready' : recipe.status === 'needs-memorizing' ? 'Needs memorizing' : 'Unavailable'
  return <Paper variant="outlined" data-testid={`macros-recipe-${recipe.id}`} sx={{ p: 1.5, minWidth: 0,
    borderColor: selected ? 'primary.main' : 'divider', display: 'flex', flexDirection: 'column', gap: 1.25 }}>
    <Stack direction="row" spacing={1} alignItems="flex-start" justifyContent="space-between">
      <Typography variant="subtitle1" sx={{ fontWeight: 600, lineHeight: 1.4 }}>{recipe.name}</Typography>
      <Chip size="small" variant="outlined" color={recipe.ready ? 'success' : 'default'} label={label} sx={{ flexShrink: 0 }} />
    </Stack>
    <RecipeInformation recipe={recipe} />
    {recipe.lines.length > 0 && <MacroCommands lines={recipe.lines} />}
    <Stack direction="row" spacing={1.5} sx={{ mt: 'auto' }}>
      <Typography variant="caption" color="text.secondary">{recipe.mana} mana</Typography>
      <Typography variant="caption" color="text.secondary">{(recipe.pauseTenths / 10).toLocaleString()} s planned waits</Typography>
      <Typography variant="caption" color="text.secondary">{recipe.lines.length}/5 lines</Typography>
    </Stack>
    <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" useFlexGap>
      <FormControlLabel sx={{ mr: 0 }} label="Manage this macro" control={<Checkbox size="small" checked={selected}
        disabled={busy || (!selected && (selectionFull || recipe.status === 'unavailable'))} onChange={(_, checked) => onSelect(checked)}
        slotProps={{ input: { 'aria-label': `Manage ${recipe.name}`, ...{ 'data-testid': `macros-select-${recipe.id}` } } }} />} />
      <CopyCommands recipe={recipe} />
    </Stack>
  </Paper>
}
