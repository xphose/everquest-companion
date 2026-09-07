/** Real journal IPC over the Rust fold and staged character exports; no live game files are written.
 * Assignment comes from p1-unbound-pet.log:1118; the live update replays e2e-deep-link.log:69.
 * UI navigation, layout and filters are covered by quest-journal.e2e.mts.
 * Run: npm run test:e2e -- quest-journal-data
 */
import { copyFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from 'playwright-core'
import type { EqApi } from '../../src/preload/index'
import type { QuestJournalQuery, QuestJournalQueryResult } from '../../src/shared/questJournal/journal'
import { buildIfStale, check, dumpArtifacts, failures, reportRun, ROOT, settle } from './appHarness.mjs'
import { mainWindow, makeUserData, removeUserData } from './appWindow.mjs'
import { launchOnFixture, stageFixture, writeAchievementsDump, writeInventoryDump, type FixtureLog } from './logFixture.mjs'

type Bridge = Pick<EqApi, 'questJournalQuery' | 'questJournalDetail' | 'questJournalMutate' | 'setCharacter'>
const TASK = 'Potential of the Void - Lord Nagafen - Weekly'
const TASK_ID = `task:${TASK.toLowerCase()}`
const EARNED = 'posky:Ranger::Ranger Test of Defense'
const BYPASSED = 'posky:Paladin::Paladin Test of Love'

function query(page: Page, request: QuestJournalQuery = {}): Promise<QuestJournalQueryResult> {
  return page.evaluate((value) => (window as unknown as { eq: Bridge }).eq.questJournalQuery(value), request)
}

async function onCharacter(page: Page, logPath: string, name: string): Promise<QuestJournalQueryResult> {
  const picked = await page.evaluate((path) => (window as unknown as { eq: Bridge }).eq.setCharacter(path), logPath)
  if (!check(`the app accepts the staged ${name} character`, picked.ok)) throw new Error('Character selection failed')
  const ready = await settle(
    () => query(page).catch(() => null),
    (value) => value?.context.characterName === name && value.context.readiness === 'ready',
    { timeoutMs: 60_000 }
  )
  if (!check(`${name}'s real engine answers the journal`, ready?.context.characterName === name && ready.context.readiness === 'ready')) {
    throw new Error('Journal never became ready')
  }
  return ready as QuestJournalQueryResult
}

function detail(page: Page, characterId: string, id: string) {
  return page.evaluate((value) => (window as unknown as { eq: Bridge }).eq.questJournalDetail(value), { characterId, id })
}

/** Locate the exact committed message; only the harness supplies its replay timestamp. */
function recordedUpdate(): string {
  const lines = readFileSync(join(ROOT, 'tests', 'fixtures', 'e2e-deep-link.log'), 'utf8').split(/\r?\n/u)
  const line = lines.find((value) => value.endsWith(`Your task '${TASK}' has been updated.`))
  if (!line) throw new Error('The verified task update fixture is missing')
  return line.replace(/^\[[^\]]+\] /u, '')
}

function checkAssignment(assigned: Awaited<ReturnType<typeof detail>>): void {
  check('the recorded assignment appears without a manual quest mark', assigned.row?.state === 'active' && assigned.manual.status === undefined)
  check('assignment has a real observed timestamp and no invented completion', typeof assigned.observed?.assignedAt === 'number' && assigned.observed.completedAt === undefined)
  check('unknown task guide data stays unknown', assigned.entry === undefined && assigned.row?.hasGuide === false)
}

async function taskEvidence(page: Page, log: FixtureLog, characterId: string): Promise<void> {
  const assigned = await detail(page, characterId, TASK_ID)
  checkAssignment(assigned)
  log.append(recordedUpdate())
  const updated = await settle(
    () => detail(page, characterId, TASK_ID),
    (value) => typeof value.observed?.updatedAt === 'number',
    { timeoutMs: 30_000 }
  )
  check('a live recorded update invalidates the cached engine task snapshot',
    updated.observed?.lastChange === 'updated' && typeof updated.observed.updatedAt === 'number')
  check('the update preserves assignment evidence without inventing completion',
    updated.observed?.assignedAt === assigned.observed?.assignedAt && updated.row?.state === 'active')
}

