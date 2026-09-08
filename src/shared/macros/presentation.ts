import { macroSelectionKey, type MacroRecipe, type MacroSelection } from '../macros'
import type { MacroExistingSocial } from '../macroAssistant'

export const MACRO_SELECTION_LIMIT = 12

/** Keep unavailable selections visible: changing class must never strand a hidden checked box. */
export function visibleRecipes(recipes: readonly MacroRecipe[], selected: readonly MacroSelection[]): MacroRecipe[] {
  const present = new Set(recipes.map((recipe) => macroSelectionKey(recipe.selection)))
  const missing = selected.filter((selection) => !present.has(macroSelectionKey(selection))).map((selection): MacroRecipe => ({
    id: macroSelectionKey(selection), role: selection.role, name: selection.role.replace(/-/g, ' '),
    description: selection.spellLine ?? 'A previously selected macro.', selection, ready: false, status: 'unavailable',
    lines: [], requiredSpellIds: [], missingSpellIds: [], mana: 0, pauseTenths: 0,
    reasons: ['This selection is unavailable for the current character setup. You can remove it from the managed set.']
  }))
  return [...recipes, ...missing]
}

export function changeSelection(selected: readonly MacroSelection[], selection: MacroSelection, checked: boolean): MacroSelection[] {
  const key = macroSelectionKey(selection)
  if (checked && selected.length >= MACRO_SELECTION_LIMIT && !selected.some((entry) => macroSelectionKey(entry) === key)) return [...selected]
  const others = selected.filter((entry) => macroSelectionKey(entry) !== key)
  return checked ? [...others, selection] : others
}

/** A compact introduction, one ready suggestion per role in the planner's play-style order.
 * Existing selections stay selected; this button adds to the user's choices. */
export function starterSelections(recipes: readonly MacroRecipe[], selected: readonly MacroSelection[]): MacroSelection[] {
  let next = [...selected]
  const buffs = recipes.find((recipe) => recipe.ready && recipe.role === 'self-buffs')
  const opener = recipes.find((recipe) => recipe.ready && recipe.role === 'pet-opener')
  const existingRoles = new Set(selected.filter((selection) => selection.role !== 'buff').map((selection) => selection.role))
  const roles = new Set<string>()
  for (const candidate of recipes) {
    if (next.length >= MACRO_SELECTION_LIMIT) break
    const recipe = starterReplacement(candidate, buffs, opener)
    if (!recipe.ready || roles.has(recipe.role) || existingRoles.has(recipe.role) || roles.size >= 8) continue
    roles.add(recipe.role)
    // Starter roles can follow classes and gem changes; an individual card keeps its chosen line.
    next = changeSelection(next, recipe.role === 'buff' ? recipe.selection : { role: recipe.role }, true)
  }
  return next
}

function starterReplacement(recipe: MacroRecipe, buffs: MacroRecipe | undefined, opener: MacroRecipe | undefined): MacroRecipe {
  if (recipe.role === 'pet-attack' && opener) return opener
  if (recipe.role === 'buff' && buffs && recipe.requiredSpellIds.length > 0 &&
    recipe.requiredSpellIds.every((id) => buffs.requiredSpellIds.includes(id))) return buffs
  return recipe
}

export function recipePresentation(recipes: readonly MacroRecipe[], selected: readonly MacroSelection[], filter: string) {
  const all = visibleRecipes(recipes, selected)
  const keys = new Set(selected.map(macroSelectionKey))
  return { all, selected: keys, ready: all.filter((recipe) => recipe.ready).length,
    displayed: all.filter((recipe) => filter === 'all' || (filter === 'ready' ? recipe.ready : keys.has(macroSelectionKey(recipe.selection)))) }
}

export function auditIssueCount(socials: readonly MacroExistingSocial[]): number {
  return socials.reduce((count, social) => count + social.issues.length, 0)
}
