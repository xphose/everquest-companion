import { acquisitionAvailable } from './gearAcquisition'
import { gearClasses } from './gearAcquisitionRules'
import type { GearExaltationAdvice, GearProgressionInput } from './gearProgressionTypes'
import type { GearRow } from './planner/gear'
import { extractionCost, narrowedClasses, socketCompatibility } from './planner/rules'
import { equipSlotOf, type PlannerDonor, type PlanSlotId } from './planner/types'
import { gearFocusSupports } from './gearProgressionScore'
import { sourceInEra } from './gearProgressionCandidates'
import { layeredVerdict } from './planner/era'

function donors(row: GearRow): PlannerDonor[] {
  return row.effects.flatMap((effect) => effect.socket && effect.tierRequired ? [{
    ...row, ...effect, classes: [...gearClasses(row)], effect: effect.name, name: row.name,
    socket: effect.socket, tierRequired: effect.tierRequired, hasteLocked: effect.hasteLocked === true
  }] : [])
}
function relevantFocus(donor: PlannerDonor, input: GearProgressionInput, level: number): boolean {
  if (donor.socket !== 'focus') return true
  const focus = input.character.focusByEffect?.[donor.effect.toLowerCase()]
  if (!focus) return false
  return gearFocusSupports(focus, input.character, input.character.classes, level)
}
/** A small list of compatible plans, kept outside the stat score. Source access, exact focus
 * limits and existing sockets still need checking before spending either item. */
export function gearExaltationAdvice(row: GearRow, slot: PlanSlotId, level: number, input: GearProgressionInput): GearExaltationAdvice[] {
  const targetSlot = equipSlotOf(slot)
  if (!targetSlot || !gearClasses(row).length) return []
  const options: GearExaltationAdvice[] = []
  const seen = new Set<string>()
  for (const item of input.rows) {
    if (item.key === row.key) continue
    if (item.eraDerived?.verdict === 'out-of-era' || layeredVerdict([], item.eraTag) === 'out-of-era') continue
    for (const donor of donors(item)) {
      const option = transferOption(donor, row, { slot: targetSlot, level }, input)
      if (!option || seen.has(option.socket)) continue
      seen.add(option.socket)
      options.push(option)
    }
    if (options.length === 4) break
  }
  return options
}
function transferOption(donor: PlannerDonor, row: GearRow, target: { slot: NonNullable<ReturnType<typeof equipSlotOf>>; level: number }, input: GearProgressionInput): GearExaltationAdvice | undefined {
  const { slot, level } = target
  const classes = narrowedClasses(gearClasses(row), donor.classes)
  if (!classes.some((c) => input.character.classes.includes(c))) return undefined
  if (!socketCompatibility(donor, [slot], input.character.classes).ok) return undefined
  if ((donor.reqLevel ?? 0) > level || !relevantFocus(donor, input, level)) return undefined
  const source = input.acquisitions.get(donor.key)?.find((entry) => sourceInEra(entry) && acquisitionAvailable(entry, input.character.classes, level))
  if (!source) return undefined
  return { donorKey: donor.key, donorName: donor.name, effect: donor.effect, socket: donor.socket,
    donorTier: donor.tierRequired, hostTier: donor.tierRequired, baseCopies: extractionCost(donor.tierRequired).d0Copies,
    classes, source, warnings: [
      'This is a compatible option, not a scored improvement. Check existing sockets and the effect description first.',
      `The finished item is restricted to ${classes.join(', ')}. Slot and class restrictions follow the transferred effect.`,
      'Keep your host separate. Moving the effect removes it from the donor.',
      'The base-copy estimate counts extra +0 copies consumed to upgrade one starting donor. Keep that starting donor and the host separate. Higher-tier donors and fractional progress change the cost.'
    ] }
}
