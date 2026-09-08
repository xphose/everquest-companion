import type { MacroAssistantMutation } from '../../shared/macroAssistant'
import { planMacroPreparation } from '../../shared/macros/preparation'
import { currentPlayerLocation } from '../../shared/currentPlayer'
import type { MacroModel } from './model'
import type { MacroServiceDeps, PreparedMacros, QueuedMacros } from './types'
import { assertMacroWorld } from './settings'
import { readCharacterFile, readMacroDefaults } from './files'
import { planSpellLoadoutIni, type SpellLoadoutRequest } from './spellLoadoutIni'
import { planSocialIni, type SocialRequest } from './socialIni'
import { currentPreparation, temporaryPreparationGems } from './preparationState'

function setRequests(plan: PreparedMacros['plan']): SpellLoadoutRequest[] {
  if (!plan.replacements.length) return []
  return [
    { id: 'preparation-load', name: 'EQL Preparation', slots: plan.preparationGems },
    { id: 'preparation-combat', name: 'EQL Combat Return', slots: plan.combatGems }
  ]
}
function socialRequests(prepared: Omit<PreparedMacros, 'requests'>): SocialRequest[] {
  const hotbar = prepared.destination
  const load = prepared.sets.find((set) => set.id === 'preparation-load')
  const combat = prepared.sets.find((set) => set.id === 'preparation-combat')
  const requests: SocialRequest[] = prepared.plan.utilities.map((utility) => ({ id: `preparation-use:${utility.spellId}`,
    name: utility.buttonName, color: 0, lines: utility.lines, hotbar }))
  const supplies = prepared.plan.suppliesButton
  if (supplies) requests.unshift({ id: 'preparation-use:supplies', name: supplies.name, color: 0, lines: supplies.lines, hotbar })
  if (load && combat) requests.unshift({ id: load.id, name: 'Load Prep', color: 0, lines: [`/memspellset ${load.index}`], hotbar })
  if (load && combat) requests.push({ id: combat.id, name: 'Restore Combat', color: 0, lines: [`/memspellset ${combat.index}`], hotbar })
  return requests
}

async function previewFiles(deps: MacroServiceDeps, model: MacroModel, root: string, target: string): Promise<{ file: Awaited<ReturnType<typeof readCharacterFile>>; defaults: string }> {
  const [file, defaults] = await Promise.all([readCharacterFile(root, target), readMacroDefaults(root)])
  assertMacroWorld(model.world, deps.world())
  if (!currentPlayerLocation(model.player, model.world.character?.name ?? '', deps.now())) throw new Error('The player observation expired. Refresh before preparing utilities.')
  return { file, defaults: defaults?.text ?? '' }
}

function allocatedSets(requested: SpellLoadoutRequest[], plan: ReturnType<typeof planSpellLoadoutIni>): SpellLoadoutRequest[] {
  if (plan.conflicts.length) throw new Error(plan.conflicts.join(' '))
  return requested.map((request) => {
    const allocated = plan.managed.find((item) => item.id === request.id)
    if (!allocated) throw new Error('Both preparation and combat spell sets must be allocated together.')
    return { ...request, index: allocated.index, name: allocated.fields.name }
  })
}

/** Build a complete reviewable package while the game runs. Only its later stopped-game apply writes files. */
export async function queuePreparation(deps: MacroServiceDeps, model: MacroModel, mutation: Extract<MacroAssistantMutation, { action: 'prepare' }>, combat: QueuedMacros): Promise<QueuedMacros> {
  if (!model.input || !model.target || !model.world.root) throw new Error('A fresh player observation and one selected character settings file are required.')
  const existing = currentPreparation(model)
  if (existing && temporaryPreparationGems(model, existing) !== false) throw new Error('Restore combat gems before replacing adventure preparation; the original baseline must stay intact.')
  const result = planMacroPreparation(model.input, mutation.spellIds)
  if (!result.ok) throw new Error(result.reasons.join(' '))
  const { file, defaults } = await previewFiles(deps, model, model.world.root, model.target)
  const requested = setRequests(result.plan)
  const plan = planSpellLoadoutIni(file.text, defaults, requested, model.saved.setManaged?.[model.target] ?? [])
  const sets = allocatedSets(requested, plan)
  const prepared = { plan: result.plan, targetFile: model.target, destination: { ...mutation.destination }, sets, createdAt: new Date(deps.now()).toISOString() }
  const preparation: PreparedMacros = { ...prepared, requests: socialRequests(prepared) }
  const requests = [...combat.requests, ...preparation.requests]
  const socials = planSocialIni(plan.text, requests, model.saved.managed[model.target] ?? [], { retireMissing: true })
  const conflicts = socials.conflicts.map((item) => item.reason)
  if (conflicts.length) throw new Error(conflicts.join(' '))
  return { ...combat, source: 'prepare', requests, preparation,
    signature: JSON.stringify([model.target, requests, combat.problems, preparation.sets, preparation.plan]) }
}
