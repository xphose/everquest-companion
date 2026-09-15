import { useCallback, useEffect, useState } from 'react'
import type { WikiRefreshStatus } from '@shared/wikiCatalog'
import { recordPref } from '../features/preferences/prefsSnapshot'

let latest: WikiRefreshStatus | null = null

/** Poll only the small status record while a relevant view is mounted, never the catalogs. */
export function useWikiCatalogStatus(seed?: WikiRefreshStatus): {
  status: WikiRefreshStatus | null; unavailable: boolean; requesting: boolean; refresh: () => void
} {
  const [status, setStatus] = useState<WikiRefreshStatus | null>(() => seed ?? latest)
  const [unavailable, setUnavailable] = useState(false)
  const [requesting, setRequesting] = useState(false)
  const accept = useCallback((value: WikiRefreshStatus) => {
    latest = value
    recordPref('wikiCatalog', value)
    setUnavailable(false)
    setStatus(previous => JSON.stringify(previous) === JSON.stringify(value) ? previous : value)
  }, [])
  useEffect(() => {
    let alive = true
    let busy = false
    const read = async (): Promise<void> => {
      if (busy) return
      busy = true
      try {
        const value = await window.eq.getWikiCatalogStatus()
        if (alive) accept(value)
      } catch { if (alive) setUnavailable(true) }
      finally { busy = false }
    }
    void read()
    const timer = window.setInterval(() => { void read() }, 2000)
    return () => { alive = false; window.clearInterval(timer) }
  }, [accept])
  const refresh = useCallback(() => {
    setRequesting(true)
    void window.eq.refreshWikiCatalog().then(accept, () => setUnavailable(true)).finally(() => setRequesting(false))
  }, [accept])
  return { status, unavailable, requesting, refresh }
}
