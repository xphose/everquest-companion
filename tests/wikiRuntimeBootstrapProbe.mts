import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  activeWikiCatalog, bundledWikiCatalog, getWikiCatalogRendererData, initializeReferenceData,
  referenceDataInitializationFailed, wikiCatalogEngineEnvironment
} from '../src/main/referenceData'
import { WikiCache } from '../src/main/wikiRefresh/persistence'

const [userData, mode] = process.argv.slice(2)
assert.ok(userData && mode)
const bundled = bundledWikiCatalog()
const directory = join(userData, 'wiki-catalog')
if (mode === 'unwritable') {
  writeFileSync(directory, 'A file prevents cache-directory creation')
  initializeReferenceData(userData)
  assert.equal(referenceDataInitializationFailed(), true)
  assert.equal(activeWikiCatalog().generation, bundled.generation)
  const env = wikiCatalogEngineEnvironment({ EQC_WIKI_CATALOG_PATH: 'untrusted', EQC_WIKI_CATALOG_GENERATION: 'untrusted', EQC_WIKI_CATALOG_SHA256: 'untrusted' })
  assert.equal(env.EQC_WIKI_CATALOG_PATH, undefined)
  assert.equal(env.EQC_WIKI_CATALOG_GENERATION, undefined)
  assert.equal(env.EQC_WIKI_CATALOG_SHA256, undefined)
} else {
  const cache = new WikiCache(directory, bundled.baseFingerprint)
  const first = structuredClone(bundled)
  first.generation = 'synthetic-current'
  first.items.items['synthetic charm'] = { page: 'Synthetic Charm', summary: 'Pinned evidence' }
  first.mobs.mobs.push({ page: 'Synthetic Keeper', name: 'Synthetic Keeper', drops: ['Synthetic Charm'] })
  first.quests.quests.push({ page: 'Synthetic Errand', name: 'Synthetic Errand', relatedNpcs: ['Synthetic Keeper'], requiredItems: ['Synthetic Charm'] })
  cache.stage(first, bundled)
  initializeReferenceData(userData)
  const selectedEnv = wikiCatalogEngineEnvironment({ EQC_WIKI_CATALOG_PATH: 'untrusted' })
  assert.equal(selectedEnv.EQC_WIKI_CATALOG_PATH, cache.packPath(first.generation))
  assert.match(selectedEnv.EQC_WIKI_CATALOG_SHA256 ?? '', /^[a-f0-9]{64}$/)
  assert.equal(activeWikiCatalog().items.items['synthetic charm'].summary, 'Pinned evidence')
  const { getQuestJournalCatalog } = await import('../src/main/questJournal/catalog')
  assert.ok(getQuestJournalCatalog().some((quest) => quest.id === 'Synthetic Errand'))
  cache.stage({ ...first, generation: 'synthetic-pending' }, first)
  initializeReferenceData(userData)
  assert.equal(getWikiCatalogRendererData().generation, first.generation)
  assert.equal(activeWikiCatalog().generation, first.generation)
  assert.deepEqual(wikiCatalogEngineEnvironment({}), selectedEnv)
}
process.stdout.write('verified')
