import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { RecoveryCapture, RecoveryOcrLine, RecoveryOcrWord } from '../../../shared/questJournal/recovery'
import { record } from '../validate'
import { OCR_SCRIPT } from './ocrScript'

const run = promisify(execFile)
const MAX_IMAGE_BYTES = 20 * 1024 * 1024

function ocrWord(value: unknown): RecoveryOcrWord | null {
  const word = record(value)
  if (!word || typeof word.text !== 'string' || word.text.length > 1000) return null
  if (![word.x, word.y, word.width, word.height].every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 10000)) return null
  return { text: word.text, x: word.x as number, y: word.y as number, width: word.width as number, height: word.height as number }
}

function ocrLine(value: unknown): RecoveryOcrLine | null {
  const line = record(value)
  if (!line || typeof line.text !== 'string' || !Array.isArray(line.words) || line.words.length > 2000) return null
  const words = line.words.map(ocrWord)
  if (words.some((word) => word === null)) return null
  return { text: line.text, words: words as RecoveryOcrWord[] }
}

export function parseOcrResult(text: string): RecoveryCapture {
  const value = record(JSON.parse(text.replace(/^\uFEFF/, '')) as unknown)
  if (!value || typeof value.text !== 'string' || value.text.length > 100000 || !Array.isArray(value.lines) || value.lines.length > 2000) {
    throw new Error('The local text reader returned an unsupported result.')
  }
  const lines = value.lines.map(ocrLine)
  if (lines.some((line) => line === null)) throw new Error('The local text reader returned invalid word positions.')
  return { text: value.text, lines: lines as RecoveryOcrLine[] }
}

function failureMessage(error: unknown): string {
  const failure = error as { stderr?: string; killed?: boolean; code?: string }
  if (failure.killed) return 'The local text reader timed out. Try a smaller screenshot.'
  if (failure.code === 'ENOENT') return 'Windows PowerShell is unavailable; the local text reader could not start.'
  if (failure.stderr?.includes('English OCR is unavailable')) return 'Install English language OCR in Windows Settings, then retry.'
  if (failure.stderr?.includes('image is too large')) return 'The image is too large. Capture a smaller journal window.'
  return 'Windows could not read this image. Try a clear PNG screenshot with the journal enlarged.'
}

export async function recognizeJournalImage(png: Buffer): Promise<RecoveryCapture> {
  if (process.platform !== 'win32') throw new Error('Journal screen reading currently requires Windows. Saved-file recovery is still available.')
  if (!png.length || png.length > MAX_IMAGE_BYTES) throw new Error('Choose a journal image smaller than 20 MB.')
  const directory = await mkdtemp(join(tmpdir(), 'eq-journal-ocr-'))
  try {
    const path = join(directory, 'journal.png')
    await writeFile(path, png)
    const executable = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    const { stdout } = await run(executable, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(OCR_SCRIPT, 'utf16le').toString('base64')], {
      windowsHide: true, timeout: 45000, maxBuffer: 2 * 1024 * 1024,
      env: { ...process.env, EQ_JOURNAL_OCR_FILE: path }, encoding: 'utf8'
    }).catch((error: unknown) => { throw new Error(failureMessage(error)) })
    return parseOcrResult(stdout)
  } finally { await rm(directory, { recursive: true, force: true }) }
}
