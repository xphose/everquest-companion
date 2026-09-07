/** Visible journal workflow, against real IPC and a staged install. Automatic log/export
 * observation and character mutation isolation are covered by quest-journal-data.e2e.mts. */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ElectronApplication, Page } from 'playwright-core'
import type { EqApi } from '../../src/preload/index'
import { CURRENT_SCHEMA_VERSION } from '../../src/main/storeMigrations'
import { ARTIFACTS, buildIfStale, check, dumpArtifacts, failures, reportRun, settle, settleGone } from './appHarness.mjs'
import { launchApp, mainWindow, makeUserData, removeUserData, type LaunchedApp } from './appWindow.mjs'
import { stageFixture, type FixtureLog } from './logFixture.mjs'
import { settleEngineServing } from './engineSteps.mjs'

const NAV = '[data-testid="nav-questJournal"]'
const JOURNAL = '[data-testid="quest-journal"]'
const SEARCH = '[data-testid="quest-journal-search"] input'
const ROW = '[data-testid="quest-journal-row"]'
const DETAIL = '[data-testid="quest-journal-detail"]'
const QUEST = 'Blackburrow Brewers'
const SELECTED = `${DETAIL}[data-quest-id="${QUEST}"]`
const shown = (page: Page, selector: string): Promise<string> => page.locator(selector).first().innerText().catch(() => '')

function stageMap(installDir: string): void {
  // Hand-authored geometry for exercising the renderer. These are test lines, not a game map.
  const dir = join(installDir, 'maps')
  mkdirSync(dir)
  writeFileSync(join(dir, 'qrg.txt'), [
    'L -500, -500, 0, 500, -500, 0, 180, 180, 180',
    'L 500, -500, 0, 500, 500, 0, 180, 180, 180',
    'L 500, 500, 0, -500, 500, 0, 180, 180, 180',
    'L -500, 500, 0, -500, -500, 0, 180, 180, 180'
  ].join('\n'))
}

async function resize(app: ElectronApplication, page: Page, width: number): Promise<void> {
  const win = await app.browserWindow(page)
  await win.evaluate((w, size) => {
    w.setMinimumSize(360, 360)
    w.setBounds({ ...w.getBounds(), width: size, height: 850 })
  }, width)
  const actual = await settle(() => page.evaluate(() => document.documentElement.clientWidth), (v) => Math.abs(v - width) <= 24, { timeoutMs: 15_000 })
  check(`window reaches ${width}px layout`, Math.abs(actual - width) <= 24, String(actual))
}

async function open(page: Page): Promise<void> {
  await page.click(NAV)
  await page.waitForSelector(JOURNAL, { timeout: 30_000 })
  await settle(() => shown(page, '[data-testid="quest-journal-count"]'), (value) => /^\d+ quests?$/.test(value), { timeoutMs: 30_000 })
}

async function selectQuest(page: Page): Promise<void> {
  await page.locator(SEARCH).focus()
  await page.keyboard.press('Control+A')
  await page.keyboard.type(QUEST)
  const row = page.locator(`${ROW}[data-quest-id="${QUEST}"]`)
  await row.waitFor()
  await row.focus()
  await page.keyboard.press('Enter')
  await page.waitForSelector(SELECTED)
  check('keyboard search and Enter select the matching quest', (await shown(page, '[data-testid="quest-journal-title"]')) === QUEST)
  check('the first visible action says where to begin', (await shown(page, '[data-testid="quest-journal-next-step"]')).includes('Larsk Juton'))
  check('pickup, monsters and final recipient are inside the journal', (await shown(page, DETAIL)).includes('a gnoll brewer') && (await shown(page, '[data-testid="quest-journal-final-turn-in"]')).includes('Larsk Juton'))
  check('manual corrections start collapsed', await page.getByRole('button', { name: 'Mark completed', exact: true }).count() === 0)
}

async function filters(page: Page): Promise<void> {
  const status = page.locator('[data-testid="quest-journal-status-filter"] [role="combobox"]')
  await status.focus()
  await page.keyboard.press('Enter')
  await page.getByRole('option', { name: 'Tracked', exact: true }).click()
  check('status filtering can show an empty result without losing the chosen detail',
    (await settle(() => shown(page, '[data-testid="quest-journal-count"]'), (v) => v === '0 quests')) === '0 quests' && await page.locator(SELECTED).count() === 1)
  await page.click('[data-testid="quest-journal-track"]')
  check('tracking the selected quest refreshes the filtered list automatically',
    (await settle(() => page.locator(ROW).count(), (n) => n === 1)) === 1)
  await page.locator('[data-testid="quest-journal-level-filter"] input').fill('30')
  await page.locator('[data-testid="quest-journal-zone-filter"] [role="combobox"]').click()
  await page.getByRole('option', { name: 'Surefall Glade', exact: true }).click()
  await page.click('[data-testid="nav-overview"]')
  check('navigation unmounts the journal', await settleGone(page, JOURNAL))
  await open(page)
  await page.waitForSelector(SELECTED)
  check('search, status, zone, level and selection survive view switching',
    await page.locator(SEARCH).inputValue() === QUEST && (await status.innerText()) === 'Tracked' &&
    await page.locator('[data-testid="quest-journal-level-filter"] input').inputValue() === '30' &&
    (await shown(page, '[data-testid="quest-journal-zone-filter"]')).includes('Surefall Glade'))
}

