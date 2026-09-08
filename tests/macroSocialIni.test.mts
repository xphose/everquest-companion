import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseSocialIni, planSocialIni, type SocialRequest } from '../src/main/macros/socialIni'

// Synthetic names/commands only. The on-disk PageNButtonNName/Color/LineN layout and E12
// hotbutton serialization were observed in the installed September 2026 Legends client.
const USER = '[Socials]\r\nPage2Button1Name=My Button\r\nPage2Button1Color=13\r\nPage2Button1Line1=/cast 1\r\n'
const INI = '\uFEFF; keep this comment\r\n[Defaults]\r\nMusic=3\r\nUnknown=\u00e9\r\n' + USER +
  '[HotButtons]\r\nPage2Button2=E12,@-1,0000000000000000,0,,\r\n' +
  '[HotButtons4]\r\nPage1Button1=H0,@-1,0000000000000000,0,,\r\n' +
  '[Other]\nKeep=spacing  '
const REQUEST: SocialRequest = { id: 'pet-control', name: 'Pet Control', color: 0,
  lines: ['/pet attack', '/pet report health'], hotbar: { bar: 4, page: 1 } }

test('adds a normal social and first empty hotbutton while preserving all user bytes', () => {
  const plan = planSocialIni(INI, [REQUEST])
  assert.equal(plan.original, INI)
  assert.equal(plan.changed, true)
  assert.deepEqual(plan.conflicts, [])
  assert.equal(plan.managed.length, 1)
  assert.deepEqual(plan.managed[0], { id: REQUEST.id, page: 1, button: 1,
    fields: { name: REQUEST.name, color: '0', line1: '/pet attack', line2: '/pet report health' },
    hotbutton: { bar: 4, page: 1, button: 2, value: 'E0,@-1,0000000000000000,0,,' } })
  assert.ok(plan.text.includes(USER))
  assert.ok(plan.text.startsWith('\uFEFF; keep this comment\r\n[Defaults]\r\nMusic=3\r\nUnknown=\u00e9\r\n'))
  assert.ok(plan.text.endsWith('[Other]\nKeep=spacing  '))
  assert.ok(plan.text.includes('Page1Button2=E0,@-1,0000000000000000,0,,\r\n'))
  assert.equal(parseSocialIni(plan.text).socials.length, 2)
  const again = planSocialIni(plan.text, [REQUEST], plan.managed)
  assert.equal(again.text, plan.text)
  assert.equal(again.changed, false)
})

test('empty socials referenced by any existing user hotbar are reserved, even on an extra bar', () => {
  const text = '[Socials]\n[HotButtons11]\nPage1Button1=E0,@-1,0000000000000000,0,,\n'
  const plan = planSocialIni(text, [{ ...REQUEST, hotbar: undefined }])
  assert.equal(plan.managed[0].button, 2)
  assert.equal(plan.text.includes('Page1Button1Name='), false)
  assert.ok(plan.text.endsWith('[HotButtons11]\nPage1Button1=E0,@-1,0000000000000000,0,,\n'))
})

test('social index 12 means page 2 button 1; existing user slots are never claimed by matching name', () => {
  const occupied = Array.from({ length: 12 }, (_, i) => `Page1Button${i + 1}Name=${REQUEST.name}\n`).join('')
  const plan = planSocialIni(`[Socials]\n${occupied}`, [REQUEST])
  assert.equal(plan.managed[0].page, 2)
  assert.equal(plan.managed[0].button, 1)
  assert.equal(plan.managed[0].hotbutton?.value, 'E12,@-1,0000000000000000,0,,')
  assert.ok(plan.text.startsWith(`[Socials]\n${occupied}`))
})

test('updating owned content removes obsolete command lines and retains the same hotbutton', () => {
  const first = planSocialIni(INI, [{ ...REQUEST, lines: ['/cast 1', '/cast 2', '/cast 3', '/cast 4', '/cast 5'] }])
  const plan = planSocialIni(first.text, [{ ...REQUEST, lines: ['/cast 6'] }], first.managed)
  assert.equal(plan.conflicts.length, 0)
  assert.ok(plan.text.includes('Page1Button1Line1=/cast 6\r\n'))
  assert.equal(/Page1Button1Line[2-5]=/.test(plan.text), false)
  assert.deepEqual(plan.managed[0].hotbutton, first.managed[0].hotbutton)
  assert.ok(plan.text.includes(USER))
})

