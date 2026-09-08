import type { MacroPreparationPhase, MacroPreparationSnapshot } from '../../shared/macroPreparation'
import { preparationOptions, preparationPhase } from '../../shared/macros/preparation'
import { currentPlayerClasses, currentPlayerLocation } from '../../shared/currentPlayer'
import type { MacroModel } from './model'
import type { PreparedMacros, QueuedMacros } from './types'

export function currentPreparation(model: MacroModel): PreparedMacros | undefined {
  if (!model.target) return undefined
  const queued = model.saved.queued
  return queued?.targetFile === model.target && queued.preparation ? queued.preparation : model.saved.preparations?.[model.target]
}
export function currentPreparationPhase(model: MacroModel, prepared = currentPreparation(model)): MacroPreparationPhase {
  if (!prepared) return { phase: 'unknown', message: 'Select utilities to prepare for an adventure.', readySpellIds: [] }
  if (prepared.invalidated) return { phase: 'changed', message: prepared.invalidated, readySpellIds: [] }
  return preparationPhase(model.input, prepared.plan)
}
export function freezeCombatPlan(model: MacroModel): boolean {
  const prepared = currentPreparation(model)
  if (!prepared) return false
  const phase = currentPreparationPhase(model, prepared).phase
  return phase !== 'combat' && !(phase === 'changed' && temporaryPreparationGems(model, prepared) === false)
}

/** Independent of class/metadata invalidation: never recapture a temporary spell as combat. */
export function temporaryPreparationGems(model: MacroModel, prepared: PreparedMacros): boolean | undefined {
  const gems = model.input?.player.memorizedSpells
  if (!gems) return undefined
  const entries = prepared.plan.replacements.map((item) => ({ item, id: gems[item.gem - 1] }))
  if (entries.some(({ id }) => id === undefined)) return undefined
  return entries.some(({ item, id }) => id === null || id === item.spellId)
}

/** Cancel file work without losing the return layout of temporary gems already observed in game. */
export function cancelQueuedPreparation(model: MacroModel, restoring = false): void {
  const prepared = restoring ? currentPreparation(model) : model.saved.queued?.preparation
  if (prepared && (temporaryPreparationGems(model, prepared) ?? prepared.temporaryGems) === true) {
    const previous = model.saved.preparations?.[prepared.targetFile]
    if (restoring || !previous || JSON.stringify(previous.plan) !== JSON.stringify(prepared.plan)) {
      model.saved.preparations ??= {}
      model.saved.preparations[prepared.targetFile] = { ...structuredClone(prepared), preserveBaseline: true,
        invalidated: 'The preparation update was canceled while temporary gems were active. Restore the captured combat gems before rebuilding preparation.' }
    }
  }
  model.saved.queued = undefined
}

function observeTemporaryGems(model: MacroModel, prepared: PreparedMacros): void {
  const temporary = temporaryPreparationGems(model, prepared)
  if (temporary === undefined) return
  prepared.temporaryGems = temporary
  if (!temporary) prepared.preserveBaseline = false
}

function observedClassesChanged(model: MacroModel, prepared: PreparedMacros, now: number): boolean {
  const name = model.world.character?.name ?? ''
  const location = currentPlayerLocation(model.player, name, now)
  const classes = currentPlayerClasses(model.player, name, now)
  return Boolean(location && classes && classes.slice().sort().join(',') !== prepared.plan.classes.slice().sort().join(','))
}

/** A fresh incompatible observation invalidates the package permanently until an explicit rebuild.
 * Missing observations preserve the stable queue; temporary and partially loaded gems preserve the baseline. */
