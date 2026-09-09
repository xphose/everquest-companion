/** Real catalog + native profile + inventory watcher + routing, in an isolated synthetic install. */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ElectronApplication, Page } from 'playwright-core'
import type { ClassAbbr } from '../../src/shared/classCombo'
import { ZONES } from '../../src/shared/zones'
import { IPC } from '../../src/shared/ipc'
import { buildIfStale, check, dumpArtifacts, failures, reportRun, settle } from './appHarness.mjs'
import { mainWindow } from './appWindow.mjs'
import { launchOnFixture, stageFixture, type FixtureLog } from './logFixture.mjs'
import { gearProgressionJourney, gearProgressionInventory, gearProgressionLayout } from './gearProgressionSteps.mjs'

interface Reading { classes: ClassAbbr[]; level: number; mismatch: boolean; stale: boolean }
interface MainFixture { gearProgressionReading: Reading }
const DEFAULT: Reading = { classes: ['MAG', 'SHM'], level: 10, mismatch: false, stale: false }

async function control(app: ElectronApplication, root: string): Promise<void> {
  await app.evaluate((_electron, stagedRoot) => {
    const { Worker } = process.getBuiltinModule('node:worker_threads') as typeof import('node:worker_threads')
    const fixture = globalThis as unknown as MainFixture
    fixture.gearProgressionReading = { classes: ['MAG', 'SHM'], level: 10, mismatch: false, stale: false }
    const original = Worker.prototype.postMessage
    Worker.prototype.postMessage = function (value, ...transfer) {
      const request = value as { type?: string; id?: number; root?: string }
      if (request?.type !== 'read' || request.root !== stagedRoot || typeof request.id !== 'number') return original.call(this, value, ...transfer)
      const reading = fixture.gearProgressionReading
      const result = { state: 'live', location: { classes: reading.classes, level: reading.level,
        characterName: reading.mismatch ? 'Otherhero' : 'Primitive', zone: 'qeynos2', ns: 1, ew: 2, z: 3,
        heading: 0, sampledAt: Date.now() - (reading.stale ? 60_000 : 0) } }
      queueMicrotask(() => this.emit('message', { id: request.id, result }))
    }
  }, root)
}

async function publish(app: ElectronApplication, over: Partial<Reading>): Promise<void> {
  await app.evaluate((_electron, value) => { Object.assign((globalThis as unknown as MainFixture).gearProgressionReading, value) }, over)
}

async function profile(app: ElectronApplication, page: Page): Promise<void> {
  await page.locator('[data-testid="nav-gear"]').click()
  await page.locator('[data-testid="tab-gear"]').click()
  await page.locator('[data-testid="gear-next-upgrade"]').waitFor({ timeout: 30_000 })
  check('Gear opens on Recommended with real catalog advice', await page.locator('[data-testid="gear-section-recommended"]').getAttribute('aria-selected') === 'true')
  const classes = page.locator('[data-testid="gear-character-classes"]')
  await settle(() => classes.innerText(), text => text.includes('Magician') && text.includes('Shaman'))
  check('detected classes and exact current level are visible', (await classes.innerText()).includes('Magician') && (await page.locator('[data-testid="gear-current-band"]').innerText()).includes('exact level 10'))
  check('missing equipment is explained, never treated as owning nothing', await page.locator('[data-testid="gear-inventory-missing"]').count() === 1)
  await publish(app, { classes: ['MAG', 'SHM', 'ENC'], level: 11 })
  const changed = await settle(() => classes.innerText(), text => text.includes('Enchanter'), { timeoutMs: 15_000 })
  check('new classes appear automatically without leaving Gear', changed.includes('Enchanter'))
  check('a live level-up advances the exact level and five-level range', (await page.locator('[data-testid="gear-current-band"]').innerText()).includes('11 - 15'))
  await publish(app, { classes: ['WAR'], level: 45, mismatch: true })
  const fallback = await settle(() => page.locator('[data-testid="gear-character-source"]').innerText(), text => text === 'From your log', { timeoutMs: 15_000 })
  check('another character cannot replace the current profile', fallback === 'From your log' && !(await classes.innerText()).includes('Warrior'), `${fallback}: ${await classes.innerText()}`)
  await publish(app, { ...DEFAULT, stale: true })
  check('stale memory falls back to log evidence', await settle(() => page.locator('[data-testid="gear-character-source"]').innerText(), text => text === 'From your log') === 'From your log')
  await publish(app, DEFAULT)
  await settle(() => page.locator('[data-testid="gear-character-source"]').innerText(), text => text === 'Live character', { timeoutMs: 15_000 })
}

function stage(): FixtureLog {
  const log = stageFixture('cw7-who-swap-boundary-aug12.log')
  mkdirSync(join(log.installDir, 'maps'))
  const geometry = 'L -3000,-3000,0,3000,-3000,0,0,0,0\nL 3000,-3000,0,3000,3000,0,0,0,0\nL 3000,3000,0,-3000,3000,0,0,0,0\nL -3000,3000,0,-3000,-3000,0,0,0,0\n'
  for (const zone of ZONES) writeFileSync(join(log.installDir, 'maps', `${zone.short}.txt`), geometry)
  return log
}

async function main(): Promise<void> {
  buildIfStale()
  const log = stage()
  const launched = await launchOnFixture(log)
  let page: Page | undefined
  try {
    await control(launched.app, log.installDir)
    page = await mainWindow(launched.app)
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.locator('[data-testid="nav-gear"]').waitFor({ timeout: 60_000 })
    const notice = page.locator('[data-testid="telemetry-notice-off"]')
    if (await notice.count()) await notice.click()
    await profile(launched.app, page)
    await gearProgressionJourney(page)
    await gearProgressionInventory(page, log)
    await gearProgressionLayout(launched.app, page)
    await unavailableContext(launched.app, page)
    check('Gear progression emits no renderer runtime errors', errors.length === 0, errors.join('\n'))
    if (failures.length) await dumpArtifacts(page, 'gear-progression-FAIL')
  } catch (error) { if (page) await dumpArtifacts(page, 'gear-progression-ERROR'); throw error }
  finally { await launched.close(); await log.dispose() }
  reportRun()
}

/** A failed read must not lock a user out of the static item browser. The staged app exits next. */
async function unavailableContext(app: ElectronApplication, page: Page): Promise<void> {
  await app.evaluate(({ ipcMain }, channel) => {
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, () => { throw new Error('Synthetic unavailable context') })
  }, IPC.gearProgressionContext)
  await page.locator('[data-testid="gear-context-waiting"]').waitFor({ timeout: 10_000 })
  await page.locator('[data-testid="gear-section-browse"]').click()
  await page.locator('[data-testid="gear-search"] input').fill('cloth cap')
  check('Browse all stays usable when automatic character reading fails', await settle(() => page.locator('[data-testid="gear-row"]').count(), count => count > 0) > 0)
}
main().catch((error: unknown) => { console.error(error); process.exitCode = 1 })
