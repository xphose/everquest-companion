import { readFileSync, statSync } from 'node:fs'
import { parentPort, workerData } from 'node:worker_threads'
import { parseOwnedSpells } from './spellParser'

const { path, ids, size, mtimeMs } = workerData as { path: string; ids: number[]; size: number; mtimeMs: number }
try {
  const before = statSync(path)
  if (before.size !== size || before.mtimeMs !== mtimeMs) throw new Error('The spell table changed before reading.')
  const bytes = readFileSync(path)
  const spells = parseOwnedSpells(bytes.toString('latin1'), ids)
  const after = statSync(path)
  if (after.size !== size || after.mtimeMs !== mtimeMs) throw new Error('The spell table changed while reading.')
  parentPort?.postMessage({ ok: true, spells })
} catch (error) {
  parentPort?.postMessage({ ok: false, error: error instanceof Error ? error.message : 'Unable to read the client spell table.' })
}
