import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { MacroRepository, MacroSaved } from './types'
import { emptyMacroSaved, object, settingsPatch } from './settings'

/** Private per-channel state, separate from exports and shared character profiles. */
export function createMacroRepository(folder: string): MacroRepository {
  const previous = new Map<string, string>()
  const read = async (key: string): Promise<MacroSaved> => {
    if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('Invalid macro storage key.')
    const path = join(folder, `${key}.json`)
    try {
      if ((await stat(path)).size > 4 * 1024 * 1024) throw new Error('Saved macro settings are too large.')
      const text = await readFile(path, 'utf8')
      const value = object(JSON.parse(text))
      const settings = settingsPatch(value?.settings)
      if (value?.version !== 1 || !settings || !object(value.managed)) throw new Error('Saved macro settings are invalid.')
      previous.set(key, text)
      return { ...value, settings: { ...emptyMacroSaved().settings, ...settings } } as unknown as MacroSaved
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyMacroSaved()
      throw error
    }
  }
  return { get: read, put: async (key, value) => {
    if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('Invalid macro storage key.')
    const serialized = JSON.stringify({ ...value, version: 1 })
    if (serialized === previous.get(key)) return
    await mkdir(folder, { recursive: true })
    const temporary = join(folder, `${key}.${randomUUID()}.tmp`)
    await writeFile(temporary, serialized, { mode: 0o600, flag: 'wx' })
    await rename(temporary, join(folder, `${key}.json`))
    previous.set(key, serialized)
  } }
}