test('a user edit to any social field or the owned hotbutton preserves the whole pair', () => {
  const first = planSocialIni(INI, [REQUEST])
  for (const text of [first.text.replace('Page1Button1Line1=/pet attack', 'Page1Button1Line1=/pet back off'),
    first.text.replace('Page1Button2=E0,', 'Page1Button2=E451,'),
    first.text.replace('Page1Button1Color=0', 'Page1Button1Color=19')]) {
    const plan = planSocialIni(text, [{ ...REQUEST, lines: ['/cast 1'] }], first.managed)
    assert.equal(plan.changed, false)
    assert.equal(plan.text, text)
    assert.equal(plan.conflicts.length, 1)
    assert.deepEqual(plan.managed, first.managed)
  }
})

test('case-insensitive keys and client-added empty line fields compare as the same content', () => {
  const first = planSocialIni('[SOCIALS]\n', [{ ...REQUEST, hotbar: undefined }])
  const serialized = first.text.replace('Page1Button1Line1=', 'page1button1line1=') + 'Page1Button1Line5=\n'
  const plan = planSocialIni(serialized, [{ ...REQUEST, hotbar: undefined }], first.managed)
  assert.equal(plan.changed, false)
  assert.equal(plan.text, serialized)
})

test('full requested hotbar page refuses atomically without creating an inaccessible social', () => {
  const occupied = Array.from({ length: 12 }, (_, i) => `Page1Button${i + 1}=H${i},@-1,0000000000000000,0,,\n`).join('')
  const text = `[Socials]\n[HotButtons4]\n${occupied}`
  const plan = planSocialIni(text, [REQUEST])
  assert.equal(plan.text, text)
  assert.equal(plan.managed.length, 0)
  assert.match(plan.conflicts[0].reason, /no empty button/)
})

test('full social grid never spills into the AA indices starting at E120', () => {
  const occupied = Array.from({ length: 120 }, (_, i) => `Page${Math.floor(i / 12) + 1}Button${i % 12 + 1}Name=User\n`).join('')
  const plan = planSocialIni(`[Socials]\n${occupied}`, [REQUEST])
  assert.equal(plan.changed, false)
  assert.equal(plan.managed.length, 0)
  assert.match(plan.conflicts[0].reason, /No empty social/)
})

test('duplicate sections, duplicate keys and malformed social entries refuse every change', () => {
  for (const text of ['[Socials]\n[Socials]\n', '[Socials]\nPage1Button1Name=\npage1button1name=\n',
    '[HotButtons4]\nPage1Button1=\nPage1Button1=\n', '[Socials]\nPage1Button1Name']) {
    const plan = planSocialIni(text, [REQUEST])
    assert.equal(plan.text, text)
    assert.equal(plan.changed, false)
    assert.equal(plan.conflicts.length, 1)
  }
})

test('invalid requests and duplicate IDs never produce INI injection or partially allocate duplicates', () => {
  for (const request of [{ ...REQUEST, name: 'a\n[Other]' }, { ...REQUEST, lines: ['/cast 1\r\nOther=2'] },
    { ...REQUEST, lines: Array<string>(6).fill('/cast 1') }, { ...REQUEST, color: -1 },
    { ...REQUEST, hotbar: { bar: 1, page: 11 } }]) {
    const plan = planSocialIni(INI, [request])
    assert.equal(plan.changed, false)
    assert.equal(plan.conflicts.length, 1)
  }
  const duplicate = planSocialIni(INI, [REQUEST, REQUEST])
  assert.equal(duplicate.changed, false)
  assert.equal(duplicate.managed.length, 0)
  assert.equal(duplicate.conflicts.length, 2)
})

