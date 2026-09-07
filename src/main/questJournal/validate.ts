import { isClassAbbr } from '../../shared/classCombo'
import { classAbbrForDisplayName, classDisplayName } from '../../shared/spellLevels'
import { sanitizeRecovery } from './recovery/records'
import type {
  QuestJournalManual, QuestJournalMutation, QuestJournalProfile,
  QuestJournalProgress, QuestJournalQuery
} from '../../shared/questJournal/journal'

export function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : null
}

export function safeId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 300 &&
    !['__proto__', 'constructor', 'prototype'].includes(value) && !/\p{Cc}/u.test(value)
}

export function normalizedClass(value: string): string | undefined {
  const code = isClassAbbr(value.toUpperCase()) ? value.toUpperCase() : classAbbrForDisplayName(value)
  return isClassAbbr(code) ? classDisplayName(code) : undefined
}

function levelNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 125
}

export function sanitizeProfile(value: unknown): QuestJournalProfile | undefined {
  const r = record(value)
  if (!r || !Array.isArray(r.classes) || r.classes.length > 3) return undefined
  if (r.level !== undefined && !levelNumber(r.level)) return undefined
  const classes: string[] = []
  for (const c of r.classes) {
    if (typeof c !== 'string') return undefined
    const name = normalizedClass(c)
    if (!name) return undefined
    if (!classes.includes(name)) classes.push(name)
  }
  return { classes, ...(levelNumber(r.level) ? { level: r.level } : {}) }
}

export function sanitizeManual(value: unknown): QuestJournalManual {
  const r = record(value)
  const steps: Record<string, boolean> = {}
  for (const [id, checked] of Object.entries(record(r?.steps) ?? {}).slice(0, 100)) {
    if (safeId(id) && typeof checked === 'boolean') steps[id] = checked
  }
  return {
    tracked: r?.tracked === true,
    ...(r?.status === 'active' || r?.status === 'completed' ? { status: r.status } : {}),
    steps
  }
}

export function sanitizeProgress(value: unknown): QuestJournalProgress {
  const r = record(value)
  const quests: Record<string, QuestJournalManual> = {}
  for (const [id, manual] of Object.entries(record(r?.quests) ?? {}).slice(0, 5000)) {
    if (safeId(id)) quests[id] = sanitizeManual(manual)
  }
  return { version: 1, quests, profile: sanitizeProfile(r?.profile), recovery: sanitizeRecovery(r?.recovery) }
}

const FILTERS = new Set(['all', 'tracked', 'active', 'completed', 'ready', 'unknown'])

function boundedInteger(value: unknown, fallback: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(max, Math.floor(value))) : fallback
}

export function sanitizeQuery(value: unknown): QuestJournalQuery & { offset: number; limit: number } {
  const r = record(value) ?? {}
  const text = (v: unknown): string => typeof v === 'string' ? v.trim().slice(0, 200) : ''
  return {
    search: text(r.search), zone: text(r.zone), className: text(r.className),
    state: typeof r.state === 'string' && FILTERS.has(r.state)
      ? r.state as QuestJournalQuery['state'] : 'all',
    level: levelNumber(r.level) ? r.level : undefined,
    sort: r.sort === 'name' ? 'name' : 'recommended',
    offset: boundedInteger(r.offset, 0, 100000),
    limit: Math.max(1, boundedInteger(r.limit, 50, 50))
  }
}

export function validateMutation(value: unknown): QuestJournalMutation | null {
  const r = record(value)
  if (!r || !safeId(r.characterId) || r.characterId === 'none') return null
  if (r.action === 'profile') {
    const profile = sanitizeProfile(r)
    return profile ? { characterId: r.characterId, action: 'profile', ...profile } : null
  }
  if (!safeId(r.id)) return null
  return questMutation(r, { characterId: r.characterId, id: r.id })
}

function questMutation(r: Record<string, unknown>, base: { characterId: string; id: string }): QuestJournalMutation | null {
  if (r.action === 'track' && typeof r.value === 'boolean') return { ...base, action: 'track', value: r.value }
  if (r.action === 'status' && typeof r.value === 'string' && ['active', 'completed', 'unknown'].includes(r.value)) {
    return { ...base, action: 'status', value: r.value as 'active' | 'completed' | 'unknown' }
  }
  if (r.action === 'step' && safeId(r.stepId) && (typeof r.value === 'boolean' || r.value === null)) {
    return { ...base, action: 'step', stepId: r.stepId, value: r.value }
  }
  return null
}

export function applyMutation(progress: QuestJournalProgress, mutation: QuestJournalMutation): QuestJournalProgress {
  if (mutation.action === 'profile') return { ...progress, profile: sanitizeProfile(mutation) }
  const manual = sanitizeManual(progress.quests[mutation.id])
  if (mutation.action === 'track') manual.tracked = mutation.value
  if (mutation.action === 'status') manual.status = mutation.value === 'unknown' ? undefined : mutation.value
  if (mutation.action === 'step') {
    if (mutation.value === null) Reflect.deleteProperty(manual.steps, mutation.stepId)
    else manual.steps[mutation.stepId] = mutation.value
  }
  return { ...progress, quests: { ...progress.quests, [mutation.id]: manual } }
}