async function references(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Source walkthrough', exact: true }).click()
  check('the source walkthrough is readable inside the app', (await shown(page, '[data-testid="quest-journal-walkthrough"]')).includes('Gnasher'))
  await page.getByRole('button', { name: 'Cloak of Jaggedpine', exact: true }).click()
  await page.getByRole('button', { name: 'Open item details', exact: true }).click()
  await page.waitForSelector('[data-testid="loot-detail"]')
  check('reward links open the existing item detail pane', (await shown(page, '[data-testid="loot-detail-title"]')).includes('Cloak of Jaggedpine'))
  await page.click('[data-testid="loot-back"]')
  await page.waitForSelector(SELECTED)
  check('item Back restores the journal selection and filters', await page.locator(SEARCH).inputValue() === QUEST)
  await page.locator(`${SELECTED} [data-testid="quest-journal-map-link"]`).first().click()
  await page.waitForSelector('[data-testid="map-canvas"]')
  check('a source coordinate opens the exact native zone map', (await shown(page, '[data-testid="maps-zone-chip"]')).includes('qrg'))
  check('the map shows the requested quest location and its temporary marker',
    (await shown(page, '[data-testid="maps-quest-focus"]')).includes('Larsk Juton') &&
    (await settle(() => page.locator('[data-testid="maps-marker"]').count(), (n) => n === 1)) === 1)
  await page.click('[data-testid="maps-origin-back"]')
  await page.waitForSelector(SELECTED)
  check('native map Back returns to the same journal entry', await page.locator(SEARCH).inputValue() === QUEST)
}

async function profileAndComparison(page: Page): Promise<void> {
  // This committed log has no self /who row. Exercise the optional fallback, using actual
  // bundled cloak stats and the committed inventory's equipped Cloak of Flames +2.
  await page.click('[data-testid="quest-journal-profile-toggle"]')
  await page.getByLabel('Character level', { exact: true }).fill('30')
  await page.getByLabel('Classes, separated by commas', { exact: true }).fill('Druid')
  await page.getByRole('button', { name: 'Save correction', exact: true }).click()
  const compared = await settle(() => shown(page, '[data-testid="quest-journal-comparison"]'), (v) => v.includes('Cloak of Flames'), { timeoutMs: 15_000 })
  check('optional profile correction enables an actual equipped-item stat comparison', compared.includes('Cloak of Flames') && compared.includes('Change') && compared.includes('AC'), compared)
  await page.click('[data-testid="quest-journal-profile-toggle"]')
}

async function layout(app: ElectronApplication, page: Page, width: number): Promise<void> {
  await resize(app, page, width)
  await page.locator(SELECTED).evaluate((el) => { el.scrollTop = 0 })
  const shape = await page.evaluate(() => {
    const list = document.querySelector('[data-testid="quest-journal-list"]')!.getBoundingClientRect()
    const detail = document.querySelector('[data-testid="quest-journal-detail"]')!.getBoundingClientRect()
    const root = document.querySelector('[data-testid="quest-journal"]')!
    return { sideBySide: detail.x > list.x + list.width - 2, stacked: detail.y >= list.bottom, overflow: root.scrollWidth > root.clientWidth + 1 }
  })
  check(`${width}px journal layout fits without horizontal overflow`, !shape.overflow)
  check(`${width}px journal uses the intended pane layout`, width >= 1200 ? shape.sideBySide : shape.stacked)
  const tag = width >= 1200 ? 'journal-wide' : 'journal-narrow'
  if (width < 1200) await page.locator(SELECTED).scrollIntoViewIfNeeded()
  await dumpArtifacts(page, tag)
  await captureHidden(app, page, tag)
}

/** Borrow a compositor frame without ever showing the test window. The first capture can wake
 * a hidden surface; keep only the second, nonempty image. */
async function captureHidden(app: ElectronApplication, page: Page, tag: string): Promise<void> {
  const win = await app.browserWindow(page)
  const base64 = await win.evaluate(async (w) => {
    w.webContents.invalidate()
    await w.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })
    const img = await w.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })
    return img.isEmpty() ? '' : img.toPNG().toString('base64')
  })
  if (base64.length < 5000) return
  mkdirSync(ARTIFACTS, { recursive: true })
  writeFileSync(join(ARTIFACTS, `${tag}.png`), Buffer.from(base64, 'base64'))
}

async function prepare(userData: string, log: FixtureLog): Promise<{ launched: LaunchedApp; page: Page }> {
  const launched = await launchApp({ userData, installDir: log.installDir })
  try {
    await settleEngineServing(launched.app)
    const page = await mainWindow(launched.app)
    await page.waitForSelector(NAV, { timeout: 60_000 })
    const notice = page.locator('[data-testid="telemetry-notice-off"]')
    if (await notice.count()) await notice.click()
    return { launched, page }
  } catch (cause) {
    await launched.close()
    throw cause
  }
}