test('requests omitted from an update remain owned until retirement is explicit', () => {
  const first = planSocialIni(INI, [REQUEST])
  const plan = planSocialIni(first.text, [], first.managed)
  assert.equal(plan.changed, false)
  assert.deepEqual(plan.managed, first.managed)
})

test('retiring missing recipes removes only exact owned fields and hotbutton; user content remains', () => {
  const first = planSocialIni(INI, [REQUEST, { ...REQUEST, id: 'healing', name: 'Heal', lines: ['/cast 2'] }])
  const plan = planSocialIni(first.text, [{ ...REQUEST, id: 'healing', name: 'Heal', lines: ['/cast 2'] }], first.managed, { retireMissing: true })
  assert.equal(plan.changed, true)
  assert.deepEqual(plan.conflicts, [])
  assert.equal(plan.managed.length, 1)
  assert.equal(plan.managed[0].id, 'healing')
  assert.equal(plan.text.includes('Page1Button1Name=Pet Control'), false)
  assert.equal(plan.text.includes('Page1Button2=E0,'), false)
  assert.ok(plan.text.includes(USER))
  assert.ok(plan.text.includes('Page1Button1=H0,@-1,0000000000000000,0,,\r\n'))
  const restored = planSocialIni(plan.text, [], plan.managed, { retireMissing: true })
  assert.equal(restored.text, INI)
})

test('retirement preserves edited owned content and its ownership record for a visible conflict', () => {
  const first = planSocialIni(INI, [REQUEST])
  const edited = first.text.replace('Page1Button1Name=Pet Control', 'Page1Button1Name=My Pet')
  const plan = planSocialIni(edited, [], first.managed, { retireMissing: true })
  assert.equal(plan.changed, false)
  assert.equal(plan.text, edited)
  assert.equal(plan.conflicts.length, 1)
  assert.deepEqual(plan.managed, first.managed)
})

test('ambiguous ownership records are rejected before retiring any missing recipes', () => {
  const first = planSocialIni(INI, [REQUEST])
  for (const previous of [[...first.managed, ...first.managed],
    [...first.managed, { ...first.managed[0], id: 'another-id' }]]) {
    const plan = planSocialIni(first.text, [], previous, { retireMissing: true })
    assert.equal(plan.changed, false)
    assert.equal(plan.text, first.text)
    assert.equal(plan.conflicts.length, 1)
    assert.deepEqual(plan.managed, previous)
  }
})

test('a destination change moves the unchanged owned binding while preserving its custom icon and label', () => {
  const first = planSocialIni(INI, [REQUEST])
  const previous = first.managed.map((entry) => ({ ...entry, hotbutton: { ...entry.hotbutton!, value: 'E0,B2,0000000000000000,0,Pet,' } }))
  const input = first.text.replace('E0,@-1,0000000000000000,0,,', previous[0].hotbutton.value)
  const plan = planSocialIni(input, [{ ...REQUEST, hotbar: { bar: 2, page: 3 } }], previous)
  assert.deepEqual(plan.conflicts, [])
  assert.deepEqual(plan.managed[0].hotbutton, { bar: 2, page: 3, button: 1, value: previous[0].hotbutton.value })
  assert.equal(plan.text.includes('Page1Button2=E0,'), false)
  assert.ok(plan.text.includes('[HotButtons2]\r\nPage3Button1=E0,B2,0000000000000000,0,Pet,\r\n'))
  assert.ok(plan.text.includes(USER))
})

test('a full destination page preserves both the original managed binding and its social', () => {
  const first = planSocialIni(INI, [REQUEST])
  const occupied = Array.from({ length: 12 }, (_, i) => `Page1Button${i + 1}=H${i},@-1,0000000000000000,0,,\n`).join('')
  const text = first.text + '\n[HotButtons2]\n' + occupied
  const plan = planSocialIni(text, [{ ...REQUEST, lines: ['/cast 2'], hotbar: { bar: 2, page: 1 } }], first.managed)
  assert.equal(plan.text, text)
  assert.equal(plan.changed, false)
  assert.equal(plan.conflicts.length, 1)
  assert.deepEqual(plan.managed, first.managed)
})
