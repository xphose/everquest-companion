import type { MacroSaved, QueuedMacros } from './types'
import { readMacroDefaults, type CharacterFile } from './files'
import { planSpellLoadoutIni, type ManagedSpellLoadout } from './spellLoadoutIni'
import { planSocialIni } from './socialIni'

/** Defaults participate in allocation even when the character file overrides them. */
export async function unchangedDefaults(root: string, observed: CharacterFile | undefined): Promise<void> {
  const current = await readMacroDefaults(root)
  if (Boolean(current) !== Boolean(observed) || current && observed && !current.bytes.equals(observed.bytes)) {
    throw new Error('Default spell sets changed before saving. Rebuild adventure preparation.')
  }
}

function preparedSets(file: CharacterFile, defaults: CharacterFile | undefined, queue: QueuedMacros, saved: MacroSaved): ReturnType<typeof planSpellLoadoutIni> | undefined {
  return queue.preparation ? planSpellLoadoutIni(file.text, defaults?.text ?? '', queue.preparation.sets, saved.setManaged?.[queue.targetFile] ?? []) : undefined
}

export function installationPlan(file: CharacterFile, defaults: CharacterFile | undefined, queue: QueuedMacros, saved: MacroSaved): {
  text: string; changed: boolean; managed: ReturnType<typeof planSocialIni>['managed']
  setManaged?: ManagedSpellLoadout[]; conflicts: string[]
} {
  const prepared = queue.preparation
  const sets = preparedSets(file, defaults, queue, saved)
  const socials = planSocialIni(sets?.text ?? file.text, queue.requests, saved.managed[queue.targetFile] ?? [], { retireMissing: true })
  const packageConflicts = [...sets?.conflicts ?? [], ...socials.conflicts.map((item) => item.reason)]
  // A Load button without a valid return set, or a partial set/social package, is never installed.
  if (prepared && packageConflicts.length) throw new Error(packageConflicts.join(' '))
  return { text: socials.text, changed: socials.text !== file.text, managed: socials.managed, setManaged: sets?.managed,
    conflicts: [...queue.problems, ...packageConflicts] }
}

export function rememberPreparation(saved: MacroSaved, queue: QueuedMacros, sets: ManagedSpellLoadout[] | undefined, receipt: { at: string; changed: boolean }): void {
  if (!queue.preparation || !sets) return
  saved.setManaged ??= {}
  saved.preparations ??= {}
  saved.setManaged[queue.targetFile] = sets
  const installedAt = receipt.changed ? receipt.at : saved.preparations[queue.targetFile]?.installedAt
  saved.preparations[queue.targetFile] = { ...structuredClone(queue.preparation), installedAt, unchanged: !receipt.changed,
    completion: { kind: receipt.changed ? 'written' : 'unchanged', at: receipt.at } }
}
