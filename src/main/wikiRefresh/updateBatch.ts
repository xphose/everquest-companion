import { wikiRecord } from '../../shared/wikiCatalog'
import { titleKey, type WikiKnownPages } from './parse'
import { validWikiTitle, type WikiRefreshCheckpoint } from './updateCheckpoint'
import { resultRows } from './updateIndex'

interface MatchedBatch {
  rows: Record<string, unknown>[]
  titles: string[]
  normalize: (title: string) => string
}

function normalizationMap(data: Record<string, unknown>): Map<string, string> {
  if (!wikiRecord(data.query)) throw new Error('Wiki returned incomplete page content')
  const normalized = data.query.normalized
  if (normalized === undefined) return new Map()
  if (!Array.isArray(normalized)) throw new Error('Wiki returned invalid title normalizations')
  const aliases = new Map<string, string>()
  for (const row of normalized) {
    if (!wikiRecord(row) || !validWikiTitle(row.from) || !validWikiTitle(row.to)) throw new Error('Wiki returned invalid title normalizations')
    const key = titleKey(row.from)
    const previous = aliases.get(key)
    if (previous && previous !== row.to) throw new Error('Wiki returned conflicting title normalizations')
    aliases.set(key, row.to)
  }
  return aliases
}

function normalizeThrough(title: string, aliases: Map<string, string>): string {
  let current = title
  const seen = new Set<string>()
  for (;;) {
    const key = titleKey(current)
    const next = aliases.get(key)
    if (!next) return current
    if (titleKey(next) === key) return next
    if (seen.has(key) || seen.size >= 8) throw new Error('Wiki returned cyclic title normalizations')
    seen.add(key)
    current = next
  }
}

/** Match unique canonical identities, not raw counts: aliases can legitimately collapse. */
export function matchWikiBatch(data: Record<string, unknown>, requested: string[]): MatchedBatch {
  const aliases = normalizationMap(data)
  const normalize = (title: string): string => normalizeThrough(title, aliases)
  const titles = requested.map(normalize)
  const expected = new Set(titles.map(titleKey))
  const rows = resultRows(data, 'pages')
  const actual = new Set<string>()
  for (const row of rows) {
    if (!validWikiTitle(row.title)) throw new Error('Wiki returned a malformed page')
    const key = titleKey(row.title)
    if (!expected.has(key) || actual.has(key)) throw new Error('Wiki returned an unexpected page batch')
    actual.add(key)
  }
  if (actual.size !== expected.size) throw new Error('Wiki omitted one or more requested pages')
  return { rows, titles, normalize }
}

export function inheritNormalizedContext(requested: string[], batch: MatchedBatch, known: WikiKnownPages): void {
  for (const title of requested) {
    for (const kind of [known.items, known.mobs, known.quests]) {
      if (kind.has(titleKey(title))) kind.add(titleKey(batch.normalize(title)))
    }
  }
}

/** Keep completed work, collapse normalized aliases, then retain the remaining queue. */
export function advanceWikiBatch(checkpoint: WikiRefreshCheckpoint, count: number, batch: MatchedBatch): void {
  const completed = checkpoint.titles.slice(0, checkpoint.nextIndex)
  const remainder = checkpoint.titles.slice(checkpoint.nextIndex + count).map(batch.normalize)
  const seen = new Set<string>()
  const unique = (titles: string[]): string[] => titles.filter((title) => {
    const key = titleKey(title)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  const prefix = unique([...completed, ...batch.titles])
  checkpoint.titles = [...prefix, ...unique(remainder)]
  checkpoint.nextIndex = prefix.length
}
