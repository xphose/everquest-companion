import type { JSX } from 'react'
import { Alert, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, Divider, FormControlLabel, LinearProgress, Stack, Typography, useMediaQuery, useTheme } from '@mui/material'
import RestoreIcon from '@mui/icons-material/Restore'
import { useQuestRecovery, type QuestRecoveryController } from './useQuestRecovery'
import { RecoverySourceButtons, RecoverySources } from './RecoverySources'
import { RecoveryCandidates } from './RecoveryCandidates'
import { RecoveryObjectives } from './RecoveryObjectives'

function ForgetRecovery({ characterLabel, controller }: { characterLabel: string; controller: QuestRecoveryController }): JSX.Element {
  if (!controller.forgetConfirmation) return <Button size="small" color="inherit" disabled={!!controller.busy}
    onClick={() => controller.setForgetConfirmation(true)} sx={{ alignSelf: 'flex-start' }} data-testid="quest-recovery-forget">Forget recovered data…</Button>
  return <Alert severity="warning" data-testid="quest-recovery-forget-confirm">
    Clear recovered entries for {characterLabel}? Game log observations and your corrections will remain.
    <Stack direction="row" spacing={1} sx={{ mt: 0.5 }}>
      <Button size="small" color="error" disabled={!!controller.busy} onClick={controller.forget}>Forget recovered data</Button>
      <Button size="small" disabled={!!controller.busy} onClick={() => controller.setForgetConfirmation(false)}>Keep data</Button>
    </Stack>
  </Alert>
}

function RecoveryDialog({ characterLabel, controller }: { characterLabel: string; controller: QuestRecoveryController }): JSX.Element {
  const fullScreen = useMediaQuery(useTheme().breakpoints.down('sm'))
  return <Dialog open={controller.open} onClose={controller.close} fullWidth maxWidth="md" fullScreen={fullScreen} aria-labelledby="quest-recovery-title" data-testid="quest-recovery-dialog">
    <DialogTitle id="quest-recovery-title">Recover character <Typography component="span" color="text.secondary" sx={{ fontSize: 'inherit', overflowWrap: 'anywhere' }}>· {characterLabel}</Typography></DialogTitle>
    <DialogContent dividers><Stack spacing={1.5}>
      <RecoverySourceButtons scan={controller.scan} busy={!!controller.busy} />
      {controller.busy && <Stack spacing={0.5} role="status" aria-live="polite"><LinearProgress /><Typography variant="body2">
        {controller.busy === 'scan' ? 'Reading the selected source…' : controller.busy === 'apply' ? 'Saving recovered quests…' : 'Clearing recovered data…'}
      </Typography></Stack>}
      {controller.error && <Alert severity="error" data-testid="quest-recovery-error">{controller.error}</Alert>}
      {controller.draft && <>
        <RecoverySources draft={controller.draft} />
        <Divider />
        <RecoveryCandidates draft={controller.draft} controller={controller} />
        <RecoveryObjectives draft={controller.draft} controller={controller} />
        <FormControlLabel sx={{ m: 0 }} control={<Checkbox checked={controller.confirmed} disabled={!!controller.busy} data-testid="quest-recovery-character-confirm"
          onChange={(_, value) => controller.setConfirmed(value)} />}
          label={`These entries belong to ${characterLabel}; current-task entries still apply.`} />
      </>}
      <Divider />
      <ForgetRecovery characterLabel={characterLabel} controller={controller} />
    </Stack></DialogContent>
    <DialogActions sx={{ px: 2, py: 1.5, flexWrap: 'wrap', gap: 0.5 }}>
      <Button onClick={controller.close} disabled={controller.busy === 'apply' || controller.busy === 'forget'} data-testid="quest-recovery-cancel">Cancel</Button>
      <Button variant="contained" disabled={!!controller.busy || !controller.draft || !controller.confirmed || !controller.objectiveSelectionValid || controller.selected.size === 0}
        onClick={controller.apply} data-testid="quest-recovery-apply">Apply selected ({controller.selected.size})</Button>
    </DialogActions>
  </Dialog>
}

export function QuestRecovery({ characterId, characterName, characterServer, refresh }: {
  characterId: string | null; characterName?: string; characterServer?: string; refresh: () => void
}): JSX.Element {
  const controller = useQuestRecovery(characterId, refresh)
  const characterLabel = characterName ? `${characterName}${characterServer ? `@${characterServer}` : ''}` : 'the selected character'
  return <>
    <Button size="small" startIcon={<RestoreIcon />} onClick={controller.begin} disabled={!characterId} data-testid="quest-journal-recover">Recover character</Button>
    {controller.notice && <Alert severity="success" onClose={controller.dismissNotice} sx={{ width: '100%', py: 0 }} data-testid="quest-recovery-notice">{controller.notice}</Alert>}
    {characterId && <RecoveryDialog characterLabel={characterLabel} controller={controller} />}
  </>
}
