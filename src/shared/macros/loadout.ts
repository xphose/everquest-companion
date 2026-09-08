import type { MacroLoadoutPlan, MacroLoadoutSlot, MacroPlanInput, MacroRecipe, MacroSelection, MacroSpell } from '../macros'
import { macroSelectionKey } from '../macros'
import { eligibleSpell } from './spells'
import { castableMacroSlots } from './slots'

const COMMAND_ONLY = new Set(['loc', 'export', 'pet-attack', 'pet-backoff'])
interface Requirements { ids: Set<number>; spells: MacroSpell[]; problems: string[]; omitted: MacroLoadoutPlan['omitted'] }

function requirements(input: MacroPlanInput, recipes: MacroRecipe[], selections: MacroSelection[]): Requirements {
  const selected = new Set(selections.map(macroSelectionKey))
  const found = recipes.filter((recipe) => selected.has(macroSelectionKey(recipe.selection)))
  const out: Requirements = { ids: new Set(), spells: [], problems: [], omitted: [] }
  for (const key of selected) {
    if (!found.some((recipe) => macroSelectionKey(recipe.selection) === key)) out.problems.push(`The selected macro ${key} has no current recommendation.`)
  }
  for (const recipe of found) {
    if (recipe.status === 'unavailable' || !recipe.requiredSpellIds.length && (!COMMAND_ONLY.has(recipe.role) || !recipe.ready)) {
      out.problems.push(`${recipe.name}: ${recipe.reasons[0] ?? 'Its spell requirements are unavailable.'}`)
    }
    for (const id of recipe.requiredSpellIds) out.ids.add(id)
  }
  resolveRequirements(input, out)
  return out
}
function resolveRequirements(input: MacroPlanInput, out: Requirements): void {
  for (const id of out.ids) {
    const spell = input.spells.find((candidate) => candidate.id === id)
    if (spell && input.player.spellbook?.includes(id) && eligibleSpell(spell, input)) out.spells.push(spell)
    else {
      const name = spell?.name ?? `Spell ${id}`
      const reason = 'Ownership or eligibility for the current classes and level is not verified.'
      out.omitted.push({ id, name, reason })
      out.problems.push(`${name}: ${reason}`)
    }
  }
}

function observedSlots(input: MacroPlanInput, gems: number[]): boolean {
  const memorized = input.player.memorizedSpells
  return Array.isArray(memorized) && gems.every((gem) => {
    const id = memorized[gem - 1]
    return id === null || typeof id === 'number' && Number.isInteger(id) && id > 0
  })
}
function heldSlots(input: MacroPlanInput, gems: number[], wanted: Set<number>): MacroLoadoutSlot[] {
  const names = new Map(input.spells.map((spell) => [spell.id, spell.name]))
  const kept = new Set<number>()
  return gems.map((gem) => {
    const id = input.player.memorizedSpells?.[gem - 1]
    if (id === null || id === undefined) return { gem, action: 'empty', required: false }
    const required = wanted.has(id) && !kept.has(id)
    if (required) kept.add(id)
    // Preserve redundant copies when space remains, but one required spell needs only one gem.
    return { gem, spellId: id, name: names.get(id), currentSpellId: id, currentName: names.get(id), action: 'keep', required }
  })
}
function allocate(slots: MacroLoadoutSlot[], missing: MacroSpell[]): MacroLoadoutPlan['omitted'] {
  const omitted: MacroLoadoutPlan['omitted'] = []
  for (const spell of missing) {
    const row = slots.find((slot) => slot.action === 'empty') ?? slots.find((slot) => !slot.required)
    if (!row) { omitted.push({ id: spell.id, name: spell.name, reason: 'No unlocked castable gem remains for this selected spell.' }); continue }
    row.spellId = spell.id
    row.name = spell.name
    row.action = row.currentSpellId === undefined ? 'memorize' : 'replace'
    row.required = true
  }
  return omitted
}
function verdict(plan: MacroLoadoutPlan): void {
  if (plan.overflow) {
    plan.state = 'over-capacity'
    plan.message = `The selected macros need ${plan.requiredSpellCount} distinct spells but only ${plan.availableSlots} castable slots are unlocked. ${plan.overflow} additional slots are needed.`
  } else if (plan.missingSpellCount) {
    plan.state = 'needs-memorizing'
    plan.message = `The selected spells fit. Memorize ${plan.missingSpellCount} spells as shown; these changes are recommendations only.`
  } else {
    plan.state = 'ready'
    plan.message = plan.requiredSpellCount ? 'Every spell needed by the selected macros is already in an unlocked castable slot.' : 'The selected macros do not require spell gems.'
  }
}

/** A deterministic read-only gem plan. It does not memorize spells or make hypothetical
 * assignments into installable macros. Recipe order determines priority among missing spells. */
export function planMacroLoadout(input: MacroPlanInput, recipes: MacroRecipe[], selections: MacroSelection[]): MacroLoadoutPlan {
  const wanted = requirements(input, recipes, selections)
  const gems = castableMacroSlots(input.player)
  const plan: MacroLoadoutPlan = { state: 'unavailable', message: '', requiredSpellCount: wanted.ids.size,
    missingSpellCount: 0, overflow: 0, slots: [], omitted: wanted.omitted }
  if (gems === null) { plan.message = 'Wait for verified unlocked spell-slot information before planning a loadout.'; return plan }
  plan.availableSlots = gems.length
  if (!observedSlots(input, gems)) { plan.message = 'Some unlocked gems have not been observed. Their contents cannot be treated as empty.'; return plan }
  const held = heldSlots(input, gems, wanted.ids)
  const loaded = new Set(held.filter((slot) => slot.required).map((slot) => slot.spellId))
  const missing = wanted.spells.filter((spell) => !loaded.has(spell.id))
  plan.missingSpellCount = missing.length
  if (wanted.problems.length) { plan.message = wanted.problems.join(' '); return plan }
  plan.slots = held
  plan.omitted = allocate(plan.slots, missing)
  plan.overflow = plan.omitted.length
  verdict(plan)
  return plan
}
