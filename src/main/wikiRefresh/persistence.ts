// Immutable generation files let the running app and every engine respawn keep one catalog.
import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { validateWikiCatalogPack, type WikiCatalogPack } from '../../shared/wikiCatalog'

const MAX_CACHE_BYTES = 160 * 1024 * 1024
export interface WikiCacheState {
  schemaVersion: 1
  baseFingerprint: string
  activeGeneration?: string
  previousGeneration?: string
  pendingGeneration?: string
  pendingUpdatedAt?: string
  lastCheckedAt?: string
  nextCheckAt?: string
  failures?: number
  error?: string
}

function jsonFile(path: string, limit = MAX_CACHE_BYTES): unknown {
  if (statSync(path).size > limit) throw new Error('Wiki cache exceeds its size limit')
  return JSON.parse(readFileSync(path, 'utf8')) as unknown
}

function serializedJson(value: unknown, limit: number): string {
  const json = JSON.stringify(value)
  if (Buffer.byteLength(json, 'utf8') > limit) throw new Error('Wiki cache exceeds its size limit')
  return json
}

function atomicJson(path: string, value: unknown, limit = MAX_CACHE_BYTES): void {
  const temp = `${path}.${randomUUID()}.tmp`
  writeFileSync(temp, serializedJson(value, limit), { flag: 'wx' })
  renameSync(temp, path)
}

function validDate(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

export class WikiCache {
  constructor(readonly directory: string, readonly baseFingerprint: string, private readonly maxBytes = MAX_CACHE_BYTES) {}

  packPath(generation: string): string {
    const key = createHash('sha256').update(`${this.baseFingerprint}:${generation}`).digest('hex')
    return join(this.directory, `${key}.json`)
  }

  readState(): WikiCacheState {
    const empty: WikiCacheState = { schemaVersion: 1, baseFingerprint: this.baseFingerprint }
    try {
      const value = jsonFile(join(this.directory, 'state.json'), 64 * 1024)
      if (!value || typeof value !== 'object') return empty
      const row = value as Record<string, unknown>
      if (row.schemaVersion !== 1 || row.baseFingerprint !== this.baseFingerprint) return empty
      return {
        ...empty,
        activeGeneration: this.generation(row.activeGeneration),
        previousGeneration: this.generation(row.previousGeneration),
        pendingGeneration: this.generation(row.pendingGeneration),
        pendingUpdatedAt: validDate(row.pendingUpdatedAt) ? row.pendingUpdatedAt : undefined,
        lastCheckedAt: validDate(row.lastCheckedAt) ? row.lastCheckedAt : undefined,
        nextCheckAt: validDate(row.nextCheckAt) ? row.nextCheckAt : undefined,
        failures: typeof row.failures === 'number' ? Math.max(0, Math.min(20, row.failures)) : 0,
        error: typeof row.error === 'string' ? row.error.slice(0, 500) : undefined
      }
    } catch { return empty }
  }

  private generation(value: unknown): string | undefined {
    return typeof value === 'string' && value.length > 0 && value.length < 200 ? value : undefined
  }

  writeState(change: Partial<WikiCacheState>): WikiCacheState {
    mkdirSync(this.directory, { recursive: true })
    const state = { ...this.readState(), ...change, schemaVersion: 1 as const, baseFingerprint: this.baseFingerprint }
    atomicJson(join(this.directory, 'state.json'), state, 64 * 1024)
    return state
  }

  readPack(generation: string | undefined): WikiCatalogPack | undefined {
    if (!generation) return undefined
    try {
      const pack = jsonFile(this.packPath(generation), this.maxBytes)
      return validateWikiCatalogPack(pack, this.baseFingerprint) && pack.generation === generation ? pack : undefined
    } catch { return undefined }
  }

  savePack(pack: WikiCatalogPack): string {
    if (!validateWikiCatalogPack(pack, this.baseFingerprint)) throw new Error('Wiki catalog did not pass validation')
    mkdirSync(this.directory, { recursive: true })
    const path = this.packPath(pack.generation)
    // Never replace a file the running engine could be reading lazily.
    const existing = this.readPack(pack.generation)
    if (existing) {
      if (JSON.stringify(existing) !== JSON.stringify(pack)) throw new Error('Wiki generation identity collision')
      return path
    }
    writeFileSync(path, serializedJson(pack, this.maxBytes), { flag: 'wx' })
    return path
  }

  activate(bundled: WikiCatalogPack): { pack: WikiCatalogPack; path: string } {
    const state = this.readState()
    let pack = this.readPack(state.pendingGeneration) ?? this.readPack(state.activeGeneration) ?? this.readPack(state.previousGeneration) ?? bundled
    let path: string
    try { path = this.savePack(pack) }
    catch (error) {
      // A damaged bundled cache file must not block the shipped fallback. Give its replacement
      // a new immutable identity; never overwrite a pathname another process might have open.
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error
      pack = { ...pack, generation: `recovered-${randomUUID()}` }
      path = this.savePack(pack)
    }
    this.writeState({ activeGeneration: pack.generation,
      previousGeneration: state.activeGeneration === pack.generation ? state.previousGeneration : state.activeGeneration,
      pendingGeneration: undefined, pendingUpdatedAt: undefined })
    return { pack, path }
  }

  stage(pack: WikiCatalogPack, active: WikiCatalogPack): void {
    this.savePack(pack)
    const pending = pack.generation !== active.generation
    this.writeState({ pendingGeneration: pending ? pack.generation : undefined, pendingUpdatedAt: pending && pack.metadata.snapshotAt !== active.metadata.snapshotAt ? pack.metadata.snapshotAt : undefined })
  }

  latest(active: WikiCatalogPack): WikiCatalogPack {
    return this.readPack(this.readState().pendingGeneration) ?? active
  }

  checkpoint(): unknown {
    try { return jsonFile(join(this.directory, 'checkpoint.json'), this.maxBytes) } catch { return undefined }
  }

  saveCheckpoint(checkpoint: unknown): void {
    mkdirSync(this.directory, { recursive: true })
    atomicJson(join(this.directory, 'checkpoint.json'), checkpoint, this.maxBytes)
  }

  /** Call only from the owning app after its instance lock, or its one refresh worker. */
  prune(pinnedGeneration: string): void {
    const state = this.readState()
    const keep = new Set([pinnedGeneration, state.activeGeneration, state.previousGeneration, state.pendingGeneration]
      .filter((generation): generation is string => !!generation).map((generation) => this.packPath(generation)))
    for (const name of readdirSync(this.directory)) {
      // Names are generated hashes, never a manifest-supplied path. Leave unrelated files alone.
      const isPack = /^[a-f0-9]{64}\.json$/.test(name)
      const isTemp = /^(?:state\.json|checkpoint\.json)\.[a-f0-9-]{36}\.tmp$/.test(name)
      const path = join(this.directory, name)
      if ((isPack && !keep.has(path)) || isTemp) unlinkSync(path)
    }
  }
}
