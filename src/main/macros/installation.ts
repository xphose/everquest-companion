import type { MacroSaved, MacroServiceDeps, MacroWorld } from './types'
import { assertMacroWorld } from './settings'
import { bytesHash, encodeCharacterFile, readBackup, readCharacterFile, readMacroDefaults, replaceCharacterFile } from './files'
import { installationPlan, rememberPreparation, restorePreparationOwnership, unchangedDefaults } from './preparationInstall'
import type { QueuedMacros } from './types'

async function exited(deps: MacroServiceDeps, world: MacroWorld): Promise<void> {
  assertMacroWorld(world, deps.world())
  const player = await deps.livePlayer()
  assertMacroWorld(world, deps.world())
  if (player.state !== 'not-running') throw new Error('Waiting for EverQuest to exit before changing character settings.')
}

function completedStatus(saved: MacroSaved, queue: QueuedMacros, plan: ReturnType<typeof installationPlan>, at: string): void {
  const { changed, conflicts } = plan
  saved.status = conflicts.length
    ? { state: 'conflict', message: 'Some selected macros need attention. Existing edits were preserved.', conflicts }
    : { state: 'applied', message: changed ? 'Managed hotbuttons saved. They will load next time you enter the game.' : 'The managed hotbuttons already match this plan.', conflicts: [],
      completion: { kind: changed ? 'written' : 'unchanged', at, targetFile: queue.targetFile, destination: completionDestination(queue) } }
}

function completionDestination(queue: QueuedMacros): { bar: number; page: number } | undefined {
  const destinations = queue.requests.flatMap((request) => request.hotbar ? [request.hotbar] : [])
  const first = destinations[0]
  return first && destinations.every((destination) => destination.bar === first.bar && destination.page === first.page) ? { ...first } : undefined
}

export async function applyQueuedMacros(deps: MacroServiceDeps, world: MacroWorld, saved: MacroSaved): Promise<void> {
  const queue = saved.queued
  const root = world.root
  if (!queue || !root) return
  await exited(deps, world)
  const file = await readCharacterFile(root, queue.targetFile)
  const defaults = queue.preparation ? await readMacroDefaults(root) : undefined
  const previous = saved.managed[queue.targetFile] ?? []
  const plan = installationPlan(file, defaults, queue, saved)
  const guard = async (): Promise<void> => {
    await exited(deps, world)
    if (queue.preparation) await unchangedDefaults(root, defaults)
  }
  const at = new Date(deps.now()).toISOString()
  if (plan.changed) {
    const updated = encodeCharacterFile(file, plan.text)
    const backup = await replaceCharacterFile({ root, name: queue.targetFile, original: file.bytes,
      updated, backupDir: deps.backupDir, guard })
    saved.applied = { targetFile: queue.targetFile, hash: bytesHash(updated), backup,
      previousManaged: previous, previousSetManaged: saved.setManaged?.[queue.targetFile],
      previousPreparation: saved.preparations?.[queue.targetFile], at }
    saved.managed[queue.targetFile] = plan.managed
  } else await guard()
  rememberPreparation(saved, queue, plan.setManaged, { at, changed: plan.changed })
  saved.lastSignature = queue.signature
  saved.queued = undefined
  completedStatus(saved, queue, plan, at)
}

export async function restoreMacros(deps: MacroServiceDeps, world: MacroWorld, saved: MacroSaved): Promise<void> {
  const applied = saved.applied
  if (!applied || !world.root) throw new Error('There is no saved macro change to restore.')
  await exited(deps, world)
  const file = await readCharacterFile(world.root, applied.targetFile)
  if (bytesHash(file.bytes) !== applied.hash) throw new Error('The character settings changed after installation. Restore would overwrite those edits.')
  const original = await readBackup(deps.backupDir, applied.backup)
  await replaceCharacterFile({ root: world.root, name: applied.targetFile, original: file.bytes,
    updated: original, backupDir: deps.backupDir, guard: () => exited(deps, world) })
  saved.managed[applied.targetFile] = applied.previousManaged
  restorePreparationOwnership(saved, applied)
  saved.applied = undefined
  saved.restoreRequested = false
  saved.status = { state: 'off', message: 'The previous character settings were restored. Automatic updates are off.', conflicts: [],
    completion: { kind: 'restored', at: new Date(deps.now()).toISOString(), targetFile: applied.targetFile } }
}
