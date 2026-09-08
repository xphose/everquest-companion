interface Line { text: string; eol: string; section: string; key?: string; value?: string }
export interface LoadoutRecord { index: number; fields: Record<string, string> }
export interface LoadoutDocument { lines: Line[]; eol: string; records: Map<number, LoadoutRecord>; error?: string }

function recordLine(line: Line, records: Map<number, LoadoutRecord>, keys: Set<string>): string | undefined {
  if (line.section !== 'spellloadouts' || /^\s*\[/.test(line.text)) return undefined
  if (!line.key) return /^\s*(?:[;#]|$)/.test(line.text) ? undefined : 'Malformed SpellLoadouts entries need to be resolved first.'
  if (keys.has(line.key)) return 'Duplicate SpellLoadouts keys need to be resolved first.'
  keys.add(line.key)
  const slot = /^spellloadout(\d+)(?:\.(.*))?$/.exec(line.key)
  if (!slot) return undefined
  const index = Number(slot[1]), record = records.get(index) ?? { index, fields: {} }
  record.fields[slot[2] ?? ''] = line.value ?? ''
  records.set(index, record)
  return undefined
}

export function parseLoadoutDocument(text: string): LoadoutDocument {
  const lines: Line[] = [], records = new Map<number, LoadoutRecord>(), keys = new Set<string>()
  let section = '', sections = 0, error: string | undefined
  for (const match of text.matchAll(/([^\r\n]*)(\r\n|\n|\r|$)/g)) {
    if (!match[0]) continue
    const heading = /^\s*\[([^\]]+)\]\s*$/.exec(match[1].replace(/^\uFEFF/, ''))
    if (heading) section = heading[1].trim().toLowerCase()
    if (heading && section === 'spellloadouts' && ++sections > 1) error = 'Duplicate SpellLoadouts sections need to be resolved first.'
    const entry = /^\s*([^;#=][^=]*?)\s*=(.*)$/.exec(match[1])
    const line: Line = { text: match[1], eol: match[2], section, ...(entry && !heading ? { key: entry[1].toLowerCase(), value: entry[2] } : {}) }
    lines.push(line)
    error ??= recordLine(line, records, keys)
  }
  return { lines, records, error, eol: lines.find((line) => line.eol)?.eol ?? '\r\n' }
}

export function writeLoadoutFields(doc: LoadoutDocument, index: number, fields: Record<string, string | null>): LoadoutDocument {
  const prefix = `spellloadout${index}.`
  const missing = new Map(Object.entries(fields).map(([suffix, value]) => [prefix + suffix, value]))
  const lines = doc.lines.flatMap((line) => {
    if (line.section !== 'spellloadouts' || !line.key || !missing.has(line.key)) return [line]
    const value = missing.get(line.key)
    missing.delete(line.key)
    if (value == null) return []
    return [line.value === value ? line : { ...line, value, text: line.text.slice(0, line.text.indexOf('=') + 1) + value }]
  })
  for (const [key, value] of missing) if (value === null) missing.delete(key)
  if (!missing.size) return parseLoadoutDocument(lines.map((line) => line.text + line.eol).join(''))
  let insert = 0
  for (const [at, line] of lines.entries()) if (line.section === 'spellloadouts') insert = at + 1
  if (!insert) {
    if (lines.length && !lines[lines.length - 1].eol) lines[lines.length - 1] = { ...lines[lines.length - 1], eol: doc.eol }
    lines.push({ text: '[SpellLoadouts]', eol: doc.eol, section: 'spellloadouts' })
    insert = lines.length
  }
  if (insert && !lines[insert - 1].eol) lines[insert - 1] = { ...lines[insert - 1], eol: doc.eol }
  lines.splice(insert, 0, ...[...missing].map(([key, value]) => ({ text: `${key.replace('spellloadout', 'SpellLoadout')}=${value ?? ''}`, eol: doc.eol, section: 'spellloadouts', key, value: value ?? '' })))
  return parseLoadoutDocument(lines.map((line) => line.text + line.eol).join(''))
}

export function renderLoadoutDocument(doc: LoadoutDocument): string { return doc.lines.map((line) => line.text + line.eol).join('') }
