/** Real map/journal IPC in a distinct overlay renderer; synthetic install and shortcut only. */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ElectronApplication, Page } from 'playwright-core'
import type { EqApi } from '../../src/preload/index'
import type { AdventureControls } from '../../src/preload/adventure'
import type { EqOverlayApi } from '../../src/preload/overlay'
import { IPC } from '../../src/shared/ipc'
import { ARTIFACTS, buildIfStale, check, dumpArtifacts, failures, reportRun, settle } from './appHarness.mjs'
import { mainWindow, overlayWindow } from './appWindow.mjs'
import { launchOnFixture, type FixtureLog } from './logFixture.mjs'
import { controlAdventure, publishAdventure, stageAdventure } from './adventureFixture.mjs'

interface Browser { eq: EqApi; eqAdventure: AdventureControls; eqOverlay: EqOverlayApi }
interface ShortcutProbe { __eqAdventureShortcut: { registrationAvailable: boolean; trigger: () => boolean; shown: () => boolean } }
const QUEST = 'Blackburrow Brewers'
const PLAYER = '[data-testid="maps-player-marker"]'

async function captureHidden(app: ElectronApplication, page: Page, name: string): Promise<void> {
  const win = await app.browserWindow(page)
  const base64 = await win.evaluate(async (w) => {
    w.webContents.invalidate()
    await w.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })
    return (await w.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG().toString('base64')
  })
  mkdirSync(ARTIFACTS, { recursive: true })
  writeFileSync(join(ARTIFACTS, `${name}.png`), Buffer.from(base64, 'base64'))
}

async function nativeMap(app: ElectronApplication, page: Page): Promise<void> {
  const profile = page.locator('[data-testid="adventure-profile"]')
  await settle(() => profile.innerText(), text => text.includes('Rogue'), { timeoutMs: 30_000 })
  const profileText = await profile.innerText()
  check('Adventure uses live SHA/PAL/ROG and level1', profileText.includes('Lv 1') && ['Shaman', 'Paladin', 'Rogue'].every(name => profileText.includes(name)), profileText)
  await page.locator(PLAYER).waitFor()
  check('the map uses the same native current zone', await page.locator(PLAYER).getAttribute('data-zone') === 'qrg')
  await page.locator('[data-testid="maps-center-player"]').click()
  const centered = await page.locator(PLAYER).evaluate((marker) => {
    const box = marker.getBoundingClientRect(), host = marker.parentElement!.getBoundingClientRect()
    return Math.abs(box.x + box.width / 2 - host.x - host.width / 2) < 2 && Math.abs(box.y + box.height / 2 - host.y - host.height / 2) < 2
  })
  check('Center me centers the native marker', centered)
  await page.locator('[data-testid="maps-find"]').click()
  await page.locator('[data-testid="maps-pane-search"]').fill('Adventure Beacon')
  await page.locator('[data-testid="maps-pane-label"]').filter({ hasText: 'Adventure Beacon' }).click()
  check('search opens the installed label and returns canvas space', await page.locator('[data-testid="maps-pane-marker"]').count() === 1 && await page.locator('[data-testid="maps-pane"]').count() === 0)
  await page.locator('[data-testid="map-canvas"]').evaluate(node => node.setAttribute('data-preserved', 'yes'))
  await publishAdventure(app, { ns: 200, ew: 300, level: 2, classes: ['SHM', 'PAL'] })
  await settle(() => profile.innerText(), text => text.includes('Lv 2'), { timeoutMs: 15_000 })
  check('changed native classes replace the previous combination automatically', !(await profile.innerText()).includes('Rogue') && (await profile.innerText()).includes('Paladin'))
  check('live polling keeps canvas and chosen target', await page.locator('[data-testid="map-canvas"]').getAttribute('data-preserved') === 'yes' && await page.locator('[data-testid="maps-pane-marker"]').count() === 1)
  await page.locator('[data-testid="maps-find"]').click()
  check('search survives live ticks', await page.locator('[data-testid="maps-pane-search"]').inputValue() === 'Adventure Beacon')
  await page.locator('[data-testid="maps-pane-search"]').fill('Tarn Visilin')
  await page.locator('[data-testid="maps-pane-hit"][data-kind="mob"]').filter({ hasText: 'Tarn Visilin' }).first().click()
  check('wiki NPC search jumps to its other zone', await settle(() => page.locator('[data-testid="maps-zone-filter"]').inputValue(), value => value === 'High Keep') === 'High Keep')
  await page.locator('[data-testid="maps-marker"]').waitFor()
  await page.waitForTimeout(2800)
  check('cross-zone NPC target remains visible after the normal flash period', await page.locator('[data-testid="maps-marker"]').count() === 1)
  await page.locator('[data-testid="maps-follow-current"]').click()
  await publishAdventure(app, { zone: 'qeynos2', classes: ['SHM', 'PAL', 'ROG'] })
  check('a later native zone follows automatically', await settle(() => page.locator(PLAYER).getAttribute('data-zone'), zone => zone === 'qeynos2') === 'qeynos2')
  await publishAdventure(app, { age: 60_000 })
  check('stale native position is hidden', await settle(() => page.locator(PLAYER).count(), count => count === 0) === 0)
  await publishAdventure(app, { age: 0, zone: 'qrg' })
  await page.locator(PLAYER).waitFor()
}

