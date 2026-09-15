/** Quest evidence is recorded while the journal is unmounted, then survives a real process
 * restart after replacement of the staged log. Only disposable synthetic game data is written. */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ElectronApplication, Page } from 'playwright-core'
import type { EqApi } from '../../src/preload/index'
import type { ProgressState } from '../../src/shared/types'
import { buildIfStale, check, dumpArtifacts, failures, reportRun, ROOT, settle } from './appHarness.mjs'
import { mainWindow, makeUserData, overlayWindow, removeUserData } from './appWindow.mjs'
import { launchOnFixture, stageFixture, type FixtureLog } from './logFixture.mjs'

const QUEST = 'Froglock Tadpole Fleshies'
const TASK = 'A Long Road Home'
const TASK_ID = 'task:a long road home'
const ROW = `[data-testid="quest-journal-row"][data-quest-id="${QUEST}"]`
interface Browser { eq: EqApi }

function savedProgress(userData: string): ProgressState | undefined {
  try {
    const store = JSON.parse(readFileSync(join(userData, 'everquest-companion-progress.json'), 'utf8')) as { byCharacter?: Record<string, ProgressState> }
    return Object.values(store.byCharacter ?? {}).find(progress => progress.questJournal?.history?.tasks[TASK_ID])
  } catch { return undefined }
}

function appendObservations(log: FixtureLog): void {
  const reward = readFileSync(join(ROOT, 'tests/fixtures/quest-rewarded-handin.log'), 'utf8').trim().split(/\r?\n/u)
  const messages = reward.map(line => line.replace(/^\[[^\]]+\] /u, ''))
  if (messages.length !== 4) throw new Error('Expected the verified four-line hand-in fixture')
  const assignment = readFileSync(join(ROOT, 'tests/fixtures/task-strings.eqstr.txt'), 'utf8').split(/\r?\n/u)
    .find(line => line.startsWith('3472 '))?.slice(5).replace('%1', TASK)
  if (!assignment) throw new Error('Expected the verified task assignment template')
  const now = Date.now()
  log.appendAt(new Date(now - 2000), messages[0])
  log.appendAt(new Date(now), ...messages.slice(1))
  log.appendAt(new Date(now + 1000), assignment)
}

async function setFilter(main: Page, label: string): Promise<void> {
  await main.locator('[data-testid="quest-journal-status-filter"] [role="combobox"]').click()
  await main.getByRole('option', { name: label, exact: true }).click()
}

async function showCompleted(main: Page): Promise<void> {
  await main.locator('[data-testid="nav-questJournal"]').click()
  await main.locator('[data-testid="quest-journal"]').waitFor()
  await main.locator('[data-testid="quest-journal-search"] input').fill(QUEST)
  await setFilter(main, 'Completed')
  await main.locator(ROW).waitFor()
  await main.locator(ROW).click()
  check('main journal retains the verified hand-in explanation', (await main.locator(ROW).innerText()).includes('hand-in and experience'))
}

async function adventure(app: ElectronApplication, main: Page): Promise<Page> {
  let page = await overlayWindow(app, 'adventure', 1000)
  if (!page) {
    await main.getByRole('button', { name: 'Floating DPS overlays', exact: true }).click()
    await main.locator('[data-testid="overlay-menu-adventure"]').click()
    await main.keyboard.press('Escape')
    page = await overlayWindow(app, 'adventure')
  }
  if (!page) throw new Error('Adventure did not open')
  await page.locator('[data-testid="adventure-overlay"]').waitFor()
  await page.getByRole('tab', { name: 'Quests', exact: true }).click()
  const back = page.getByRole('button', { name: '← Quest list', exact: true })
  if (await back.count()) await back.click()
  await page.getByRole('tab', { name: 'Completed', exact: true }).click()
  await page.getByRole('textbox', { name: 'Find a quest' }).fill(QUEST)
  const row = page.locator('[data-testid="adventure-quest-row"]').filter({ hasText: QUEST })
  await row.waitFor()
  const completed = (await row.innerText()).includes('hand-in and experience')
  await row.click()
  await page.locator('[data-testid="adventure-quest-detail"]').waitFor()
  check('Adventure restores the same completed and tracked quest', completed &&
    await page.locator('[data-testid="adventure-track"]').textContent() === 'Untrack quest')
  return page
}

async function inspectActiveTask(main: Page): Promise<void> {
  const active = await main.evaluate(async name => (window as unknown as Browser).eq.questJournalQuery({ search: name, state: 'active' }), TASK)
  check('an observed-only active task also survives the missing original log', active.rows.some(row => row.id === TASK_ID && row.state === 'active'))
}

async function observeWhileClosed(main: Page, log: FixtureLog, userData: string): Promise<void> {
  check('the journal is unmounted while gameplay is recorded', await main.locator('[data-testid="quest-journal"]').count() === 0)
  appendObservations(log)
  const saved = await settle(() => savedProgress(userData), progress => Boolean(progress?.questJournal?.history?.rewardedHandIns[QUEST]), { timeoutMs: 30000 })
  check('completion and active task were saved on disk before any journal query or open', Boolean(saved?.questJournal?.history?.rewardedHandIns[QUEST]) &&
    saved?.questJournal?.history?.tasks[TASK_ID].latest.cycleStatus === 'assigned')
  check('automatic evidence never writes manual completion flags', Object.keys(saved?.questJournal?.quests ?? {}).length === 0)
}

async function session(log: FixtureLog, userData: string, restarting: boolean): Promise<void> {
  const launched = await launchOnFixture(log, { userData })
  const main = await mainWindow(launched.app)
  let overlay: Page | undefined
  const errors: string[] = []
  main.on('pageerror', error => errors.push(error.message))
  try {
    const notice = main.locator('[data-testid="telemetry-notice-off"]')
    if (await notice.count()) await notice.click()
    if (!restarting) await observeWhileClosed(main, log, userData)
    await showCompleted(main)
    if (!restarting) await main.locator('[data-testid="quest-journal-track"]').click()
    check('tracking survives independently from automatic completion', await settle(() => main.locator('[data-testid="quest-journal-track"]').textContent(), text => text === 'Tracking') === 'Tracking')
    overlay = await adventure(launched.app, main)
    overlay.on('pageerror', error => errors.push(error.message))
    await inspectActiveTask(main)
    check('journal explains automatic local persistence', (await main.locator('[data-testid="quest-journal-context"]').innerText()).includes('saves automatically'))
    check('both quest surfaces stay error free', errors.length === 0, errors.join('\n'))
    if (failures.length) await dumpArtifacts(main, 'quest-persistence-FAIL')
  } catch (error) { await dumpArtifacts(overlay ?? main, 'quest-persistence-ERROR'); throw error }
  finally { await launched.close() }
}

async function main(): Promise<void> {
  buildIfStale()
  const log = stageFixture('e2e-leveling.log')
  const userData = makeUserData()
  try {
    await session(log, userData, false)
    // The first app has exited. Replace its disposable log with a snapshot predating both quests.
    writeFileSync(log.logPath, readFileSync(join(ROOT, 'tests/fixtures/e2e-leveling.log')))
    await session(log, userData, true)
  } finally { await log.dispose(); await removeUserData(userData) }
  reportRun()
}
main().catch((error: unknown) => { console.error(error); process.exitCode = 1 })
