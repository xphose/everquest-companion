import type { MacroAssistantMutation, MacroAssistantMutationResult, MacroAssistantSnapshot } from '../../shared/macroAssistant'
import { castableMacroSlots } from '../../shared/macros/slots'
import type { MacroSaved, MacroServiceDeps, MacroWorld } from './types'
import { assertMacroWorld, emptyMacroSaved, macroMutation, worldKey } from './settings'
import { currentRecipes, macroSnapshot, readMacroModel, selectedTarget, trustedQueue, type MacroModel } from './model'
import { applyQueuedMacros, restoreMacros } from './installation'
import { cancelQueuedPreparation, failedPreparation, freezeCombatPlan, observePreparation } from './preparationState'
import { queuePreparation } from './preparationQueue'

function message(error: unknown): string { return error instanceof Error ? error.message : 'Unable to update macros.' }

function configure(model: MacroModel, mutation: Extract<MacroAssistantMutation, { action: 'configure' }>): void {
  const patch = mutation.settings
  if (patch.targetFile && !model.files.includes(patch.targetFile)) throw new Error('Choose one of the observed character settings filenames.')
  model.saved.settings = { ...model.saved.settings, ...patch }
  cancelQueuedPreparation(model)
  model.saved.restoreRequested = false
  model.saved.lastSignature = undefined
  model.saved.status = undefined
  model.target = selectedTarget(model.saved, model.files)
}

function rememberPlan(model: MacroModel): void {
  if (!model.input || castableMacroSlots(model.input.player) === null || freezeCombatPlan(model)) return
  model.saved.recipes = currentRecipes(model)
  model.saved.classes = model.input.player.classes
  model.saved.level = model.input.player.level
}

function refreshAutoQueue(model: MacroModel): void {
  if (!model.input || !model.target || !model.saved.settings.autoUpdate || model.saved.restoreRequested) return
  // Unknown capacity is an incomplete observation, never an instruction to retire spell macros.
  if (castableMacroSlots(model.input.player) === null) return
  if (freezeCombatPlan(model)) return
  if (!model.saved.settings.selections.length && !Object.values(model.saved.managed).some((items) => items.length)) return
  const queue = trustedQueue(model, 'auto')
  if (queue.signature !== model.saved.lastSignature && queue.signature !== model.saved.queued?.signature) model.saved.queued = queue
}

async function processPending(deps: MacroServiceDeps, model: MacroModel): Promise<void> {
  const saved = model.saved
  if (model.player.state !== 'not-running') return
  try {
    if (saved.restoreRequested) await restoreMacros(deps, model.world, saved)
    else if (saved.queued) {
      if (!model.files.includes(saved.queued.targetFile)) throw new Error('The queued character settings file is no longer available.')
      await applyQueuedMacros(deps, model.world, saved)
    }
  } catch (error) {
    saved.status = { state: 'conflict', message: message(error), conflicts: [message(error)] }
    failedPreparation(model, message(error))
    saved.lastSignature = saved.queued?.signature
    // A refused apply is reviewable and never silently retries a conflict on every timer tick.
    saved.queued = undefined
    saved.restoreRequested = false
  }
}

export interface MacroService {
  query(): Promise<MacroAssistantSnapshot>
  mutate(raw: unknown): Promise<MacroAssistantMutationResult>
  tick(): Promise<void>
}

/** Every query, mutation and timer tick shares one queue. Each await is scoped to the selected
 * character, installation and engine world; a background result cannot write into a new world. */
export function createMacroService(deps: MacroServiceDeps): MacroService {
  let serial: Promise<unknown> = Promise.resolve()
  const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = serial.then(operation, operation)
    serial = result.catch(() => undefined)
    return result
  }
  const save = async (world: MacroWorld, saved: MacroSaved): Promise<void> => {
    assertMacroWorld(world, deps.world())
    if (world.characterId && world.root) await deps.repository.put(worldKey(world), saved)
  }
  const read = async (): Promise<MacroModel> => {
    const world = deps.world()
    const saved = world.characterId && world.root ? await deps.repository.get(worldKey(world)) : emptyMacroSaved()
    assertMacroWorld(world, deps.world())
    return readMacroModel(deps, world, saved)
  }
  const finish = async (model: MacroModel): Promise<MacroAssistantSnapshot> => {
    observePreparation(model, deps.now())
    rememberPlan(model)
    refreshAutoQueue(model)
    await processPending(deps, model)
    await save(model.world, model.saved)
    const snapshot = await macroSnapshot(model)
    assertMacroWorld(model.world, deps.world())
    return snapshot
  }
  const failedSnapshot = async (error: unknown): Promise<MacroAssistantSnapshot> => {
    const world = deps.world()
    const saved = emptyMacroSaved()
    saved.status = { state: 'unavailable', message: message(error), conflicts: [] }
    return macroSnapshot({ world, saved, player: { state: 'unavailable', reason: message(error) }, files: [], message: message(error) })
  }
  return {
    query: () => enqueue(async () => { try { return await finish(await read()) } catch (error) { return failedSnapshot(error) } }),
    mutate: (raw) => enqueue(async () => {
      try {
        const mutation = macroMutation(raw)
        if (!mutation) throw new Error('Invalid macro settings change.')
        const model = await read()
        if (!model.world.characterId || mutation.characterId !== model.world.characterId) throw new Error('The active character changed. Refresh Macros.')
        if (mutation.action === 'configure') configure(model, mutation)
        else if (mutation.action === 'prepare') {
          model.saved.queued = await queuePreparation(deps, model, mutation, trustedQueue(model, 'prepare', false))
          model.saved.restoreRequested = false
          model.saved.status = undefined
        }
        else if (mutation.action === 'queue') {
          model.saved.queued = trustedQueue(model, 'manual')
          model.saved.restoreRequested = false
        }
        else {
          model.saved.settings.autoUpdate = false
          cancelQueuedPreparation(model, true)
          model.saved.restoreRequested = Boolean(model.saved.applied)
          if (!model.saved.applied) throw new Error('There is no saved change to restore.')
        }
        // Save the stop/restore preference before attempting any game-file changes.
        await save(model.world, model.saved)
        return { ok: true, snapshot: await finish(model) }
      } catch (error) { return { ok: false, error: message(error), snapshot: await failedSnapshot(error) } }
    }),
    tick: () => enqueue(async () => {
      const world = deps.world()
      if (!world.characterId || !world.root) return
      const saved = await deps.repository.get(worldKey(world))
      if (!saved.settings.autoUpdate && !saved.queued && !saved.restoreRequested) return
      assertMacroWorld(world, deps.world())
      await finish(await readMacroModel(deps, world, saved))
    })
  }
}
