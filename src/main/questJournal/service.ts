import type { CharacterRef, CharacterSnap, LootEvent, ProgressState, TurnInEvent } from '../../shared/types'
import type { ComboSnap } from '../../shared/classCombo'
import type { QuestJournalCatalogEntry } from '../../shared/questJournal/catalog'
import type {
  QuestJournalContext, QuestJournalDetailRequest, QuestJournalDetailResult,
  QuestJournalMutationResult, QuestJournalObservedTask, QuestJournalQueryResult
} from '../../shared/questJournal/journal'
import { classDisplayName } from '../../shared/spellLevels'
import { isClassAbbr } from '../../shared/classCombo'
import type { JournalFiles } from './files'
import { detailJournal, queryJournal, type JournalModelInput } from './model'
import { observedTaskId, supplementInventory } from './progress'
import { applyMutation, record, safeId, sanitizeProgress, validateMutation } from './validate'

export interface JournalWorld {
  characterId: string | null
  character: CharacterRef | null
  token: string
  readiness: QuestJournalContext['readiness']
}

export interface JournalServiceDeps {
  world: () => JournalWorld
  catalog: () => readonly QuestJournalCatalogEntry[]
  files: (character: CharacterRef | null) => JournalFiles
  snapshot: (module: string) => Promise<unknown>
  getProgress: (characterId: string) => ProgressState
  setProgress: (characterId: string, progress: ProgressState) => void
  now: () => number
}

export function sameJournalWorld(a: JournalWorld, b: JournalWorld): boolean {
  return a.characterId === b.characterId && a.character?.logPath === b.character?.logPath && a.token === b.token
}

function assertCurrent(deps: JournalServiceDeps, world: JournalWorld): void {
  if (!sameJournalWorld(world, deps.world())) throw new Error('The active character or engine changed. Refresh the journal.')
}

function taskRows(value: unknown): { rows: QuestJournalObservedTask[]; truncated: boolean } {
  const state = record(value)
  if (state?.v !== 1 || !Array.isArray(state.tasks)) throw new Error('Task observations are unavailable from this engine.')
  const rows: QuestJournalObservedTask[] = []
  for (const raw of state.tasks.slice(0, 4096)) {
    const row = record(raw)
    if (!row || typeof row.name !== 'string' || !safeId(observedTaskId(row.name))) continue
    rows.push({ name: row.name,
      assignedAt: typeof row.assignedAt === 'number' ? row.assignedAt : undefined,
      updatedAt: typeof row.updatedAt === 'number' ? row.updatedAt : undefined,
      ...terminalFields(row) })
  }
  return { rows, truncated: state.truncated === true }
}

function terminalFields(row: Record<string, unknown>): Partial<QuestJournalObservedTask> {
  return {
    completedAt: typeof row.completedAt === 'number' ? row.completedAt : undefined,
    removedAt: typeof row.removedAt === 'number' ? row.removedAt : undefined,
    failedAt: typeof row.failedAt === 'number' ? row.failedAt : undefined,
    lastObservedAt: typeof row.lastObservedAt === 'number' ? row.lastObservedAt : undefined,
    lastChange: ['assigned', 'updated', 'completed', 'removed', 'failed'].includes(String(row.lastChange))
      ? row.lastChange as QuestJournalObservedTask['lastChange'] : undefined,
    cycleStatus: ['observed', 'assigned', 'completed', 'removed', 'failed'].includes(String(row.cycleStatus))
      ? row.cycleStatus as QuestJournalObservedTask['cycleStatus'] : undefined
  }
}

function detectedClasses(value: unknown): { classes: string[]; inferredClasses: string[] } {
  const combo = value as ComboSnap | null
  const resolved = combo?.current?.slots.flatMap((slot) => {
    const candidate = slot.candidates[0]
    return slot.candidates.length === 1 && isClassAbbr(candidate)
      ? [{ name: classDisplayName(candidate), inferred: slot.provenance === 'inferred' }] : []
  }) ?? []
  return {
    classes: resolved.map((slot) => slot.name),
    inferredClasses: resolved.filter((slot) => slot.inferred).map((slot) => slot.name)
  }
}

