// Install before importing any consumer: their indexes are immutable for this window's life.
// The bundled fallback keeps pure node tests and a fresh offline installation self-contained.
import mobs from '../data/eqlegends/mobs.json'
import quests from '../data/eqlegends/quests.json'
import type { WikiCatalogRendererData } from '../../../shared/wikiCatalog'

let installed: WikiCatalogRendererData | undefined
let consumed = false
const bundled = { generation: 'bundled', mobs, quests } as unknown as WikiCatalogRendererData

export function installReferenceData(data: WikiCatalogRendererData): void {
  if (consumed || installed) throw new Error('Game data must be installed before opening a view.')
  if (!data?.generation || !Array.isArray(data.mobs?.mobs) || !Array.isArray(data.quests?.quests)) {
    throw new Error('The app could not read its game data.')
  }
  installed = data
}

export function referenceData(): WikiCatalogRendererData {
  consumed = true
  return installed ?? bundled
}
