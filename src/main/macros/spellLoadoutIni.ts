import { parseLoadoutDocument, renderLoadoutDocument, writeLoadoutFields, type LoadoutDocument } from './spellLoadoutDocument'

export interface SpellLoadoutRequest { id: string; name: string; slots: readonly number[]; index?: number }
export interface ManagedSpellLoadout { id: string; index: number; fields: Record<string, string> }
export interface SpellLoadoutPlan { text: string; changed: boolean; managed: ManagedSpellLoadout[]; conflicts: string[] }

function validIndex(index: number): boolean { return Number.isInteger(index) && index >= 1 && index <= 60 }
function sameFields(left: Record<string, string>, right: Record<string, string>): boolean {
  return Object.keys(left).length === Object.keys(right).length && Object.keys(left).every((key) => left[key] === right[key])
}
function desiredFields(request: SpellLoadoutRequest, name: string): Record<string, string> {
  return { inuse: '1', name, ...Object.fromEntries(request.slots.map((id, index) => [`slot${index + 1}`, String(id)])) }
}
function validRequest(request: SpellLoadoutRequest): boolean {
  return Boolean(request.id) && /^[A-Za-z0-9 _-]{1,23}$/.test(request.name) && request.slots.length === 14 &&
    request.slots.every((id) => Number.isInteger(id) && (id === -1 || id >= 1 && id <= 0x7fffffff)) &&
    new Set(request.slots.filter((id) => id > 0)).size === request.slots.filter((id) => id > 0).length &&
    (request.index === undefined || validIndex(request.index))
}
function ownershipError(doc: LoadoutDocument, defaults: LoadoutDocument, item: ManagedSpellLoadout): string | undefined {
  const current = doc.records.get(item.index)
  if (!validIndex(item.index) || !current || Object.keys(item.fields).length !== 16 || !sameFields(current.fields, item.fields)) return 'A managed spell set changed; its fields were preserved.'
  if (defaults.records.has(item.index)) return 'A default spell set now uses a managed index; its definition was preserved.'
  return undefined
}
function uniqueName(name: string, index: number, doc: LoadoutDocument, defaults: LoadoutDocument): string {
  const names = [...doc.records.values(), ...defaults.records.values()].filter((item) => item.index !== index).map((item) => item.fields.name?.toLowerCase())
  if (!names.includes(name.toLowerCase())) return name
  for (let suffix = 1; suffix <= 120; suffix++) {
    const tail = ` ${index}-${suffix}`
    const candidate = name.slice(0, 23 - tail.length) + tail
    if (!names.includes(candidate.toLowerCase())) return candidate
  }
  throw new Error('No unique preparation spell-set name is available.')
}
function applyRequest(doc: LoadoutDocument, defaults: LoadoutDocument, request: SpellLoadoutRequest, previous?: ManagedSpellLoadout): { doc: LoadoutDocument; managed: ManagedSpellLoadout } {
  if (!validRequest(request)) throw new Error('A spell set needs fourteen valid slots and a short ASCII name.')
  if (previous) {
    const error = ownershipError(doc, defaults, previous)
    if (error) throw new Error(error)
    if (request.index !== undefined && request.index !== previous.index) throw new Error('The tracked preparation set index changed.')
  }
  const index = selectedIndex(doc, defaults, request, previous)
  if (index === undefined) throw new Error('Two unused spell-set records are required; all sixty records are reserved.')
  if (!previous && (doc.records.has(index) || defaults.records.has(index))) throw new Error('A personal or default spell set now occupies a reserved preparation index.')
  const name = uniqueName(request.name, index, doc, defaults)
  if (request.index !== undefined && name !== request.name) throw new Error('A personal or default spell set now uses the reserved preparation name.')
  const fields = desiredFields(request, name)
  return { doc: writeLoadoutFields(doc, index, fields), managed: { id: request.id, index, fields } }
}

function selectedIndex(doc: LoadoutDocument, defaults: LoadoutDocument, request: SpellLoadoutRequest, previous?: ManagedSpellLoadout): number | undefined {
  return previous?.index ?? request.index ?? Array.from({ length: 60 }, (_, index) => index + 1).find((index) => !doc.records.has(index) && !defaults.records.has(index))
}
function validateRequests(requests: readonly SpellLoadoutRequest[], previous: readonly ManagedSpellLoadout[]): void {
  if (![0, 2].includes(requests.length) || new Set(requests.map((item) => item.id)).size !== requests.length) throw new Error('A preparation package requires distinct preparation and combat spell sets.')
  if (new Set(previous.map((item) => item.id)).size !== previous.length || new Set(previous.map((item) => item.index)).size !== previous.length) throw new Error('Duplicate tracked spell-set ownership.')
}
function retireSets(doc: LoadoutDocument, defaults: LoadoutDocument, previous: readonly ManagedSpellLoadout[]): LoadoutDocument {
  let next = doc
  for (const item of previous) {
    const error = ownershipError(next, defaults, item)
    if (error) throw new Error(error)
    next = writeLoadoutFields(next, item.index, Object.fromEntries(Object.keys(item.fields).map((key) => [key, null])))
  }
  return next
}

/** Two complete owned sets are atomic: a conflict returns the original document and ownership.
 * Partial, disabled and default-defined records reserve their indices. A name is never ownership.
 * Native proof: docs/macro-preparation-client-evidence.md and the checked build's 0x2bf8c0 loader. */
export function planSpellLoadoutIni(text: string, defaultsText: string, requests: readonly SpellLoadoutRequest[], previous: readonly ManagedSpellLoadout[] = []): SpellLoadoutPlan {
  let doc = parseLoadoutDocument(text)
  const defaults = parseLoadoutDocument(defaultsText)
  try {
    if (doc.error || defaults.error) throw new Error(doc.error ?? defaults.error)
    validateRequests(requests, previous)
    if (!requests.length) doc = retireSets(doc, defaults, previous)
    const managed: ManagedSpellLoadout[] = []
    for (const request of requests) {
      const result = applyRequest(doc, defaults, request, previous.find((item) => item.id === request.id))
      doc = result.doc
      managed.push(result.managed)
    }
    if (requests.length && previous.some((item) => !requests.some((request) => request.id === item.id))) throw new Error('Existing spell-set ownership does not match the preparation package.')
    const updated = renderLoadoutDocument(doc)
    return { text: updated, changed: updated !== text, managed, conflicts: [] }
  } catch (error) {
    return { text, changed: false, managed: [...previous], conflicts: [error instanceof Error ? error.message : 'The preparation spell sets could not be updated.'] }
  }
}
