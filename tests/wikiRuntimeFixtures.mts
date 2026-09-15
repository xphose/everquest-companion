import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WikiCache } from '../src/main/wikiRefresh/persistence'
import type { WikiCatalogPack } from '../src/shared/wikiCatalog'

export const STAMP = '2026-09-15T12:00:00.000Z'
export function pack(generation = 'one', stamp = STAMP): WikiCatalogPack {
  return {
    schemaVersion: 1, baseFingerprint: 'synthetic-baseline', generation, checkedAt: stamp,
    items: { scrapedAt: stamp, source: 'Synthetic fixture', count: 1, items: { 'test charm': { page: 'Test Charm' } } },
    mobs: { scrapedAt: stamp, source: 'Synthetic fixture', mobs: [{ page: 'Test Keeper', name: 'Test Keeper', level: '4', drops: ['Test Charm'] }] },
    quests: { scrapedAt: stamp, source: 'Synthetic fixture', quests: [{ page: 'Test Errand', name: 'Test Errand', requiredItems: ['Test Charm'] }] },
    metadata: { snapshotAt: stamp, levelNotes: {}, walkthroughs: {} }
  }
}

export function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'eqc-wiki-runtime-'))
  const cache = new WikiCache(directory, 'synthetic-baseline')
  const base = pack()
  cache.activate(base)
  return { directory, cache, base, cleanup: () => rmSync(directory, { recursive: true, force: true }) }
}

export function clock() {
  let now = Date.parse(STAMP)
  let next: { callback(): void; delay: number } | undefined
  return {
    now: () => now,
    timer: (callback: () => void, delay: number) => {
      next = { callback, delay }
      return { unref() { /* Synthetic clock does not hold Node open. */ } } as ReturnType<typeof setTimeout>
    },
    clearTimer: () => { next = undefined },
    delay: () => next?.delay,
    advance: (ms: number) => { now += ms },
    fire: () => { const task = next; next = undefined; task?.callback() }
  }
}
