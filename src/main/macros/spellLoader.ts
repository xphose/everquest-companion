import { lstat, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import type { MacroSpell } from '../../shared/macros'

function loadWorker(path: string, ids: number[], size: number, mtimeMs: number): Promise<MacroSpell[]> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(join(__dirname, 'macroSpellWorker.js'), { workerData: { path, ids, size, mtimeMs } })
    const timeout = setTimeout(() => { void worker.terminate(); reject(new Error('Reading the spell table timed out.')) }, 15_000)
    worker.once('message', (reply: { ok?: boolean; spells?: MacroSpell[]; error?: string }) => {
      clearTimeout(timeout)
      if (reply.ok && Array.isArray(reply.spells)) resolve(reply.spells)
      else reject(new Error(reply.error ?? 'Unable to read the client spell table.'))
    })
    worker.once('error', (error) => { clearTimeout(timeout); reject(error) })
    worker.once('exit', () => { clearTimeout(timeout); reject(new Error('The spell reader stopped before answering.')) })
  })
}

/** CPU-heavy client parsing stays off the Electron thread; at most one table remains cached. */
export function createMacroSpellLoader(
  read: typeof loadWorker = loadWorker
): (root: string, ids: number[]) => Promise<MacroSpell[]> {
  let cached: { key: string; spells: Promise<MacroSpell[]> } | undefined
  return async (root, ids) => {
    if (ids.length > 1120 || !ids.every((id) => Number.isInteger(id) && id > 0 && id <= 0x7fffffff)) throw new Error('Invalid owned spell IDs.')
    const folder = await realpath(root)
    const path = join(folder, 'spells_us.txt')
    const stat = await lstat(path)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 128 * 1024 * 1024) throw new Error('The client spell table is unavailable or too large.')
    const sorted = [...new Set(ids)].sort((a, b) => a - b)
    const key = JSON.stringify([path, stat.size, stat.mtimeMs, sorted])
    if (cached?.key === key) return cached.spells
    const spells = sorted.length ? read(path, sorted, stat.size, stat.mtimeMs) : Promise.resolve([])
    cached = { key, spells }
    try { return await spells } catch (error) { if (cached?.key === key) cached = undefined; throw error }
  }
}
