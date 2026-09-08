import type { MacroSaved, MacroServiceDeps, MacroWorld } from './types'
import { assertMacroWorld } from './settings'
import { bytesHash, encodeCharacterFile, readBackup, readCharacterFile, replaceCharacterFile } from './files'
import { planSocialIni } from './socialIni'

async function exited(deps: MacroServiceDeps, world: MacroWorld): Promise<void> {
  assertMacroWorld(world, deps.world())
  const player = await deps.livePlayer()
  assertMacroWorld(world, deps.world())
  if (player.state !== 'not-running') throw new Error('Waiting for EverQuest to exit before changing character settings.')
}

export async function applyQueuedMacros(deps: MacroServiceDeps, world: MacroWorld, saved: MacroSaved): Promise<void> {
  const queue = saved.queued
  if (!queue || !world.root) return
  await exited(deps, world)
  const file = await readCharacterFile(world.root, queue.targetFile)
  const previous = saved.managed[queue.targetFile] ?? []
  const plan = planSocialIni(file.text, queue.requests, previous, { retireMissing: true })
  const conflicts = [...queue.problems, ...plan.conflicts.map((problem) => problem.reason)]
  if (plan.changed) {
    const updated = encodeCharacterFile(file, plan.text)
    const backup = await replaceCharacterFile({ root: world.root, name: queue.targetFile, original: file.bytes,
      updated, backupDir: deps.backupDir, guard: () => exited(deps, world) })
    saved.applied = { targetFile: queue.targetFile, hash: bytesHash(updated), backup,
      previousManaged: previous, at: new Date(deps.now()).toISOString() }
    saved.managed[queue.targetFile] = plan.managed
  }
  saved.lastSignature = queue.signature
  saved.queued = undefined
  saved.status = conflicts.length
    ? { state: 'conflict', message: 'Some selected macros need attention. Existing edits were preserved.', conflicts }
    : { state: 'applied', message: plan.changed ? 'Managed hotbuttons saved. They will load next time you enter the game.' : 'The managed hotbuttons already match this plan.', conflicts: [] }
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
  saved.applied = undefined
  saved.restoreRequested = false
  saved.status = { state: 'off', message: 'The previous character settings were restored. Automatic updates are off.', conflicts: [] }
}
