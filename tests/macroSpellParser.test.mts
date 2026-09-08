import assert from 'node:assert/strict'
import test from 'node:test'
import { parseOwnedSpells } from '../src/main/macros/spellParser.ts'

function row(id: number, edit: Record<number, string> = {}): string {
  // Literal file columns deliberately independent of the parser implementation constants.
  const fields = Array<string>(173).fill('0')
  fields[0] = String(id); fields[1] = 'Example Flame'
  fields[8] = '2500'; fields[9] = '1500'; fields[10] = '6000'; fields[12] = '4'
  fields[14] = '17'; fields[30] = '5'
  for (let index = 36; index <= 51; index++) fields[index] = '255'
  fields[48] = '8'; fields[49] = '12'
  fields[172] = '1|0|-10|0|101|55$2|50|-5|0|100|5$'
  for (const [key, value] of Object.entries(edit)) fields[Number(key)] = value
  return fields.join('^')
}

test('owned-only parser reads independent timing, class, target, effect fields and preserves effect signs', () => {
  const spells = parseOwnedSpells([row(94), row(95)].join('\r\n'), [94])
  assert.equal(spells.length, 1)
  assert.deepEqual(spells[0], { id: 94, name: 'Example Flame', castMs: 2500, recoveryMs: 1500, recastMs: 6000, mana: 17,
    durationTicks: 4, targetType: 5, classLevels: { MAG: 8, ENC: 12 },
    effects: [{ effect: 0, base: -10, calc: 101, max: 55 }, { effect: 50, base: -5, calc: 100, max: 5 }] })
})

test('missing, duplicate, truncated and malformed owned spell rows invalidate rather than silently simplify a spell', () => {
  assert.throws(() => parseOwnedSpells(row(94), [94, 95]), /missing/)
  assert.throws(() => parseOwnedSpells(`${row(94)}\n${row(94)}`, [94]), /duplicate/)
  assert.throws(() => parseOwnedSpells('94^name^0', [94]), /Unsupported/)
  for (const edit of [{ 9: '' }, { 10: 'NaN' }, { 48: '256' }, { 172: '1|0|-10' }, { 172: '1|0|NaN|0|100|10' }]) {
    assert.throws(() => parseOwnedSpells(row(94, edit), [94]))
  }
  assert.deepEqual(parseOwnedSpells('94^bad', []), [])
})
