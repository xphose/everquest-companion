import type { JSX } from 'react'
import { Alert, AlertTitle, Snackbar, Typography } from '@mui/material'
import type { MacroAssistantSnapshot } from '@shared/macroAssistant'
import { installationFeedback, type MacroNotice } from './macroFeedback'

export function MacroStatus({ snapshot }: { snapshot: MacroAssistantSnapshot }): JSX.Element {
  const feedback = installationFeedback(snapshot)
  return <Alert severity={feedback.severity} role="status" aria-live="polite" aria-atomic="true" data-testid="macros-status">
    <AlertTitle sx={{ fontWeight: 600 }}>{feedback.title}</AlertTitle>
    <Typography variant="body2">{feedback.message}</Typography>
    {feedback.detail && <Typography variant="body2" sx={{ mt: 0.5, overflowWrap: 'anywhere' }}>{feedback.detail}</Typography>}
    {feedback.timestamp && <Typography variant="caption" component="div" sx={{ mt: 0.5 }}>
      {feedback.timestamp.label}: <time dateTime={feedback.timestamp.value}>{new Date(feedback.timestamp.value).toLocaleString()}</time>
    </Typography>}
  </Alert>
}

export function MacroNotification({ notice, dismiss }: { notice: MacroNotice | null | undefined; dismiss: (id: number) => void }): JSX.Element | null {
  if (!notice) return null
  return <Snackbar key={notice.id} open autoHideDuration={9000} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
    onClose={(_, reason) => { if (reason !== 'clickaway') dismiss(notice.id) }}>
    <Alert data-testid="macros-notification" data-notice-id={notice.id} severity={notice.feedback.severity} variant="filled"
      onClose={() => dismiss(notice.id)} sx={{ maxWidth: 620 }}>
      <AlertTitle>{notice.feedback.title}</AlertTitle>{notice.feedback.message}
      {notice.feedback.detail && <Typography variant="body2" sx={{ mt: 0.5, overflowWrap: 'anywhere' }}>{notice.feedback.detail}</Typography>}
    </Alert>
  </Snackbar>
}
