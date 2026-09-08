/** Synthetic geometry with exact installed exit-label text, through real map IPC and renderer. */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ElectronApplication, Page } from 'playwright-core'
import { buildIfStale, check, dumpArtifacts, failures, reportRun, settle, waitHydrated } from './appHarness.mjs'
import { mainWindow } from './appWindow.mjs'
import { launchOnFixture, stageFixture } from './logFixture.mjs'

const CHIP = '[data-testid="maps-zone-chip"]'
const LABEL = '[data-testid="map-point"]'
const DOT = '[data-testid="map-point-dot"]'
const geometry = 'L -1000,-1000,0,1000,-1000,0,0,0,0\nL 1000,-1000,0,1000,1000,0,0,0,0\nL 1000,1000,0,-1000,1000,0,0,0,0\nL -1000,1000,0,-1000,-1000,0,0,0,0\n'
const point = (label: string, x = 0) => `P ${x},0,0,150,0,200,3,${label}\n`

async function publish(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ ipcMain }) => {
    const state = globalThis as typeof globalThis & { mapZoneLinkPolls?: number }
    state.mapZoneLinkPolls = 0
    ipcMain.removeHandler('maps:playerLocation')
    ipcMain.handle('maps:playerLocation', () => {
      state.mapZoneLinkPolls = (state.mapZoneLinkPolls ?? 0) + 1
      return { state: 'live', location: { characterName: 'Primitive', zone: 'steamfont', ns: 0, ew: 0,
        z: 0, heading: 0, sampledAt: Date.now() } }
    })
  })
}

async function pollCount(app: ElectronApplication): Promise<number> {
  return app.evaluate(() => (globalThis as typeof globalThis & { mapZoneLinkPolls?: number }).mapZoneLinkPolls ?? 0)
}

async function expectZone(page: Page, zone: string, name: string): Promise<void> {
  check(`displayed map is ${zone}`, await settle(() => page.locator(CHIP).textContent(), text => text === zone) === zone)
  check(`zone picker states ${name}`, await settle(() => page.locator('[data-testid="maps-zone-filter"]').inputValue(), value => value === name) === name)
  await page.locator('[data-testid="maps-surface"]').waitFor()
}

async function dragDoesNotOpen(page: Page): Promise<void> {
  const label = page.locator(`${LABEL}[data-map-link="akanon"]`)
  const box = await label.boundingBox()
  if (!box) throw new Error('Expected visible Ak\'Anon exit label')
  const x = box.x + box.width / 2, y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + 55, y + 25, { steps: 5 })
  await page.mouse.move(x, y, { steps: 5 })
  await page.mouse.up()
  check('dragging away and back across an exit label never opens its map', await page.locator(CHIP).textContent() === 'steamfont')
  check('dragging releases automatic centering', !(await page.getByRole('checkbox', { name: 'Keep centered', exact: true }).isChecked()))
}

async function followLinks(app: ElectronApplication, page: Page): Promise<void> {
  const label = page.locator(`${LABEL}[data-map-link="akanon"]`)
  check('purple exit keeps its original text, color and clickable cursor', await label.evaluate(element =>
    element.textContent === "to Ak'Anon" && getComputedStyle(element).color === 'rgb(150, 0, 200)' && getComputedStyle(element).cursor === 'pointer'))
  check('exit tooltip names its destination', await label.getAttribute('title') === "Open Ak'Anon map")
  await label.click()
  await expectZone(page, 'akanon', "Ak'Anon")
  check('opened destination actually draws its return link', await page.locator(`${LABEL}[data-map-link="steamfont"]`).count() === 1)
  const before = await pollCount(app)
  check('live location has polled again', await settle(() => pollCount(app), count => count >= before + 2) >= before + 2)
  check('manual map stays pinned across native polls', await page.locator(CHIP).textContent() === 'akanon' &&
    await page.locator('[data-testid="maps-zone-mode"]').getAttribute('data-mode') === 'pinned')
  const back = page.locator(`${LABEL}[data-map-link="steamfont"]`)
  await back.focus()
  await back.press('Enter')
  await expectZone(page, 'steamfont', 'Steamfont Mountains')
}

