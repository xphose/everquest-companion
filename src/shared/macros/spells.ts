import { isClassAbbr } from '../classCombo'
import type { MacroPlanInput, MacroRole, MacroSpell } from '../macros'
import { parseSpellRank, spellLineKey } from '../spellLines'
import { memorizedMacroSpellIds } from './slots'
import { utilityRoles } from './utilityRoles'

// Legends target 51: measured Strengthen/Spirit of Wolf rows, documented Single Friendly (or Self).
// It is not the enemy-target role of type 5, even if an unfamiliar row carries hostile slots.
const FRIENDLY_HEALS: Record<number, MacroRole[]> = {
  6: ['heal-self'], 14: ['heal-pet'], 51: ['heal-self', 'heal-target', 'heal-pet']
}

export function eligibleSpell(spell: MacroSpell, input: MacroPlanInput): boolean {
  const { player } = input
  const currentLevel = player.level
  if (!currentLevel || !Number.isInteger(currentLevel) || currentLevel < 1 || currentLevel > 125) return false
  return player.classes.filter(isClassAbbr).some((cls) => {
    const level = spell.classLevels[cls]
    return level !== undefined && level > 0 && level < 255 && level <= currentLevel
  })
}

/** Never infer ownership from a level, an ID, a class, or an item-triggered cast. */
export function ownedSpells(input: MacroPlanInput): MacroSpell[] {
  const owned = new Set(input.player.spellbook ?? [])
  return input.spells.filter((spell) => owned.has(spell.id) && eligibleSpell(spell, input))
}

/** Semantic allowlists, from EQEmu common/spdat.h; unsupported/AE effects stay unclassified.
 * These are roles, never estimates that a spell is stronger because it has a larger ID. */
export function spellRoles(spell: MacroSpell): MacroRole[] {
  const roles: MacroRole[] = utilityRoles(spell)
  const effect = (id: number, test: (base: number) => boolean = () => true): boolean =>
    spell.effects.some((slot) => slot.effect === id && test(slot.base))
  const damage = effect(0, (base) => base < 0)
  const heal = !damage && (effect(0, (base) => base > 0) || effect(100, (base) => base > 0))
  if (spell.targetType === 5) roles.push(...singleTargetRoles(spell, { heal, damage }))
  if (heal) roles.push(...FRIENDLY_HEALS[spell.targetType] ?? [])
  // EQEmu names effect 106 SummonBSTPet; warders use the verified self target.
  if (effect(33) || effect(71) || spell.targetType === 6 && effect(106)) roles.push('summon-pet')
  if (beneficialBuff(spell, damage)) roles.push('buff')
  return roles
}

function singleTargetRoles(spell: MacroSpell, hp: { heal: boolean; damage: boolean }): MacroRole[] {
  const roles: MacroRole[] = []
  if (hp.damage) roles.push('damage')
  if (hp.heal) roles.push('heal-self', 'heal-target', 'heal-pet')
  if (!hp.damage && spell.effects.some((s) => s.effect === 31)) roles.push('mez')
  if (spell.effects.some(debuffEffect)) roles.push('debuff')
  return roles
}
function beneficialBuff(spell: MacroSpell, damage: boolean): boolean {
  return !damage && [5, 6, 14, 51].includes(spell.targetType) && spell.effects.some(buffEffect) &&
    !spell.effects.some((s) => debuffEffect(s) || s.effect === 22 || s.effect === 31)
}

function debuffEffect(slot: MacroSpell['effects'][number]): boolean {
  if (slot.effect === 11) return slot.base > 0 && slot.base < 100
  return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 46, 47, 48, 49, 50, 111].includes(slot.effect) && slot.base < 0
}
function buffEffect(slot: MacroSpell['effects'][number]): boolean {
  if (slot.effect === 11) return slot.base > 100
  return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 46, 47, 48, 49, 50, 69].includes(slot.effect) && slot.base > 0
}

/** Families are ordered by readiness, then a stable name. Rank comparison is ONLY within a line. */
export function roleFamilies(input: MacroPlanInput, role: MacroRole): MacroSpell[][] {
  const memorized = memorizedMacroSpellIds(input.player)
  const lines = new Map<string, MacroSpell[]>()
  for (const spell of ownedSpells(input).filter((s) => spellRoles(s).includes(role))) {
    const key = spellLineKey(spell.name)
    const family = lines.get(key) ?? []
    family.push(spell)
    lines.set(key, family)
  }
  return [...lines.values()].map((line) => line.sort(compareRanks)).sort((a, b) =>
    Number(b.some((s) => memorized?.includes(s.id))) -
    Number(a.some((s) => memorized?.includes(s.id))) || a[0].name.localeCompare(b[0].name))
}
function compareRanks(a: MacroSpell, b: MacroSpell): number {
  return parseSpellRank(b.name).rank - parseSpellRank(a.name).rank || a.name.localeCompare(b.name)
}

export function familyChoice(family: MacroSpell[], input: MacroPlanInput): { spell: MacroSpell; upgrade?: MacroSpell } {
  const best = family[0]
  const memorized = memorizedMacroSpellIds(input.player)
  const spell = family.find((s) => memorized.includes(s.id)) ?? best
  return { spell, ...(parseSpellRank(best.name).rank > parseSpellRank(spell.name).rank ? { upgrade: best } : {}) }
}
