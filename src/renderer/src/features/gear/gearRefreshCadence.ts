export const GEAR_CHARACTER_INTERVAL = 2_000
export const GEAR_INVENTORY_INTERVAL = 30_000

interface CadenceDeps {
  tick: () => void
  refresh: () => void
  interval: number
  window: Pick<Window, 'addEventListener' | 'removeEventListener' | 'setInterval' | 'clearInterval'>
  document: Pick<Document, 'hidden' | 'addEventListener' | 'removeEventListener'>
}

/** Visible gameplay keeps updating even without focus. Hidden windows catch up on resume. */
export function gearRefreshCadence(deps: CadenceDeps): () => void {
  let alive = true
  let queued = false
  const resume = (): void => {
    if (!alive || deps.document.hidden || queued) return
    queued = true
    queueMicrotask(() => {
      queued = false
      if (alive && !deps.document.hidden) deps.refresh()
    })
  }
  const timer = deps.window.setInterval(() => { if (!deps.document.hidden) deps.tick() }, deps.interval)
  deps.window.addEventListener('focus', resume)
  deps.document.addEventListener('visibilitychange', resume)
  deps.tick()
  return () => {
    alive = false
    deps.window.clearInterval(timer)
    deps.window.removeEventListener('focus', resume)
    deps.document.removeEventListener('visibilitychange', resume)
  }
}