async function firstLaunch(userData: string, log: FixtureLog): Promise<void> {
  const { launched, page } = await prepare(userData, log)
  try {
    await resize(launched.app, page, 1280)
    await open(page)
    check('the catalog is windowed while all catalog quests remain accessible',
      (await page.locator(ROW).count()) === 20 && Number.parseInt(await shown(page, '[data-testid="quest-journal-count"]')) >= 999)
    await page.click('[data-testid="quest-journal-next"]')
    check('the next catalog page is usable', (await settle(() => page.locator('[data-testid="quest-journal-prev"]').isEnabled(), Boolean)) === true)
    await selectQuest(page)
    await filters(page)
    await profileAndComparison(page)
    await references(page)
    await layout(launched.app, page, 1280)
    await layout(launched.app, page, 900)
  } catch (cause) {
    await dumpArtifacts(page, 'journal-failure')
    throw cause
  } finally { await launched.close() }
}

async function restart(userData: string, log: FixtureLog): Promise<void> {
  const { launched, page } = await prepare(userData, log)
  try {
    await page.waitForSelector(SELECTED, { timeout: 30_000 })
    check('a full restart restores the journal view, selection and filters',
      await page.locator(SEARCH).inputValue() === QUEST &&
      (await shown(page, '[data-testid="quest-journal-status-filter"]')).includes('Tracked') &&
      (await shown(page, '[data-testid="quest-journal-zone-filter"]')).includes('Surefall Glade') &&
      await page.locator('[data-testid="quest-journal-level-filter"] input').inputValue() === '30')
    if (failures.length) await dumpArtifacts(page, 'journal-restart-failure')
  } finally { await launched.close() }
}

async function offline(): Promise<void> {
  const installDir = makeUserData()
  const userData = makeUserData()
  mkdirSync(join(installDir, 'Logs'))
  stageMap(installDir)
  // EQ_INSTALL_DIR is an auto-discovery candidate and needs a character log to qualify.
  // Persist the real manual setting before launch so an empty staged install stays selected
  // even when another installation on the host has logs. No live store is read or written.
  writeFileSync(join(userData, 'everquest-companion-progress.json'), JSON.stringify({
    schemaVersion: CURRENT_SCHEMA_VERSION, eqInstallDir: installDir
  }), 'utf8')
  const launched = await launchApp({ installDir, userData })
  let page: Page | undefined
  try {
    page = await mainWindow(launched.app)
    await page.waitForSelector(NAV, { timeout: 30_000 })
    const isolation = await page.evaluate(async () => {
      const eq = (window as unknown as { eq: Pick<EqApi, 'getEqConfig' | 'listCharacters' | 'getCharacter'> }).eq
      const [config, characters, active] = await Promise.all([eq.getEqConfig(), eq.listCharacters(), eq.getCharacter()])
      return { config, count: characters.length, active }
    })
    check('the offline launch uses its saved empty installation', isolation.config.source === 'manual' &&
      isolation.config.root.toLowerCase() === installDir.toLowerCase() && isolation.config.characterCount === 0)
    check('the offline character list and active character are empty', isolation.count === 0 && isolation.active === null)
    const notice = page.locator('[data-testid="telemetry-notice-off"]')
    if (await notice.count()) await notice.click()
    await resize(launched.app, page, 1280)
    await open(page)
    await page.locator(SEARCH).fill(QUEST)
    await page.locator(`${ROW}[data-quest-id="${QUEST}"]`).click()
    await page.waitForSelector(SELECTED)
    check('an empty Logs install can browse the catalog without a character', await page.locator(JOURNAL).getAttribute('data-character-id') === 'catalog')
    check('offline tracking does not invent a character', await page.locator('[data-testid="quest-journal-track"]').isDisabled())
    await references(page)
    await page.getByRole('button', { name: 'Larsk Juton', exact: true }).first().click()
    await page.waitForSelector('[data-testid="mobs-back"]')
    check('offline NPC links open existing catalog details', (await shown(page, '[data-testid="mobs-back"]')).toLowerCase().includes('quest journal') && await page.getByRole('heading', { name: 'Larsk Juton', exact: true }).count() > 0)
    await page.click('[data-testid="mobs-back"]')
    await page.waitForSelector(SELECTED)
    check('offline NPC Back returns to the journal', await page.locator(JOURNAL).count() === 1)
    if (failures.length) await dumpArtifacts(page, 'journal-offline-failure')
  } catch (cause) {
    if (page) await dumpArtifacts(page, 'journal-offline-failure')
    throw cause
  } finally { await launched.close(); await removeUserData(installDir); await removeUserData(userData) }
}

async function main(): Promise<void> {
  buildIfStale()
  const userData = makeUserData()
  const log = stageFixture('e2e-deep-link.log', { inventory: 'Primitive_freeport-Inventory.txt' })
  stageMap(log.installDir)
  try { await firstLaunch(userData, log); await restart(userData, log); await offline() }
  finally { await log.dispose(); await removeUserData(userData) }
  reportRun()
}

main().catch((cause: unknown) => { console.error(cause); process.exitCode = 1 })