async function quests(main: Page, page: Page): Promise<void> {
  await page.getByRole('tab', { name: 'Quests', exact: true }).click()
  await page.getByRole('tab', { name: 'Find', exact: true }).click()
  await page.getByRole('textbox', { name: 'Find a quest' }).fill(QUEST)
  await page.locator('[data-testid="adventure-quest-row"]').filter({ hasText: QUEST }).click()
  const detail = page.locator('[data-testid="adventure-quest-detail"]')
  await detail.waitFor()
  check('quest has useful next action, pickup and recipient inside overlay', (await detail.innerText()).includes('Larsk Juton') && (await detail.innerText()).includes('Where to turn in'))
  await page.locator('[data-testid="adventure-track"]').click()
  await settle(() => page.locator('[data-testid="adventure-track"]').textContent(), text => text === 'Untrack quest')
  const rows = await main.evaluate(() => (window as unknown as Browser).eq.questJournalQuery({ state: 'tracked' }))
  check('overlay tracking writes the main journal shared progress', rows.rows.some(row => row.id === QUEST && row.tracked))
  await detail.evaluate(node => node.setAttribute('data-preserved', 'yes'))
  const checkbox = page.locator('[data-testid="adventure-objective"] input[type="checkbox"]').first()
  await checkbox.click()
  await page.getByRole('button', { name: 'Undo my checkmark' }).first().waitFor()
  check('manual objective completion is visibly distinguished', (await detail.innerText()).includes('Your checkmark'))
  await page.getByRole('button', { name: 'Undo my checkmark' }).first().click()
  await settle(() => page.getByRole('button', { name: 'Undo my checkmark' }).count(), count => count === 0)
  const changed = await main.evaluate(async (quest) => {
    const eq = (window as unknown as Browser).eq
    const { context } = await eq.questJournalQuery({ limit: 1 })
    return eq.questJournalMutate({ characterId: context.characterId!, action: 'track', id: quest, value: false })
  }, QUEST)
  check('main-window mutation updates the open overlay detail automatically', changed.ok && await settle(() => page.locator('[data-testid="adventure-track"]').textContent(), text => text === 'Track quest') === 'Track quest', JSON.stringify(changed))
  await page.waitForTimeout(5200)
  check('refresh preserves the quest detail DOM', await detail.getAttribute('data-preserved') === 'yes')
  await page.locator('[data-testid="adventure-quest-map"]').first().click()
  check('quest location switches to the local Map tab', await page.getByRole('tab', { name: 'Map', exact: true }).getAttribute('aria-selected') === 'true')
  await page.getByRole('button', { name: 'Back to quest' }).click()
  check('return to quest preserves its chosen detail', await detail.getAttribute('data-quest-id') === QUEST)
}

