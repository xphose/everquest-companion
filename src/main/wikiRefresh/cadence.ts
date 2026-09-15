import type { WikiRefreshStatus } from '../../shared/wikiCatalog'
import type { WikiCache, WikiCacheState } from './persistence'

export const WIKI_CHECK_MS = 24 * 60 * 60 * 1000
const RETRY_START_MS = 15 * 60 * 1000
export interface WikiRefreshProgress {
  state: 'checking' | 'downloading'
  completedPages: number
  totalPages?: number
}
export interface WikiRefreshRun {
  /** Source watermark through which changes were checked, which may predate a resumed run. */
  promise: Promise<string>
  stop(): void
}
export interface WikiCadenceOptions {
  cache: WikiCache
  activeUpdatedAt: string
  run(onProgress: (progress: WikiRefreshProgress) => void): WikiRefreshRun
  enabled: boolean | (() => boolean)
  initialError?: string
  now?: () => number
  timer?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void
}

export class WikiRefreshCadence {
  private status: WikiRefreshStatus
  private running: WikiRefreshRun | undefined
  private flight: Promise<WikiRefreshStatus> | undefined
  private timer: ReturnType<typeof setTimeout> | undefined
  private stopped = true
  private readonly now: () => number

  constructor(private readonly options: WikiCadenceOptions) {
    this.now = options.now ?? Date.now
    const state = options.cache.readState()
    this.status = {
      state: (options.initialError ?? state.error) ? 'error' : state.pendingUpdatedAt ? 'ready' : 'idle',
      activeUpdatedAt: options.activeUpdatedAt,
      lastCheckedAt: state.lastCheckedAt ?? null,
      nextCheckAt: state.nextCheckAt ?? null,
      pendingUpdatedAt: state.pendingUpdatedAt ?? null,
      error: options.initialError ?? state.error,
      autoCheckDays: 1
    }
  }

  getStatus(): WikiRefreshStatus { return { ...this.status } }

  start(): void {
    if (!this.stopped) return
    this.stopped = false
    if (this.enabled()) this.schedule()
  }

  stop(): void {
    this.stopped = true
    this.clearTimer()
    this.running?.stop()
  }

  refresh(): Promise<WikiRefreshStatus> {
    if (this.flight) return this.flight
    if (!this.enabled()) return Promise.resolve(this.getStatus())
    this.clearTimer()
    this.status = { ...this.status, state: 'checking', completedPages: 0, totalPages: undefined, error: undefined }
    this.flight = this.perform().finally(() => {
      this.flight = undefined
      this.running = undefined
      if (!this.stopped) this.schedule()
    })
    return this.flight
  }

  private async perform(): Promise<WikiRefreshStatus> {
    try {
      // A killed process resumes after a bounded retry rather than hammering the wiki at launch.
      this.options.cache.writeState({ nextCheckAt: new Date(this.now() + RETRY_START_MS).toISOString() })
      this.running = this.options.run((progress) => { this.status = { ...this.status, ...progress } })
      const checkedAt = await this.running.promise
      if (this.stopped) return this.getStatus()
      const watermark = Date.parse(checkedAt)
      if (!Number.isFinite(watermark)) throw new Error('Wiki check returned an invalid watermark')
      const nextCheck = Math.min(this.now() + WIKI_CHECK_MS, watermark + WIKI_CHECK_MS)
      this.finish({ lastCheckedAt: checkedAt, nextCheckAt: new Date(nextCheck).toISOString(), failures: 0, error: undefined })
    } catch {
      if (this.stopped) return this.getStatus()
      const failures = (this.options.cache.readState().failures ?? 0) + 1
      const retry = Math.min(WIKI_CHECK_MS, RETRY_START_MS * 2 ** Math.min(failures - 1, 8))
      const error = 'Wiki update could not finish. Your saved reference data is still available; the app will retry automatically.'
      try { this.finish({ failures, error, nextCheckAt: new Date(this.now() + retry).toISOString() }) }
      catch { this.status = { ...this.status, state: 'error', error, nextCheckAt: null } }
    }
    return this.getStatus()
  }

  private finish(change: Partial<WikiCacheState>): void {
    const state = this.options.cache.writeState(change)
    this.status = {
      ...this.status, state: state.error ? 'error' : state.pendingUpdatedAt ? 'ready' : 'idle',
      lastCheckedAt: state.lastCheckedAt ?? null, nextCheckAt: state.nextCheckAt ?? null,
      pendingUpdatedAt: state.pendingUpdatedAt ?? null, error: state.error,
      completedPages: undefined, totalPages: undefined
    }
  }

  private schedule(): void {
    if (!this.enabled()) return
    this.clearTimer()
    const next = this.status.nextCheckAt ? Date.parse(this.status.nextCheckAt) : this.now()
    const delay = Math.max(0, Math.min(WIKI_CHECK_MS, next - this.now()))
    this.timer = (this.options.timer ?? setTimeout)(() => { void this.refresh() }, delay)
    this.timer.unref?.()
  }

  private clearTimer(): void {
    if (this.timer) (this.options.clearTimer ?? clearTimeout)(this.timer)
    this.timer = undefined
  }

  private enabled(): boolean {
    return typeof this.options.enabled === 'function' ? this.options.enabled() : this.options.enabled
  }
}
