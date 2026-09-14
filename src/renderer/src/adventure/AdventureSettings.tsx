import { type JSX, useEffect, useState } from 'react'
import { Alert, Button, Slider, Stack, TextField, Typography } from '@mui/material'
import type { AdventureShortcutState } from '@shared/adventureShortcut'

export function useAdventureShortcut() {
  const [shortcut, setShortcut] = useState<AdventureShortcutState | null>(null)
  useEffect(() => {
    let alive = true
    void window.eqAdventure.getAdventureShortcut().then((state) => { if (alive) setShortcut(state) })
      .catch(() => { if (alive) setShortcut({ accelerator: '', registered: false, error: 'Shortcut settings could not be read.' }) })
    return () => { alive = false }
  }, [])
  return { shortcut, setShortcut }
}

export function AdventureSettings({ shortcut, changed, alpha, onAlpha }: {
  shortcut: AdventureShortcutState | null
  changed: (state: AdventureShortcutState) => void
  alpha: number
  onAlpha: (value: number) => void
}): JSX.Element {
  const [value, setValue] = useState(shortcut?.accelerator ?? '')
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const save = async (): Promise<void> => {
    setSaving(true)
    try { const next = await window.eqAdventure.setAdventureShortcut(value); changed(next); setSaved(!next.error) }
    catch { changed({ accelerator: value, registered: false, error: 'The shortcut could not be saved.' }) }
    finally { setSaving(false) }
  }
  return <Stack spacing={1.25} sx={{ p: 1.5, width: 330, maxWidth: 'calc(100vw - 24px)' }}>
    <Typography variant="subtitle2">Adventure controls</Typography>
    <Typography variant="body2">Drag the top bar to move. Pin to let clicks pass through to the game. Hover over the top bar to unpin and search.</Typography>
    <TextField size="small" label="Show / hide shortcut" value={value} onChange={(event) => { setValue(event.target.value); setSaved(false) }} helperText="Example: Ctrl+Shift+Space. Leave empty to disable." />
    <Button size="small" variant="contained" disabled={saving} onClick={() => void save()}>Save shortcut</Button>
    {shortcut?.error && <Alert severity="warning">{shortcut.error} You can still use the main app’s Overlay menu.</Alert>}
    {saved && <Typography variant="caption" role="status">{shortcut?.registered ? 'Shortcut ready.' : 'Shortcut disabled.'}</Typography>}
    <Typography variant="subtitle2">Background</Typography>
    <Slider size="small" value={alpha} min={0.15} max={1} step={0.05} aria-label="Adventure background opacity" onChange={(_, next) => onAlpha(next as number)} />
    <Typography variant="caption" color="text.secondary">The live map updates automatically. Quests check every 5 seconds and after new game records. No game actions are performed.</Typography>
  </Stack>
}