async function minimum(app: ElectronApplication, page: Page): Promise<void> {
  await page.getByRole('tab', { name: 'Map', exact: true }).click()
  const win = await app.browserWindow(page)
  await win.evaluate(w => w.setBounds({ ...w.getBounds(), width: 420, height: 480 }))
  await settle(() => win.evaluate(w => w.getBounds().height), height => height === 480)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
  const canvas = await page.locator('[data-testid="maps-surface"]').boundingBox()
  check('420×480 still has a usable map and no horizontal overflow', !overflow && !!canvas && canvas.width >= 370 && canvas.height >= 210, JSON.stringify(canvas))
  await page.locator('[data-testid="maps-find"]').click()
  const pane = await page.locator('[data-testid="maps-pane"]').boundingBox()
  const results = await page.locator('[data-testid="maps-pane-scroll"]').boundingBox()
  check('open search leaves canvas visible and room to read results', !!pane && !!canvas && pane.width < canvas.width * 0.8 && !!results && results.height >= 75, JSON.stringify({ pane, results }))
  const stacked = await page.locator('[data-testid="maps-pane-search"]').evaluate(node => {
    const box = node.getBoundingClientRect(), top = document.elementFromPoint(box.x + 30, box.y + 10)
    return top === node
  })
  check('map labels and native player cannot paint over search', stacked)
  await captureHidden(app, page, 'adventure-min-search')
  await page.locator('[data-testid="maps-pane-close"]').click()
  await page.getByRole('tab', { name: 'Quests', exact: true }).click()
  check('minimum quest pane remains a bounded usable scroller', await page.locator('[data-testid="adventure-quest-detail"]').isVisible())
  await captureHidden(app, page, 'adventure-min-quest')
  await win.evaluate(w => w.setBounds({ ...w.getBounds(), width: 640, height: 660 }))
  await captureHidden(app, page, 'adventure-quest')
}

async function controls(app: ElectronApplication, page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Adventure settings' }).click()
  await page.getByRole('textbox', { name: 'Show / hide shortcut' }).fill('Ctrl+Shift+J')
  await app.evaluate(() => { (globalThis as unknown as ShortcutProbe).__eqAdventureShortcut.registrationAvailable = false })
  await page.getByRole('button', { name: 'Save shortcut' }).click()
  check('shortcut collision is reported honestly', await settle(() => page.locator('body').innerText(), text => text.includes('could not be registered')).then(text => text.includes('could not be registered')))
  await app.evaluate(() => { (globalThis as unknown as ShortcutProbe).__eqAdventureShortcut.registrationAvailable = true })
  await page.getByRole('button', { name: 'Save shortcut' }).click()
  await page.getByText('Shortcut ready.', { exact: true }).waitFor()
  await page.keyboard.press('Escape')
  check('saved shortcut is shown in the overlay', (await page.locator('[data-testid="adventure-shortcut"]').innerText()).includes('Ctrl+Shift+J'))
  const first = await app.evaluate(() => { const probe = (globalThis as unknown as ShortcutProbe).__eqAdventureShortcut; probe.trigger(); return probe.shown() })
  const second = await app.evaluate(() => { const probe = (globalThis as unknown as ShortcutProbe).__eqAdventureShortcut; probe.trigger(); return probe.shown() })
  check('synthetic shortcut hides and restores the same window', !first && second && !page.isClosed())
  await page.evaluate(() => (window as unknown as { eqOverlay: { setLocked(value: boolean): void } }).eqOverlay.setLocked(true))
  await settle(() => page.locator('[data-testid="adventure-overlay"]').getAttribute('data-locked'), value => value === 'true')
  const win = await app.browserWindow(page)
  check('pinned Adventure cannot take keyboard focus', await win.evaluate(w => !w.isFocusable()))
  await win.evaluate(w => {
    const tracked = w as typeof w & { lastAdventureIgnore?: boolean }
    const original = w.setIgnoreMouseEvents.bind(w)
    w.setIgnoreMouseEvents = (ignore, options): void => { tracked.lastAdventureIgnore = ignore; original(ignore, options) }
  })
  await app.evaluate(({ BrowserWindow }, channels) => {
    const overlay = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('adventure.html'))!
    overlay.webContents.send(channels.onOverlayHover, { kind: 'adventure', inside: true })
  }, IPC)
  await page.evaluate(() => (window as unknown as { eqOverlay: { setIgnoreMouse(value: boolean): void } }).eqOverlay.setIgnoreMouse(false))
  await settle(() => win.evaluate(w => (w as typeof w & { lastAdventureIgnore?: boolean }).lastAdventureIgnore), value => value === false)
  await app.evaluate(() => { const probe = (globalThis as unknown as ShortcutProbe).__eqAdventureShortcut; probe.trigger(); probe.trigger() })
  check('pinned hide/show keeps native focus policy', await win.evaluate(w => !w.isFocusable()))
  check('pinned hide/show releases captured header and restores body click-through', await win.evaluate(w => (w as typeof w & { lastAdventureIgnore?: boolean }).lastAdventureIgnore === true))
  await page.evaluate(() => (window as unknown as { eqOverlay: { setLocked(value: boolean): void } }).eqOverlay.setLocked(false))
  await settle(() => win.evaluate(w => w.isFocusable()), value => value)
}