async function dotAndReturn(page: Page): Promise<void> {
  // Nearby labels intentionally force the second exit into its existing decluttered dot.
  const dot = page.locator(`${DOT}[data-map-link="lfaydark"]`)
  await dot.waitFor()
  await dot.focus()
  check('a keyboard-focused exit dot reveals the full label', await page.locator(`${LABEL}[data-map-link="lfaydark"]`).count() === 1)
  await dot.press(' ')
  await expectZone(page, 'lfaydark', 'The Lesser Faydark')
  await page.locator(`${LABEL}[data-map-link="steamfont"]`).click()
  await expectZone(page, 'steamfont', 'Steamfont Mountains')
  await dot.click({ position: { x: 6, y: 11 } })
  await expectZone(page, 'lfaydark', 'The Lesser Faydark')
  await page.locator(`${LABEL}[data-map-link="steamfont"]`).press(' ')
  await expectZone(page, 'steamfont', 'Steamfont Mountains')
  await dot.focus()
  await page.locator(`${LABEL}[data-map-link="lfaydark"]`).click()
  await expectZone(page, 'lfaydark', 'The Lesser Faydark')
  await page.locator(`${LABEL}[data-map-link="steamfont"]`).click()
  await expectZone(page, 'steamfont', 'Steamfont Mountains')
  const plain = page.locator(LABEL).filter({ hasText: "Ak'Anon Bank" })
  check('ordinary and unavailable labels have no navigation role', await plain.getAttribute('role') === null &&
    await page.locator(LABEL).filter({ hasText: 'to North Freeport' }).getAttribute('role') === null)
  await plain.click()
  check('ordinary map labels do not change the map', await page.locator(CHIP).textContent() === 'steamfont')
  await page.locator(`${LABEL}[data-map-link="akanon"]`).click()
  await expectZone(page, 'akanon', "Ak'Anon")
  await page.locator('[data-testid="maps-center-player"]').click()
  await expectZone(page, 'steamfont', 'Steamfont Mountains')
  check('Center on me restores following the live zone', await page.locator('[data-testid="maps-zone-mode"]').getAttribute('data-mode') === 'follow')
}

async function main(): Promise<void> {
  buildIfStale()
  const fixture = stageFixture('e2e-maps.log')
  mkdirSync(join(fixture.installDir, 'maps'))
  writeFileSync(join(fixture.installDir, 'maps', 'steamfont.txt'), geometry + point("to_Ak'Anon") +
    point('to_The_Lesser_Faydark', 400) + point("Ak'Anon_Bank", -700) + point('to_North_Freeport', 700))
  for (const zone of ['akanon', 'lfaydark']) writeFileSync(join(fixture.installDir, 'maps', `${zone}.txt`), geometry + point('to_The_Steamfont_Mountains'))
  const launched = await launchOnFixture(fixture)
  let page: Page | undefined
  try {
    page = await mainWindow(launched.app)
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.waitForSelector('[data-testid="nav-maps"]', { timeout: 60000 })
    await waitHydrated(page)
    await publish(launched.app)
    await page.locator('[data-testid="nav-maps"]').click()
    await expectZone(page, 'steamfont', 'Steamfont Mountains')
    await page.locator('[data-testid="maps-pane-close"]').click()
    await dragDoesNotOpen(page)
    await followLinks(launched.app, page)
    await dotAndReturn(page)
    check('map navigation has no renderer errors', errors.length === 0, errors.join('; '))
    if (failures.length) await dumpArtifacts(page, 'maps-zone-links-FAIL')
  } catch (error) {
    if (page) await dumpArtifacts(page, 'maps-zone-links-FAIL')
    throw error
  } finally { await launched.close(); await fixture.dispose() }
  reportRun()
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1 })
