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

interface ObjectiveColumns { instructions: Box; status: Box; zone: Box }

function objectiveRows(lines: RecoveryOcrWord[][], columns: ObjectiveColumns): RecoveryObjective[] {
  const rows: RecoveryObjective[] = []
  let lastBottom = columns.instructions.y + columns.instructions.height
  for (const line of lines) {
    const height = Math.max(columns.instructions.height, ...line.map((word) => word.height))
    // A large empty region ends the coherent table; later chat or description panes are not rows.
    if (line[0].y - lastBottom > height * 6) break
    const objective = objectiveRow(line, columns)
    if (objective) {
      rows.push(objective)
      lastBottom = Math.max(...line.map((word) => word.y + word.height))
    }
  }
  return rows.slice(0, 50)
}

function objectiveRow(line: RecoveryOcrWord[], { instructions, status, zone }: ObjectiveColumns): RecoveryObjective | undefined {
  const text = joined(line.filter((word) => word.x >= instructions.x - 3 && word.x + word.width < status.x - 2))
  const value = joined(line.filter((word) => word.x + word.width > status.x - 3 && word.x < zone.x - 2))
  const objective = statusObjective(text, value)
  if (objective) return objective
  // An unreadable status is not an absent cell. Only retain a label when the same row supplies a
  // bounded zone cell and Windows OCR supplied no Status words at all (the measured missing 2/3).
  if (value || !text || text.length > 500) return undefined
  const right = zone.x + Math.max(zone.width * 8, zone.x - status.x)
  const place = joined(line.filter((word) => word.x >= zone.x - 3 && word.x + word.width <= right))
  return place && place.length <= 120 ? { text } : undefined
}
