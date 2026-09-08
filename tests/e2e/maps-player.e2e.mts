/** Drive the real IPC/preload/map path with deterministic memory observations. Native reads
 * and client fingerprint checks have their own injected-byte tests and a live Windows probe. */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ElectronApplication, Page } from 'playwright-core'
import type { EqApi } from '../../src/preload/index'
import type { PlayerLocation, PlayerLocationResult } from '../../src/shared/playerLocation'
import { buildIfStale, check, dumpArtifacts, failures, reportRun, settle, settleGone, waitHydrated } from './appHarness.mjs'
import { mainWindow } from './appWindow.mjs'
import { launchOnFixture, stageFixture } from './logFixture.mjs'

const MARKER = '[data-testid="maps-player-marker"]'
const ZONE = '[data-testid="maps-zone-chip"]'
const initial: PlayerLocation = { characterName: 'Primitive', zone: 'oasis', ns: 613, ew: 51, z: 0, heading: 0, sampledAt: 0 }

async function publish(app: ElectronApplication, observation: PlayerLocationResult, fresh = true): Promise<void> {
  await app.evaluate(({ ipcMain }, data) => {
    ipcMain.removeHandler('maps:playerLocation')
    ipcMain.handle('maps:playerLocation', () => data.observation.state === 'live' && data.fresh
      ? { ...data.observation, location: { ...data.observation.location, sampledAt: Date.now() } }
      : data.observation)
  }, { observation, fresh })
}

async function reading(page: Page): Promise<string | null> { return page.locator(MARKER).getAttribute('data-loc').catch(() => null) }
async function zone(page: Page): Promise<string> { return page.locator(ZONE).textContent().then((v) => v ?? '').catch(() => '') }

async function waitZone(page: Page, wanted: string): Promise<void> {
  check(`automatically follows ${wanted}`, await settle(() => zone(page), (value) => value === wanted) === wanted)
  await page.waitForSelector(MARKER)
  check('player marker belongs to the drawn map', await page.locator(MARKER).getAttribute('data-zone') === wanted)
}

async function movement(app: ElectronApplication, page: Page): Promise<void> {
  await waitZone(page, 'oasis')
  await page.getByRole('checkbox', { name: 'Keep centered', exact: true }).uncheck()
  const before = await page.locator(MARKER).boundingBox()
  await publish(app, { state: 'live', location: { ...initial, ns: 700, ew: 120 } })
  check('position changes without typing /loc', await settle(() => reading(page), (value) => value === '700, 120, 0') === '700, 120, 0')
  const after = await page.locator(MARKER).boundingBox()
  check('north and west move up and left on the map', Boolean(before && after && after.x < before.x && after.y < before.y))
  await publish(app, { state: 'live', location: { ...initial, zone: 'akanon', ns: 200, ew: 100 } })
  await waitZone(page, 'akanon')
  const saved = await page.evaluate(() => localStorage.getItem('eq.maps.loc'))
  check('live positions are never persisted as saved markers', saved === null || saved === '{}')
}

async function pinAndFollow(app: ElectronApplication, page: Page): Promise<void> {
  await page.locator('[data-testid="maps-zone-filter"]').fill('Oasis')
  await page.locator('[data-testid="maps-zone-row"]').filter({ hasText: 'oasis' }).click()
  check('a manual map remains pinned', await settle(() => zone(page), (value) => value === 'oasis') === 'oasis')
  await settleGone(page, MARKER)
  check('another zone never receives the player dot', await page.locator(MARKER).count() === 0)
  await page.locator('[data-testid="maps-center-player"]').click()
  await waitZone(page, 'akanon')
  await publish(app, { state: 'live', location: { ...initial, zone: 'oasis' } })
  await waitZone(page, 'oasis')
}

