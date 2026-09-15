import { createHash } from 'node:crypto'
import { validateWikiCatalogPack, wikiRecord } from '../../shared/wikiCatalog'
import type { WikiCatalogPack } from '../../shared/wikiCatalog'
import { createWikiQuery, type WikiNetworkOptions, type WikiQuery } from './fetch'
import { applyWikiPages, knownWikiPages, parseWikiPage, titleKey } from './parse'
import type { WikiKnownPages, WikiParsedPage } from './parse'
import { readWikiCheckpoint, validWikiTitle, type WikiRefreshCheckpoint } from './updateCheckpoint'
import { appendTitles, indexWikiBatch, startWikiCheckpoint } from './updateIndex'
import { advanceWikiBatch, inheritNormalizedContext, matchWikiBatch } from './updateBatch'
export type { WikiRefreshCheckpoint } from './updateCheckpoint'

export interface WikiRefreshProgress {
  state: 'checking' | 'downloading'
  completedPages: number
  totalPages?: number
}
export interface WikiRefreshOptions extends WikiNetworkOptions {
  base: WikiCatalogPack
  checkpoint?: unknown
  onCheckpoint?: (checkpoint: WikiRefreshCheckpoint) => void | Promise<void>
  onProgress?: (progress: WikiRefreshProgress) => void
}

function pageContent(page: Record<string, unknown>, known: WikiKnownPages): WikiParsedPage {
  if (!validWikiTitle(page.title)) throw new Error('Wiki returned a malformed page')
  if (page.missing === true) return { title: page.title, missing: true }
  if (!Array.isArray(page.revisions) || page.revisions.length !== 1) throw new Error('Wiki omitted a requested page revision')
  const revision: unknown = page.revisions[0]
  if (!wikiRecord(revision) || !wikiRecord(revision.slots) || !wikiRecord(revision.slots.main)) throw new Error('Wiki omitted page content')
  const text = revision.slots.main.content
  if (typeof text !== 'string' || text.length > 2_000_000) throw new Error('Wiki returned invalid page content')
  return parseWikiPage(page.title, text, known)
}

async function downloadBatch(query: WikiQuery, checkpoint: WikiRefreshCheckpoint, known: WikiKnownPages): Promise<void> {
  const requested = checkpoint.titles.slice(checkpoint.nextIndex, checkpoint.nextIndex + 50)
  const data = await query({ prop: 'revisions', rvprop: 'content', rvslots: 'main', titles: requested.join('|') })
  if (data.continue !== undefined) throw new Error('Wiki returned incomplete page content')
  const batch = matchWikiBatch(data, requested)
  inheritNormalizedContext(requested, batch, known)
  const parsed = batch.rows.map((page) => pageContent(page, known))
  // A target may precede its redirect in the same API batch.
  const rawByTitle = new Map(batch.rows.map((page) => [titleKey(String(page.title)), page]))
  for (let i = 0; i < parsed.length; i++) {
    const page = parsed[i]
    const raw = rawByTitle.get(titleKey(page.title))
    if (raw && known.quests.has(titleKey(page.title)) && !page.questText) parsed[i] = pageContent(raw, known)
  }
  // No checkpoint mutation until every response and parse in the batch succeeded.
  const redirects = parsed.flatMap((page) => page.redirect ? [page.redirect] : [])
  advanceWikiBatch(checkpoint, requested.length, batch)
  appendTitles(checkpoint, redirects)
  for (const page of parsed) checkpoint.pages[titleKey(page.title)] = page
}

function dataDigest(pack: WikiCatalogPack): string {
  const order = <T extends { page: string }>(rows: T[]): T[] => [...rows].sort((a, b) => a.page.localeCompare(b.page))
  return createHash('sha256').update(JSON.stringify(canonical([
    pack.items.items, order(pack.mobs.mobs), order(pack.quests.quests), pack.metadata.levelNotes, pack.metadata.walkthroughs
  ]))).digest('hex')
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (!wikiRecord(value)) return value
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, v]) => [key, canonical(v)]))
}

function finish(base: WikiCatalogPack, checkpoint: WikiRefreshCheckpoint): WikiCatalogPack {
  const pack = applyWikiPages(base, checkpoint.pages)
  const digest = dataDigest(pack)
  if (digest !== dataDigest(base)) {
    pack.items.scrapedAt = checkpoint.watermark
    pack.mobs.scrapedAt = checkpoint.watermark
    pack.quests.scrapedAt = checkpoint.watermark
    pack.metadata.snapshotAt = checkpoint.watermark
  }
  pack.checkedAt = checkpoint.watermark
  pack.generation = createHash('sha256').update(`${base.generation}\n${pack.checkedAt}\n${digest}`).digest('hex')
  if (!validateWikiCatalogPack(pack, base.baseFingerprint)) throw new Error('Refreshed catalog failed validation; the previous catalog was kept')
  return pack
}

function resumedKnownPages(base: WikiCatalogPack, pages: Record<string, WikiParsedPage>): WikiKnownPages {
  const known = knownWikiPages(base)
  for (let pass = 0; pass < 8; pass++) {
    for (const page of Object.values(pages)) {
      if (page.redirect && known.quests.has(titleKey(page.title))) known.quests.add(titleKey(page.redirect))
    }
  }
  return known
}

async function collect(options: WikiRefreshOptions, query: WikiQuery, checkpoint: WikiRefreshCheckpoint): Promise<void> {
  while (checkpoint.phase === 'index') {
    options.signal?.throwIfAborted()
    await indexWikiBatch(query, checkpoint, options.base)
    await options.onCheckpoint?.(checkpoint)
    options.onProgress?.({ state: 'checking', completedPages: 0, totalPages: checkpoint.titles.length })
  }
  const known = resumedKnownPages(options.base, checkpoint.pages)
  while (checkpoint.nextIndex < checkpoint.titles.length) {
    options.signal?.throwIfAborted()
    options.onProgress?.({ state: 'downloading', completedPages: checkpoint.nextIndex, totalPages: checkpoint.titles.length })
    await downloadBatch(query, checkpoint, known)
    await options.onCheckpoint?.(checkpoint)
  }
  options.onProgress?.({ state: 'downloading', completedPages: checkpoint.nextIndex, totalPages: checkpoint.titles.length })
}

/** Complete pack or rejection. Partial work is resumable but never returned as active data. */
export async function runWikiRefresh(options: WikiRefreshOptions): Promise<WikiCatalogPack> {
  if (!validateWikiCatalogPack(options.base)) throw new Error('The existing wiki catalog is invalid')
  const query = createWikiQuery(options)
  options.onProgress?.({ state: 'checking', completedPages: 0 })
  const saved = readWikiCheckpoint(options.checkpoint, options.base)
  let checkpoint = saved ?? await startWikiCheckpoint(query, options.base)
  if (saved?.phase === 'index' && saved.mode === 'incremental') {
    const measured = await startWikiCheckpoint(query, options.base)
    if (measured.mode === 'full') checkpoint = measured
  }
  await options.onCheckpoint?.(checkpoint)
  await collect(options, query, checkpoint)
  return finish(options.base, checkpoint)
}
