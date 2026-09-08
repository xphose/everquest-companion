import { isClassAbbr } from '../classCombo'
import type { MacroPlanInput, MacroSpell, MacroStep } from '../macros'
import type { MacroPreparationPlan, MacroPreparationResult, MacroPreparationUtility } from '../macroPreparation'
import { spellLineKey } from '../spellLines'
import { castableMacroSlots } from './slots'
import { ownedSpells } from './spells'
import { compileMacro, MACRO_MAX_LINE, MACRO_MAX_LINES, safeCastName, safeMacroText, selfTargetCommand } from './compiler'
import { preparationCategory } from './preparationOptions'
export { preparationOptions, foodDrinkPreset, changePreparationSelection } from './preparationOptions'
export { preparationPhase } from './preparationPhase'

function validSelection(ids: number[]): boolean {
  return ids.length >= 1 && ids.length <= 4 && ids.every((id) => Number.isInteger(id) && id > 0) && new Set(ids).size === ids.length
}
function captureErrors(input: MacroPlanInput, ids: number[]): string[] {
  if (!validSelection(ids)) return ['Choose one to four different utility spells.']
  if (!selfTargetCommand(input.player.characterName) || !input.player.classes.length || !input.player.classes.every(isClassAbbr)) return ['Wait for your current character name and classes.']
  const gems = Array.from(input.player.memorizedSpells?.slice(0, 14) ?? [])
  if (castableMacroSlots(input.player) === null || gems.length !== 14 || !gems.every((id) => id === null || Number.isInteger(id) && id > 0)) return ['Wait for verified unlocked slots and a complete current spell-gem observation.']
  return []
}

function selectedUtilities(input: MacroPlanInput, ids: number[]): MacroSpell[] {
  return ids.map((id) => ownedSpells(input).find((spell) => spell.id === id && preparationCategory(spell) !== undefined)).filter((spell) => spell !== undefined)
}

function allocate(input: MacroPlanInput, spells: MacroSpell[]): MacroPreparationPlan | undefined {
  const baseline = input.player.memorizedSpells?.slice(0, 14) ?? []
  const unlockedSpellSlots = castableMacroSlots(input.player) ?? []
  const wanted = new Set(spells.map((spell) => spell.id))
  const eligible = new Set(ownedSpells(input).map((spell) => spell.id))
  const candidates = replacementCandidates({ baseline, unlockedSpellSlots, wanted, eligible })
  const plan: MacroPreparationPlan = { characterName: input.player.characterName ?? '', classes: [...input.player.classes],
    spellIds: spells.map((spell) => spell.id), unlockedSpellSlots, baseline,
    preparationGems: Array<number>(14).fill(-1), combatGems: Array<number>(14).fill(-1), replacements: [], utilities: [] }
  for (const spell of spells) {
    if (unlockedSpellSlots.some((gem) => baseline[gem - 1] === spell.id)) continue
    const gem = candidates.shift()
    if (gem === undefined) return undefined
    const originalSpellId = baseline[gem - 1]
    if (typeof originalSpellId !== 'number') return undefined
    plan.preparationGems[gem - 1] = spell.id
    plan.combatGems[gem - 1] = originalSpellId
    plan.replacements.push({ gem, originalSpellId, originalName: input.spells.find((s) => s.id === originalSpellId)?.name, spellId: spell.id, name: spell.name })
  }
  return plan
}

function replacementCandidates(input: { baseline: (number | null)[]; unlockedSpellSlots: number[]; wanted: Set<number>; eligible: Set<number> }): number[] {
  const originals = new Set<number>()
  return [...input.unlockedSpellSlots].reverse().filter((gem) => {
    const id = input.baseline[gem - 1]
    if (typeof id !== 'number' || input.wanted.has(id) || !input.eligible.has(id) || originals.has(id)) return false
    originals.add(id)
    return true
  })
}

function nameErrors(input: MacroPlanInput, spells: MacroSpell[]): string[] {
  const ids = new Set([...(input.player.memorizedSpells ?? []).slice(0, 14).filter((id) => id !== null), ...spells.map((spell) => spell.id)])
  const names = [...ids].map((id) => input.spells.find((spell) => spell.id === id))
  if (names.some((spell) => !spell)) return ['The names of some current gem spells are unknown. Refresh before preparing utilities.']
  return spells.flatMap((spell) => !safeCastName(spell.name) || names.some((other) => other && other.id !== spell.id && other.name.toLowerCase().startsWith(spell.name.toLowerCase()))
    ? [`${spell.name} cannot use a safe unique full-name cast in both layouts. Memorize it manually and use an ordinary macro instead.`] : [])
}

