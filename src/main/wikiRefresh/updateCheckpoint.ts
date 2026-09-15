import { wikiRecord, wikiStamp } from '../../shared/wikiCatalog'
import type { WikiCatalogPack } from '../../shared/wikiCatalog'
import type { WikiParsedPage } from './parse'
import { titleKey } from './parse'
import { validWikiItem, validWikiMob } from '../../shared/wikiCatalogValidation'

export interface WikiRefreshCheckpoint {
  schemaVersion: 1
  baseGeneration: string
  baseFingerprint: string
  watermark: string
  mode: 'incremental' | 'full'
  phase: 'index' | 'download'
  cursor: Record<string, string>
  titles: string[]
  nextIndex: number
  pages: Record<string, WikiParsedPage>
}
export function validWikiTitle(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512) return false
  if (['__proto__', 'constructor', 'prototype'].includes(value.toLowerCase())) return false
  for (let i = 0; i < value.length; i++) if (value.charCodeAt(i) < 32) return false
  return !/[|[\]{}<>#]/.test(value)
}

const optional = (value: unknown, check: (v: unknown) => boolean): boolean => value === undefined || check(value)
function validPage(value: unknown): boolean {
  if (!wikiRecord(value) || !validWikiTitle(value.title)) return false
  return optional(value.redirect, validWikiTitle) &&
    optional(value.questText, (v) => typeof v === 'string' && v.length <= 2_000_000) &&
    optional(value.item, validWikiItem) && optional(value.mob, validWikiMob) && optional(value.missing, (v) => v === true)
}

function validPosition(value: Record<string, unknown>): boolean {
  if (!Array.isArray(value.titles) || value.titles.length > 100_000 || !value.titles.every(validWikiTitle)) return false
  const keys = value.titles.map(titleKey)
  if (new Set(keys).size !== keys.length) return false
  if (!Number.isInteger(value.nextIndex) || Number(value.nextIndex) < 0 || Number(value.nextIndex) > keys.length) return false
  const pages = value.pages
  if (!wikiRecord(pages) || Object.keys(pages).length !== value.nextIndex) return false
  return keys.slice(0, value.nextIndex).every((key) => {
    const page = pages[key]
    return wikiRecord(page) && validPage(page) && titleKey(String(page.title)) === key
  })
}

function validPhase(value: Record<string, unknown>): boolean {
  if (!['incremental', 'full'].includes(String(value.mode)) || !['index', 'download'].includes(String(value.phase))) return false
  if (!wikiRecord(value.cursor) || !Object.values(value.cursor).every((v) => typeof v === 'string' && v.length < 2048)) return false
  if (value.phase === 'index') return value.nextIndex === 0
  return Object.keys(value.cursor).length === 0
}

/** An interrupted run resumes only against the exact immutable base it started with. */
export function readWikiCheckpoint(value: unknown, base: WikiCatalogPack): WikiRefreshCheckpoint | undefined {
  if (!wikiRecord(value) || value.schemaVersion !== 1) return undefined
  if (value.baseGeneration !== base.generation || value.baseFingerprint !== base.baseFingerprint || !wikiStamp(value.watermark)) return undefined
  if (Date.parse(value.watermark) < Date.parse(base.checkedAt)) return undefined
  if (!validPosition(value) || !validPhase(value)) return undefined
  return value as unknown as WikiRefreshCheckpoint
}