async function appearance(app: ElectronApplication, main: Page, page: Page): Promise<void> {
  const fonts = (): Promise<{ chrome: string; content: string }> => page.evaluate(() => ({
    chrome: getComputedStyle(document.querySelector('[data-testid="adventure-shortcut"]')!).fontSize,
    content: getComputedStyle(document.querySelector('[data-testid="adventure-quest-detail"] h6')!).fontSize
  }))
  const before = await fonts()
  await main.evaluate(() => (window as unknown as Browser).eq.setOverlayTextSize({ shared: 1.3 }))
  const after = await settle(fonts, next => next.content !== before.content)
  check('readable quest text scales while recovery chrome stays fixed', after.chrome === before.chrome && parseFloat(after.content) > parseFloat(before.content))
  await main.evaluate(() => (window as unknown as Browser).eq.setOverlayTextSize({ shared: 1 }))
  await page.getByRole('button', { name: 'Adventure settings' }).click()
  await page.getByRole('slider', { name: 'Adventure background opacity' }).press('Home')
  await page.keyboard.press('Escape')
  const alpha = await settle(() => page.locator('[data-testid="adventure-overlay"]').evaluate(node => getComputedStyle(node).backgroundColor), color => color.endsWith('0.15)'))
  const backgrounds = await page.locator('[data-testid="maps-surface"]').evaluate(node => {
    const layers: string[] = []
    for (let layer: Element | null = node; layer && !layer.matches('[data-testid="adventure-overlay"]'); layer = layer.parentElement) layers.push(getComputedStyle(layer).backgroundColor)
    return layers
  })
  check('appearance slider changes the map through transparent nested panels', alpha.endsWith('0.15)') && backgrounds.every(color => color === 'rgba(0, 0, 0, 0)'), JSON.stringify(backgrounds))
  await captureHidden(app, page, 'adventure-low-alpha')
  await main.evaluate(() => (window as unknown as Browser).eq.setOverlayBgAlpha({ shared: 0.72 }))
}

