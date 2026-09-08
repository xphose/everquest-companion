import { useMemo, useState } from 'react'
import type { MacroPreparationSnapshot } from '@shared/macroPreparation'
import { foodDrinkPreset, planMacroPreparation } from '../../../../shared/macros/preparation'
import { canCapturePreparation } from '../../../../shared/macros/preparationOptions'
const DEFAULT_DESTINATION = { bar: 3, page: 1 }

function preparationPreview(preparation: MacroPreparationSnapshot, selected: number[], destination: { bar: number; page: number }) {
  const captureAllowed = canCapturePreparation(preparation)
  const result = captureAllowed && preparation.previewInput ? planMacroPreparation(preparation.previewInput, selected) : undefined
  const edited = JSON.stringify(selected) !== JSON.stringify(preparation.plan?.spellIds) ||
    JSON.stringify(destination) !== JSON.stringify(preparation.installation?.destination)
  const preview = captureAllowed && (edited || preparation.phase === 'changed')
  const shown = preview ? result?.ok ? result.plan : undefined : preparation.plan
  return { captureAllowed, result, preview, shown }
}

/** Local edits only. Native observations remain the source of the captured combat baseline. */
export function useMacroPreparation(preparation: MacroPreparationSnapshot) {
  const [choice, setChoice] = useState<number[] | null>(null)
  const [target, setTarget] = useState<{ bar: number; page: number } | null>(null)
  const selected = choice ?? preparation.plan?.spellIds ?? foodDrinkPreset(preparation.options)
  const destination = target ?? preparation.installation?.destination ?? DEFAULT_DESTINATION
  const preview = useMemo(() => preparationPreview(preparation, selected, destination), [preparation, selected, destination])
  return { selected, destination, setChoice, setTarget, ...preview }
}
