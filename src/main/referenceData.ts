// Electron-free so parsers and unit tests retain the shipped offline catalog. channel.ts pins
// the launch's validated cache before any consumer constructs its indexes.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import bundledItems from './data/items.json'
import bundledMobs from '../renderer/src/data/eqlegends/mobs.json'
import bundledQuests from '../renderer/src/data/eqlegends/quests.json'
import bundledMetadata from './data/questJournalMetadata.json'
import type { WikiCatalogPack, WikiCatalogRendererData } from '../shared/wikiCatalog'
import type { MobData, QuestData } from '../shared/types'
import type { ItemDbFile } from './itemsDb'
import { WikiCache } from './wikiRefresh/persistence'

export function bundledWikiCatalog(): WikiCatalogPack {
  const metadata = { snapshotAt: bundledMetadata.snapshotAt, levelNotes: bundledMetadata.levelNotes, walkthroughs: bundledMetadata.walkthroughs }
  const contents = { items: bundledItems as unknown as ItemDbFile, mobs: bundledMobs, quests: bundledQuests, metadata }
  const baseFingerprint = createHash('sha256').update(JSON.stringify(contents)).digest('hex')
  const stamps: string[] = [contents.items.scrapedAt, contents.mobs.scrapedAt, contents.quests.scrapedAt, contents.metadata.snapshotAt]
  const checkedAt = stamps.reduce((oldest, stamp) => stamp < oldest ? stamp : oldest)
  return { schemaVersion: 1, baseFingerprint, generation: `bundled-${baseFingerprint}`, checkedAt, ...contents }
}

let selected: WikiCatalogPack | undefined
let selectedPath: string | undefined
let selectedDigest: string | undefined
let initialized = false
let cache: WikiCache | undefined
let initializationFailed = false
export let itemsJson = bundledItems as unknown as ItemDbFile
export let mobsJson: MobData = bundledMobs
export let questsJson: QuestData = bundledQuests
export let metadataJson: WikiCatalogPack['metadata'] = bundledMetadata

export function initializeReferenceData(userData: string): void {
  if (initialized) return
  const bundled = bundledWikiCatalog()
  cache = new WikiCache(join(userData, 'wiki-catalog'), bundled.baseFingerprint)
  try {
    const active = cache.activate(bundled)
    selected = active.pack
    selectedPath = active.path
    selectedDigest = createHash('sha256').update(readFileSync(active.path)).digest('hex')
  } catch {
    // Cache access must not prevent startup. Both processes use their shipped corpus when no
    // cache can be pinned; a visible refresh error explains why it could not be selected.
    selected = bundled
    selectedPath = undefined
    selectedDigest = undefined
    initializationFailed = true
  }
  itemsJson = selected.items
  mobsJson = selected.mobs
  questsJson = selected.quests
  metadataJson = selected.metadata
  initialized = true
}

export function activeWikiCatalog(): WikiCatalogPack { return selected ??= bundledWikiCatalog() }
export function activeWikiUpdatedAt(): string {
  const pack = activeWikiCatalog()
  return [pack.items.scrapedAt, pack.mobs.scrapedAt, pack.quests.scrapedAt, pack.metadata.snapshotAt].sort()[0]
}
export function referenceDataInitializationFailed(): boolean { return initializationFailed }
export function wikiCache(): WikiCache {
  if (!cache) throw new Error('Wiki catalog must be initialized after choosing application data')
  return cache
}

export function wikiCatalogEngineEnvironment(inherited: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  // Only this launch chooses the engine's catalog; inherited environment overrides are ignored.
  const env = { ...inherited }
  delete env.EQC_WIKI_CATALOG_PATH
  delete env.EQC_WIKI_CATALOG_GENERATION
  delete env.EQC_WIKI_CATALOG_SHA256
  if (selectedPath) {
    env.EQC_WIKI_CATALOG_PATH = selectedPath
    env.EQC_WIKI_CATALOG_GENERATION = activeWikiCatalog().generation
    env.EQC_WIKI_CATALOG_SHA256 = selectedDigest
  }
  return env
}

export function getWikiCatalogRendererData(): WikiCatalogRendererData {
  const pack = activeWikiCatalog()
  return { generation: pack.generation, mobs: pack.mobs, quests: pack.quests }
}
