import type { CompiledMacro, MacroPlanInput, MacroSpell, MacroStep } from '../macros'
import { MACRO_CAST_GEMS } from '../macros'
import { macroBindings } from './bindings'
import { eligibleSpell } from './spells'
import { castableMacroSlots, spellGem } from './slots'
export { spellGem } from './slots'

export const MACRO_MAX_LINES = 5
/** Conservative writer bounds; the client /cast handler was verified to inspect only gems 1–14. */
export const MACRO_MAX_NAME = 15
export const MACRO_MAX_LINE = 240
export { MACRO_CAST_GEMS } from '../macros'
export const MACRO_MAX_PAUSE = 600
export function safeMacroText(text: string, max: number): boolean {
  return text.length > 0 && text.length <= max && /^[\x20-\x7e]+$/u.test(text)
}
export function castPause(spell: MacroSpell, repeated = false): number {
  // A small explicit scheduling margin, not a guarantee against lag, fizzles or interruption.
  const cooldown = repeated ? Math.max(spell.recoveryMs, spell.recastMs) : spell.recoveryMs
  return Math.ceil((spell.castMs + cooldown + 200) / 100)
}

/** Full names are unquoted. The client does PREFIX lookup, so collisions use the actual gem. */
export function castCommand(spell: MacroSpell, input: MacroPlanInput): string | null {
  const gem = spellGem(spell.id, input)
  if (gem === null) return null
  if (!input.castByName || !safeCastName(spell.name)) return `/cast ${gem}`
  if ((input.player.memorizedSpells?.length ?? 0) < MACRO_CAST_GEMS) return `/cast ${gem}`
  const gems = Array.from(input.player.memorizedSpells?.slice(0, MACRO_CAST_GEMS) ?? [])
  const lookup = new Map(input.spells.map((s) => [s.id, s.name.toLowerCase()]))
  const names = gems.filter((id) => id !== null).map((id) => lookup.get(id))
  const matches = names.filter((name) => name?.startsWith(spell.name.toLowerCase()))
  return names.every((name) => name !== undefined) && matches.length === 1 ? `/cast ${spell.name}` : `/cast ${gem}`
}
export function safeCastName(name: string): boolean {
  return safeMacroText(name, 180) && name.trim() === name && !/^[\d/]/u.test(name) && !/[",;\\]/u.test(name)
}
function validMetrics(spell: MacroSpell): boolean {
  return [spell.castMs, spell.recoveryMs, spell.recastMs, spell.mana].every((n) => Number.isFinite(n) && n >= 0)
}
function addCast(out: CompiledMacro, step: Extract<MacroStep, { kind: 'cast' }>, input: MacroPlanInput, repeated: boolean): void {
  out.requiredSpellIds.push(step.spellId)
  const spell = input.spells.find((s) => s.id === step.spellId)
  if (!spell || !input.player.spellbook?.includes(step.spellId) || !eligibleSpell(spell, input)) {
    out.reasons.push('A required spell is not verified as owned and usable by your current classes and level.')
    return
  }
  if (!validMetrics(spell)) { out.reasons.push(`Timing or mana data is unavailable for ${spell.name}.`); return }
  out.mana += spell.mana
  const pause = castPause(spell, repeated)
  out.pauseTenths += pause
  if (pause > MACRO_MAX_PAUSE) { out.reasons.push(`${spell.name} needs a wait longer than one social line supports.`); return }
  if (castableMacroSlots(input.player) === null) { out.reasons.push('Unlocked spell-slot information is unavailable.'); return }
  if (!input.player.memorizedSpells) { out.reasons.push('Current spell-gem data is unavailable.'); return }
  const command = castCommand(spell, input)
  if (!command) {
    out.missingSpellIds.push(spell.id)
    out.reasons.push(`Memorize ${spell.name} in an unlocked castable gem (1 to 14).`)
    return
  }
  out.lines.push(`/pause ${pause}, ${command}`)
}
function addCommand(out: CompiledMacro, step: Extract<MacroStep, { kind: 'command' }>): void {
  if (!step.command.startsWith('/') || !safeMacroText(step.command, MACRO_MAX_LINE) || /[,;]/u.test(step.command)) {
    out.reasons.push('A command contains unsupported or unsafe text.'); return
  }
  const pause = step.pauseTenths ?? 0
  if (!Number.isInteger(pause) || pause < 0 || pause > MACRO_MAX_PAUSE) { out.reasons.push('A command has an invalid pause.'); return }
  out.lines.push(pause ? `/pause ${pause}, ${step.command}` : step.command)
  out.pauseTenths += pause
}
export function selfTargetCommand(name: string | undefined): string | null {
  return name && /^[A-Za-z]{1,64}$/u.test(name) ? `/target ${name}` : null
}
function targetSelf(out: CompiledMacro, input: MacroPlanInput): void {
  const command = selfTargetCommand(input.player.characterName)
  if (!command) {
    out.reasons.push('A valid observed character name is required to target yourself.'); return
  }
  // Native /target resolves a spawn name. It does not implement a "myself" keyword.
  addCommand(out, { kind: 'command', command, pauseTenths: 3 })
}
function addSteps(out: CompiledMacro, steps: MacroStep[], input: MacroPlanInput): void {
  for (const [index, step] of steps.entries()) {
    if (step.kind === 'command') addCommand(out, step)
    else if (step.kind === 'target-self') targetSelf(out, input)
    else addCast(out, step, input, steps.slice(index + 1).some((s) => s.kind === 'cast' && s.spellId === step.spellId))
  }
}

/** Compilation builds reviewable text only. It never runs commands or writes the game files. */
export function compileMacro(name: string, steps: MacroStep[], input: MacroPlanInput): CompiledMacro {
  const out: CompiledMacro = { lines: [], requiredSpellIds: [], missingSpellIds: [], mana: 0, pauseTenths: 0,
    ready: false, status: 'unavailable', reasons: [] }
  if (!safeMacroText(name, MACRO_MAX_NAME) || name.trim() !== name) out.reasons.push('Use a short printable macro name (1 to 15 characters).')
  if (!steps.length || steps.length > MACRO_MAX_LINES) out.reasons.push('A social must contain one to five commands.')
  addSteps(out, steps, input)
  if (out.lines.some((line) => !safeMacroText(line, MACRO_MAX_LINE))) out.reasons.push('A compiled command exceeds the line limit.')
  out.requiredSpellIds = [...new Set(out.requiredSpellIds)]
  out.missingSpellIds = [...new Set(out.missingSpellIds)]
  out.ready = out.reasons.length === 0
  out.status = out.ready ? 'ready' : out.missingSpellIds.length && out.missingSpellIds.length === out.reasons.length ? 'needs-memorizing' : 'unavailable'
  // A blocked recipe must not offer an executable-looking partial sequence.
  if (!out.ready) out.lines = []
  out.bindings = macroBindings(out.lines, input)
  return out
}