async function exportEvidence(page: Page, log: FixtureLog, characterId: string): Promise<void> {
  // Only the other character/server has exports at first: the journal must not borrow them.
  const missing = await query(page)
  check('another character or server export does not populate this character',
    missing.context.inventory.state === 'missing' && missing.context.achievements.state === 'missing')
  check('another character’s earned achievements cannot complete this character’s quest',
    (await detail(page, characterId, EARNED)).row?.state === 'unknown')
  writeInventoryDump(log.installDir, 'Primitive_freeport-Inventory.txt')
  writeAchievementsDump(log.installDir, 'Primitive_freeport-Achievements.txt')
  const loaded = await settle(
    () => query(page),
    (value) => value.context.inventory.state === 'available' && value.context.achievements.state === 'available'
  )
  check('exact-character exports are detected without an import or manual progress mutation',
    loaded.context.inventory.state === 'available' && loaded.context.achievements.state === 'available')
  check('inventory and achievement export dates are exposed',
    typeof loaded.context.inventory.updatedAt === 'string' && typeof loaded.context.achievements.updatedAt === 'string')
  const earned = await detail(page, characterId, EARNED)
  check('an earned Sky quest imports completion from the real achievement fixture',
    earned.row?.state === 'completed' && earned.evidence.some((line) => line.includes('achievements export')))
  const bypassed = await detail(page, characterId, BYPASSED)
  check('the same fixture’s class-confirmation grant never becomes quest completion', bypassed.row?.state === 'unknown')
}

async function characterIsolation(page: Page, log: FixtureLog, originalId: string): Promise<void> {
  const saved = await page.evaluate(({ characterId, id }) => (window as unknown as { eq: Bridge }).eq.questJournalMutate({
    characterId, action: 'track', id, value: true
  }), { characterId: originalId, id: TASK_ID })
  check('tracking saves against the selected character', saved.ok)
  const other = await onCharacter(page, log.others.Journalalt, 'Journalalt')
  const otherId = other.context.characterId
  if (!otherId) throw new Error('Switched character has no journal identity')
  check('switching characters clears prior log task activity and tracking',
    (await query(page, { search: TASK })).total === 0 && (await query(page, { state: 'tracked' })).total === 0)
  check('the previous character’s exact exports remain excluded after the switch',
    other.context.inventory.state === 'missing' && other.context.achievements.state === 'missing')
  const stale = await page.evaluate(({ characterId, id }) => (window as unknown as { eq: Bridge }).eq.questJournalMutate({
    characterId, action: 'status', id, value: 'completed'
  }), { characterId: originalId, id: EARNED })
  check('a stale-character mutation is rejected at the real IPC boundary', !stale.ok)
  check('a refused mutation does not complete the other character’s quest',
    (await detail(page, otherId, EARNED)).row?.state === 'unknown')
  await onCharacter(page, log.logPath, 'Primitive')
  check('switching back restores only the original character’s saved tracking',
    (await detail(page, originalId, TASK_ID)).row?.tracked === true)
}

async function session(log: FixtureLog, userData: string): Promise<void> {
  const launched = await launchOnFixture(log, { userData })
  let page: Page | null = null
  try {
    page = await mainWindow(launched.app)
    const initial = await onCharacter(page, log.logPath, 'Primitive')
    const id = initial.context.characterId
    if (!id) throw new Error('Fixture character has no journal identity')
    await taskEvidence(page, log, id)
    await exportEvidence(page, log, id)
    await characterIsolation(page, log, id)
    if (failures.length) await dumpArtifacts(page, 'quest-journal-data-FAIL')
  } catch (error) {
    if (page) await dumpArtifacts(page, 'quest-journal-data-ERROR')
    throw error
  } finally { await launched.close() }
}

async function persistedSession(log: FixtureLog, userData: string): Promise<void> {
  const launched = await launchOnFixture(log, { userData })
  try {
    const page = await mainWindow(launched.app)
    const ready = await onCharacter(page, log.logPath, 'Primitive')
    if (!ready.context.characterId) throw new Error('Relaunched character has no identity')
    const task = await detail(page, ready.context.characterId, TASK_ID)
    check('restart reloads saved tracking while rebuilding observed task history from the log',
      task.row?.tracked === true && typeof task.observed?.updatedAt === 'number' && task.manual.status === undefined)
  } finally { await launched.close() }
}

async function main(): Promise<void> {
  buildIfStale()
  const log = stageFixture('p1-unbound-pet.log', { others: { Journalalt: 'e2e-leveling.log' } })
  const userData = makeUserData()
  try {
    for (const kind of ['Inventory', 'Achievements']) {
      copyFileSync(join(ROOT, 'tests', 'fixtures', `Primitive_freeport-${kind}.txt`), join(log.installDir, `Other_freeport-${kind}.txt`))
      copyFileSync(join(ROOT, 'tests', 'fixtures', `Primitive_freeport-${kind}.txt`), join(log.installDir, `Primitive_wrongserver-${kind}.txt`))
    }
    await session(log, userData)
    await persistedSession(log, userData)
  } finally {
    await log.dispose()
    await removeUserData(userData)
  }
  reportRun()
}

main().catch((error: unknown) => {
  console.error('e2e: quest journal data harness error', error)
  process.exitCode = 1
})