interface ObservationSet {
  character?: CharacterSnap
  classes: string[]
  inferredClasses: string[]
  tasks: QuestJournalObservedTask[]
  truncated: boolean
  loot: LootEvent[]
  turnins: TurnInEvent[]
  error?: string
  inventoryUpdatesAvailable: boolean
}

async function observations(deps: JournalServiceDeps, world: JournalWorld): Promise<ObservationSet> {
  const out: ObservationSet = { classes: [], inferredClasses: [], tasks: [], truncated: false, loot: [], turnins: [], inventoryUpdatesAvailable: false }
  if (!world.characterId || world.readiness !== 'ready') return out
  const results = await Promise.allSettled(['character', 'combo', 'tasks', 'loot', 'turnins'].map(deps.snapshot))
  assertCurrent(deps, world)
  const [character, combo, tasks, loot, turnins] = results
  if (character.status === 'fulfilled') out.character = character.value as CharacterSnap
  if (combo.status === 'fulfilled') Object.assign(out, detectedClasses(combo.value))
  if (tasks.status === 'fulfilled') {
    try {
      const parsed = taskRows(tasks.value)
      out.tasks = parsed.rows
      out.truncated = parsed.truncated
    } catch (error) { out.error = error instanceof Error ? error.message : 'Task observations unavailable.' }
  } else out.error = 'Task observations are unavailable. Quest guides and saved progress remain available.'
  if (arrayResult(loot)) out.loot = loot.value as LootEvent[]
  if (arrayResult(turnins)) out.turnins = turnins.value as TurnInEvent[]
  out.inventoryUpdatesAvailable = [loot, turnins].every(arrayResult)
  return out
}

function arrayResult(result: PromiseSettledResult<unknown>): result is PromiseFulfilledResult<unknown[]> {
  return result.status === 'fulfilled' && Array.isArray(result.value)
}

function profileContext(input: ObservationSet, stored: ProgressState): Pick<QuestJournalContext, 'classes' | 'inferredClasses' | 'level' | 'profileSource'> {
  const profile = sanitizeProgress(stored.questJournal).profile
  const classes = profile?.classes.length ? profile.classes : input.classes
  const inferredClasses = profile?.classes.length ? [] : input.inferredClasses
  const level = profile?.level ?? input.character?.level?.level
  const manual = hasManualProfile(stored)
  const known = level !== undefined || classes.length > 0
  return { classes, inferredClasses, level, profileSource: !known ? 'unknown' : manual ? 'manual' : 'detected' }
}

function hasManualProfile(stored: ProgressState): boolean {
  const profile = sanitizeProgress(stored.questJournal).profile
  return profile?.level !== undefined || Boolean(profile?.classes.length)
}

function completedSky(stored: ProgressState): Set<string> {
  const keys = new Set(stored.completedQuests)
  for (const [key, times] of Object.entries(stored.questTurnIns ?? {})) if (times.length) keys.add(key)
  return new Set([...keys].map((key) => `posky:${key}`))
}

async function readModel(deps: JournalServiceDeps): Promise<{ input: JournalModelInput; world: JournalWorld }> {
  const world = deps.world()
  const observed = await observations(deps, world)
  assertCurrent(deps, world)
  const stored = world.characterId ? deps.getProgress(world.characterId) : { inventory: {}, completedQuests: [] }
  const files = deps.files(world.character)
  const context: QuestJournalContext = {
    characterId: world.characterId, characterName: world.character?.name, characterServer: world.character?.server,
    ...profileContext(observed, stored), zone: observed.character?.zone,
    readiness: observed.error ? 'unavailable' : world.readiness,
    message: observed.error ?? readinessMessage(world), inventory: files.inventoryStatus,
    achievements: files.achievementsStatus, refreshedAt: deps.now(), tasksTruncated: observed.truncated
  }
  const exportedAt = Date.parse(files.inventoryStatus.updatedAt ?? '')
  annotateInventory(context, observed, exportedAt)
  assertCurrent(deps, world)
  return { world, input: {
    catalog: deps.catalog(), context, progress: sanitizeProgress(stored.questJournal), observed: observed.tasks,
    inventory: supplementInventory(files.inventory, exportedAt, observed.loot, observed.turnins),
    claims: files.claims, worn: files.worn, turnins: observed.turnins, completedSky: completedSky(stored)
  } }
}

