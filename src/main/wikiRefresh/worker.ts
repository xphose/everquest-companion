// Network parsing and large JSON serialization stay off the log/UI thread.
import { parentPort, workerData } from 'node:worker_threads'
import { WikiCache } from './persistence'
import { runWikiRefresh } from './update'
import { validateWikiCatalogPack, type WikiCatalogPack } from '../../shared/wikiCatalog'

const input = workerData as { directory: string; baseFingerprint: string; activeGeneration: string; fallback?: WikiCatalogPack }
const cache = new WikiCache(input.directory, input.baseFingerprint)
const abort = new AbortController()
parentPort?.on('message', (message: { type: string }) => { if (message.type === 'stop') abort.abort() })

async function run(): Promise<void> {
  try {
    const active = cache.readPack(input.activeGeneration) ?? input.fallback
    if (!active) throw new Error('Selected wiki catalog is unavailable')
    if (!validateWikiCatalogPack(active, input.baseFingerprint)) throw new Error('Selected wiki catalog is invalid')
    const next = await runWikiRefresh({
      base: cache.latest(active), signal: abort.signal, checkpoint: cache.checkpoint(),
      onProgress: (progress) => parentPort?.postMessage({ type: 'progress', progress }),
      onCheckpoint: (checkpoint) => cache.saveCheckpoint(checkpoint)
    })
    if (!abort.signal.aborted) {
      cache.stage(next, active)
      cache.saveCheckpoint(null)
      try { cache.prune(active.generation) }
      catch { parentPort?.postMessage({ type: 'diagnostic', reason: 'cache retention deferred' }) }
      parentPort?.postMessage({ type: 'done', checkedAt: next.checkedAt })
    }
  } catch (error) { parentPort?.postMessage({ type: 'error', reason: failureReason(error) }) }
  finally { parentPort?.close() }
}
void run()

function failureReason(error: unknown): string {
  if (error instanceof Error && 'code' in error && typeof error.code === 'string') {
    const diskCodes = ['EACCES', 'EPERM', 'ENOSPC', 'EIO', 'ENOENT', 'EEXIST']
    if (diskCodes.includes(error.code)) return `cache I/O ${error.code}`
  }
  if (error instanceof Error && error.name === 'AbortError') return 'check cancelled'
  if (error instanceof Error && /^Wiki (?:response|returned|could|request|update|contains|redirect|omitted|did|repeated|is|requested)/.test(error.message)) {
    // Fetch errors use public fixed prose, with only a numeric HTTP status interpolated.
    return error.message.slice(0, 300)
  }
  if (error instanceof Error && /^(?:The existing wiki catalog is invalid|An item page no longer contains usable details;|A known (?:item|NPC|quest) page could not be parsed;|Refreshed catalog failed validation;)/.test(error.message)) {
    return error.message.slice(0, 300)
  }
  return 'wiki fetch or catalog validation failed'
}
