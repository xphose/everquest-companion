import type { JSX } from 'react'
import { Accordion, AccordionDetails, AccordionSummary, Alert, Box, Button, Stack, Typography } from '@mui/material'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import type { RecoveryDraft, RecoveryInput } from '@shared/questJournal/recovery'

export function RecoverySourceButtons({ scan, busy }: { scan: (source: RecoveryInput) => Promise<void>; busy: boolean }): JSX.Element {
  return <Stack spacing={1}>
    <Typography variant="body2">Scan saved character files, or open EverQuest's journal on the page you want to recover. Read active tasks and completed history separately; you can save each scan.</Typography>
    <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
      <Button size="small" variant="outlined" disabled={busy} onClick={() => void scan('files')} data-testid="quest-recovery-files">Scan saved files</Button>
      <Button size="small" variant="outlined" disabled={busy} onClick={() => void scan('game-window')} data-testid="quest-recovery-game">Read game journal</Button>
      <Button size="small" variant="outlined" disabled={busy} onClick={() => void scan('clipboard')} data-testid="quest-recovery-clipboard">Clipboard image</Button>
      <Button size="small" variant="outlined" disabled={busy} onClick={() => void scan('image-file')} data-testid="quest-recovery-image">Choose screenshot</Button>
    </Stack>
    <Typography variant="caption" color="text.secondary">Image text is read locally on Windows. Only the visible page is read; the companion does not open tabs or control the game.</Typography>
    <Typography variant="caption" color="text.secondary">Use a fresh screenshot for current tasks. Image files and clipboard images do not prove capture time; history pages may be older.</Typography>
  </Stack>
}

export function RecoverySources({ draft }: { draft: RecoveryDraft }): JSX.Element {
  return <Stack spacing={0.75} data-testid="quest-recovery-sources">
    {draft.sources.map((source, index) => <Alert key={index} severity={source.state === 'error' ? 'warning' : source.state === 'available' ? 'success' : 'info'} sx={{ py: 0 }}>
      <Typography variant="subtitle2">{source.label} · {source.state}</Typography>{source.message}
    </Alert>)}
    {draft.warnings.map((warning, index) => <Alert key={index} severity="warning" sx={{ py: 0 }}>{warning}</Alert>)}
    {(Boolean(draft.imageDataUrl) || Boolean(draft.scannedText)) && <Accordion disableGutters elevation={0} slotProps={{ transition: { unmountOnExit: true } }}>
      <AccordionSummary expandIcon={<ExpandMoreIcon />} data-testid="quest-recovery-recognized"><Typography variant="body2">Review image and recognized text</Typography></AccordionSummary>
      <AccordionDetails><Stack spacing={1}>
        {draft.imageDataUrl && <Box component="img" src={draft.imageDataUrl} alt="Journal image used for recovery" sx={{ maxWidth: '100%', maxHeight: 300, objectFit: 'contain', alignSelf: 'flex-start' }} />}
        {draft.scannedText && <Typography variant="body2" component="pre" data-testid="quest-recovery-text" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 250, overflow: 'auto', m: 0 }}>{draft.scannedText}</Typography>}
      </Stack></AccordionDetails>
    </Accordion>}
  </Stack>
}
