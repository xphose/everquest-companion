import { clipboard, desktopCapturer, dialog, nativeImage, type NativeImage } from 'electron'
import { readFile, stat } from 'node:fs/promises'
import type { RecoveryCapture, RecoveryInput } from '../../../shared/questJournal/recovery'
import { recognizeJournalImage } from './ocr'

export function isEverQuestWindow(name: string): boolean {
  return /^(?:EverQuest(?: Legends)?)(?:$|\s*[-–:]\s*.+$)/i.test(name.trim()) && !/companion/i.test(name)
}

async function gameImage(): Promise<NativeImage> {
  const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 3840, height: 2160 }, fetchWindowIcons: false })
  const matches = sources.filter((source) => isEverQuestWindow(source.name))
  if (matches.length > 1) throw new Error('More than one EverQuest window is open. Use a screenshot of the intended character’s journal.')
  if (!matches.length) throw new Error('No EverQuest window was found. Open the game and its quest journal, or choose a screenshot.')
  return matches[0].thumbnail
}

async function fileImage(): Promise<NativeImage | null> {
  const chosen = await dialog.showOpenDialog({ title: 'Choose a quest journal screenshot', properties: ['openFile'], filters: [{ name: 'Journal images', extensions: ['png', 'jpg', 'jpeg', 'bmp'] }] })
  if (chosen.canceled || !chosen.filePaths[0]) return null
  const path = chosen.filePaths[0]
  const info = await stat(path)
  if (!info.isFile() || info.size > 20 * 1024 * 1024) throw new Error('Choose an image smaller than 20 MB.')
  return nativeImage.createFromBuffer(await readFile(path))
}

async function sourceImage(source: Exclude<RecoveryInput, 'files'>): Promise<NativeImage | null> {
  if (source === 'game-window') return gameImage()
  if (source === 'clipboard') return clipboard.readImage()
  return fileImage()
}

/** Whole-image enlargement preserves layout and makes small isolated fractions legible.
 * 2600 is the validated Windows OCR side limit; the native engine enforces its own limit too. */
async function recognizePicture(picture: NativeImage): Promise<RecoveryCapture> {
  const original = picture.getSize()
  const scale = Math.min(2, 2600 / Math.max(original.width, original.height))
  const width = Math.max(1, Math.round(original.width * scale))
  const height = Math.max(1, Math.round(original.height * scale))
  const prepared = picture.resize({ width, height, quality: 'best' })
  const result = await recognizeJournalImage(prepared.toPNG())
  const xScale = original.width / width; const yScale = original.height / height
  return { ...result, lines: result.lines?.map((line) => ({ ...line, words: line.words.map((word) => ({
    ...word, x: word.x * xScale, y: word.y * yScale, width: word.width * xScale, height: word.height * yScale
  })) })) }
}

export async function captureJournal(source: Exclude<RecoveryInput, 'files'>): Promise<RecoveryCapture | null> {
  const picture = await sourceImage(source)
  const capturedAt = Date.now()
  if (!picture) return null
  if (picture.isEmpty()) throw new Error('No image was available. Copy a journal screenshot or restore the game window, then retry.')
  const size = picture.getSize()
  if (size.width * size.height > 20000000) throw new Error('The image is too large. Capture just the quest journal.')
  const result = await recognizePicture(picture)
  return { ...result, imageDataUrl: picture.toDataURL(), capturedAt }
}
