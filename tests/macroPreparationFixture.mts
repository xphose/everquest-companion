import type { MacroPlanInput, MacroSpell } from '../src/shared/macros'

export function prepSpell(id: number, name: string, effect = 32, targetType = 6): MacroSpell {
  return { id, name, classLevels: { MAG: 1, SHM: 1 }, castMs: 2500, recoveryMs: 1500, recastMs: 0, mana: 10,
    targetType, effects: [{ effect, base: effect === 0 ? -10 : effect === 35 ? -5 : 1 }] }
}
export function prepInput(): MacroPlanInput {
  return { player: { characterName: 'Example', classes: ['MAG', 'SHM'], level: 10, spellbook: [10, 11, 12, 20, 21, 30],
    memorizedSpells: [20, null, 21, ...Array<null>(8).fill(null), 30, null, null], unlockedSpellSlots: Array.from({ length: 12 }, (_, i) => i + 1) },
  spells: [prepSpell(10, 'Summon Food'), prepSpell(11, 'Summon Drink'), prepSpell(12, 'Summon Food II'),
    prepSpell(20, 'Flame', 0, 5), prepSpell(21, 'Frost', 0, 5), prepSpell(30, 'Strengthen', 4, 51)], style: 'solo', castByName: true }
}
