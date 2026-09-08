// Pure edits for the client's normal [Socials] and [HotButtonsN] INI sections.
// Callers own process-exit gating, encoding, backups and compare-before-replace of the FILE.
// This module owns compare-before-replace of each managed SLOT. A matching name is not ownership.
// Raw lines retain their exact terminators; unrelated bytes survive a Latin-1 decode/encode too.

export interface SocialContent { name: string; color: number; lines: readonly string[] }
export interface HotbarDestination { bar: number; page: number }
export interface SocialRequest extends SocialContent { id: string; hotbar?: HotbarDestination }
export interface SocialSlot { page: number; button: number }
export interface ManagedHotbutton extends SocialSlot { bar: number; value: string }
export interface ManagedSocial extends SocialSlot {
  id: string
  /** All fields written into this slot, keyed by lowercase field suffix. */
  fields: Record<string, string>
  hotbutton?: ManagedHotbutton
}
export interface SocialConflict { id: string; reason: string }
export interface SocialIniPlan {
  /** Exact original, for a backup and a caller's final file-content comparison. */
  original: string
  text: string
  changed: boolean
  managed: ManagedSocial[]
  conflicts: SocialConflict[]
}

interface IniLine { text: string; eol: string; section: string; key?: string; value?: string }
interface IniDocument { lines: IniLine[]; sections: Map<string, number>; eol: string }
export interface ParsedSocial extends SocialSlot { fields: Record<string, string>; ambiguous: boolean }
export interface ParsedHotbutton extends SocialSlot { bar: number; value: string; ambiguous: boolean }
export interface ParsedSocialIni { socials: ParsedSocial[]; hotbuttons: ParsedHotbutton[] }

