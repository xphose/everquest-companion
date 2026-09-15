/** Coalesce readiness/publication bursts with at most one snapshot read in flight. */
export function startJournalHistoryRecorder(
  observe: () => Promise<void>, subscribe: (changed: () => void) => () => void, onError: () => void
): () => void {
  let stopped = false
  let running = false
  let pending = false
  const read = async (): Promise<void> => {
    try { await observe() } catch { if (!stopped) onError() }
  }
  const drain = async (): Promise<void> => {
    try {
      while (pending && !stopped) {
        pending = false
        await read()
      }
    } finally { running = false }
  }
  const request = (): void => {
    if (stopped) return
    pending = true
    if (running) return
    running = true
    queueMicrotask(() => { void drain() })
  }
  const unsubscribe = subscribe(request)
  request()
  return () => { stopped = true; pending = false; unsubscribe() }
}