function annotateInventory(context: QuestJournalContext, observed: ObservationSet, exportedAt: number): void {
  if (context.inventory.state !== 'available') return
  if (!observed.inventoryUpdatesAvailable) {
    context.inventory.message = 'Inventory export only; subsequent log item updates are currently unavailable.'
    context.inventory.refreshSuggested = true
    return
  }
  const combined = observed.loot.some((event) => event.ts > exportedAt && event.disposition === 'combined')
  const old = context.refreshedAt - exportedAt > 30 * 60 * 1000
  context.inventory.refreshSuggested = combined || old
  context.inventory.message = combined
    ? 'A combine after this export made some item counts uncertain. Export inventory again to update them.'
    : 'Based on the inventory export plus recorded loot, destroys and trades. Export again after selling or giving away items.'
}

function readinessMessage(world: JournalWorld): string | undefined {
  if (!world.characterId) return 'Choose a character to read observations and save progress. Quest guides are available now.'
  if (world.readiness === 'loading') return 'Reading the character log. Quest observations will appear when the engine is ready.'
  if (world.readiness === 'unavailable') return 'The log engine is unavailable. Saved progress and local exports remain available.'
  return undefined
}

function validateQuestMutation(input: JournalModelInput, mutation: ReturnType<typeof validateMutation>): string | null {
  if (!mutation || mutation.action === 'profile') return null
  const entry = input.catalog.find((candidate) => candidate.id === mutation.id)
  const knownTask = input.observed.some((task) => observedTaskId(task.name) === mutation.id) ||
    Object.prototype.hasOwnProperty.call(input.progress.quests, mutation.id) ||
    Object.prototype.hasOwnProperty.call(input.progress.recovery ?? {}, mutation.id)
  if (!entry && !knownTask) return 'Unknown quest.'
  if (mutation.action === 'step' && !entry?.guide?.steps.some((step) => step.id === mutation.stepId)) return 'Unknown quest step.'
  return null
}

export function createQuestJournalService(deps: JournalServiceDeps): {
  query: (raw: unknown) => Promise<QuestJournalQueryResult>
  detail: (request: QuestJournalDetailRequest) => Promise<QuestJournalDetailResult>
  mutate: (raw: unknown) => Promise<QuestJournalMutationResult>
} {
  return {
    query: async (raw) => queryJournal((await readModel(deps)).input, raw),
    detail: async (request) => {
      if (!safeId(request.id)) throw new Error('Invalid quest.')
      const { input } = await readModel(deps)
      if (request.characterId !== input.context.characterId) throw new Error('The active character changed. Refresh the journal.')
      return detailJournal(input, request.id)
    },
    mutate: async (raw) => {
      const mutation = validateMutation(raw)
      if (!mutation) return { ok: false, error: 'Invalid journal change.' }
      try {
        const { input, world } = await readModel(deps)
        if (mutation.characterId !== world.characterId) return { ok: false, error: 'The active character changed. Refresh the journal.' }
        const error = validateQuestMutation(input, mutation)
        if (error) return { ok: false, error }
        assertCurrent(deps, world)
        const current = deps.getProgress(mutation.characterId)
        const next = applyMutation(sanitizeProgress(current.questJournal), mutation)
        deps.setProgress(mutation.characterId, { ...current, questJournal: next })
        return { ok: true }
      } catch (error) { return { ok: false, error: error instanceof Error ? error.message : 'Unable to save progress.' } }
    }
  }
}