function parseDocument(text: string): IniDocument {
  let section = ''
  const sections = new Map<string, number>()
  const lines: IniLine[] = []
  for (const match of text.matchAll(/([^\r\n]*)(\r\n|\n|\r|$)/g)) {
    if (match[0] === '') continue
    const raw = match[1]
    const heading = /^\s*\[([^\]]+)\]\s*$/.exec(raw.replace(/^\uFEFF/, ''))
    if (heading) {
      section = heading[1].trim().toLowerCase()
      sections.set(section, (sections.get(section) ?? 0) + 1)
    }
    const entry = /^\s*([^;#=][^=]*?)\s*=(.*)$/.exec(raw)
    lines.push({ text: raw, eol: match[2], section,
      ...(entry && !heading ? { key: entry[1].toLowerCase(), value: entry[2] } : {}) })
  }
  return { lines, sections, eol: lines.find((line) => line.eol)?.eol ?? '\r\n' }
}

function sectionName(bar: number): string { return bar === 1 ? 'hotbuttons' : `hotbuttons${bar}` }
function slotPrefix(slot: SocialSlot): string { return `page${slot.page}button${slot.button}` }
function validInteger(n: number, max: number): boolean { return Number.isInteger(n) && n >= 1 && n <= max }
function validSlot(slot: SocialSlot): boolean { return validInteger(slot.page, 10) && validInteger(slot.button, 12) }

function socialAt(doc: IniDocument, slot: SocialSlot): ParsedSocial {
  const fields: Record<string, string> = {}
  let ambiguous = (doc.sections.get('socials') ?? 0) > 1
  const prefix = slotPrefix(slot)
  for (const line of doc.lines) {
    if (line.section !== 'socials' || !line.key?.startsWith(prefix)) continue
    const suffix = line.key.slice(prefix.length)
    // Page1Button1 must not accidentally include Page1Button10.
    if (!/^[a-z]/.test(suffix)) continue
    if (Object.hasOwn(fields, suffix)) ambiguous = true
    fields[suffix] = line.value ?? ''
  }
  return { ...slot, fields, ambiguous }
}

function hotbuttonAt(doc: IniDocument, slot: SocialSlot, bar: number): ParsedHotbutton {
  const section = sectionName(bar)
  const found = doc.lines.filter((line) => line.section === section && line.key === slotPrefix(slot))
  return { ...slot, bar, value: found[0]?.value ?? '',
    ambiguous: found.length > 1 || (doc.sections.get(section) ?? 0) > 1 }
}

export function parseSocialIni(text: string): ParsedSocialIni {
  const doc = parseDocument(text)
  const socials: ParsedSocial[] = []
  const hotbuttons: ParsedHotbutton[] = []
  for (let page = 1; page <= 10; page++) {
    for (let button = 1; button <= 12; button++) {
      const slot = socialAt(doc, { page, button })
      if (Object.keys(slot.fields).length) socials.push(slot)
    }
  }
  for (const line of doc.lines) {
    const bar = /^hotbuttons(\d*)$/.exec(line.section)
    const slot = /^page(\d+)button(\d+)$/.exec(line.key ?? '')
    if (!bar || !slot) continue
    hotbuttons.push(hotbuttonAt(doc, { page: Number(slot[1]), button: Number(slot[2]) }, Number(bar[1] || 1)))
  }
  return { socials, hotbuttons }
}

/** The raw lowercase fields remain available for auditing malformed or unexpected values. */
export function readSocials(text: string): (ParsedSocial & SocialContent)[] {
  return parseSocialIni(text).socials.map((slot) => ({ ...slot, name: slot.fields.name ?? '',
    color: Number(slot.fields.color ?? '0'),
    lines: Array.from({ length: 5 }, (_, index) => slot.fields[`line${index + 1}`] ?? '') }))
}

function sameFields(a: Record<string, string>, b: Record<string, string>): boolean {
  // The client may omit empty command fields when saving. Empty and absent execute identically.
  const keys = Object.keys(a).filter((key) => a[key] !== '')
  return keys.length === Object.keys(b).filter((key) => b[key] !== '').length && keys.every((key) => a[key] === b[key])
}

function requestError(request: SocialRequest): string | null {
  if (!request.id || !/^[\x20-\x7e]{1,15}$/.test(request.name)) return 'A social needs an ID and a 1–15 character ASCII name.'
  if (!Number.isInteger(request.color) || request.color < 0 || request.color > 19) return 'Social color must be 0–19.'
  if (request.lines.length < 1 || request.lines.length > 5) return 'A social must contain 1–5 command lines.'
  if (request.lines.some((line) => !/^[\x20-\x7e]{0,255}$/.test(line))) return 'Social lines must be single-line ASCII, at most 255 characters.'
  if (request.hotbar && (!validInteger(request.hotbar.bar, 10) || !validInteger(request.hotbar.page, 10))) return 'Hotbar and page must be 1–10.'
  return null
}

function desiredFields(request: SocialRequest): Record<string, string> {
  const fields: Record<string, string> = { name: request.name, color: String(request.color) }
  for (const [index, line] of request.lines.entries()) if (line !== '') fields[`line${index + 1}`] = line
  return fields
}

function reservedSocials(doc: IniDocument): Set<number> {
  const reserved = new Set<number>()
  for (const line of doc.lines) {
    if (!/^hotbuttons\d*$/.test(line.section)) continue
    const match = /^E(\d+),/.exec(line.value ?? '')
    if (match) reserved.add(Number(match[1]))
  }
  return reserved
}

function findEmptySocial(doc: IniDocument): SocialSlot | null {
  const reserved = reservedSocials(doc)
  for (let index = 0; index < 120; index++) {
    const slot = { page: Math.floor(index / 12) + 1, button: index % 12 + 1 }
    const current = socialAt(doc, slot)
    if (!current.ambiguous && !reserved.has(index) && Object.values(current.fields).every((value) => value === '')) return slot
  }
  return null
}

function findHotbutton(doc: IniDocument, dest: HotbarDestination): ManagedHotbutton | null {
  for (let button = 1; button <= 12; button++) {
    const current = hotbuttonAt(doc, { page: dest.page, button }, dest.bar)
    if (!current.ambiguous && current.value === '') return { bar: dest.bar, page: dest.page, button, value: '' }
  }
  return null
}

function ownershipError(doc: IniDocument, managed: ManagedSocial): string | null {
  if (!validSlot(managed)) return 'The tracked social slot is invalid.'
  const current = socialAt(doc, managed)
  if (current.ambiguous || !sameFields(current.fields, managed.fields)) return 'The managed social was changed in game; it has been preserved.'
  const hot = managed.hotbutton
  if (!hot) return null
  if (!validSlot(hot) || !validInteger(hot.bar, 10)) return 'The tracked hotbutton slot is invalid.'
  const button = hotbuttonAt(doc, hot, hot.bar)
  return button.ambiguous || button.value !== hot.value ? 'The managed hotbutton was changed in game; it has been preserved.' : null
}

function renderDocument(doc: IniDocument): string { return doc.lines.map((line) => line.text + line.eol).join('') }

function newKey(key: string): string {
  return key.replace(/^page(\d+)button(\d+)(.*)$/, (_, p: string, b: string, tail: string) =>
    `Page${p}Button${b}${tail ? tail[0].toUpperCase() + tail.slice(1) : ''}`)
}

function writeFields(doc: IniDocument, section: string, fields: Record<string, string | null>): IniDocument {
  const missing = new Map(Object.entries(fields))
  const lines = doc.lines.flatMap((line) => {
    if (line.section !== section || !line.key || !missing.has(line.key)) return [line]
    const value = missing.get(line.key)
    missing.delete(line.key)
    if (value == null) return []
    if (line.value === value) return [line]
    return [{ ...line, text: line.text.slice(0, line.text.indexOf('=') + 1) + value, value }]
  })
  for (const [key, value] of missing) if (value === null) missing.delete(key)
  if (!missing.size) return parseDocument(renderDocument({ ...doc, lines }))
  let insert = 0
  for (const [index, line] of lines.entries()) if (line.section === section) insert = index + 1
  if (insert === 0) {
    if (lines.length && lines[lines.length - 1].eol === '') lines[lines.length - 1] = { ...lines[lines.length - 1], eol: doc.eol }
    lines.push({ text: `[${section === 'socials' ? 'Socials' : section.replace('hotbuttons', 'HotButtons')}]`, eol: doc.eol, section })
    insert = lines.length
  }
  if (insert > 0 && lines[insert - 1].eol === '') lines[insert - 1] = { ...lines[insert - 1], eol: doc.eol }
  const added = [...missing].map(([key, value]) => ({ text: `${newKey(key)}=${value ?? ''}`, eol: doc.eol, section, key, value: value ?? '' }))
  lines.splice(insert, 0, ...added)
  return parseDocument(renderDocument({ ...doc, lines }))
}

function trackedUpdates(slot: SocialSlot, fields: Record<string, string>, previous?: ManagedSocial): Record<string, string | null> {
  const updates: Record<string, string | null> = {}
  for (const key of Object.keys(previous?.fields ?? {})) updates[slotPrefix(slot) + key] = null
  for (const [key, value] of Object.entries(fields)) updates[slotPrefix(slot) + key] = value
  return updates
}

function applyHotbutton(doc: IniDocument, managed: ManagedSocial, hotbutton: ManagedHotbutton, previous?: ManagedSocial): IniDocument {
  const index = (managed.page - 1) * 12 + managed.button - 1
  const value = previous?.hotbutton?.value ?? `E${index},@-1,0000000000000000,0,,`
  managed.hotbutton = { ...hotbutton, value }
  const old = previous?.hotbutton
  const moved = old && (old.bar !== hotbutton.bar || old.page !== hotbutton.page || old.button !== hotbutton.button)
  const cleared = moved ? writeFields(doc, sectionName(old.bar), { [slotPrefix(old)]: null }) : doc
  return writeFields(cleared, sectionName(hotbutton.bar), { [slotPrefix(hotbutton)]: value })
}

function requestedHotbutton(doc: IniDocument, request: SocialRequest, previous?: ManagedSocial): ManagedHotbutton | null | undefined {
  const old = previous?.hotbutton
  const dest = request.hotbar
  if (!dest) return old
  if (old?.bar === dest.bar && old.page === dest.page) return old
  return findHotbutton(doc, dest)
}

function applyRequest(doc: IniDocument, request: SocialRequest, previous?: ManagedSocial): { doc: IniDocument; managed: ManagedSocial } | string {
  const error = requestError(request) ?? (previous ? ownershipError(doc, previous) : null)
  if (error) return error
  const slot = previous ?? findEmptySocial(doc)
  if (!slot) return 'No empty social slot is available.'
  const hotbutton = requestedHotbutton(doc, request, previous)
  if (hotbutton === null) return 'The requested hotbar page has no empty button.'
  const fields = desiredFields(request)
  let next = writeFields(doc, 'socials', trackedUpdates(slot, fields, previous))
  const managed: ManagedSocial = { id: request.id, page: slot.page, button: slot.button, fields }
  if (hotbutton) next = applyHotbutton(next, managed, hotbutton, previous)
  return { doc: next, managed }
}

function documentError(doc: IniDocument): string | null {
  const seen = new Set<string>()
  for (const line of doc.lines) {
    if (!/^(socials|hotbuttons\d*)$/.test(line.section)) continue
    if ((doc.sections.get(line.section) ?? 0) > 1) return 'Duplicate social or hotbutton section; no changes were made.'
    if (!line.key) {
      if (!/^\s*(?:[;#[]|$)/.test(line.text.replace(/^\uFEFF/, ''))) return 'Malformed social or hotbutton entry; no changes were made.'
      continue
    }
    const address = `${line.section}:${line.key}`
    if (seen.has(address)) return 'Duplicate social or hotbutton key; no changes were made.'
    seen.add(address)
  }
  return null
}

function managedError(previous: readonly ManagedSocial[]): string | null {
  const ids = new Set<string>()
  const slots = new Set<string>()
  for (const entry of previous) {
    const social = `social:${slotPrefix(entry)}`
    const hot = entry.hotbutton
    const button = hot ? `${sectionName(hot.bar)}:${slotPrefix(hot)}` : null
    if (ids.has(entry.id) || slots.has(social) || (button !== null && slots.has(button))) return 'Duplicate tracked social or hotbutton ownership; no changes were made.'
    ids.add(entry.id)
    slots.add(social)
    if (button) slots.add(button)
  }
  return null
}

function retireMissing(doc: IniDocument, requested: Set<string>, managed: Map<string, ManagedSocial>, conflicts: SocialConflict[]): IniDocument {
  let next = doc
  for (const [id, entry] of managed) {
    if (requested.has(id)) continue
    const reason = ownershipError(next, entry)
    if (reason) { conflicts.push({ id, reason }); continue }
    next = writeFields(next, 'socials', trackedUpdates(entry, {}, entry))
    const hot = entry.hotbutton
    if (hot) next = writeFields(next, sectionName(hot.bar), { [slotPrefix(hot)]: null })
    managed.delete(id)
  }
  return next
}

/** Conflicts leave the whole requested social/hotbutton pair unchanged. Other requests may apply.
 * Omitted managed entries are retained unless retireMissing is explicitly requested. A conflicted
 * entry always remains tracked so the service can report it instead of claiming a new slot.
 * Persist `managed` only after the caller's backed-up write succeeds. */
export function planSocialIni(text: string, requests: readonly SocialRequest[], previous: readonly ManagedSocial[] = [], options: { retireMissing?: boolean } = {}): SocialIniPlan {
  let doc = parseDocument(text)
  const managed = new Map(previous.map((entry) => [entry.id, entry]))
  const conflicts: SocialConflict[] = []
  const invalid = documentError(doc) ?? managedError(previous)
  if (invalid) return { original: text, text, changed: false, managed: [...previous], conflicts: [{ id: '', reason: invalid }] }
  const requested = new Set(requests.map((request) => request.id))
  if (options.retireMissing) doc = retireMissing(doc, requested, managed, conflicts)
  for (const request of requests) {
    const duplicates = requests.filter((entry) => entry.id === request.id).length > 1
    const result = duplicates ? 'Duplicate managed social ID.' : applyRequest(doc, request, managed.get(request.id))
    if (typeof result === 'string') conflicts.push({ id: request.id, reason: result })
    else { doc = result.doc; managed.set(request.id, result.managed) }
  }
  const updated = renderDocument(doc)
  return { original: text, text: updated, changed: updated !== text, managed: [...managed.values()], conflicts }
}
