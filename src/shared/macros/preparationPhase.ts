import type { MacroPlanInput } from '../macros'
import type { MacroPreparationPhase, MacroPreparationPlan } from '../macroPreparation'
import { castableMacroSlots } from './slots'
import { planMacroPreparation } from './preparation'

function outcome(phase: MacroPreparationPhase['phase'], message: string, readySpellIds: number[] = []): MacroPreparationPhase {
  return { phase, message, readySpellIds }
}

function sameMembers(left: string[], right: string[]): boolean {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort())
}

function validateCapture(input: MacroPlanInput, plan: MacroPreparationPlan): string | undefined {
  if (input.player.characterName !== plan.characterName || !sameMembers(input.player.classes, plan.classes)) return 'The character or selected classes changed. Rebuild preparation from your intended combat gems.'
  if (JSON.stringify(castableMacroSlots(input.player)) !== JSON.stringify(plan.unlockedSpellSlots)) return 'The unlocked spell slots changed. Rebuild preparation from your intended combat gems.'
  const rebuilt = planMacroPreparation({ ...input, player: { ...input.player, memorizedSpells: plan.baseline } }, plan.spellIds)
  if (!rebuilt.ok) return rebuilt.reasons.join(' ')
  if (JSON.stringify(rebuilt.plan.utilities) !== JSON.stringify(plan.utilities) || JSON.stringify(rebuilt.plan.suppliesButton) !== JSON.stringify(plan.suppliesButton) ||
      JSON.stringify(rebuilt.plan.replacements) !== JSON.stringify(plan.replacements)) return 'Spell details changed since this package was captured. Rebuild preparation to update the buttons safely.'
  return undefined
}

/** A partial native batch or unknown observation never becomes a new combat baseline. */
export function preparationPhase(input: MacroPlanInput | undefined, plan: MacroPreparationPlan): MacroPreparationPhase {
  if (!input || castableMacroSlots(input.player) === null) return outcome('unknown', 'Waiting for a fresh character and unlocked spell-slot observation.')
  const gems = Array.from(input.player.memorizedSpells?.slice(0, 14) ?? [])
  if (gems.length !== 14 || !gems.every((id) => id === null || Number.isInteger(id) && id > 0)) return outcome('unknown', 'Current gem contents are not completely observed yet.')
  const invalid = validateCapture(input, plan)
  if (invalid) return outcome('changed', invalid)
  const ready = plan.utilities.filter((utility) => gems[utility.gem - 1] === utility.spellId).map((utility) => utility.spellId)
  const matches = (prepared: boolean): boolean => plan.unlockedSpellSlots.every((gem) =>
    gems[gem - 1] === (prepared && plan.preparationGems[gem - 1] > 0 ? plan.preparationGems[gem - 1] : plan.baseline[gem - 1]))
  if (matches(false)) return outcome('combat', plan.replacements.length ? 'Combat gems are restored.' : 'Utility spells are already ready. No gem swap is needed.', ready)
  if (matches(true)) return outcome('utility-ready', 'Utility spells are ready. Press their Use buttons as needed, then Restore Combat.', ready)
  const transitioning = plan.unlockedSpellSlots.every((gem) => {
    const current = gems[gem - 1]
    const utility = plan.preparationGems[gem - 1]
    return current === plan.baseline[gem - 1] || utility > 0 && (current === null || current === utility)
  })
  return transitioning ? outcome('changing', 'Gems are changing. Wait for Utility spells ready or Combat gems restored before continuing.', ready)
    : outcome('changed', 'The gems no longer match the captured combat or utility layouts. Restore your intended combat gems before rebuilding preparation.')
}
