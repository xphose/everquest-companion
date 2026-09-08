/** Class evidence and correction drafts through the real engine, journal IPC, and visible UI.
 * The initial casts and later /who messages are committed game samples, replayed only into a
 * staged log. Run: npm run test:e2e -- quest-journal-classes */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from 'playwright-core'
import type { EqApi } from '../../src/preload/index'
import { buildIfStale, check, dumpArtifacts, failures, reportRun, ROOT, settle } from './appHarness.mjs'
import { mainWindow, makeUserData, removeUserData } from './appWindow.mjs'
import { launchOnFixture, stageFixture, type FixtureLog } from './logFixture.mjs'

const CONTEXT = '[data-testid="quest-journal-context"]'
type Bridge = Pick<EqApi, 'questJournalQuery'>
const query = (page: Page) => page.evaluate(() => (window as unknown as { eq: Bridge }).eq.questJournalQuery({ limit: 1 }))
const header = (page: Page) => page.locator(`${CONTEXT} > div`).first().innerText()

function whoMessage(classes: string): string {
  const lines = readFileSync(join(ROOT, 'tests', 'fixtures', 'cw7-who-swap-boundary-aug12.log'), 'utf8').split(/\r?\n/u)
  const line = lines.find((value) => value.includes(` ${classes}] Primitive `))
  if (!line) throw new Error(`Missing committed /who sample for ${classes}`)
  return line.replace(/^\[[^\]]+\] /u, '')
}

async function initialDetection(page: Page): Promise<void> {
  const initial = await query(page)
  check('gameplay evidence populates journal classes without a manual profile or /who',
    initial.context.profileSource === 'detected' && initial.context.classes.includes('Paladin') &&
    initial.context.inferredClasses?.includes('Paladin') === true, JSON.stringify(initial.context))
  await page.waitForSelector('[data-testid="nav-questJournal"]', { timeout: 30_000 })
  const notice = page.locator('[data-testid="telemetry-notice-off"]')
  if (await notice.count()) await notice.click()
  await page.click('[data-testid="nav-questJournal"]')
  await page.waitForSelector(CONTEXT, { timeout: 30_000 })
  check('the detected class is visibly labeled inferred', (await header(page)).includes('Paladin · inferred'))
  await page.click('[data-testid="quest-journal-profile-toggle"]')
}

async function cleanFields(page: Page, log: FixtureLog): Promise<void> {
  log.append(whoMessage('PAL/MNK/ENC'))
  const classes = page.getByLabel('Classes, separated by commas', { exact: true })
  const observed = await settle(() => classes.inputValue(), (value) => value.includes('Monk'), { timeoutMs: 30_000 })
  check('untouched correction fields follow newly stated classes without reopening the journal', observed === 'Paladin, Monk, Enchanter')
  check('a who statement removes the inferred label from the visible classes', !(await header(page)).includes('inferred'))
  check('an untouched level field follows the same who statement', await page.getByLabel('Character level', { exact: true }).inputValue() === '50')
}

async function dirtyFields(page: Page, log: FixtureLog): Promise<void> {
  const classes = page.getByLabel('Classes, separated by commas', { exact: true })
  const level = page.getByLabel('Character level', { exact: true })
  await classes.fill('Wizard')
  await level.fill('42')
  // Later log timestamps preserve /who ordering even if the test machine finishes in one second.
  log.appendAt(new Date(Date.now() + 1000), whoMessage('PAL/RNG/SHM'))
  const updated = await settle(() => header(page), (value) => value.includes('Ranger'), { timeoutMs: 30_000 })
  check('the live class header updates while a correction is being edited', updated.includes('Shaman'))
  check('background observations preserve both typed corrections', await classes.inputValue() === 'Wizard' && await level.inputValue() === '42')
  await page.getByRole('button', { name: 'Save correction', exact: true }).click()
  const saved = await settle(() => query(page), (value) => value.context.profileSource === 'manual', { timeoutMs: 15_000 })
  check('saving retains the actual typed correction', saved.context.classes.join(', ') === 'Wizard' && saved.context.level === 42 && saved.context.inferredClasses?.length === 0)
  await page.getByRole('button', { name: 'Use detected profile', exact: true }).click()
  const reset = await settle(() => classes.inputValue(), (value) => value.includes('Ranger'), { timeoutMs: 15_000 })
  check('returning to detection clears drafts and restores current observed classes and level',
    reset === 'Paladin, Ranger, Shaman' && await level.inputValue() === '10')
}

async function session(log: FixtureLog, userData: string): Promise<void> {
  const launched = await launchOnFixture(log, { userData })
  let page: Page | null = null
  try {
    page = await mainWindow(launched.app)
    await initialDetection(page)
    await cleanFields(page, log)
    await dirtyFields(page, log)
    if (failures.length) await dumpArtifacts(page, 'journal-classes-FAIL')
  } catch (cause) {
    if (page) await dumpArtifacts(page, 'journal-classes-ERROR')
    throw cause
  } finally { await launched.close() }
}

async function main(): Promise<void> {
  buildIfStale()
  // This inference fixture spans two hourly evidence buckets; a short combat fixture cannot
  // clear the engine's intentional stray-cast admission rule.
  const log = stageFixture('cw4-stray-cast.log')
  const userData = makeUserData()
  try { await session(log, userData) }
  finally { await log.dispose(); await removeUserData(userData) }
  reportRun()
}

main().catch((cause: unknown) => { console.error(cause); process.exitCode = 1 })
