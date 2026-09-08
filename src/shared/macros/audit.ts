import type { MacroAuditIssue, MacroPlanInput, MacroSpell } from '../macros'
import { castPause, MACRO_CAST_GEMS, MACRO_MAX_LINE, MACRO_MAX_LINES, MACRO_MAX_NAME, MACRO_MAX_PAUSE, safeMacroText, selfTargetCommand, spellGem } from './compiler'

interface ParsedLine { command: string; pause: number; issues: MacroAuditIssue[] }
function parseLine(text: string, line: number): ParsedLine {
  const parsed: ParsedLine = { command: text.trim(), pause: 0, issues: [] }
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
function numericCast(arg: string, input: MacroPlanInput): { spell?: MacroSpell; issue?: MacroAuditIssue } {
  const gem = Number(arg)
  if (!Number.isInteger(gem) || gem < 1 || gem > MACRO_CAST_GEMS) return { issue: {
    code: 'gem-range', severity: 'error', message: 'This client accepts /cast gem numbers from 1 to 14.' } }
  if (!input.player.memorizedSpells) return { issue: {
    code: 'gems-unavailable', severity: 'warning', message: 'Current spell-gem data is unavailable; this binding cannot be verified.' } }
  const id = input.player.memorizedSpells[gem - 1]
  if (id === null || id === undefined) return { issue: {
    code: 'empty-gem', severity: 'error', message: `Gem ${gem} is empty; this command cannot cast a spell.` } }
  const spell = input.spells.find((s) => s.id === id)
  return spell ? { spell } : { issue: { code: 'spell-data-unavailable', severity: 'warning', message: `Spell details for gem ${gem} are unavailable.` } }
}
function namedCast(arg: string, input: MacroPlanInput): { spell?: MacroSpell; issue?: MacroAuditIssue } {
  if (!input.castByName) return { issue: { code: 'named-cast-unverified', severity: 'warning', message: 'Named casting is not verified for this client; use a current gem number.' } }
  if (arg.startsWith('"')) return { issue: { code: 'quoted-name', severity: 'error', message: 'This client does not strip quotation marks from /cast spell names.', suggestion: `/cast ${arg.replace(/^"|"$/gu, '')}` } }
  if (!input.player.memorizedSpells) return { issue: { code: 'gems-unavailable', severity: 'warning', message: 'Current spell-gem data is unavailable; this name cannot be verified.' } }
  const gems = input.player.memorizedSpells.slice(0, MACRO_CAST_GEMS).filter((id) => id !== null)
    .map((id) => input.spells.find((s) => s.id === id))
  if (gems.some((spell) => !spell)) return { issue: { code: 'spell-data-unavailable', severity: 'warning',
    message: 'Some occupied gems have no spell details, so the client’s first name-prefix match cannot be verified.' } }
  const matches = gems.filter((s) => s?.name.toLowerCase().startsWith(arg.toLowerCase()))
  const spell = matches[0]
  if (!spell) return { issue: { code: 'name-not-memorized', severity: 'error', message: `No castable memorized spell matches “${arg}”.` } }
  if (matches.length > 1) return { spell, issue: { code: 'name-ambiguous', severity: 'warning',
    message: `This prefix matches several gems; the client casts the first, ${spell.name}.`, suggestion: `/cast ${spellGem(spell.id, input)}` } }
  return { spell }
}
function auditCast(parsed: ParsedLine, input: MacroPlanInput): { spell?: MacroSpell; issue?: MacroAuditIssue } {
  if (!/^\/cast(?:\s|$)/iu.test(parsed.command)) return {}
  const arg = parsed.command.replace(/^\/cast\s*/iu, '').trim()
  if (!arg) return { issue: { code: 'cast-argument', severity: 'error', message: 'Specify a memorized spell name or gem number after /cast.' } }
  return /^\d/u.test(arg) ? numericCast(arg, input) : namedCast(arg, input)
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
    const cast = auditCast(entry, input)
    if (cast.issue) issues.push({ ...cast.issue, line: index + 1 })
    if (cast.spell && later && waitAfter(parsed, index) < castPause(cast.spell)) issues.push({
      line: index + 1, code: 'short-pause', severity: 'warning',
      message: `${cast.spell.name} needs about ${castPause(cast.spell) / 10}s for casting, recovery and a 0.2s margin before the next command.`,
      suggestion: `/pause ${castPause(cast.spell)}, ${entry.command}`
    })
  }
  return issues
}
