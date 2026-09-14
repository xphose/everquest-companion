/** The scrubbed four-line legacy hand-in flows through the real tailer, Rust fold,
 * journal IPC and both visible quest lists. No quest is tracked or manually completed. */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ElectronApplication, Page } from 'playwright-core'
import type { EqApi } from '../../src/preload/index'
import { buildIfStale, check, dumpArtifacts, failures, reportRun, ROOT, settle } from './appHarness.mjs'
import { mainWindow, makeUserData, overlayWindow, removeUserData } from './appWindow.mjs'
import { launchOnFixture, stageFixture, type FixtureLog } from './logFixture.mjs'

const QUEST = 'Froglock Tadpole Fleshies'
const ROW = `[data-testid="quest-journal-row"][data-quest-id="${QUEST}"]`
const DETAIL = `[data-testid="quest-journal-detail"][data-quest-id="${QUEST}"]`
const ADVENTURE_ROW = '[data-testid="adventure-quest-row"]'
const OVERLAY_DETAIL = '[data-testid="adventure-quest-detail"]'
interface Browser { eq: EqApi }

async function ready(main: Page, log: FixtureLog): Promise<void> {
  await main.evaluate(path => (window as unknown as Browser).eq.setCharacter(path), log.logPath)
  const context = await settle(() => main.evaluate(() => (window as unknown as Browser).eq.questJournalQuery({ limit: 1 })).catch(() => null),
    result => result?.context.readiness === 'ready', { timeoutMs: 30000 })
  if (!context?.context.characterId) throw new Error('Staged character did not become ready')
  const notice = main.locator('[data-testid="telemetry-notice-off"]')
  if (await notice.count()) await notice.click()
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
  return page
}

async function mainFilter(page: Page, label: string): Promise<void> {
  await page.locator('[data-testid="quest-journal-status-filter"] [role="combobox"]').click()
  await page.getByRole('option', { name: label, exact: true }).click()
}

async function showUnfinished(main: Page, overlay: Page): Promise<void> {
  await main.locator('[data-testid="nav-questJournal"]').click()
  await main.locator('[data-testid="quest-journal-search"] input').fill(QUEST)
  await main.locator(ROW).click()
  check('fresh journal defaults to To do', (await main.locator('[data-testid="quest-journal-status-filter"]').innerText()).includes('To do'))
  await overlay.getByRole('tab', { name: 'Find', exact: true }).click()
  await overlay.getByRole('textbox', { name: 'Find a quest' }).fill(QUEST)
  await overlay.locator(ADVENTURE_ROW).filter({ hasText: QUEST }).waitFor()
  check('an untracked unfinished quest is visible in both discovery lists', await main.locator(ROW).count() === 1 &&
    await main.locator('[data-testid="quest-journal-track"]').textContent() === 'Track quest')
}

function appendReward(log: FixtureLog): void {
  const lines = readFileSync(join(ROOT, 'tests/fixtures/quest-rewarded-handin.log'), 'utf8').trim().split(/\r?\n/u)
  if (lines.length !== 4) throw new Error('Expected the verified four-line hand-in fixture')
  const messages = lines.map(line => line.replace(/^\[[^\]]+\] /u, ''))
  const now = Date.now()
  log.appendAt(new Date(now - 2000), messages[0])
  log.appendAt(new Date(now), ...messages.slice(1))
}

async function completedViews(main: Page, overlay: Page): Promise<void> {
  await mainFilter(main, 'Completed')
  await main.locator(ROW).waitFor()
  check('main Completed view explains the hand-in and experience evidence', (await main.locator(ROW).innerText()).includes('hand-in and experience'))
  await overlay.getByRole('tab', { name: 'Completed', exact: true }).click()
  const row = overlay.locator(ADVENTURE_ROW).filter({ hasText: QUEST })
  await row.waitFor()
  check('Adventure Completed view contains the same untracked completion', (await row.innerText()).includes('hand-in and experience'))
  await row.click()
  await overlay.locator(OVERLAY_DETAIL).waitFor()
  check('the completed quest remains readable without a tracking requirement',
    (await overlay.locator(OVERLAY_DETAIL).innerText()).includes('Completion recorded') &&
    await overlay.locator('[data-testid="adventure-track"]').textContent() === 'Track quest')
  await mainFilter(main, 'All quests')
  check('an explicit All query still includes completed quests', await settle(() => main.locator(ROW).count(), count => count === 1) === 1)
}

async function runSession(log: FixtureLog, userData: string, replay: boolean): Promise<void> {
  const launched = await launchOnFixture(log, { userData })
  let overlay: Page | null = null
  const main = await mainWindow(launched.app)
  const errors: string[] = []
  main.on('pageerror', error => errors.push(error.message))
  try {
    await ready(main, log)
    overlay = await adventure(launched.app, main)
    overlay.on('pageerror', error => errors.push(error.message))
    if (!replay) {
      await showUnfinished(main, overlay)
      appendReward(log)
      check('main To do removes the newly completed quest automatically', await settle(() => main.locator(ROW).count(), count => count === 0, { timeoutMs: 30000 }) === 0)
      check('Adventure Find removes the newly completed quest automatically', await settle(() => overlay!.locator(ADVENTURE_ROW).count(), count => count === 0, { timeoutMs: 15000 }) === 0)
      check('open main details update completion without reopening the quest', (await settle(() => main.locator(DETAIL).innerText(), text => text.includes('hand-in and experience'))).includes('hand-in and experience'))
    } else {
      await main.locator('[data-testid="nav-questJournal"]').click()
      await main.locator('[data-testid="quest-journal-search"] input').fill(QUEST)
      await overlay.getByRole('textbox', { name: 'Find a quest' }).fill(QUEST)
    }
    await completedViews(main, overlay)
    const fact = await main.evaluate(async id => {
      const eq = (window as unknown as Browser).eq
      const result = await eq.questJournalQuery({ search: id, state: 'completed' })
      return eq.questJournalDetail({ characterId: result.context.characterId, id })
    }, QUEST)
    check(`${replay ? 'restart replay' : 'live completion'} requires no saved manual status or named task event`, fact.row?.state === 'completed' && fact.manual.status === undefined && !fact.row.tracked && fact.observed === undefined)
    check('both renderers stay error free', errors.length === 0, errors.join('\n'))
    if (failures.length) await dumpArtifacts(overlay, 'quest-completion-FAIL')
  } catch (error) { await dumpArtifacts(overlay ?? main, 'quest-completion-ERROR'); throw error }
  finally { await launched.close() }
}

async function main(): Promise<void> {
  buildIfStale()
  const log = stageFixture('e2e-leveling.log')
  const userData = makeUserData()
  try { await runSession(log, userData, false); await runSession(log, userData, true) }
  finally { await log.dispose(); await removeUserData(userData) }
  reportRun()
}
main().catch((error: unknown) => { console.error(error); process.exitCode = 1 })
