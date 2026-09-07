import type { RecoveryObjective, RecoveryRecord, RecoverySource } from '../../../shared/questJournal/recovery'

export const MAX_RECOVERY = 5000
export const MAX_CANDIDATES = 250
export const SOURCES: RecoverySource[] = ['task-window', 'history-window', 'achievement', 'inventory', 'npc-journal']

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function text(value: unknown, max = 300): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max && !/\p{Cc}/u.test(value) &&
    !['__proto__', 'constructor', 'prototype'].includes(value)
}

function count(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 1000000
}

export function sanitizeObjectives(value: unknown): RecoveryObjective[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.slice(0, 50).flatMap((raw) => {
    const r = object(raw)
    if (!r || !text(r.text, 500)) return []
    const pair = count(r.current) && count(r.required) && r.required > 0 && r.current <= r.required
    return [{ text: r.text, ...(pair ? { current: r.current as number, required: r.required as number } : {}),
      ...(typeof r.complete === 'boolean' ? { complete: r.complete } : {}) }]
  })
}

function validMetadata(r: Record<string, unknown>): boolean {
  return ['active', 'completed'].includes(String(r.state)) && ['confirmed', 'user-confirmed'].includes(String(r.confidence)) &&
    SOURCES.includes(r.source as RecoverySource)
}

function recoveryRecord(id: string, value: unknown): RecoveryRecord | undefined {
  const r = object(value)
  if (r?.questId !== id || !text(id) || !text(r.name) || !validMetadata(r)) return undefined
  if (typeof r.recoveredAt !== 'number' || !Number.isFinite(new Date(r.recoveredAt).getTime()) || r.recoveredAt <= 0) return undefined
  if (!Array.isArray(r.evidence)) return undefined
  const evidence = r.evidence.filter((line): line is string => text(line, 1000)).slice(0, 20)
  if (!evidence.length) return undefined
  return { questId: id, name: r.name, state: r.state as RecoveryRecord['state'], confidence: r.confidence as RecoveryRecord['confidence'], source: r.source as RecoverySource,
    recoveredAt: r.recoveredAt, evidence, objectives: sanitizeObjectives(r.objectives) }
}

/** Disk content is untrusted; a malformed recovery row never becomes a completion baseline. */
export function sanitizeRecovery(value: unknown): Record<string, RecoveryRecord> {
  const result: Record<string, RecoveryRecord> = {}
  for (const [id, raw] of Object.entries(object(value) ?? {}).slice(0, MAX_RECOVERY)) {
    const row = recoveryRecord(id, raw)
    if (row) result[id] = row
  }
  return result
}