function buttonLabel(spell: MacroSpell): string {
  const family = spellLineKey(spell.name)
  if (family === 'summon food') return 'Make Food'
  if (family === 'summon drink') return 'Make Drink'
  return (preparationCategory(spell) === 'summon-item' ? spell.name.replace(/^Summon\b/iu, 'Make') : `Use ${spell.name}`).slice(0, 15).trim()
}
function utility(spell: MacroSpell, planned: MacroPlanInput): MacroPreparationUtility | string[] {
  const summon = preparationCategory(spell) === 'summon-item'
  const steps: MacroStep[] = spell.targetType === 6 ? [] : [{ kind: 'target-self' }]
  steps.push({ kind: 'cast', spellId: spell.id })
  if (summon) steps.push({ kind: 'command', command: '/autoinventory' })
  const buttonName = buttonLabel(spell)
  const compiled = compileMacro(buttonName, steps, planned)
  if (!compiled.ready) return compiled.reasons
  if (!compiled.lines.some((line) => line.endsWith(`/cast ${spell.name}`))) return [`${spell.name} requires a numeric cast fallback; preparation buttons require a unique full name.`]
  return { spellId: spell.id, name: spell.name, gem: (planned.player.memorizedSpells ?? []).indexOf(spell.id) + 1,
    buttonName, lines: compiled.lines, mana: compiled.mana, pauseTenths: compiled.pauseTenths,
    guidance: summon ? ['Press again for more supplies. Keep the cursor clear and leave free bag space. A fizzle needs another click.'] : ['Use on yourself after the utility gems are ready. A fizzle needs another click.'],
    signature: JSON.stringify(spell) }
}

function suppliesShortcut(utilities: MacroPreparationUtility[]): MacroPreparationPlan['suppliesButton'] {
  const food = utilities.find((entry) => spellLineKey(entry.name) === 'summon food' && entry.lines.at(-1) === '/autoinventory')
  const drink = utilities.find((entry) => spellLineKey(entry.name) === 'summon drink' && entry.lines.at(-1) === '/autoinventory')
  if (!food || !drink) return undefined
  const lines = [...food.lines, ...drink.lines]
  if (lines.length > MACRO_MAX_LINES || !lines.every((line) => safeMacroText(line, MACRO_MAX_LINE))) return undefined
  return { name: 'Make Supplies', lines, mana: food.mana + drink.mana, pauseTenths: food.pauseTenths + drink.pauseTenths }
}

/** Compile a separate preparation package against a virtual layout, never ordinary ready macros. */
export function planMacroPreparation(input: MacroPlanInput, spellIds: number[]): MacroPreparationResult {
  const reasons = captureErrors(input, spellIds)
  if (reasons.length) return { ok: false, reasons }
  const spells = selectedUtilities(input, spellIds)
  if (spells.length !== spellIds.length) return { ok: false, reasons: ['Every selected utility must be owned, usable by your current classes and level, and safe for self preparation.'] }
  if (new Set(spells.map((spell) => spellLineKey(spell.name))).size !== spells.length) return { ok: false, reasons: ['Choose only one rank from each utility spell family.'] }
  const plan = allocate(input, spells)
  if (!plan) return { ok: false, reasons: ['There are not enough occupied unlocked gems containing distinct usable combat spells to swap safely. Memorize different combat spells first, or choose fewer utilities.'] }
  const owned = new Set(ownedSpells(input).map((spell) => spell.id))
  if (plan.replacements.some((slot) => !owned.has(slot.originalSpellId))) return { ok: false, reasons: ['A combat spell to restore is not verified as owned and usable by your current classes and level.'] }
  reasons.push(...nameErrors(input, spells))
  const memorizedSpells = plan.baseline.map((id, index) => plan.preparationGems[index] > 0 ? plan.preparationGems[index] : id)
  const planned = { ...input, castByName: true, player: { ...input.player, memorizedSpells } }
  for (const spell of spells) {
    const compiled = utility(spell, planned)
    if (Array.isArray(compiled)) reasons.push(...compiled)
    else plan.utilities.push(compiled)
  }
  plan.suppliesButton = suppliesShortcut(plan.utilities)
  return reasons.length ? { ok: false, reasons } : { ok: true, plan }
}
