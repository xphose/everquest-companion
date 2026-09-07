import type { RecoveryCapture } from '../../../shared/questJournal/recovery'
import { phraseBox, spatialLines, validWord } from './geometry'

interface TableRow { name: string; bounded: boolean }
export interface ScreenTable {
  state?: 'active' | 'completed'
  rows: TableRow[]
  objectiveText: string[]
  warnings: string[]
}
interface Heading { state: 'active' | 'completed'; title: string; next: string; end: string }
const HEADINGS: Heading[] = [
  { state: 'active', title: 'Task Title', next: 'Time Left', end: 'Task Progression' },
  { state: 'completed', title: 'Quest Title', next: 'Completion', end: 'Quest Progression' }
]

/** These are the distinct inner table labels in the installed default EQUI_TaskWnd.xml.
 * Current Tasks / Shared Task / Quest History are always-visible tabs, not selection evidence. */
export function screenTable(capture: RecoveryCapture): ScreenTable {
  const lines = capture.lines?.length ? spatialLines(capture).map((line) => line.map((word) => word.text).join(' ')) :
    capture.text.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean)
  const visible = HEADINGS.filter((heading) => lines.some((line) => has(line, heading.title)) &&
    lines.some((line) => has(line, heading.next)))
  if (visible.length !== 1) return empty('The selected task page is unclear. Capture its Task Title / Time Left or Quest Title / Completion table, including the progression heading.')
  const heading = visible[0]
  const start = Math.max(lines.findIndex((line) => has(line, heading.title)), lines.findIndex((line) => has(line, heading.next)))
  const end = lines.findIndex((line, i) => i > start && line.toLowerCase() === heading.end.toLowerCase())
  if (end < 0) return empty('The task table has no clear lower boundary. Include the progression heading and capture again.')
  const rows = capture.lines?.length ? spatialRows(capture, heading) : plainRows(lines.slice(start + 1, end))
  if (!rows) return empty('The title column could not be separated from neighboring columns. Capture a clear task table again.')
  return { state: heading.state, rows, objectiveText: lines.slice(end + 1), warnings: [] }
}

function empty(warning: string): ScreenTable { return { rows: [], objectiveText: [], warnings: [warning] } }

function has(line: string, phrase: string): boolean {
  const expression = new RegExp(`(?:^|[\\t ])${phrase.replace(/ /gu, '\\s+')}(?:$|[\\t ])`, 'iu')
  return expression.test(line)
}

function plainRows(lines: string[]): TableRow[] {
  const controls = new Set(['zone', 'min', 'max', 'task title', 'time left', 'quest title', 'completion'])
  return lines.filter((line) => !controls.has(line.toLowerCase())).map((line) => {
    const cells = line.split(/\t+/u).filter(Boolean)
    return { name: cells[0].trim(), bounded: cells.length > 1 && /^(?:\d|unlimited|none)/iu.test(cells[1]) }
  })
}

function spatialRows(capture: RecoveryCapture, heading: Heading): TableRow[] | undefined {
  const title = phraseBox(capture, heading.title); const next = phraseBox(capture, heading.next)
  const end = phraseBox(capture, heading.end)
  if (!title || !next || !end || next.x <= title.x + title.width || end.y <= title.y) return undefined
  if (Math.abs(title.y - next.y) > Math.max(title.height, next.height)) return undefined
  const rows: TableRow[] = []
  for (const line of spatialLines(capture)) {
    const words = line.filter((word) => validWord(word) && word.y > title.y + title.height &&
      word.y + word.height <= end.y && word.x >= title.x - 3 && word.x + word.width < next.x - 2)
    if (words.length) rows.push({ name: words.sort((a, b) => a.x - b.x).map((word) => word.text).join(' '), bounded: true })
  }
  return rows
}
