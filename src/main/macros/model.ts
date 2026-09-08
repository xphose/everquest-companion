import type { MacroAssistantSnapshot } from '../../shared/macroAssistant'
import type { MacroPlanInput, MacroRecipe } from '../../shared/macros'
import { macroSelectionKey } from '../../shared/macros'
import { planMacros } from '../../shared/macros/planner'
import { auditMacro } from '../../shared/macros/audit'
import { currentPlayerLocation, currentPlayerClasses } from '../../shared/currentPlayer'
import type { PlayerLocationResult } from '../../shared/playerLocation'
import type { MacroSaved, MacroServiceDeps, MacroWorld, QueuedMacros } from './types'
import { assertMacroWorld } from './settings'
import { characterFiles, readCharacterFile } from './files'
import { readSocials } from './socialIni'

export interface MacroModel {
  world: MacroWorld
  saved: MacroSaved
  player: PlayerLocationResult
  input?: MacroPlanInput
  files: string[]
  target?: string
  message: string
}

function completePlayer(player: PlayerLocationResult, name: string, now: number): MacroPlanInput['player'] | undefined {
  const location = currentPlayerLocation(player, name, now)
  const classes = currentPlayerClasses(player, name, now)
  if (!location || !classes || !location.spellbook || !location.memorizedSpells) return undefined
  const profile = { characterName: location.characterName, classes, level: location.level,
    spellbook: location.spellbook, memorizedSpells: location.memorizedSpells }
  return profile
}

export async function readMacroModel(deps: MacroServiceDeps, world: MacroWorld, saved: MacroSaved): Promise<MacroModel> {
  const model: MacroModel = { world, saved, player: { state: 'unavailable', reason: 'Choose a character first.' }, files: [], message: 'Choose a character first.' }
  if (!world.character || !world.root || !world.characterId) return model
  const [player, files] = await Promise.allSettled([deps.livePlayer(), characterFiles(world.root, world.character)])
  assertMacroWorld(world, deps.world())
  if (files.status === 'fulfilled') model.files = files.value
  model.target = selectedTarget(saved, model.files)
  if (player.status !== 'fulfilled') { model.message = 'The live player observation is unavailable.'; return model }
  model.player = player.value
  model.message = player.value.state === 'live' ? 'Spellbook or current classes are not available from this client.' : player.value.reason
  const profile = completePlayer(player.value, world.character.name, deps.now())
  if (!profile?.spellbook) return model
  try {
    const spells = await deps.spells(world.root, profile.spellbook)
    assertMacroWorld(world, deps.world())
    if (!currentPlayerLocation(player.value, world.character.name, deps.now())) throw new Error('The player observation expired while reading spells. Refresh to try again.')
    model.input = { player: profile, spells, style: saved.settings.style, castByName: true }
    model.message = 'Reading your current classes, owned spells, and memorized gems.'
  } catch (error) { model.message = error instanceof Error ? error.message : 'The client spell table is unavailable.' }
  return model
}

export function selectedTarget(saved: MacroSaved, files: string[]): string | undefined {
  if (saved.settings.targetFile) return files.includes(saved.settings.targetFile) ? saved.settings.targetFile : undefined
  return files.length === 1 ? files[0] : undefined
}

export function currentRecipes(model: MacroModel): MacroRecipe[] {
  if (!model.input) return model.saved.recipes ?? []
  model.input.style = model.saved.settings.style
  return planMacros(model.input, model.saved.settings.selections)
}

export function trustedQueue(model: MacroModel, source: QueuedMacros['source']): QueuedMacros {
  if (!model.input) throw new Error('Wait for a fresh observation of this character’s classes, spellbook, and gems.')
  if (!model.target) throw new Error(model.files.length > 1 ? 'Choose the character settings file to update.' : 'No matching character settings file is available.')
  const recipes = currentRecipes(model)
  const selected = new Set(model.saved.settings.selections.map(macroSelectionKey))
  const wanted = recipes.filter((recipe) => selected.has(macroSelectionKey(recipe.selection)))
  const problems = wanted.filter((recipe) => !recipe.ready).flatMap((recipe) => recipe.reasons.map((reason) => `${recipe.name}: ${reason}`))
  for (const key of selected) if (!wanted.some((recipe) => macroSelectionKey(recipe.selection) === key)) problems.push(`The selected macro ${key} is unavailable for these classes.`)
  const requests = wanted.filter((recipe) => recipe.ready).map((recipe) => ({ id: recipe.id, name: recipe.name,
    color: 0, lines: recipe.lines, hotbar: { ...model.saved.settings.destination } }))
  const signature = JSON.stringify([model.target, requests, problems])
  return { targetFile: model.target, requests, problems, signature, source }
}

async function existingSocials(model: MacroModel): Promise<MacroAssistantSnapshot['existing']> {
  if (!model.target || !model.world.root) return []
  const file = await readCharacterFile(model.world.root, model.target)
  const input = model.input ?? { player: { classes: [] }, spells: [], style: model.saved.settings.style }
  const managed = model.saved.managed[model.target] ?? []
  return readSocials(file.text).map((social) => ({ page: social.page, button: social.button, name: social.name, lines: [...social.lines],
    managed: managed.some((item) => item.page === social.page && item.button === social.button),
    issues: [...auditMacro(social.name, [...social.lines], input), ...social.ambiguous ? [{ severity: 'error' as const,
      code: 'ambiguous-settings', message: 'Duplicate or ambiguous social fields need to be corrected in game before this slot can be managed.' }] : []] }))
}

function installBase(model: MacroModel): Omit<MacroAssistantSnapshot['installation'], 'state' | 'message'> {
  const { saved, target, files } = model
  return { targetFiles: files, targetFile: target, pendingCount: saved.queued?.requests.length ?? (saved.restoreRequested ? 1 : 0),
    appliedAt: saved.applied?.at, canRestore: Boolean(saved.applied), conflicts: saved.status?.conflicts ?? [] }
}
function installation(model: MacroModel): MacroAssistantSnapshot['installation'] {
  const { saved, target, files } = model
  const base = installBase(model)
  if (!target) return { ...base, state: 'unavailable', message: files.length > 1 ? 'Choose a character settings file. The active loadout filename cannot be determined automatically.' : 'No matching character settings file is available.' }
  if (saved.queued || saved.restoreRequested) return { ...base, state: 'pending', message: 'Queued. Exit EverQuest so the companion can safely update the settings file.' }
  if (saved.status) return { ...base, ...saved.status }
  return { ...base, state: saved.settings.autoUpdate ? 'ready' : 'off', message: saved.settings.autoUpdate ? 'Automatic updates are enabled for selected macros.' : 'Choose macros to install or keep updated automatically.' }
}

function playerContext(model: MacroModel): MacroAssistantSnapshot['context'] {
  const live = model.input?.player
  return { live: Boolean(live), message: model.message, classes: live?.classes ?? model.saved.classes ?? [],
    level: live?.level ?? model.saved.level, knownSpells: live?.spellbook?.length,
    memorizedSpells: live?.memorizedSpells?.filter((id) => id !== null).length }
}

export async function macroSnapshot(model: MacroModel): Promise<MacroAssistantSnapshot> {
  let existing: MacroAssistantSnapshot['existing'] = []
  try { existing = await existingSocials(model) } catch (error) { model.message = error instanceof Error ? error.message : 'Cannot read existing socials.' }
  return { character: model.world.character, characterId: model.world.characterId,
    context: playerContext(model),
    settings: model.saved.settings, recipes: currentRecipes(model), existing, installation: installation(model) }
}
