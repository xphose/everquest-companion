import type { RecoveryCapture, RecoveryObjective, RecoveryOcrWord } from '../../../shared/questJournal/recovery'
import { phraseBox, spatialLines, type Box } from './geometry'

function statusObjective(text: string, status: string): RecoveryObjective | undefined {
  if (!text || text.length > 500) return undefined
  const ratio = /^(\d{1,6})\s*\/\s*(\d{1,6})$/u.exec(status)
  if (ratio) {
    const current = Number(ratio[1]); const required = Number(ratio[2])
    return required > 0 && current <= required ? { text, current, required, complete: current === required } : undefined
  }
  if (/^(?:done|complete)$/iu.test(status)) return { text, complete: true }
  if (/^(?:not done|incomplete|in progress)$/iu.test(status)) return { text, complete: false }
  return undefined
}

export function extractObjectives(capture: RecoveryCapture, lines: string[]): RecoveryObjective[] {
  if (capture.lines?.length) return spatialObjectives(capture)
  const start = lines.findIndex((line) => /^Objective Instructions\s+Status(?:\s+Zone)?$/iu.test(line))
  if (start < 0) return []
  const objectives: RecoveryObjective[] = []
  for (const line of lines.slice(start + 1)) {
    const cells = line.split(/\t+/u)
    if (cells.length < 2) break
    const objective = statusObjective(cells[0].trim(), cells[1].trim())
    if (objective) objectives.push(objective)
  }
  return objectives.slice(0, 50)
}

function joined(words: RecoveryOcrWord[]): string { return words.sort((a, b) => a.x - b.x).map((word) => word.text).join(' ') }

/** The actual default table has separate Instructions / Status / Zone columns. A zone name is
 * never part of the fraction, even when native OCR returns all three columns on one line. */
function spatialObjectives(capture: RecoveryCapture): RecoveryObjective[] {
  const columns = objectiveColumns(capture)
  if (!columns) return []
  const { instructions } = columns
  const lines = spatialLines(capture).filter((line) => line[0].y > instructions.y + instructions.height)
  return objectiveRows(lines, columns)
}

function objectiveColumns(capture: RecoveryCapture): { instructions: Box; status: Box; zone: Box } | undefined {
  const instructions = phraseBox(capture, 'Objective Instructions')
  const status = phraseBox(capture, 'Status', (instructions?.y ?? 0) - 1)
  const zone = phraseBox(capture, 'Zone', (instructions?.y ?? 0) - 1)
  if (!instructions || !status || !zone || status.x <= instructions.x || zone.x <= status.x) return undefined
  if (Math.abs(status.y - instructions.y) > instructions.height || Math.abs(zone.y - instructions.y) > instructions.height) return undefined
  return { instructions, status, zone }
}

function objectiveRows(lines: RecoveryOcrWord[][], { instructions, status, zone }: { instructions: Box; status: Box; zone: Box }): RecoveryObjective[] {
  const rows: RecoveryObjective[] = []
  for (const line of lines) {
    const text = joined(line.filter((word) => word.x >= instructions.x - 3 && word.x + word.width < status.x - 2))
    const value = joined(line.filter((word) => word.x >= status.x - 3 && word.x + word.width < zone.x - 2))
    const objective = statusObjective(text, value)
    if (objective) rows.push(objective)
    else if (text && text.length <= 500 && line.some((word) => word.x >= zone.x - 3)) rows.push({ text })
  }
  return rows.slice(0, 50)
}
