/** Offline only: preserve level qualifications omitted by the older quest catalog scraper. */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import questsJson from '../src/renderer/src/data/eqlegends/quests.json'
import pagesJson from './sources/cache/quests/quest-pages.json'
import guidesJson from '../src/main/data/questJournalGuides.json'
import { parseTopTable } from './sources/questPage'
import { wikiPageUrl } from '../src/shared/wiki'
import type { QuestJournalGuide, QuestJournalWalkthrough } from '../src/shared/questJournal/catalog'
import { extractQuestWalkthrough } from './gen-quest-journal-text'

const root = new URL('../', import.meta.url)
const cachedText = (pageId: number): string => readFileSync(
  new URL(`scripts/sources/cache/quests/page-${pageId}.wikitext`, root), 'utf8'
)
const levelNotes: Record<string, string> = {}
const walkthroughs: Record<string, QuestJournalWalkthrough> = {}
const pages = new Map(pagesJson.map((page) => [page.title, page.pageid]))
for (const quest of questsJson.quests) {
  const pageId = pages.get(quest.page)
  if (pageId === undefined) continue
  const text = cachedText(pageId)
  const note = parseTopTable(text)?.minLevelText
  if (note) levelNotes[quest.page] = note
  const walkthrough = extractQuestWalkthrough(text)
  if (walkthrough.sections.length) walkthroughs[quest.page] = walkthrough
}

const guides = guidesJson as Record<string, QuestJournalGuide>
for (const [page, guide] of Object.entries(guides)) {
  const pageId = pages.get(page)
  if (pageId === undefined) throw new Error(`No cached source for curated guide: ${page}`)
  guide.source = {
    url: wikiPageUrl(page) ?? '',
    snapshotAt: questsJson.scrapedAt,
    cachePageId: pageId,
    cacheSha256: createHash('sha256').update(cachedText(pageId)).digest('hex')
  }
}

for (const [name, data] of [
  ['questJournalMetadata.json', { snapshotAt: questsJson.scrapedAt, levelNotes, walkthroughs }],
  ['questJournalGuides.json', guides]
] as const) {
  const target = new URL(`src/main/data/${name}`, root)
  writeFileSync(target, JSON.stringify(data, null, 2) + '\n')
  console.log(`Wrote ${fileURLToPath(target)}`)
}
