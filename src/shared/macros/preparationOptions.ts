import type { MacroPlanInput, MacroSpell } from '../macros'
import type { MacroPreparationCategory, MacroPreparationOption, MacroPreparationSnapshot } from '../macroPreparation'
import { parseSpellRank, spellLineKey } from '../spellLines'
import { ownedSpells, spellRoles } from './spells'
import { isFriendlyUtilitySpell, utilityRoles } from './utilityRoles'

const CATEGORIES: MacroPreparationCategory[] = ['summon-item', 'cure', 'invisibility', 'vision', 'breathing', 'levitation', 'rune']

export function preparationCategory(spell: MacroSpell): MacroPreparationCategory | undefined {
  if (![5, 6, 51].includes(spell.targetType)) return undefined
  const roles = utilityRoles(spell)
  return CATEGORIES.find((category) => roles.includes(category)) ??
    (isFriendlyUtilitySpell(spell) && spellRoles(spell).includes('buff') ? 'buff' : undefined)
}

function preset(spell: MacroSpell): MacroPreparationOption['preset'] {
  if (!utilityRoles(spell).includes('summon-item')) return undefined
  const family = spellLineKey(spell.name)
  if (family === 'summon food') return 'food'
  return family === 'summon drink' ? 'drink' : undefined
}

/** Rank comparisons are confined to one spell family, never numeric IDs or unrelated effects. */
export function preparationOptions(input: MacroPlanInput): MacroPreparationOption[] {
  const families = new Map<string, MacroSpell>()
  const ranked = ownedSpells(input).filter((spell) => preparationCategory(spell) !== undefined).sort((a, b) =>
    parseSpellRank(b.name).rank - parseSpellRank(a.name).rank || a.name.localeCompare(b.name) || a.id - b.id)
  for (const spell of ranked) if (!families.has(spellLineKey(spell.name))) families.set(spellLineKey(spell.name), spell)
  return [...families.values()].map((spell) => ({ spellId: spell.id, name: spell.name, family: spellLineKey(spell.name),
    category: preparationCategory(spell) ?? 'buff', preset: preset(spell), classes: input.player.classes.filter((cls) => {
      const level = spell.classLevels[cls]
      return level !== undefined && level > 0 && level < 255 && level <= (input.player.level ?? 0)
    }) })).sort((a, b) => Number(Boolean(b.preset)) - Number(Boolean(a.preset)) || a.name.localeCompare(b.name))
}

export function foodDrinkPreset(options: MacroPreparationOption[]): number[] {
  return options.filter((option) => option.preset !== undefined).slice(0, 2).map((option) => option.spellId)
}

export function changePreparationSelection(selected: number[], spellId: number, checked: boolean): number[] {
  if (!checked) return selected.filter((id) => id !== spellId)
  return selected.includes(spellId) || selected.length >= 4 ? selected : [...selected, spellId]
}

export function preparationSpellLabel(preparation: MacroPreparationSnapshot, id: number): string {
  return preparation.options.find((option) => option.spellId === id)?.name ??
    preparation.plan?.utilities.find((utility) => utility.spellId === id)?.name ?? `Spell ${id}`
}

export function canCapturePreparation(preparation: MacroPreparationSnapshot): boolean {
  const current = preparation.previewInput?.player.memorizedSpells
  if (!current) return false
  if (preparation.plan?.replacements.some((slot) => current[slot.gem - 1] === null || current[slot.gem - 1] === slot.spellId)) return false
  return !preparation.plan || preparation.phase === 'combat' || preparation.phase === 'changed'
}