async function closeReopen(app: ElectronApplication, main: Page, page: Page): Promise<void> {
  const win = await app.browserWindow(page)
  // Electron's programmatic setBounds does not emit the completed user-resize event on Windows.
  await win.evaluate(w => { w.setBounds({ ...w.getBounds(), width: 590, height: 610 }); w.emit('resized') })
  await page.evaluate(() => (window as unknown as Browser).eqOverlay.setLocked(true))
  await settle(() => page.evaluate(() => (window as unknown as Browser).eqOverlay.getConfig()), config => config.locked && config.bounds?.width === 590)
  const before = await page.evaluate(() => (window as unknown as Browser).eqOverlay.getConfig())
  check('a completed resize is persisted through the native bounds listener', before.bounds?.width === 590 && before.bounds.height === 610)
  await page.evaluate(() => (window as unknown as Browser).eqOverlay.close())
  await settle(async () => page.isClosed(), closed => closed)
  const menuItem = main.locator('[data-testid="overlay-menu-adventure"]')
  if (!await menuItem.isVisible()) await main.getByRole('button', { name: 'Floating DPS overlays', exact: true }).click()
  await menuItem.click()
  const reopened = await overlayWindow(app, 'adventure')
  if (!reopened) throw new Error('Closed Adventure could not be reopened')
  await reopened.locator('[data-testid="adventure-overlay"]').waitFor()
  const after = await reopened.evaluate(() => (window as unknown as Browser).eqOverlay.getConfig())
  check('close and menu reopen preserve pin, size, position and appearance', !!before.bounds && after.open && after.locked && after.bgAlpha === before.bgAlpha && JSON.stringify(after.bounds) === JSON.stringify(before.bounds), JSON.stringify({ before: before.bounds, after: after.bounds }))
  check('reopened pinned window is focus safe', !(await (await app.browserWindow(reopened)).evaluate(w => w.isFocusable())))
  await reopened.evaluate(() => (window as unknown as Browser).eqOverlay.close())
}

async function identitySwitch(app: ElectronApplication, main: Page, page: Page, log: FixtureLog): Promise<void> {
  const original = await main.evaluate(() => (window as unknown as Browser).eq.questJournalQuery({ limit: 1 }))
  await publishAdventure(app, { name: 'Journalalt', level: 3 })
  await main.evaluate(path => (window as unknown as Browser).eq.setCharacter(path), log.others.Journalalt)
  check('changing character clears the old selected quest', await settle(() => page.locator('[data-testid="adventure-quest-detail"]').count(), count => count === 0) === 0)
  const refused = await page.evaluate(({ characterId, id }) => (window as unknown as Browser).eq.questJournalMutate({ characterId, id, action: 'track', value: true }), { characterId: original.context.characterId!, id: QUEST })
  check('old-character mutations are refused at the real IPC boundary', !refused.ok)
  await app.evaluate(({ BrowserWindow }, channel) => {
    const overlay = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('adventure.html'))!
    overlay.webContents.send(channel, { name: 'Journalalt', server: 'freeport', logPath: '' })
  }, IPC.onCharacter)
  await publishAdventure(app, { level: 4 })
  check('same-character rebuild resumes automatic updates', await settle(() => page.locator('[data-testid="adventure-profile"]').innerText(), text => text.includes('Lv 4'), { timeoutMs: 15_000 }).then(text => text.includes('Lv 4')))
}

async function main(): Promise<void> {
  buildIfStale()
  const log = stageAdventure()
  const launched = await launchOnFixture(log)
  let page: Page | null = null
  try {
    await controlAdventure(launched.app, log.installDir)
    const main = await mainWindow(launched.app)
    await main.evaluate(path => (window as unknown as Browser).eq.setCharacter(path), log.logPath)
    await main.getByRole('button', { name: 'Floating DPS overlays', exact: true }).click()
    await main.locator('[data-testid="overlay-menu-adventure"]').click()
    page = await overlayWindow(launched.app, 'adventure')
    if (!page) throw new Error('Adventure did not open')
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.locator('[data-testid="adventure-overlay"]').waitFor()
    const keys = await page.evaluate(() => Object.keys((window as unknown as Browser).eq))
    check('dedicated bridge excludes settings, macro writes, generic sends and engine credentials', !keys.some(key => /setEq|macro|engineConnect|submitFeedback|setCharacter|reloadInventory/i.test(key)))
    await nativeMap(launched.app, page)
    await quests(main, page)
    await minimum(launched.app, page)
    await controls(launched.app, page)
    await appearance(launched.app, main, page)
    await identitySwitch(launched.app, main, page, log)
    check('Adventure has no renderer errors', errors.length === 0, errors.join('\n'))
    if (failures.length) await dumpArtifacts(page, 'adventure-FAIL')
    await closeReopen(launched.app, main, page)
  } catch (error) { if (page) await dumpArtifacts(page, 'adventure-ERROR'); throw error }
  finally { await launched.close(); await log.dispose() }
  reportRun()
}
main().catch((error: unknown) => { console.error(error); process.exitCode = 1 })
