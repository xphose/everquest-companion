/** Real journal IPC/UI over a recorded level-7 log and controlled location-worker observations.
 * Only this staged install's worker reads are intercepted; journal queries and polling stay real.
 * No Maps visit or Refresh click is used. Run: npm run test:e2e -- quest-journal-level */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ElectronApplication, Page } from 'playwright-core'
import type { EqApi } from '../../src/preload/index'
import { buildIfStale, check, dumpArtifacts, failures, reportRun, ROOT, settle } from './appHarness.mjs'
import { mainWindow, makeUserData, removeUserData } from './appWindow.mjs'
import { launchOnFixture, stageFixture, type FixtureLog } from './logFixture.mjs'

type Mode = 'live' | 'unavailable' | 'mismatch' | 'stale'
interface Observation { mode: Mode; level: number; reads: number }
interface MainFixture { journalLevelFixture: Observation }
const LEVEL = '[data-testid="quest-journal-level"]'

async function controlWorker(app: ElectronApplication, root: string): Promise<void> {
  await app.evaluate((_electron, stagedRoot) => {
    const { Worker } = process.getBuiltinModule('node:worker_threads') as typeof import('node:worker_threads')
    const state = globalThis as unknown as MainFixture
    state.journalLevelFixture = { mode: 'unavailable', level: 10, reads: 0 }
    const original = Worker.prototype.postMessage
    Worker.prototype.postMessage = function (value, ...transfer) {
      const request = value as { type?: string; id?: number; root?: string }
      if (request?.type !== 'read' || request.root !== stagedRoot || typeof request.id !== 'number') {
        return original.call(this, value, ...transfer)
      }
      const observed = state.journalLevelFixture
      observed.reads++
      const result = observed.mode === 'unavailable' ? { state: 'unavailable', reason: 'Staged observation unavailable.' } : {
        state: 'live', location: {
          characterName: observed.mode === 'mismatch' ? 'OtherCharacter' : 'Primitive', zone: 'qeynos2',
          level: observed.level, ns: 100, ew: 200, z: 3, heading: 0,
          sampledAt: Date.now() - (observed.mode === 'stale' ? 60_000 : 0)
        }
      }
      queueMicrotask(() => this.emit('message', { id: request.id, result }))
    }
  }, root)
}

function publish(app: ElectronApplication, level: number, mode: Mode = 'live'): Promise<void> {
  return app.evaluate((_electron, observed) => {
    (globalThis as unknown as MainFixture).journalLevelFixture = { ...observed, reads: 0 }
  }, { level, mode })
}

async function expectLevel(page: Page, level: number, source: 'live' | 'log' | 'manual', label: string): Promise<void> {
  const expected = `Level ${level}|${source}`
  const found = await settle(async () => {
    const chip = page.locator(LEVEL)
    return `${await chip.innerText()}|${await chip.getAttribute('data-source')}`
  }, (value) => value === expected, { timeoutMs: 20_000 })
  if (!check(label, found === expected, found)) throw new Error(`Expected ${expected}`)
}

async function automaticLevels(app: ElectronApplication, page: Page): Promise<void> {
  await page.evaluate(() => localStorage.setItem('eq.maps.live', '0'))
  await page.waitForSelector('[data-testid="nav-questJournal"]', { timeout: 30_000 })
  const notice = page.locator('[data-testid="telemetry-notice-off"]')
  if (await notice.count()) await notice.click()
  await page.click('[data-testid="nav-questJournal"]')
  await page.waitForSelector(LEVEL, { timeout: 30_000 })
  await expectLevel(page, 7, 'log', 'unavailable live data initially shows the recorded level')
  await publish(app, 10)
  await expectLevel(page, 10, 'live', 'live level replaces history automatically without visiting Maps')
  await page.click('[data-testid="quest-journal-profile-toggle"]')
  await page.getByLabel('Classes, separated by commas', { exact: true }).fill('Wizard')
  await page.getByRole('button', { name: 'Save correction', exact: true }).click()
  const corrected = await settle(() => page.evaluate(() =>
    (window as unknown as { eq: Pick<EqApi, 'questJournalQuery'> }).eq.questJournalQuery({ limit: 1 })),
  (result) => result.context.classes.join(', ') === 'Wizard')
  check('class-only correction leaves the level automatic', corrected.context.levelSource === 'live')
  await publish(app, 11)
  await expectLevel(page, 11, 'live', 'the next automatic poll raises the level after a class-only correction')
  await publish(app, 9)
  await expectLevel(page, 9, 'live', 'a lower current class level replaces the earlier higher level')
  check('journal level detection runs while live Maps tracking is disabled',
    await page.evaluate(() => localStorage.getItem('eq.maps.live')) === '0')
}

async function manualOverride(app: ElectronApplication, page: Page): Promise<void> {
  await page.getByLabel('Character level', { exact: true }).fill('42')
  await page.getByRole('button', { name: 'Save correction', exact: true }).click()
  await expectLevel(page, 42, 'manual', 'an explicit saved level overrides live observations')
  await publish(app, 12)
  await settle(() => app.evaluate(() => (globalThis as unknown as MainFixture).journalLevelFixture.reads),
    (reads) => reads > 0, { timeoutMs: 20_000 })
  await expectLevel(page, 42, 'manual', 'a later live observation preserves the explicit level correction')
  await page.getByRole('button', { name: 'Use detected profile', exact: true }).click()
  await expectLevel(page, 12, 'live', 'Use detected profile restores the current live level')
}

async function invalidSamples(app: ElectronApplication, page: Page): Promise<void> {
  for (const mode of ['unavailable', 'mismatch', 'stale'] as const) {
    await publish(app, 10)
    await expectLevel(page, 10, 'live', `live observation is available before ${mode} sample`)
    await publish(app, 99, mode)
    await expectLevel(page, 7, 'log', `${mode} sample falls back to history without displaying an invalid level`)
  }
}

async function session(log: FixtureLog, userData: string): Promise<void> {
  const launched = await launchOnFixture(log, { userData })
  let page: Page | null = null
  try {
    await controlWorker(launched.app, log.installDir)
    page = await mainWindow(launched.app)
    await automaticLevels(launched.app, page)
    await manualOverride(launched.app, page)
    await invalidSamples(launched.app, page)
    if (failures.length) await dumpArtifacts(page, 'journal-level-FAIL')
  } catch (cause) {
    if (page) await dumpArtifacts(page, 'journal-level-ERROR')
    throw cause
  } finally { await launched.close() }
}

async function main(): Promise<void> {
  buildIfStale()
  const log = stageFixture('cw1-who-anchored.log')
  const userData = makeUserData()
  try {
    // Keep the recorded warmup through its first /who; no level-5 row is committed.
    const recorded = readFileSync(join(ROOT, 'tests/fixtures/cw1-who-anchored.log'), 'utf8').split(/\r?\n/u)
    const stated = recorded.findIndex((line) => line.includes('[7 CLR/BER] Primitive'))
    if (stated < 0) throw new Error('The recorded historical-level fixture is missing')
    writeFileSync(log.logPath, `${recorded.slice(0, stated + 1).join('\n')}\n`)
    await session(log, userData)
  } finally { await log.dispose(); await removeUserData(userData) }
  reportRun()
}

main().catch((cause: unknown) => { console.error(cause); process.exitCode = 1 })
