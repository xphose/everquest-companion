import type { MacroAssistantSnapshot } from '../../../../shared/macroAssistant'

export interface MacroFeedback {
  title: string
  message: string
  severity: 'info' | 'success' | 'warning'
  detail?: string
  timestamp?: { label: string; value: string }
}
export interface MacroNotice { id: number; feedback: MacroFeedback }

/** Present typed outcomes. A legacy appliedAt can describe an older write, so it is never
 * substituted for a missing completion record or used to claim that a no-op wrote the file. */
export function installationFeedback(snapshot: MacroAssistantSnapshot): MacroFeedback {
  const { installation: state } = snapshot
  if (state.state === 'pending') return {
    title: state.pendingAction === 'restore' ? 'Restore queued, not written yet' : 'Queued, not written yet', severity: 'info',
    message: 'Keep the companion open. Fully exit EverQuest, then wait for Saved or Already up to date before relaunching.'
  }
  if (state.state === 'conflict') return { title: 'Needs your attention', message: state.message, severity: 'warning' }
  if (state.state === 'unavailable') return { title: 'Setup needed', message: state.message, severity: 'warning' }
  if (state.completion) return completedFeedback(state.completion)
  const title = state.state === 'applied' ? 'Update complete' : state.state === 'off' ? 'Automatic updates off' : 'Ready to queue'
  return { title, message: state.message, severity: 'info' }
}

function completedFeedback(completion: NonNullable<MacroAssistantSnapshot['installation']['completion']>): MacroFeedback {
  const destination = completion.destination
  const detail = destination ? `Hotbar ${destination.bar} · Page ${destination.page} · ${completion.targetFile}` : completion.targetFile
  if (completion.kind === 'unchanged') return {
    title: 'Already up to date', severity: 'success', detail,
    message: 'No new changes were written. If these macros are already visible in game, no restart is needed.',
    timestamp: { label: 'Last checked', value: completion.at }
  }
  return { title: completion.kind === 'restored' ? 'Saved: previous settings restored' : 'Saved to character settings', severity: 'success', detail,
    message: 'Start EverQuest to load these hotbuttons. If it is already running, fully exit and restart it.',
    timestamp: { label: 'Saved', value: completion.at } }
}
