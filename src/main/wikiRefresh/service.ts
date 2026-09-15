import { Worker } from 'node:worker_threads'
import { join } from 'node:path'
import { E2E } from '../e2e'
import { activeWikiCatalog, activeWikiUpdatedAt, referenceDataInitializationFailed, wikiCache } from '../referenceData'
import { logInfo } from '../errorLog'
import { WikiRefreshCadence, type WikiRefreshProgress, type WikiRefreshRun } from './cadence'
import type { WikiRefreshStatus, WikiCatalogPack } from '../../shared/wikiCatalog'
export { getWikiCatalogRendererData } from '../referenceData'

function workerRun(onProgress: (progress: WikiRefreshProgress) => void): WikiRefreshRun {
  const cache = wikiCache()
  const active = activeWikiCatalog()
  const worker = new Worker(join(__dirname, 'wikiRefreshWorker.js'), {
    workerData: { directory: cache.directory, baseFingerprint: active.baseFingerprint, activeGeneration: active.generation,
      fallback: referenceDataInitializationFailed() ? active : undefined }
  })
  worker.unref()
  const promise = new Promise<string>((resolve, reject) => {
    let checkedAt: string | undefined
    worker.on('message', (message: { type: string; progress?: WikiRefreshProgress; reason?: string; checkedAt?: string }) => {
      if (message.type === 'progress' && message.progress) onProgress(message.progress)
      if (message.type === 'done') checkedAt = message.checkedAt
      if (message.type === 'diagnostic') logInfo(`[everquest-companion] Wiki refresh: ${message.reason ?? 'background maintenance deferred'}`)
      if (message.type === 'error') {
        logInfo(`[everquest-companion] Wiki refresh: ${message.reason ?? 'worker failed'}`)
        reject(new Error('Wiki refresh failed'))
      }
    })
    worker.once('error', reject)
    worker.once('exit', (code) => { if (code === 0 && checkedAt) resolve(checkedAt); else reject(new Error('Wiki refresh worker stopped')) })
  })
  return { promise, stop: () => worker.postMessage({ type: 'stop' }) }
}

let cadence: WikiRefreshCadence | undefined
type FixtureRunner = (base: WikiCatalogPack, progress: (value: WikiRefreshProgress) => void) => Promise<WikiCatalogPack>
let fixtureRunner: FixtureRunner | undefined
declare global {
  var __eqWikiRefresh: { setRunner(run: FixtureRunner): void } | undefined
}
// The headless harness supplies synthetic packs through the same staging boundary. No endpoint
// override exists in a normal build, and E2E cannot contact the real wiki without this seam.
if (E2E) globalThis.__eqWikiRefresh = { setRunner: (run) => { fixtureRunner = run } }

function fixtureRun(progress: (value: WikiRefreshProgress) => void): WikiRefreshRun {
  const run = fixtureRunner
  if (!run) throw new Error('E2E wiki refresh requires a fixture')
  let stopped = false
  const active = activeWikiCatalog()
  const promise = run(wikiCache().latest(active), progress).then((pack) => {
    if (!stopped) {
      wikiCache().stage(pack, active)
      try { wikiCache().prune(active.generation) } catch { /* Retention cannot undo a verified refresh. */ }
    }
    return pack.checkedAt
  })
  return { promise, stop: () => { stopped = true } }
}

function controller(): WikiRefreshCadence {
  return cadence ??= new WikiRefreshCadence({
    cache: wikiCache(), activeUpdatedAt: activeWikiUpdatedAt(),
    run: E2E ? fixtureRun : workerRun, enabled: () => !E2E || fixtureRunner !== undefined,
    initialError: referenceDataInitializationFailed() ? 'Saved wiki data could not be opened. The app is using its bundled reference data and will retry automatically.' : undefined
  })
}

export function startWikiRefresh(): void {
  // Composition root calls this only after winning the instance lock.
  try { wikiCache().prune(activeWikiCatalog().generation) }
  catch { logInfo('[everquest-companion] Wiki cache retention will retry after its next successful check.') }
  controller().start()
}
export function stopWikiRefresh(): void { cadence?.stop() }
export function getWikiRefreshStatus(): WikiRefreshStatus { return controller().getStatus() }
export function refreshWikiCatalog(): Promise<WikiRefreshStatus> { return controller().refresh() }
