import { wikiRecord } from '../../shared/wikiCatalog'

export const WIKI_API = 'https://eqlwiki.com/api.php'
export interface WikiNetworkOptions {
  fetch?: typeof globalThis.fetch
  signal?: AbortSignal
  now?: () => number
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
  maxRequests?: number
}
export type WikiQuery = (params: Record<string, string>) => Promise<Record<string, unknown>>
const MAX_BYTES = 12 * 1024 * 1024
const MAX_WAIT = 10 * 60_000

export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted()
  return new Promise((resolve, reject) => {
    const finish = (): void => { signal?.removeEventListener('abort', abort); resolve() }
    const timer = setTimeout(finish, Math.max(0, ms))
    const abort = (): void => { clearTimeout(timer); reject(new Error('Wiki update cancelled')) }
    signal?.addEventListener('abort', abort, { once: true })
  })
}

export function wikiRetryDelay(header: string | null, now: number, backoff: number): number {
  if (!header) return backoff
  const seconds = Number(header)
  const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - now
  return Number.isFinite(delay) ? Math.max(backoff, delay) : backoff
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const declared = Number(response.headers.get('content-length'))
  if (declared > MAX_BYTES) throw new Error('Wiki response exceeded the size limit')
  if (!response.body) throw new Error('Wiki returned an empty response')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    for (;;) {
      const result = await reader.read()
      if (result.done) break
      bytes += result.value.byteLength
      if (bytes > MAX_BYTES) throw new Error('Wiki response exceeded the size limit')
      chunks.push(result.value)
    }
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (!wikiRecord(parsed)) throw new Error('Wiki returned malformed data')
  return parsed
}

interface Attempt { data?: Record<string, unknown>; retry?: string | null }
async function requestAttempt(url: string, options: WikiNetworkOptions): Promise<Attempt> {
  const signal = options.signal
    ? AbortSignal.any([options.signal, AbortSignal.timeout(30_000)])
    : AbortSignal.timeout(30_000)
  const response = await (options.fetch ?? globalThis.fetch)(url, {
    signal, redirect: 'error', credentials: 'omit',
    headers: { 'User-Agent': 'EQ-Legends-Companion/1 (reference catalog refresh)', Accept: 'application/json' }
  })
  if (response.status === 429 || response.status >= 500) {
    await response.body?.cancel()
    return { retry: response.headers.get('retry-after') }
  }
  if (!response.ok) { await response.body?.cancel(); throw new Error(`Wiki request failed (${response.status})`) }
  const data = await readJson(response)
  if (wikiRecord(data.error)) {
    if (data.error.code === 'maxlag' || data.error.code === 'ratelimited') return { retry: response.headers.get('retry-after') }
    throw new Error('Wiki could not complete the catalog request')
  }
  if (data.warnings) throw new Error('Wiki returned a partial or unsupported catalog request')
  return { data }
}

/** One serialized, rate-limited stream shared by indexing and content requests. */
export function createWikiQuery(options: WikiNetworkOptions = {}): WikiQuery {
  const now = options.now ?? Date.now
  const sleep = options.sleep ?? abortableSleep
  let nextStart = 0
  let requests = 0
  let tail: Promise<unknown> = Promise.resolve()
  const perform = async (params: Record<string, string>): Promise<Record<string, unknown>> => {
    const url = `${WIKI_API}?${new URLSearchParams({ action: 'query', format: 'json', formatversion: '2', maxlag: '5', ...params })}`
    for (let attempt = 0; attempt < 6; attempt++) {
      options.signal?.throwIfAborted()
      if (++requests > (options.maxRequests ?? 5000)) throw new Error('Wiki update paused at its request limit; it will resume on the next check')
      await sleep(Math.max(0, nextStart - now()), options.signal)
      nextStart = now() + 1000
      const result = await requestAttempt(url, options)
      if (result.data) return result.data
      const delay = wikiRetryDelay(result.retry ?? null, now(), 1000 * 2 ** attempt)
      if (delay > MAX_WAIT) throw new Error('Wiki requested a longer pause; the saved update will resume later')
      if (attempt < 5) await sleep(delay, options.signal)
    }
    throw new Error('Wiki is busy; the saved update will resume later')
  }
  return (params) => {
    const next = tail.then(() => perform(params))
    tail = next.catch(() => undefined)
    return next
  }
}
