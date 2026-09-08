import type { MacroAuditIssue, MacroPlanInput, MacroSpell } from '../macros'
import { castPause, MACRO_MAX_LINE, MACRO_MAX_LINES, MACRO_MAX_NAME, MACRO_MAX_PAUSE, safeMacroText, selfTargetCommand } from './compiler'
import { resolveCast } from './bindings'
import { spellRoles } from './spells'
import { isFriendlyUtilitySpell } from './utilityRoles'

interface ParsedLine { command: string; pause: number; issues: MacroAuditIssue[] }
function parseLine(text: string, line: number): ParsedLine {
  const parsed: ParsedLine = { command: text.trimStart(), pause: 0, issues: [] }
  const issue = (code: string, message: string, suggestion?: string): void => {
    parsed.issues.push({ line, code, message, severity: 'error', ...(suggestion ? { suggestion } : {}) })
  }
  if (!safeMacroText(text, MACRO_MAX_LINE)) issue('line-text', 'This line is too long or contains unsupported control characters.')
  if (/^\/pause\b/iu.test(parsed.command)) {
    const match = /^\/pause\s+(\d+)(?:\s*,\s*(.*))?$/iu.exec(parsed.command)
    if (!match) { issue('pause-syntax', 'Use /pause followed by a whole number of tenths, optionally followed by a comma and a /command.'); return parsed }
    parsed.pause = Number(match[1])
    parsed.command = match[2] ?? ''
    if (parsed.pause < 1 || parsed.pause > MACRO_MAX_PAUSE) issue('pause-range', 'A pause must be between 1 and 600 tenths of a second.')
  }
  if (parsed.command && !parsed.command.startsWith('/')) {
    issue('missing-slash', 'The command is missing its leading slash.', parsed.pause ? `/pause ${parsed.pause}, /${parsed.command}` : `/${parsed.command}`)
    parsed.command = `/${parsed.command}`
  }
  return parsed
}
function isBuff(spell: MacroSpell): boolean {
  return spellRoles(spell).includes('buff') || (spell.durationTicks ?? 0) > 0 && isFriendlyUtilitySpell(spell)
}
function auditBuffBinding(name: string, cast: ReturnType<typeof resolveCast>, line: number): MacroAuditIssue[] {
  if (!/^(?:self[ -]*)?buffs?$/iu.test(name.trim()) || !cast.spell || isBuff(cast.spell)) return []
  return [{ line, code: 'buff-binding-mismatch', severity: 'warning',
    message: `This Buffs social currently casts ${cast.spell.name} from gem ${cast.gem}; it is not a verified beneficial buff. The binding may be stale.`,
    suggestion: 'Review this personal macro against your current gems, or choose a verified Self Buffs recommendation.' }]
}
function waitAfter(parsed: ParsedLine[], index: number): number {
  let wait = parsed[index].pause
  for (let i = index + 1; i < parsed.length && !parsed[i].command; i++) wait += parsed[i].pause
  return wait
}
function auditSelfTarget(parsed: ParsedLine, input: MacroPlanInput, line: number): MacroAuditIssue[] {
  if (!/^\/target\s+myself$/iu.test(parsed.command)) return []
  const command = selfTargetCommand(input.player.characterName)
  return [{ line, code: 'unsupported-self-target', severity: 'error',
    message: 'This client targets a character by name; /target myself is not a self-target keyword.',
    ...(command ? { suggestion: parsed.pause ? `/pause ${parsed.pause}, ${command}` : command } : {}) }]
}

/** Syntactic and current-binding advice only: personal macros are never changed by this audit. */
export function auditMacro(name: string, lines: string[], input: MacroPlanInput): MacroAuditIssue[] {
  const issues: MacroAuditIssue[] = []
  if (!safeMacroText(name, MACRO_MAX_NAME)) issues.push({ code: 'name-text', severity: 'error', message: 'Use a printable name of at most 15 characters.' })
  if (lines.length > MACRO_MAX_LINES) issues.push({ code: 'line-count', severity: 'error', message: 'A social supports at most five lines.' })
  if (!lines.some((text) => text.trim())) issues.push({ code: 'empty-macro', severity: 'warning', message: 'This social has no commands.' })
  const parsed = lines.map((text, index) => text.trim() ? parseLine(text, index + 1) : { command: '', pause: 0, issues: [] })
  for (const [index, entry] of parsed.entries()) {
    issues.push(...entry.issues)
    issues.push(...auditSelfTarget(entry, input, index + 1))
    const later = parsed.slice(index + 1).some((line) => line.command)
    if (!lines[index].trim() && later) issues.push({ line: index + 1, code: 'empty-line', severity: 'warning', message: 'This empty line leaves fewer command slots available.' })
    const cast = resolveCast(entry.command, input)
    issues.push(...auditBuffBinding(name, cast, index + 1))
    if (cast.issue) issues.push({ ...cast.issue, line: index + 1 })
    if (cast.spell && later && waitAfter(parsed, index) < castPause(cast.spell)) issues.push({
      line: index + 1, code: 'short-pause', severity: 'warning',
      message: `${cast.spell.name} needs about ${castPause(cast.spell) / 10}s for casting, recovery and a 0.2s margin before the next command.`,
      suggestion: `/pause ${castPause(cast.spell)}, ${entry.command}`
    })
  }
  return issues
}
