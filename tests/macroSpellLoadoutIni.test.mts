import test from 'node:test'
import assert from 'node:assert/strict'
import { planSpellLoadoutIni, type SpellLoadoutRequest } from '../src/main/macros/spellLoadoutIni.ts'

const requests = (): SpellLoadoutRequest[] => [
  { id: 'prep', name: 'EQL Prep', slots: [50, 55, ...Array<number>(12).fill(-1)] },
  { id: 'combat', name: 'EQL Combat', slots: [94, 93, ...Array<number>(12).fill(-1)] }
]

test('two complete fourteen-slot sets use one-based keys and preserve unrelated bytes', () => {
  const original = '; keep\r\n[Other]\r\nAccent=é'
  const plan = planSpellLoadoutIni(original, '', requests())
  assert.deepEqual(plan.conflicts, [])
  assert.deepEqual(plan.managed.map((item) => item.index), [1, 2])
  assert.ok(plan.text.startsWith(original + '\r\n'))
  assert.match(plan.text, /SpellLoadout1.inuse=1\r\nSpellLoadout1.name=EQL Prep/)
  assert.match(plan.text, /SpellLoadout1.slot1=50\r\nSpellLoadout1.slot2=55/)
  assert.match(plan.text, /SpellLoadout2.slot14=-1/)
  assert.ok(plan.managed.every((item) => Object.keys(item.fields).length === 16))
  const again = planSpellLoadoutIni(plan.text, '', requests(), plan.managed)
  assert.equal(again.changed, false)
  assert.equal(again.text, plan.text)
})

test('partial, disabled, unknown and default records all reserve their numeric indices', () => {
  const text = '[SpellLoadouts]\nSpellLoadout1.inuse=0\nSpellLoadout3.extra=personal\n'
  const defaults = '[SpellLoadouts]\nSpellLoadout2.name=Default\nSpellLoadout4.slot1=94\n'
  const plan = planSpellLoadoutIni(text, defaults, requests())
  assert.deepEqual(plan.managed.map((item) => item.index), [5, 6])
  assert.ok(plan.text.startsWith(text))
  assert.equal(defaults, '[SpellLoadouts]\nSpellLoadout2.name=Default\nSpellLoadout4.slot1=94\n')
})

test('names are short, case-insensitively unique and never establish ownership', () => {
  const text = '[SpellLoadouts]\nSpellLoadout1.name=eql prep\nSpellLoadout2.name=EQL Combat\n'
  const plan = planSpellLoadoutIni(text, '', requests())
  assert.deepEqual(plan.managed.map((item) => item.index), [3, 4])
  assert.equal(new Set([...plan.managed.map((item) => item.fields.name.toLowerCase()), 'eql prep', 'eql combat']).size, 4)
  assert.ok(plan.managed.every((item) => item.fields.name.length <= 23))
  assert.ok(plan.text.startsWith(text))
})

test('one remaining record, duplicates and malformed sections refuse the whole pair', () => {
  const full = '[SpellLoadouts]\n' + Array.from({ length: 59 }, (_, index) => `SpellLoadout${index + 1}.inuse=0\n`).join('')
  for (const text of [full, '[SpellLoadouts]\n[spellloadouts]\n', '[SpellLoadouts]\nSpellLoadout1.name=A\nspellloadout1.NAME=B\n', '[SpellLoadouts]\nSpellLoadout1 bad\n']) {
    const plan = planSpellLoadoutIni(text, '', requests())
    assert.ok(plan.conflicts.length)
    assert.equal(plan.text, text)
    assert.deepEqual(plan.managed, [])
  }
  assert.ok(planSpellLoadoutIni('', full, requests()).conflicts.length)
})

test('changed owned fields and newly occupied defaults refuse all changes without relocating', () => {
  const first = planSpellLoadoutIni('', '', requests())
  const updated = requests()
  updated[0].slots = [51, 55, ...Array<number>(12).fill(-1)]
  for (const text of [first.text.replace('slot1=50', 'slot1=66'), first.text + 'SpellLoadout1.personal=keep\r\n']) {
    const plan = planSpellLoadoutIni(text, '', updated, first.managed)
    assert.equal(plan.text, text)
    assert.deepEqual(plan.managed, first.managed)
    assert.ok(plan.conflicts.length)
  }
  const defaults = '[SpellLoadouts]\nSpellLoadout1.inuse=0\n'
  assert.equal(planSpellLoadoutIni(first.text, defaults, updated, first.managed).text, first.text)
  const pinned = requests().map((item, index) => ({ ...item, index: index + 1 }))
  const occupied = '[SpellLoadouts]\nSpellLoadout1.name=Personal\n'
  assert.equal(planSpellLoadoutIni(occupied, '', pinned).text, occupied)
})

test('invalid command-capacity, IDs, names, duplicate spell IDs or duplicate ownership are refused', () => {
  for (const patch of [{ name: 'x'.repeat(24) }, { name: 'line\nbreak' }, { slots: Array<number>(18).fill(-1) },
    { slots: [0, ...Array<number>(13).fill(-1)] }, { slots: [94, 94, ...Array<number>(12).fill(-1)] }, { index: 61 }]) {
    const wanted = requests()
    Object.assign(wanted[0], patch)
    assert.ok(planSpellLoadoutIni('', '', wanted).conflicts.length)
  }
  const first = planSpellLoadoutIni('', '', requests())
  assert.ok(planSpellLoadoutIni(first.text, '', requests(), [first.managed[0], first.managed[0]]).conflicts.length)
})

test('Use-only retirement removes exactly owned set fields and refuses changed or inherited records', () => {
  const personal = '[SpellLoadouts]\nSpellLoadout1.name=Personal\n'
  const first = planSpellLoadoutIni(personal, '', requests())
  const retired = planSpellLoadoutIni(first.text, '', [], first.managed)
  assert.equal(retired.text, personal)
  assert.deepEqual(retired.managed, [])
  const changed = first.text.replace('slot1=50', 'slot1=66')
  assert.equal(planSpellLoadoutIni(changed, '', [], first.managed).text, changed)
  assert.equal(planSpellLoadoutIni(first.text, '[SpellLoadouts]\nSpellLoadout2.inuse=0\n', [], first.managed).text, first.text)
})
