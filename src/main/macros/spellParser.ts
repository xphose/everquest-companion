import type { ClassAbbr } from '../../shared/classCombo'
import type { MacroSpell } from '../../shared/macros'

const CLASSES: ClassAbbr[] = ['WAR', 'CLR', 'PAL', 'RNG', 'SHD', 'DRU', 'MNK', 'BRD', 'ROG', 'SHM', 'NEC', 'WIZ', 'MAG', 'ENC', 'BST', 'BER']
function integer(value: string | undefined, min = 0, max = 0x7fffffff): number {
  if (!value || !/^-?\d+$/.test(value)) throw new Error('Missing or invalid spell field.')
  const result = Number(value)
  if (!Number.isSafeInteger(result) || result < min || result > max) throw new Error('Spell field is out of range.')
  return result
}

function effects(field: string): MacroSpell['effects'] {
  return field.split('$').filter(Boolean).map((slot) => {
    const values = slot.split('|')
    if (values.length !== 6) throw new Error('Invalid spell effect layout.')
    return { effect: integer(values[1]), base: integer(values[2], -0x7fffffff),
      calc: integer(values[4], -0x7fffffff), max: integer(values[5], -0x7fffffff) }
  })
}

function parseRow(fields: string[]): MacroSpell {
  if (fields.length <= 172 || !/^[\x20-\x7e]{1,120}$/.test(fields[1])) throw new Error('Unsupported spell row.')
  const classLevels: MacroSpell['classLevels'] = {}
  CLASSES.forEach((abbr, index) => {
    const level = integer(fields[36 + index], 0, 255)
    if (level > 0 && level < 255) classLevels[abbr] = level
  })
  return { id: integer(fields[0], 1), name: fields[1], classLevels,
    castMs: integer(fields[8], 0, 3_600_000), recoveryMs: integer(fields[9], 0, 3_600_000),
    recastMs: integer(fields[10], 0, 86_400_000), mana: integer(fields[14]), targetType: integer(fields[30]),
    effects: effects(fields[172]), durationTicks: integer(fields[12]) }
}

/** Verified client caret columns; only owned IDs leave this parser. A malformed or duplicate
 * requested row invalidates the table instead of making a dangerous spell look simpler. */
export function parseOwnedSpells(text: string, ids: readonly number[]): MacroSpell[] {
  const wanted = new Set(ids)
  const result = new Map<number, MacroSpell>()
  for (const line of text.split(/\r?\n/)) {
    const separator = line.indexOf('^')
    const id = Number(line.slice(0, separator))
    if (separator < 1 || !wanted.has(id)) continue
    if (result.has(id)) throw new Error('The client table contains duplicate owned spell IDs.')
    const row = parseRow(line.split('^'))
    result.set(row.id, row)
  }
  if (result.size !== wanted.size) throw new Error('Some owned spells are missing from the client table.')
  return [...result.values()]
}
