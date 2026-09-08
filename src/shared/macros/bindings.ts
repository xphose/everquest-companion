import type { MacroAuditIssue, MacroCastBinding, MacroPlanInput, MacroSpell } from '../macros'
import { MACRO_CAST_GEMS } from '../macros'
import { castableMacroSlots, spellGem } from './slots'

interface CastResolution { spell?: MacroSpell; gem?: number; issue?: MacroAuditIssue }
function slotIssue(input: MacroPlanInput, gem?: number): MacroAuditIssue | undefined {
  const slots = castableMacroSlots(input.player)
  if (slots === null) return { code: 'slots-unavailable', severity: 'warning', message: 'Unlocked spell-slot information is unavailable; this cast cannot be verified.' }
  if (gem !== undefined && !slots.includes(gem)) return { code: 'locked-gem', severity: 'error', message: `Gem ${gem} is locked; this command cannot cast its spell.` }
  return undefined
}
function numericCast(arg: string, input: MacroPlanInput): CastResolution {
  const gem = Number(arg)
  if (!Number.isInteger(gem) || gem < 1 || gem > MACRO_CAST_GEMS) return { issue: {
    code: 'gem-range', severity: 'error', message: 'This client accepts /cast gem numbers from 1 to 14.' } }
  const unavailable = slotIssue(input, gem)
  if (unavailable && unavailable.code !== 'locked-gem') return { issue: unavailable }
  if (!input.player.memorizedSpells) return { issue: {
    code: 'gems-unavailable', severity: 'warning', message: 'Current spell-gem data is unavailable; this binding cannot be verified.' } }
  const id = input.player.memorizedSpells[gem - 1]
  if (id === undefined) return { issue: { code: 'gems-unavailable', severity: 'warning', message: `Gem ${gem} has not been observed; this binding cannot be verified.` } }
  if (id === null) return { issue: {
    code: 'empty-gem', severity: 'error', message: `Gem ${gem} is empty; this command cannot cast a spell.` } }
  const spell = input.spells.find((s) => s.id === id)
  return spell ? { spell, gem, ...(unavailable ? { issue: unavailable } : {}) } : { issue: { code: 'spell-data-unavailable', severity: 'warning', message: `Spell details for gem ${gem} are unavailable.` } }
}
function namedCast(arg: string, input: MacroPlanInput): CastResolution {
  if (!input.castByName) return { issue: { code: 'named-cast-unverified', severity: 'warning', message: 'Named casting is not verified for this client; use a current gem number.' } }
  if (arg.startsWith('"')) return { issue: { code: 'quoted-name', severity: 'error', message: 'This client does not strip quotation marks from /cast spell names.', suggestion: `/cast ${arg.replace(/^"|"$/gu, '')}` } }
  const unavailable = slotIssue(input)
  if (unavailable) return { issue: unavailable }
  if (!input.player.memorizedSpells) return { issue: { code: 'gems-unavailable', severity: 'warning', message: 'Current spell-gem data is unavailable; this name cannot be verified.' } }
  if (input.player.memorizedSpells.length < MACRO_CAST_GEMS) return { issue: { code: 'spell-data-unavailable', severity: 'warning',
    message: 'Some spell controls have not been observed, so the first name-prefix match cannot be verified.' } }
  const gems = Array.from(input.player.memorizedSpells.slice(0, MACRO_CAST_GEMS))
    .flatMap((id, index) => id === null ? [] : [{ gem: index + 1, spell: input.spells.find((s) => s.id === id) }])
  if (gems.some((entry) => !entry.spell)) return { issue: { code: 'spell-data-unavailable', severity: 'warning',
    message: 'Some occupied gems have no spell details, so the client’s first name-prefix match cannot be verified.' } }
  return namedMatch(gems.filter((entry) => entry.spell?.name.toLowerCase().startsWith(arg.toLowerCase())), arg, input)
}
function namedMatch(matches: { gem: number; spell?: MacroSpell }[], arg: string, input: MacroPlanInput): CastResolution {
  const spell = matches[0]?.spell
  if (!spell) return { issue: { code: 'name-not-memorized', severity: 'error', message: `No castable memorized spell matches “${arg}”.` } }
  const unavailable = slotIssue(input, matches[0].gem)
  if (unavailable) return { spell, gem: matches[0].gem, issue: unavailable }
  if (matches.length > 1) return { spell, gem: matches[0].gem, issue: { code: 'name-ambiguous', severity: 'warning',
    message: `This prefix matches several gems; the client casts the first, ${spell.name}.`, suggestion: `/cast ${spellGem(spell.id, input)}` } }
  return { spell, gem: matches[0].gem }
}

/** Mirror the verified first gem-prefix match; never resolve a name from an unobserved control. */
export function resolveCast(command: string, input: MacroPlanInput): CastResolution {
  if (!/^\/cast(?:\s|$)/iu.test(command)) return {}
  const arg = command.replace(/^\/cast\s*/iu, '')
  if (!arg) return { issue: { code: 'cast-argument', severity: 'error', message: 'Specify a memorized spell name or gem number after /cast.' } }
  return /^\d/u.test(arg) ? numericCast(arg, input) : namedCast(arg, input)
}

export function macroBindings(lines: readonly string[], input: MacroPlanInput): MacroCastBinding[] {
  return lines.flatMap((text, index) => {
    const command = text.trimStart().replace(/^\/pause\s+\d+\s*,\s*/iu, '')
    const { spell, gem, issue } = resolveCast(command, input)
    return spell && gem !== undefined ? [{ line: index + 1, gem, spellId: spell.id, name: spell.name,
      castable: issue?.code !== 'locked-gem' }] : []
  })
}
