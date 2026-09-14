import { type JSX, useCallback, useEffect, useMemo, useState } from 'react'
import { Box, IconButton, Popover, Stack, Tab, Tabs, Typography } from '@mui/material'
import { createTheme, ThemeProvider } from '@mui/material/styles'
import TuneIcon from '@mui/icons-material/Tune'
import { theme } from '../theme/theme'
import { OverlayHeader } from '../overlay/OverlayHeader'
import { useOverlayChrome } from '../overlay/useOverlayChrome'
import type { MapFocus } from '../features/maps/mapFocus'
import { AdventureQuests } from './AdventureQuests'
import { AdventureSettings, useAdventureShortcut } from './AdventureSettings'
import { useAdventureJournal } from './useAdventureJournal'
import { AdventureMap, AdventureProfile, shortcutLabel, type AdventureFocus } from './AdventureMap'

const CHROME_THEME = createTheme(theme, { palette: { background: { default: 'transparent', paper: 'transparent' } } })

export default function AdventureApp(): JSX.Element {
  const chrome = useOverlayChrome()
  const journal = useAdventureJournal()
  const [tab, setTab] = useState<'map' | 'quests'>('map')
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  useEffect(() => { if (chrome.locked) setAnchor(null) }, [chrome.locked])
  const [focus, setFocus] = useState<AdventureFocus | null>(null)
  const characterId = journal.result?.context.characterId
  useEffect(() => setFocus(null), [characterId])
  const { shortcut, setShortcut } = useAdventureShortcut()
  const openMap = useCallback((target: MapFocus): void => { setFocus((old) => ({ target, nonce: (old?.nonce ?? 0) + 1 })); setTab('map') }, [])
  const palette = useMemo(() => createTheme(theme, {
    palette: { background: { default: 'transparent', paper: 'transparent' } },
    typography: {
      h6: { fontSize: `${1.25 * chrome.textScale}rem` }, body1: { fontSize: `${chrome.textScale}rem` },
      body2: { fontSize: `${0.875 * chrome.textScale}rem` }, subtitle2: { fontSize: `${0.875 * chrome.textScale}rem` },
      caption: { fontSize: `${0.75 * chrome.textScale}rem` }, button: { fontSize: `${0.875 * chrome.textScale}rem` }
    }
  }), [chrome.textScale])
  return <ThemeProvider theme={CHROME_THEME}>
    <Stack data-testid="adventure-overlay" data-locked={chrome.locked} sx={{ height: '100%', overflow: 'hidden', borderRadius: 1.5, border: '1px solid rgba(217,178,95,.4)', backgroundColor: `rgba(15,17,21,${chrome.bgAlpha})` }}>
      <OverlayHeader tag="ADVENTURE" title="Map & quests" titleColor="#d9b25f" tail={chrome.locked ? 'Pinned' : undefined} chrome={chrome} />
      <Stack direction="row" alignItems="center" spacing={0.5} sx={{ px: 1, flexShrink: 0 }}>
        <Tabs value={tab} onChange={(_, value: 'map' | 'quests') => setTab(value)} sx={{ minHeight: 34, '& .MuiTab-root': { minHeight: 34, minWidth: 65, py: 0.5 } }}>
          <Tab label="Map" value="map" /><Tab label="Quests" value="quests" />
        </Tabs>
        <AdventureProfile context={journal.result?.context} />
        <IconButton size="small" aria-label="Adventure settings" disabled={chrome.locked} onClick={(event) => setAnchor(event.currentTarget)}><TuneIcon fontSize="small" /></IconButton>
      </Stack>
      <ThemeProvider theme={palette}><Box sx={{ flex: 1, minHeight: 0, p: 0.75, pt: 0 }}>
        <Box sx={{ height: '100%', display: tab === 'map' ? 'block' : 'none' }}>
          <AdventureMap focus={focus} journal={journal} onQuests={() => setTab('quests')} />
        </Box>
        <Box sx={{ height: '100%', display: tab === 'quests' ? 'block' : 'none' }}><AdventureQuests journal={journal} onMap={openMap} /></Box>
      </Box></ThemeProvider>
      <Typography variant="caption" color="text.secondary" sx={{ px: 1, pb: 0.5, flexShrink: 0 }} data-testid="adventure-shortcut">{shortcutLabel(shortcut)} · show / hide{chrome.locked ? ' · Unpin to search' : ''}</Typography>
      <Popover open={anchor !== null && !chrome.locked} anchorEl={anchor} onClose={() => setAnchor(null)} transitionDuration={0} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }} slotProps={{ paper: { sx: { bgcolor: '#171a21' } } }}>
        <AdventureSettings shortcut={shortcut} changed={setShortcut} alpha={chrome.bgAlpha} onAlpha={(bgAlpha) => chrome.patch({ bgAlpha })} />
      </Popover>
    </Stack>
  </ThemeProvider>
}
