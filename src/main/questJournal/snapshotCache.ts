/** Engine publication cursors invalidate lazy, shared snapshot reads. No timer or second fold. */
const MODULES = new Set(['character', 'combo', 'tasks', 'loot', 'turnins'])

interface CachedSnapshot { token: string; promise: Promise<unknown> }

export function createJournalSnapshotCache(): {
  read: (module: string, token: string, request: () => Promise<unknown>, currentToken: () => string) => Promise<unknown>
  changed: (module: string, seq: number) => void
  clear: () => void
} {
  const snapshots = new Map<string, CachedSnapshot>()
  const cursors = new Map<string, number>()
  return {
    read: (module, token, request, currentToken) => {
      const found = snapshots.get(module)
      if (found?.token === token) return found.promise
      const entry: CachedSnapshot = { token, promise: Promise.resolve() }
      entry.promise = request().then((value) => {
        if (currentToken() !== token || snapshots.get(module) !== entry) throw new Error('Quest observations changed while reading. Refresh the journal.')
        return value
      }).catch((error: unknown) => {
        if (snapshots.get(module) === entry) snapshots.delete(module)
        throw error
      })
      snapshots.set(module, entry)
      return entry.promise
    },
    changed: (module, seq) => {
      if (!MODULES.has(module) || cursors.get(module) === seq) return
      cursors.set(module, seq)
      snapshots.delete(module)
    },
    clear: () => { snapshots.clear(); cursors.clear() }
  }
}

export const journalSnapshots = createJournalSnapshotCache()
