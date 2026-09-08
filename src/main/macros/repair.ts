import type { MacroAssistantMutation, MacroExistingSocial } from '../../shared/macroAssistant'
import { macroSelectionKey, type MacroRecipe } from '../../shared/macros'
import { planMacros } from '../../shared/macros/planner'
import { auditMacro } from '../../shared/macros/audit'
import { currentPlayerLocation } from '../../shared/currentPlayer'
import type { MacroModel } from './model'
import type { MacroRepairBinding, MacroRepairClaim, MacroServiceDeps, QueuedMacros } from './types'
import { assertMacroWorld } from './settings'
import { readCharacterFile, readMacroDefaults } from './files'
import { readSocials } from './socialIni'
import { cancelQueuedPreparation, freezeCombatPlan } from './preparationState'
import { installationPlan } from './preparationInstall'
import { repairFingerprint, repairId, socialRequest } from './repairOwnership'

function selfBuffs(model: MacroModel): MacroRecipe | undefined {
  return model.input && !freezeCombatPlan(model) ? planMacros(model.input, model.saved.settings.selections)
    .find((recipe) => recipe.id === 'self-buffs' && recipe.ready) : undefined
}

export function repairOffer(model: MacroModel, text: string, social: ReturnType<typeof readSocials>[number]): MacroExistingSocial['repair'] {
  if (!model.input || !model.target || social.ambiguous) return undefined
  if (model.saved.managed[model.target]?.some((entry) => entry.page === social.page && entry.button === social.button)) return undefined
  if (model.saved.queued?.repairs?.some((claim) => claim.id === repairId(social))) return undefined
  if (!auditMacro(social.name, [...social.lines], model.input).some((issue) => issue.code === 'buff-binding-mismatch')) return undefined
  const recipe = selfBuffs(model)
  if (!recipe) return undefined
  const fingerprint = repairFingerprint(text, social)
  return fingerprint ? { fingerprint, recipeId: recipe.id, lines: [...recipe.lines] } : undefined
}

/** An explicit one-time repair must not silently adopt a now-different combat setup. */
export function observePendingRepairs(model: MacroModel): void {
  const queue = model.saved.queued
  if (!model.input || !queue?.repairs?.length || model.saved.settings.autoUpdate) return
  const recipe = selfBuffs(model)
  const lines = recipe?.lines
  if (lines && queue.repairs.every((claim) => JSON.stringify(queue.requests.find((request) => request.id === claim.id)?.lines) === JSON.stringify(lines))) return
  cancelQueuedPreparation(model)
  const message = 'The Self Buffs setup changed after review. Review the personal-social replacement again before saving.'
  model.saved.status = { state: 'conflict', message, conflicts: [message] }
}

/** Carry repair-specific ownership through ordinary updates, preserving every hotbutton alias. */
export function includeRepairs(model: MacroModel, queue: QueuedMacros): QueuedMacros {
  const active = model.saved.repairs?.[queue.targetFile] ?? []
  const pending = model.saved.queued?.targetFile === queue.targetFile ? model.saved.queued.repairs ?? [] : []
  if (!active.length && !pending.length) return queue
  const recipe = selfBuffs(model)
  const requests = [...queue.requests]
  const problems = [...queue.problems]
  const repairs: NonNullable<QueuedMacros['repairs']> = []
  for (const binding of [...active, ...pending]) {
    appendRepair(model, binding, pending, { requests, problems, repairs, recipe, target: queue.targetFile })
  }
  return signedRepairQueue({ ...queue, requests, problems, repairs })
}

function signedRepairQueue(queue: QueuedMacros): QueuedMacros {
  // Adoption claims disappear after saving; identical live requests must not queue a false update.
  return { ...queue, signature: JSON.stringify([queue.targetFile, queue.requests, queue.problems,
    queue.preparation?.sets, queue.preparation?.plan]) }
}

function appendRepair(model: MacroModel, binding: MacroRepairBinding, pending: MacroRepairClaim[], state: {
  requests: QueuedMacros['requests']; problems: string[]; repairs: MacroRepairClaim[]; recipe?: MacroRecipe; target: string
}): void {
  const claim = pending.find((entry) => entry.id === binding.id)
  const original = claim?.original ?? model.saved.managed[state.target]?.find((entry) => entry.id === binding.id)
  if (!original) { state.problems.push('A repaired social has lost its saved ownership; refresh before updating it.'); return }
  const ready = state.recipe?.id === macroSelectionKey(binding.selection)
  if (!ready) state.problems.push(`${original.fields.name}: restore a ready Self Buffs spell setup before updating this repaired social.`)
  if (!ready && claim) return // Fresh incompatible observations never adopt stale personal replacements.
  state.requests.push(socialRequest(binding.id, original, ready ? state.recipe?.lines : undefined))
  if (claim) state.repairs.push(claim)
}

async function reviewedRepair(deps: MacroServiceDeps, model: MacroModel, mutation: Extract<MacroAssistantMutation, { action: 'repair' }>) {
  if (!model.target || model.target !== mutation.targetFile || !model.world.root) throw new Error('The selected character settings file changed. Refresh before replacing the social.')
  const file = await readCharacterFile(model.world.root, model.target)
  assertMacroWorld(model.world, deps.world())
  if (!currentPlayerLocation(model.player, model.world.character?.name ?? '', deps.now())) throw new Error('Wait for a fresh player observation before replacing the social.')
  const social = readSocials(file.text).find((entry) => entry.page === mutation.page && entry.button === mutation.button)
  const offer = social && repairOffer(model, file.text, social)
  if (!social || offer?.fingerprint !== mutation.fingerprint || offer.recipeId !== mutation.recipeId) {
    throw new Error('The reviewed social or ready Self Buffs recipe changed. Refresh and review the replacement again.')
  }
  return { file, social, offer, root: model.world.root }
}

export async function queueRepair(deps: MacroServiceDeps, model: MacroModel,
  mutation: Extract<MacroAssistantMutation, { action: 'repair' }>, queue: QueuedMacros): Promise<QueuedMacros> {
  const { file, social, offer, root } = await reviewedRepair(deps, model, mutation)
  const id = repairId(mutation)
  const claim = { id, selection: { role: 'self-buffs' as const }, original: { id, page: social.page, button: social.button, fields: { ...social.fields } }, fingerprint: offer.fingerprint }
  const requests = [...queue.requests, socialRequest(id, social, offer.lines)]
  const result = signedRepairQueue({ ...queue, requests, repairs: [...queue.repairs ?? [], claim] })
  const defaults = result.preparation ? await readMacroDefaults(root) : undefined
  assertMacroWorld(model.world, deps.world())
  if (!currentPlayerLocation(model.player, model.world.character?.name ?? '', deps.now())) throw new Error('The player observation expired during review. Refresh before replacing the social.')
  const plan = installationPlan(file, defaults, result, model.saved)
  if (plan.conflicts.length > result.problems.length) throw new Error(plan.conflicts.join(' '))
  return result
}
