/** Game lifecycle through real IPC/native-worker boundary, with no game, tab changes or log activity. */
import { writeFileSync } from 'node:fs'
import type { ElectronApplication, Page } from 'playwright-core'
import type { PlayerLocationResult } from '../../src/shared/playerLocation'
import { buildIfStale, check, reportRun, settle } from './appHarness.mjs'
import { mainWindow } from './appWindow.mjs'
import { launchOnFixture, stageFixture } from './logFixture.mjs'

interface Observation { state: PlayerLocationResult['state']; age?: number; characterName?: string }
interface MainFixture { gameObservation: Observation; gameReads: number }
interface PageFixture { gameBadgeNode: Element | null; gameBarNode: Element | null }
const BADGE = '[data-testid="game-connection"]'

async function control(app: ElectronApplication, root: string): Promise<void> {
  await app.evaluate((_electron, stagedRoot) => {
    const { Worker } = process.getBuiltinModule('node:worker_threads') as typeof import('node:worker_threads')
    const fixture = globalThis as unknown as MainFixture
    fixture.gameReads = 0
    fixture.gameObservation = { state: 'not-running' }
    const original = Worker.prototype.postMessage
    Worker.prototype.postMessage = function (value, ...transfer) {
      const request = value as { type?: string; id?: number; root?: string }
      if (request?.type !== 'read' || request.root !== stagedRoot || typeof request.id !== 'number') return original.call(this, value, ...transfer)
      fixture.gameReads++
      const observation = fixture.gameObservation
      const result = observation.state === 'live'
        ? { state: 'live', location: { characterName: observation.characterName ?? 'Primitive', zone: 'qeynos2',
          ns: 1, ew: 2, z: 3, heading: 0, sampledAt: Date.now() - (observation.age ?? 0) } }
        : { state: observation.state, reason: 'Synthetic game observation.' }
      queueMicrotask(() => this.emit('message', { id: request.id, result }))
    }
  }, root)
}

async function observe(app: ElectronApplication, page: Page, observation: Observation, expected: readonly [string, string]): Promise<void> {
  const [wanted, label] = expected
  await app.evaluate((_electron, value) => { (globalThis as unknown as MainFixture).gameObservation = value }, observation)
  const state = await settle(() => page.locator(BADGE).getAttribute('data-state'), value => value === wanted, { timeoutMs: 10_000 })
  check(`automatically shows ${label}`, state === wanted && await page.locator(BADGE).getAttribute('aria-label') === label)
}

async function stableNodes(page: Page): Promise<void> {
  const stable = await page.evaluate(() => {
    const fixture = window as unknown as PageFixture
    return fixture.gameBadgeNode === document.querySelector('[data-testid="game-connection"]') &&
      fixture.gameBarNode === document.querySelector('[data-testid="title-bar"]')
  })
  check('lifecycle updates preserve the badge and title-bar DOM nodes', stable)
}

async function minimumWidth(app: ElectronApplication, page: Page): Promise<void> {
  const main = await app.browserWindow(page)
  await main.evaluate(win => win.setSize(900, 600))
  const width = await settle(() => page.evaluate(() => window.innerWidth), value => value >= 850 && value <= 900, { timeoutMs: 10_000 })
  check('minimum window size is measured in the actual renderer', width >= 850 && width <= 900, String(width))
  check('game status and window controls fit at the app minimum width', await titleBarFits(page))
  await page.evaluate(() => (window as unknown as { eq: { setPerfHudEnabled(enabled: boolean): Promise<unknown> } }).eq.setPerfHudEnabled(true))
  await page.locator('[data-testid="perf-chip"]').waitFor({ state: 'visible', timeout: 15_000 })
  check('status and controls still fit with the optional performance HUD enabled', await titleBarFits(page))
}

async function titleBarFits(page: Page): Promise<boolean> {
  return page.locator('[data-testid="title-bar"]').evaluate(bar => {
    const bounds = bar.getBoundingClientRect()
    return Array.from(bar.children).every(child => {
      const box = child.getBoundingClientRect()
      return box.left >= bounds.left && box.right <= bounds.right + 1
    }) && bar.scrollWidth <= bar.clientWidth
  })
}

async function verify(app: ElectronApplication, page: Page): Promise<void> {
  await observe(app, page, { state: 'not-running' }, ['closed', 'Game closed'])
  await page.evaluate(() => {
    const fixture = window as unknown as PageFixture
    fixture.gameBadgeNode = document.querySelector('[data-testid="game-connection"]')
    fixture.gameBarNode = document.querySelector('[data-testid="title-bar"]')
  })
  await observe(app, page, { state: 'not-in-world' }, ['waiting', 'Game running'])
  await observe(app, page, { state: 'live' }, ['connected', 'In game'])
  await observe(app, page, { state: 'not-in-world' }, ['waiting', 'Game running'])
  await observe(app, page, { state: 'not-running' }, ['closed', 'Game closed'])
  await observe(app, page, { state: 'live' }, ['connected', 'In game'])
  for (const age of [5000, -5000]) await observe(app, page, { state: 'live', age }, ['unknown', 'Game status unknown'])
  // Main rejects a different character before serving it over IPC; the badge must preserve that guard.
  await observe(app, page, { state: 'live', characterName: 'Otherhero' }, ['unknown', 'Game status unknown'])
  const guard = await settle(() => page.locator(BADGE).getAttribute('title'), value => value?.includes('Select the character currently playing') === true)
  check('main character guard remains authoritative', guard?.includes('Select the character currently playing') === true)
  await observe(app, page, { state: 'unavailable' }, ['unknown', 'Game status unknown'])
  await observe(app, page, { state: 'ambiguous' }, ['ambiguous', 'Multiple games found'])
  await observe(app, page, { state: 'unsupported' }, ['unsupported', 'Live read unsupported'])
  await minimumWidth(app, page)
  await observe(app, page, { state: 'live' }, ['connected', 'In game'])
  await stableNodes(page)
  const detail = await page.locator(BADGE).getAttribute('title') ?? ''
  check('status explains dependencies, offline browsing and full-exit macro installation',
    detail.includes('classes, level, buffs') && detail.includes('Offline browsing') && detail.includes('fully exits'))
  check('automatic reader remained active away from live-feature tabs',
    await app.evaluate(() => (globalThis as unknown as MainFixture).gameReads) >= 10)
}

async function main(): Promise<void> {
  buildIfStale()
  const log = stageFixture('cw7-who-swap-boundary-aug12.log')
  writeFileSync(log.logPath, '[Tue Sep 08 10:00:00 2026] [10 MAG/SHM] Primitive (Human)  ZONE: North Qeynos (qeynos2)\n')
  const launched = await launchOnFixture(log)
  try { await control(launched.app, log.installDir); await verify(launched.app, await mainWindow(launched.app)) }
  finally { await launched.close(); await log.dispose() }
  reportRun()
}
main().catch((error: unknown) => { console.error(error); process.exitCode = 1 })
