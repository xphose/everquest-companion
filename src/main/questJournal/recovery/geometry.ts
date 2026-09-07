import type { RecoveryCapture, RecoveryOcrWord } from '../../../shared/questJournal/recovery'

export interface Box { x: number; y: number; width: number; height: number }
/** Native OCR reading order can visit a whole column before its neighbor. Rebuild screen rows
 * from overlapping vertical centers before considering titles or table headers. */
export function spatialLines(capture: RecoveryCapture): RecoveryOcrWord[][] {
  const words = capture.lines?.flatMap((line) => line.words).filter(validWord).sort((a, b) => a.y - b.y || a.x - b.x) ?? []
  const rows: RecoveryOcrWord[][] = []
  for (const word of words) {
    const row = rows[rows.length - 1]
    if (row && Math.abs(row[0].y + row[0].height / 2 - word.y - word.height / 2) < Math.min(row[0].height, word.height) * 0.6) row.push(word)
    else rows.push([word])
  }
  return rows.map((row) => row.sort((a, b) => a.x - b.x))
}

export function phraseBox(capture: RecoveryCapture, phrase: string, afterY = -1): Box | undefined {
  const parts = phrase.toLowerCase().split(' ')
  for (const line of spatialLines(capture)) {
    const at = line.findIndex((word, i) => parts.every((part, j) => line[i + j]?.text.toLowerCase() === part))
    if (at < 0) continue
    const words = line.slice(at, at + parts.length)
    if (!words.every(validWord) || words[0].y <= afterY) continue
    return { x: words[0].x, y: Math.min(...words.map((w) => w.y)),
      width: words[words.length - 1].x + words[words.length - 1].width - words[0].x,
      height: Math.max(...words.map((w) => w.height)) }
  }
  return undefined
}

export function validWord(word: RecoveryOcrWord): boolean {
  return [word.x, word.y, word.width, word.height].every((value) => Number.isFinite(value) && value >= 0) &&
    word.width > 0 && word.height > 0
}
