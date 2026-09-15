/** Real journal IPC and hidden Electron geometry: tabs keep the header reachable and
 * long source/location lists have one vertical scroll owner. All game input is staged. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ElectronApplication, Page } from 'playwright-core'
import type { EqApi } from '../../src/preload/index'
import { ARTIFACTS, buildIfStale, check, dumpArtifacts, failures, reportRun, ROOT, settle, settleStable } from './appHarness.mjs'
import { mainWindow, makeUserData, removeUserData } from './appWindow.mjs'
import { launchOnFixture, stageFixture, type FixtureLog } from './logFixture.mjs'

interface Browser { eq: EqApi }
const DETAIL = '[data-testid="quest-journal-detail"]'
const PANEL = '[data-testid="journal-detail-panel"]:not([hidden])'
const TASK = 'Potential of the Void - Lord Nagafen - Weekly'
const TASK_ID = `task:${TASK.toLowerCase()}`
const LONG_QUEST = 'Bladed Weapons'
const TABS = ['Next steps', 'Rewards', 'Walkthrough', 'History']
const tab = (page: Page, name: string) => page.getByRole('tab', { name, exact: true })

async function select(page: Page, name: string, id = name): Promise<void> {
  await page.locator('[data-testid="quest-journal-search"] input').fill(name)
  await page.locator('[data-testid="quest-journal-row"]').filter({ hasText: name }).first().click()
  await page.locator(`${DETAIL}[data-quest-id="${id}"]`).waitFor()
  check(`${name} starts on Next steps`, await tab(page, 'Next steps').getAttribute('aria-selected') === 'true')
}

async function savedState(page: Page, id: string): Promise<string> {
  return page.evaluate(async questId => {
    const eq = (window as unknown as Browser).eq
    const result = await eq.questJournalQuery({ limit: 1 })
    const detail = await eq.questJournalDetail({ characterId: result.context.characterId, id: questId })
    return JSON.stringify({ manual: detail.manual, state: detail.row?.state, tracked: detail.row?.tracked })
  }, id)
}

async function keyboardTabs(page: Page): Promise<void> {
  const before = await savedState(page, LONG_QUEST)
  await tab(page, 'Next steps').focus()
  for (const name of TABS) {
    if (name !== 'Next steps') { await page.keyboard.press('ArrowRight'); await page.keyboard.press('Enter') }
    check(`${name} is keyboard selectable`, await tab(page, name).getAttribute('aria-selected') === 'true')
    check(`${name} labels its single visible focusable panel`, await page.getByRole('tabpanel', { name, exact: true }).count() === 1 &&
      await page.locator(PANEL).getAttribute('tabindex') === '0')
  }
  check('changing tabs never changes tracking or progress', await savedState(page, LONG_QUEST) === before)
  check('optional correction is reachable in History', await page.getByRole('button', { name: 'Correct progress', exact: true }).count() === 1)
}

async function openReference(page: Page): Promise<void> {
  await tab(page, 'Walkthrough').click()
  check('an unstructured quest opens its Guide immediately', (await page.locator('[data-testid="quest-journal-walkthrough"]').innerText()).length > 2000 &&
    await tab(page, 'Guide').getAttribute('aria-selected') === 'true')
  await tab(page, 'Guide').focus()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Enter')
  check('People is keyboard selectable and shows NPC links directly', await tab(page, 'People').getAttribute('aria-selected') === 'true' &&
    await page.getByRole('button', { name: 'a decaying skeleton', exact: true }).count() === 1)
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Enter')
  check('Items is keyboard selectable with a sensible first selection', await tab(page, 'Items').getAttribute('aria-selected') === 'true' &&
    await page.getByRole('button', { name: 'Rusty Short Sword', exact: true }).getAttribute('aria-pressed') === 'true')
  check('Walkthrough has no accordion or dropdown chain', await page.locator(`${PANEL} [aria-expanded]`).count() === 0)
  await page.getByRole('button', { name: 'Rusty Long Sword', exact: true }).click()
  await page.locator(PANEL).evaluate(panel => { panel.scrollTop = 200 })
  const changed = await page.evaluate(async id => {
    const eq = (window as unknown as Browser).eq
    const result = await eq.questJournalQuery({ limit: 1 })
    return eq.questJournalMutate({ characterId: result.context.characterId!, id, action: 'track', value: true })
  }, LONG_QUEST)
  check('the staged background update is accepted', changed.ok)
  const tracked = await settle(() => page.locator('[data-testid="quest-journal-track"]').textContent(), text => text === 'Tracking')
  check('automatic detail refresh preserves Items, its chosen item and scroll position', tracked === 'Tracking' &&
    await page.locator(PANEL).evaluate(panel => panel.scrollTop) === 200 && await tab(page, 'Items').getAttribute('aria-selected') === 'true' &&
    await page.getByRole('button', { name: 'Rusty Long Sword', exact: true }).getAttribute('aria-pressed') === 'true' &&
    await page.getByRole('heading', { name: 'Rusty Long Sword', exact: true }).count() === 1)
  await page.getByRole('button', { name: 'Rusty Short Sword', exact: true }).click()
  check('the item exposes its full bundled list of locations', await page.locator(`${PANEL} [data-testid="quest-journal-location"]`).count() > 200)
}

async function resize(app: ElectronApplication, page: Page, width: number, height: number): Promise<void> {
  const window = await app.browserWindow(page)
  await window.evaluate((win, size) => { win.setMinimumSize(360, 360); win.setContentSize(size.width, size.height) }, { width, height })
  // Native frame scaling can round a requested content width by one CSS pixel.
  const matches = (size: { width: number; height: number }): boolean => Math.abs(size.width - width) <= 1 && Math.abs(size.height - height) <= 1
  const actual = await settle(() => page.evaluate(() => ({ width: innerWidth, height: innerHeight })), matches)
  check(`test window reaches ${width} × ${height}`, matches(actual), JSON.stringify(actual))
  await page.locator(DETAIL).scrollIntoViewIfNeeded()
}

function geometry(page: Page) {
  return page.locator(DETAIL).evaluate(detail => {
    const panel = detail.querySelector<HTMLElement>('[role="tabpanel"]:not([hidden])')!
    const header = detail.querySelector<HTMLElement>('[data-testid="journal-detail-header"]')!
    const tabs = detail.querySelector<HTMLElement>('[data-testid="journal-detail-tabs"]')!
    const box = detail.getBoundingClientRect()
    const head = header.getBoundingClientRect()
    const nav = tabs.getBoundingClientRect()
    const inner = detail.querySelector<HTMLElement>('[data-testid="journal-reference-tabs"]')!.getBoundingClientRect()
    const content = panel.getBoundingClientRect()
    const owners = [...detail.querySelectorAll<HTMLElement>('*')].filter(el =>
      el.clientHeight > 0 && el.scrollHeight > el.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(el).overflowY))
    return {
      scrollOwners: owners.length, panelOwnsScroll: owners[0] === panel,
      scrollTop: panel.scrollTop, scrollHeight: panel.scrollHeight,
      headerTop: head.top - box.top, tabsTop: nav.top - box.top,
      headerPageTop: head.top, innerTabsVisible: inner.top >= content.top && inner.bottom <= content.bottom,
      visibleChrome: head.top >= 0 && nav.bottom <= innerHeight,
      horizontalOverflow: panel.scrollWidth > panel.clientWidth + 1,
      width: box.width, height: box.height
    }
  })
}

async function capture(app: ElectronApplication, page: Page, name: string): Promise<void> {
  const window = await app.browserWindow(page)
  const png = await window.evaluate(async win => {
    win.webContents.invalidate()
    await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })
    const image = await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })
    return image.isEmpty() ? '' : image.toPNG().toString('base64')
  })
  check(`${name} layout has a captured frame`, png.length > 5000)
  mkdirSync(ARTIFACTS, { recursive: true })
  writeFileSync(join(ARTIFACTS, `${name}.png`), Buffer.from(png, 'base64'))
}

async function layout(app: ElectronApplication, page: Page, width: number, height: number): Promise<void> {
  await resize(app, page, width, height)
  await page.locator(PANEL).evaluate(panel => { panel.scrollTop = 0 })
  const before = await settleStable(() => geometry(page))
  check(`${width}px long item locations use one vertical scrollbar`, before.scrollOwners === 1 && before.panelOwnsScroll, JSON.stringify(before))
  check(`${width}px content fits horizontally`, !before.horizontalOverflow)
  await page.locator(PANEL).evaluate(panel => { panel.scrollTop = panel.scrollHeight })
  const after = await settle(() => geometry(page), shape => shape.scrollTop > 100)
  check(`${width}px title and tabs stay visible after scrolling the long content`, after.scrollTop > 100 && after.visibleChrome &&
    Math.abs(before.headerTop - after.headerTop) < 1 && Math.abs(before.tabsTop - after.tabsTop) < 1, JSON.stringify(after))
  check(`${width}px the inner section tabs remain visible at the end of the locations`, after.innerTabsVisible)
  await tab(page, 'Guide').click()
  const guide = await settle(() => geometry(page), shape => shape.scrollTop === 0)
  check(`${width}px switching to Guide starts at the top without moving the page header`, guide.scrollTop === 0 && Math.abs(guide.headerPageTop - after.headerPageTop) < 1)
  await tab(page, 'Items').click()
  await page.locator(PANEL).evaluate(panel => { panel.scrollTop = panel.scrollHeight })
  await page.getByRole('button', { name: 'Rusty Long Sword', exact: true }).click()
  const item = await settle(() => geometry(page), shape => shape.scrollTop === 0)
  check(`${width}px selecting another item starts its locations at the top`, item.scrollTop === 0 &&
    await page.getByRole('heading', { name: 'Rusty Long Sword', exact: true }).count() === 1)
  await page.getByRole('button', { name: 'Rusty Short Sword', exact: true }).click()
  for (const name of TABS) await tab(page, name).focus()
  check(`${width}px every tab remains keyboard reachable`, await tab(page, 'History').evaluate(el => el === document.activeElement))
  await page.locator(PANEL).evaluate(panel => { panel.scrollTop = 0 })
  await settleStable(() => geometry(page))
  await capture(app, page, `journal-tabs-${width}x${height}`)
}

async function observedTask(page: Page, log: FixtureLog): Promise<void> {
  await select(page, TASK, TASK_ID)
  check('an observed-only task explains its next-step source', (await page.locator(PANEL).innerText()).includes('in-game task instructions'))
  await tab(page, 'Rewards').click()
  check('an observed-only task explains missing reward data', (await page.locator(PANEL).innerText()).includes('not in the bundled catalog'))
  await tab(page, 'Walkthrough').click()
  check('an observed-only task points to its recorded History', (await page.locator(PANEL).innerText()).includes('recorded progress is in History'))
  await tab(page, 'History').click()
  await page.getByRole('button', { name: 'Why this recommendation / Tracking details', exact: true }).click()
  const previous = await page.locator(PANEL).innerText()
  const recorded = readFileSync(join(ROOT, 'tests/fixtures/e2e-deep-link.log'), 'utf8').split(/\r?\n/u)
    .find(line => line.endsWith(`Your task '${TASK}' has been updated.`))
  if (!recorded) throw new Error('Verified task-update fixture is missing')
  log.append(recorded.replace(/^\[[^\]]+\] /u, ''))
  const refreshed = await settle(() => page.locator(PANEL).innerText(), text => text !== previous && text.includes('Last game record:'), { timeoutMs: 30000 })
  check('automatic task refresh keeps History selected and expanded', refreshed !== previous && refreshed.includes('Last game record:') &&
    await tab(page, 'History').getAttribute('aria-selected') === 'true')
  await select(page, LONG_QUEST)
}

async function unstructuredGuide(page: Page): Promise<void> {
  await select(page, "Clurg's New Creation")
  await tab(page, 'Walkthrough').click()
  check('another quest resets the inner tab and exposes its Guide immediately', await tab(page, 'Guide').getAttribute('aria-selected') === 'true' &&
    (await page.locator('[data-testid="quest-journal-walkthrough"]').innerText()).includes('Lizard Tail'))
  await tab(page, 'People').click()
  check('missing NPC sources have a clear empty state', (await page.locator(PANEL).innerText()).includes('No other NPC locations'))
  await tab(page, 'Items').click()
  check('the new quest selects its own first item', await page.getByRole('button', { name: 'Lizard Tail', exact: true }).getAttribute('aria-pressed') === 'true')
}

async function session(log: FixtureLog, userData: string): Promise<void> {
  const launched = await launchOnFixture(log, { userData })
  const page = await mainWindow(launched.app)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  try {
    const notice = page.locator('[data-testid="telemetry-notice-off"]')
    if (await notice.count()) await notice.click()
    await page.locator('[data-testid="nav-questJournal"]').click()
    await select(page, LONG_QUEST)
    await keyboardTabs(page)
    await openReference(page)
    await layout(launched.app, page, 1280, 850)
    await layout(launched.app, page, 1280, 620)
    await layout(launched.app, page, 560, 620)
    await observedTask(page, log)
    await unstructuredGuide(page)
    check('tabbed quest details render without errors', errors.length === 0, errors.join('\n'))
    if (failures.length) await dumpArtifacts(page, 'journal-tabs-FAIL')
  } catch (error) { await dumpArtifacts(page, 'journal-tabs-ERROR'); throw error }
  finally { await launched.close() }
}

async function main(): Promise<void> {
  buildIfStale()
  const log = stageFixture('p1-unbound-pet.log')
  const userData = makeUserData()
  try { await session(log, userData) }
  finally { await log.dispose(); await removeUserData(userData) }
  reportRun()
}
main().catch((error: unknown) => { console.error(error); process.exitCode = 1 })
