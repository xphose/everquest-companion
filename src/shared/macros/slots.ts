import { MACRO_CAST_GEMS, type MacroPlayer, type MacroPlanInput } from '../macros'

/** Unknown availability is not an empty bar. The native profile has 18 positions, but this
 * client's /cast implementation can address only 1–14. Never compact holes or infer unlocks. */
export function castableMacroSlots(player: Pick<MacroPlayer, 'unlockedSpellSlots'>): number[] | null {
  const slots = player.unlockedSpellSlots
  if (!Array.isArray(slots) || slots.length > 18 || !Array.from(slots).every((gem, index) =>
    Number.isInteger(gem) && gem >= 1 && gem <= 18 && (index === 0 || gem > slots[index - 1]))) return null
  return slots.filter((gem) => gem <= MACRO_CAST_GEMS)
}

export function memorizedMacroSpellIds(player: MacroPlayer): number[] {
  return (castableMacroSlots(player) ?? []).flatMap((gem) => {
    const id = player.memorizedSpells?.[gem - 1]
    return typeof id === 'number' && Number.isInteger(id) && id > 0 ? [id] : []
  })
}

export function spellGem(spellId: number, input: MacroPlanInput): number | null {
  return (castableMacroSlots(input.player) ?? []).find((gem) => input.player.memorizedSpells?.[gem - 1] === spellId) ?? null
}