async function centering(app: ElectronApplication, page: Page): Promise<void> {
  await publish(app, { state: 'live', location: { ...initial, ns: 0, ew: 0 } })
  await settle(() => reading(page), (value) => value === '0, 0, 0')
  await page.locator('[data-testid="maps-loc-input"]').fill('600, 600, 0')
  await page.locator('[data-testid="maps-loc-input"]').press('Enter')
  await page.waitForSelector('[data-testid="maps-loc-marker"]', { state: 'attached' })
  check('a saved-location jump releases player centering', !(await page.getByRole('checkbox', { name: 'Keep centered', exact: true }).isChecked()))
  await page.locator('[data-testid="maps-center-player"]').click()
  const centered = await settle(async () => {
    const [marker, surface] = await Promise.all([page.locator(MARKER).boundingBox(), page.locator('[data-testid="maps-surface"]').boundingBox()])
    return Boolean(marker && surface && Math.abs(marker.x + marker.width / 2 - surface.x - surface.width / 2) < 3 &&
      Math.abs(marker.y + marker.height / 2 - surface.y - surface.height / 2) < 3)
  }, (value) => value)
  check('Center on me centers the stationary player', centered)
  check('live and saved markers remain independent', await page.locator('[data-testid="maps-loc-marker"]').getAttribute('data-loc') === '600, 600, 0')
}

async function availability(app: ElectronApplication, page: Page): Promise<void> {
  await publish(app, { state: 'live', location: { ...initial, sampledAt: Date.now() - 10000 } }, false)
  await settleGone(page, MARKER)
  check('a stalled reader cannot keep a live-looking position', await page.locator(MARKER).count() === 0)
  await publish(app, { state: 'unavailable', reason: 'Game exited.' })
  check('loss of the game is visible', await settle(() => page.locator('[data-testid="maps-live-status"]').textContent(), (v) => v === 'Game exited.') === 'Game exited.')
  await publish(app, { state: 'live', location: initial })
  await page.waitForSelector(MARKER)
  await publish(app, { state: 'live', location: { ...initial, characterName: 'SomeoneElse' } })
  await settleGone(page, MARKER)
  check('another character does not receive the player marker', await page.locator(MARKER).count() === 0)
  await publish(app, { state: 'live', location: initial })
  await page.waitForSelector(MARKER)
  await page.getByRole('checkbox', { name: 'Live location', exact: true }).uncheck()
  await settleGone(page, MARKER)
  await page.locator('[data-testid="nav-loot"]').click()
  await settleGone(page, '[data-testid="maps-live-controls"]')
  await page.locator('[data-testid="nav-maps"]').click()
  check('turning live location off survives a tab remount', !(await page.getByRole('checkbox', { name: 'Live location', exact: true }).isChecked()))
  check('saved manual location controls remain available', await page.locator('[data-testid="maps-loc-input"]').count() === 1)
}

async function main(): Promise<void> {
  buildIfStale()
  const log = stageFixture('e2e-maps.log')
  mkdirSync(join(log.installDir, 'maps'))
  const geometry = 'L -1200,-1200,0,1200,-1200,0,0,0,0\nL 1200,-1200,0,1200,1200,0,0,0,0\nL 1200,1200,0,-1200,1200,0,0,0,0\nL -1200,1200,0,-1200,-1200,0,0,0,0\nP -51,-613,0,255,0,0,2,Transan\n'
  for (const stem of ['oasis', 'akanon']) writeFileSync(join(log.installDir, 'maps', `${stem}.txt`), geometry)
  const launched = await launchOnFixture(log)
  let page: Page | undefined
  try {
    page = await mainWindow(launched.app)
    await page.waitForSelector('[data-testid="nav-maps"]', { timeout: 60000 })
    await waitHydrated(page)
    const isolated = await page.evaluate(async () => (window as unknown as { eq: EqApi }).eq.getPlayerLocation())
    check('staged install never reads a different installed game', isolated.state !== 'live')
    await publish(launched.app, { state: 'live', location: initial })
    await page.locator('[data-testid="nav-maps"]').click()
    await movement(launched.app, page)
    await pinAndFollow(launched.app, page)
    await centering(launched.app, page)
    await availability(launched.app, page)
    if (failures.length) await dumpArtifacts(page, 'maps-player-FAIL')
  } catch (error) {
    if (page) await dumpArtifacts(page, 'maps-player-FAIL')
    throw error
  } finally { await launched.close(); await log.dispose() }
  reportRun()
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1 })
