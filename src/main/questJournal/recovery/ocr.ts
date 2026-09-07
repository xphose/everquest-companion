import type { RecoveryCapture, RecoveryOcrLine, RecoveryOcrWord } from '../../../shared/questJournal/recovery'
import { record } from '../validate'

const MAX_IMAGE_BYTES = 5 * 1024 * 1024
type NativeReader = (pngBase64: string) => Promise<unknown>
let reader: NativeReader | null = null

/** Composition supplies the existing engine's native image reader; tests need no Electron process. */
export function installJournalImageReader(nativeReader: NativeReader): void { reader = nativeReader }

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

export async function recognizeJournalImage(png: Buffer): Promise<RecoveryCapture> {
  if (process.platform !== 'win32') throw new Error('Journal screen reading currently requires Windows. Saved-file recovery is still available.')
  if (!png.length || png.length > MAX_IMAGE_BYTES) throw new Error('The decoded image exceeds 5 MB. Capture just the quest journal.')
  if (!reader) throw new Error('The native image reader is unavailable. Restart the companion and retry.')
  const result = await reader(png.toString('base64'))
  return parseOcrResult(JSON.stringify(result))
}
