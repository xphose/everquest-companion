import { wikiRecord, wikiStamp } from '../../shared/wikiCatalog'
import type { WikiCatalogPack } from '../../shared/wikiCatalog'
import type { WikiQuery } from './fetch'
import type { WikiRefreshCheckpoint } from './updateCheckpoint'
import { validWikiTitle } from './updateCheckpoint'
import { titleKey } from './parse'

export function continuation(data: Record<string, unknown>): Record<string, string> {
  if (data.continue === undefined) return {}
  if (!wikiRecord(data.continue) || !Object.values(data.continue).every((v) => typeof v === 'string')) {
    throw new Error('Wiki returned an invalid continuation cursor')
  }
  return data.continue as Record<string, string>
}

export function resultRows(data: Record<string, unknown>, key: string): Record<string, unknown>[] {
  const query = data.query
  if (!wikiRecord(query) || !Array.isArray(query[key]) || !query[key].every(wikiRecord)) {
    throw new Error('Wiki returned an incomplete catalog index')
  }
  return query[key]
}

export function appendTitles(checkpoint: WikiRefreshCheckpoint, titles: unknown[]): void {
  const known = new Set(checkpoint.titles.map(titleKey))
  for (const title of titles) {
    if (!validWikiTitle(title)) throw new Error('Wiki returned an invalid page title')
    if (known.has(titleKey(title))) continue
    known.add(titleKey(title))
    checkpoint.titles.push(title)
  }
  if (checkpoint.titles.length > 100_000) throw new Error('Wiki update exceeded the page limit; the previous catalog was kept')
}

const CHANGE_PARAMS = { list: 'recentchanges', rcnamespace: '0', rctype: 'edit|new|log', rcprop: 'title|timestamp|loginfo' }

/** Retention is measured, never guessed from a fixed number of days. */
export async function startWikiCheckpoint(query: WikiQuery, base: WikiCatalogPack): Promise<WikiRefreshCheckpoint> {
  const oldest = await query({ ...CHANGE_PARAMS, rcdir: 'newer', rclimit: '1', curtimestamp: '1' })
  if (!wikiStamp(oldest.curtimestamp)) throw new Error('Wiki did not provide a reconciliation timestamp')
  const rows = resultRows(oldest, 'recentchanges')
  const first = rows[0]?.timestamp
  const mode = wikiStamp(first) && Date.parse(first) <= Date.parse(base.checkedAt) ? 'incremental' : 'full'
  const checkpoint: WikiRefreshCheckpoint = {
    schemaVersion: 1, baseGeneration: base.generation, baseFingerprint: base.baseFingerprint,
    watermark: oldest.curtimestamp, mode, phase: 'index', cursor: {}, titles: [], nextIndex: 0, pages: {}
  }
  if (mode === 'full') appendTitles(checkpoint, [
    ...Object.values(base.items.items).map((item) => item.page),
    ...base.mobs.mobs.map((mob) => mob.page), ...base.quests.quests.map((quest) => quest.page)
  ])
  return checkpoint
}

export async function indexWikiBatch(query: WikiQuery, checkpoint: WikiRefreshCheckpoint, base: WikiCatalogPack): Promise<void> {
  const params: Record<string, string> = checkpoint.mode === 'full'
    ? { list: 'allpages', apnamespace: '0', aplimit: '500' }
    : { ...CHANGE_PARAMS, rcdir: 'newer', rclimit: '500', rcstart: base.checkedAt, rcend: checkpoint.watermark }
  const data = await query({ ...params, ...checkpoint.cursor })
  const rows = resultRows(data, checkpoint.mode === 'full' ? 'allpages' : 'recentchanges')
  const titles: unknown[] = rows.map((row) => row.title)
  for (const row of rows) {
    // A move changes BOTH identities, including moves that suppress the old redirect.
    if (row.logtype !== 'move' || !wikiRecord(row.logparams)) continue
    if (row.logparams.target_title !== undefined) titles.push(row.logparams.target_title)
  }
  appendTitles(checkpoint, titles)
  const next = continuation(data)
  if (Object.keys(next).length && JSON.stringify(next) === JSON.stringify(checkpoint.cursor)) {
    throw new Error('Wiki repeated a continuation cursor; the previous catalog was kept')
  }
  checkpoint.cursor = next
  if (!Object.keys(next).length) checkpoint.phase = 'download'
}
