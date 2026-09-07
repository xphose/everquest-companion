import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseOcrResult } from '../src/main/questJournal/recovery/ocr.ts'

test('native OCR preserves column geometry and line breaks needed to separate task titles from dates', () => {
  const text = 'Quest Title\r\nCompletion\r\nAegis of Life Quest'
  const words = [{ text: 'Quest', x: 20, y: 40, width: 30, height: 12 }]
  const parsed = parseOcrResult('\uFEFF' + JSON.stringify({ text, lines: [{ text: 'Quest', words }] }))
  assert.equal(parsed.text, text)
  assert.deepEqual(parsed.lines?.[0].words, words)
})

test('unreadable images may return no text without manufacturing evidence', () => {
  assert.deepEqual(parseOcrResult('{"text":"","lines":[]}'), { text: '', lines: [] })
})

test('invalid native results cannot inject unbounded or missing geometry', () => {
  for (const word of [{ text: 'Title', x: -1, y: 1, width: 1, height: 1 }, { text: 'Title', x: 1 }]) {
    assert.throws(() => parseOcrResult(JSON.stringify({ text: 'Title', lines: [{ text: 'Title', words: [word] }] })))
  }
  assert.throws(() => parseOcrResult(JSON.stringify({ text: 'a'.repeat(100001), lines: [] })))
  assert.throws(() => parseOcrResult(JSON.stringify({ text: 'Task', lines: Array(2001).fill({ text: '', words: [] }) })))
  assert.throws(() => parseOcrResult('null'))
})
