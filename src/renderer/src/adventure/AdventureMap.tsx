import type { JSX } from 'react'
import { Box, Button, Stack, Typography } from '@mui/material'
import type { AdventureShortcutState } from '@shared/adventureShortcut'
import type { QuestJournalContext } from '@shared/questJournal/journal'
import MapsView from '../features/maps/MapsView'
import type { MapFocus } from '../features/maps/mapFocus'
import type { AdventureJournal } from './useAdventureJournal'

export interface AdventureFocus { target: MapFocus; nonce: number }

function trackedQuest(journal: AdventureJournal) {
  if (journal.detail?.row?.tracked) return journal.detail.row
  return journal.mode === 'tracked' ? journal.result?.rows[0] : null
}

export function AdventureMap({ focus, journal, onQuests }: { focus: AdventureFocus | null; journal: AdventureJournal; onQuests: () => void }): JSX.Element {
  const tracked = trackedQuest(journal)
  return <Stack spacing={0.5} sx={{ height: '100%', minHeight: 0 }}>
    {focus && <Button size="small" onClick={onQuests} sx={{ alignSelf: 'flex-start' }}>← Back to quest</Button>}
    {focus?.target.at === null && <Typography variant="caption" color="text.secondary">Zone map only - exact quest position unknown.</Typography>}
    <Box sx={{ flex: 1, minHeight: 0 }}><MapsView key={journal.result?.context.characterId ?? 'pending'} compact focus={focus?.target} focusNonce={focus?.nonce} /></Box>
    {tracked && <Button size="small" data-testid="adventure-tracked-strip" onClick={() => { journal.select(tracked.id); onQuests() }} sx={{ justifyContent: 'flex-start', overflow: 'hidden', flexShrink: 0 }}>
      <Typography variant="caption" noWrap>Tracked · {tracked.name}</Typography>
    </Button>}
  </Stack>
}

export function AdventureProfile({ context }: { context: QuestJournalContext | undefined }): JSX.Element {
  const classes = context?.classes.join(' / ')
  return <Typography variant="caption" noWrap sx={{ flex: 1, minWidth: 0, textAlign: 'right' }} data-testid="adventure-profile" title={classes}>
    {context?.level ? `Lv ${context.level} · ` : ''}{classes === '' || classes === undefined ? 'Waiting for character' : classes}
  </Typography>
}

export function shortcutLabel(shortcut: AdventureShortcutState | null): string {
  if (shortcut?.registered) return shortcut.accelerator
  return shortcut?.error ? 'Shortcut unavailable' : 'Shortcut off'
}