export function observePreparation(model: MacroModel, now: number): void {
  const prepared = currentPreparation(model)
  if (!prepared) return
  observeTemporaryGems(model, prepared)
  const phase = currentPreparationPhase(model, prepared)
  let invalid = phase.phase === 'changed' ? phase.message : undefined
  if (observedClassesChanged(model, prepared, now)) invalid = 'Your active classes changed. Rebuild adventure preparation for this class combination.'
  if (!invalid) return
  prepared.invalidated = invalid
  // This may be the first captured package, with no installed predecessor. Keep its combat
  // baseline before dropping the unsafe queue so temporary gems can never become a new baseline.
  model.saved.preparations ??= {}
  model.saved.preparations[prepared.targetFile] = prepared
  const queue = model.saved.queued
  if (queue?.targetFile === prepared.targetFile && (!queue.preparation?.retired || temporaryPreparationGems(model, prepared) === true)) model.saved.queued = undefined
  model.saved.status = { state: 'conflict', message: invalid, conflicts: [invalid] }
}

export function includePreparation(model: MacroModel, queue: QueuedMacros): QueuedMacros {
  const prepared = currentPreparation(model)
  if (!prepared) return queue
  const phase = currentPreparationPhase(model, prepared)
  if (phase.phase === 'changed' && temporaryPreparationGems(model, prepared) === false) {
    const retired = { ...structuredClone(prepared), sets: [], requests: [], retired: true }
    return { ...queue, preparation: retired, signature: JSON.stringify([queue.targetFile, queue.requests, queue.problems, 'retire-preparation', prepared.plan]) }
  }
  if (phase.phase !== 'combat') throw new Error(phase.phase === 'changed' ? phase.message : 'Restore combat gems before queuing regular macros; the adventure preparation baseline is preserved.')
  const requests = [...queue.requests, ...prepared.requests]
  return { ...queue, requests, preparation: structuredClone(prepared), signature: JSON.stringify([queue.targetFile, requests, queue.problems, prepared.sets, prepared.plan]) }
}

export function failedPreparation(model: MacroModel, reason: string): void {
  const prepared = model.saved.queued?.preparation
  if (!prepared) return
  model.saved.preparations ??= {}
  const retained = model.saved.preparations[prepared.targetFile] ?? structuredClone(prepared)
  retained.invalidated = reason
  model.saved.preparations[prepared.targetFile] = retained
}

export function preparationSnapshot(model: MacroModel): MacroPreparationSnapshot {
  const prepared = currentPreparation(model)
  const phase = currentPreparationPhase(model, prepared)
  const common = { ...phase, options: model.input ? preparationOptions(model.input) : [], previewInput: model.input }
  if (!prepared) return common
  return { ...common, plan: prepared.plan, installation: preparationInstallation(model, prepared) }
}

function preparationInstallation(model: MacroModel, prepared: PreparedMacros): MacroPreparationSnapshot['installation'] {
  const pending = model.saved.queued?.targetFile === prepared.targetFile && Boolean(model.saved.queued.preparation)
  const conflict = preparationConflict(model, prepared)
  return {
    state: conflict ? 'conflict' : pending ? 'pending' : 'saved',
    message: conflict ?? (pending
      ? 'Preparation queued. Fully exit EverQuest and wait for Saved before relaunching.' : preparationSavedMessage(prepared)),
    at: prepared.installedAt, targetFile: prepared.targetFile, destination: prepared.destination,
    packageId: prepared.packageId, completion: pending || conflict ? undefined : prepared.completion,
    loadSetIndex: prepared.sets.find((set) => set.id === 'preparation-load')?.index,
    combatSetIndex: prepared.sets.find((set) => set.id === 'preparation-combat')?.index,
    buttons: prepared.requests.map(({ id, name, lines }) => ({ id, name, lines: [...lines] }))
  }
}

function preparationConflict(model: MacroModel, prepared: PreparedMacros): string | undefined {
  if (prepared.invalidated) return prepared.invalidated
  return !prepared.installedAt && model.saved.status?.state === 'conflict' ? model.saved.status.message : undefined
}

function preparationSavedMessage(prepared: PreparedMacros): string {
  return prepared.unchanged ? 'Preparation is already up to date. Its buttons and spell sets were unchanged.'
    : 'Preparation buttons and spell sets are saved for this character settings file.'
}
