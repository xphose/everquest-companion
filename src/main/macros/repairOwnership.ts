import { createHash } from 'node:crypto'
import { parseSocialIni, type ManagedSocial, type ParsedSocial, type SocialRequest } from './socialIni'
import type { MacroSaved, QueuedMacros } from './types'

export function repairId(slot: { page: number; button: number }): string { return `repair:${slot.page}:${slot.button}` }

/** Exact complete known fields plus every current hotbutton alias; names never confer ownership. */
export function repairFingerprint(text: string, slot: { page: number; button: number }): string | undefined {
  const parsed = parseSocialIni(text)
  const social = parsed.socials.find((entry) => entry.page === slot.page && entry.button === slot.button)
  if (!social || social.ambiguous || Object.keys(social.fields).some((key) => !/^(name|color|line[1-5])$/.test(key))) return undefined
  const index = (slot.page - 1) * 12 + slot.button - 1
  const aliases = parsed.hotbuttons.filter((entry) => Number(/^E(\d+),/.exec(entry.value)?.[1]) === index)
  if (aliases.some((entry) => entry.ambiguous)) return undefined
  const fields = Object.entries(social.fields).sort(([a], [b]) => a.localeCompare(b))
  return createHash('sha256').update(JSON.stringify([slot.page, slot.button, fields, aliases])).digest('hex')
}

export function socialRequest(id: string, social: Pick<ParsedSocial, 'fields'>, lines?: readonly string[]): SocialRequest {
  return { id, name: social.fields.name ?? '', color: Number(social.fields.color ?? 0),
    lines: lines ?? Array.from({ length: 5 }, (_, index) => social.fields[`line${index + 1}`] ?? '') }
}

export function repairOwnership(text: string, queue: QueuedMacros, previous: ManagedSocial[]): ManagedSocial[] {
  const claimed = [...previous]
  for (const claim of queue.repairs ?? []) {
    if (repairId(claim.original) !== claim.id || claim.original.id !== claim.id ||
      !claim.fingerprint || repairFingerprint(text, claim.original) !== claim.fingerprint) {
      throw new Error('The personal social or its hotbutton references changed after review. Refresh and review its replacement again.')
    }
    if (claimed.some((entry) => entry.id === claim.id || entry.page === claim.original.page && entry.button === claim.original.button)) {
      throw new Error('This social already has managed ownership. Refresh before replacing it.')
    }
    // No hotbutton ownership: all existing aliases retain their exact original bytes.
    claimed.push({ id: claim.id, page: claim.original.page, button: claim.original.button, fields: { ...claim.original.fields } })
  }
  return claimed
}

export function rememberRepairs(saved: MacroSaved, queue: QueuedMacros): void {
  if (!queue.repairs?.length) return
  saved.repairs ??= {}
  const bindings = new Map((saved.repairs[queue.targetFile] ?? []).map((entry) => [entry.id, entry]))
  for (const claim of queue.repairs) bindings.set(claim.id, { id: claim.id, selection: claim.selection })
  saved.repairs[queue.targetFile] = [...bindings.values()]
}
