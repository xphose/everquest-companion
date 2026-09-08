import type { MacroRole, MacroSpell } from '../macros'

/** Each family remains a choice: food must not hide drink, or poison cure hide disease cure. */
export const FAMILY_ROLES: readonly MacroRole[] = ['finisher', 'buff', 'summon-item', 'cure', 'root', 'snare', 'lull',
  'invisibility', 'vision', 'breathing', 'levitation', 'gate', 'rune']

// Effect meanings: https://github.com/EQEmu/EQEmu/blob/master/common/spdat.h, SpellEffect.
// Target 51 is separately verified in the Legends client as Single Friendly (or Self).
// Whitelist whole effect mixtures for new utilities, not just a familiar slot in an unknown spell.
type Effect = MacroSpell['effects'][number]
const TOGGLES = [12, 13, 14, 28, 29, 57, 65, 66]
const COUNTERS = [35, 36, 116]
const POSITIVE_BUFFS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 46, 47, 48, 49, 50, 55, 69, 100, 111]
function blank(slot: Effect): boolean {
  return slot.effect === 254 || slot.base === 0 && [0, 10].includes(slot.effect)
}
function friendly(slot: Effect): boolean {
  if (!Number.isFinite(slot.base)) return false
  if (blank(slot)) return true
  if (TOGGLES.includes(slot.effect) || POSITIVE_BUFFS.includes(slot.effect)) return slot.base >= 0
  if (COUNTERS.includes(slot.effect)) return slot.base <= 0
  if (slot.effect === 11) return slot.base >= 100
  return slot.effect === 59 && slot.base <= 0 // Damage shields use a negative retaliation magnitude.
}
/** A verified friendly target and a wholly understood beneficial effect mix. */
export function isFriendlyUtilitySpell(spell: MacroSpell): boolean {
  return [5, 6, 14, 51].includes(spell.targetType) && spell.effects.every(friendly)
}
function friendlyRoles(spell: MacroSpell): MacroRole[] {
  if (!isFriendlyUtilitySpell(spell)) return []
  const has = (effects: number[]): boolean => spell.effects.some((slot) => effects.includes(slot.effect))
  const roles: MacroRole[] = []
  if (spell.effects.some((s) => COUNTERS.includes(s.effect) && s.base < 0)) roles.push('cure')
  if (has([12, 28, 29])) roles.push('invisibility')
  if (has([13, 65, 66])) roles.push('vision')
  if (has([14])) roles.push('breathing')
  if (has([57])) roles.push('levitation')
  if (spell.effects.some((s) => s.effect === 55 && s.base > 0)) roles.push('rune')
  return roles
}
function controlRoles(spell: MacroSpell): MacroRole[] {
  if (spell.targetType !== 5) return []
  const active = spell.effects.filter((slot) => !blank(slot))
  if (!active.length || active.some((slot) => !Number.isFinite(slot.base))) return []
  if (active.every((s) => [18, 30, 86].includes(s.effect) && s.base >= 0)) return ['lull']
  if (!active.every((s) => s.effect === 99 || s.effect === 3 && s.base < 0)) return []
  return [...(active.some((s) => s.effect === 99) ? ['root' as const] : []),
    ...(active.some((s) => s.effect === 3) ? ['snare' as const] : [])]
}
export function utilityRoles(spell: MacroSpell): MacroRole[] {
  const self = spell.targetType === 6
  const only = (effect: number): boolean => spell.effects.some((s) => s.effect === effect) &&
    spell.effects.every((s) => blank(s) || s.effect === effect && Number.isInteger(s.base) && s.base > 0)
  if (self && only(32)) return ['summon-item']
  if (self && only(26)) return ['gate']
  return [...friendlyRoles(spell), ...controlRoles(spell)]
}
