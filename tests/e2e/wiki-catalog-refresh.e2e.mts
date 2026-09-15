/** Daily reference updates use one next-launch snapshot in the app and Adventure.
 * The wiki runner is synthetic; every publication still crosses the real cache boundary. */
import type { ElectronApplication, Page } from 'playwright-core'
import type { EqApi } from '../../src/preload/index'
import type { WikiCatalogPack } from '../../src/shared/wikiCatalog'
import { buildIfStale, check, dumpArtifacts, reportRun, settle } from './appHarness.mjs'
import { mainWindow, makeUserData, overlayWindow, removeUserData } from './appWindow.mjs'
import { launchOnFixture, type FixtureLog } from './logFixture.mjs'
import { stageAdventure } from './adventureFixture.mjs'

interface Browser { eq: EqApi }
interface Probe {
  __eqWikiRefresh: { setRunner(run: (base: WikiCatalogPack, progress: (value: { state: 'downloading'; completedPages: number; totalPages: number }) => void) => Promise<WikiCatalogPack>): void }
  __wikiRelease?: () => void
}
const QUEST = "Clurg's New Creation"
const SCOUT = 'a wiki test scout'
const STAMP = '2030-01-15T12:00:00.000Z'
const GENERATION = 'wiki-e2e-complete'
const GUIDE = 'The refreshed guide names the wiki test scout as a source.'

async function openSettings(page: Page): Promise<void> {
  await page.locator('[data-testid="nav-preferences"]').click()
  await page.locator('[data-testid="prefs-rail-updates"]').click()
  await page.locator('[data-testid="wiki-catalog-setting"]').waitFor()
}

async function prepareRunner(app: ElectronApplication): Promise<void> {
  await app.evaluate((_electron, data) => {
    const probe = globalThis as unknown as Probe
    probe.__eqWikiRefresh.setRunner(async (base, progress) => {
      progress({ state: 'downloading', completedPages: 1, totalPages: 2 })
      await new Promise<void>(resolve => { probe.__wikiRelease = resolve })
      const pack = structuredClone(base)
      pack.generation = data.generation
      pack.checkedAt = data.stamp
      pack.items.scrapedAt = pack.mobs.scrapedAt = pack.quests.scrapedAt = pack.metadata.snapshotAt = data.stamp
      pack.mobs.mobs.push({ page: 'Wiki_Test_Scout', name: data.scout, level: '2', zones: ['The Feerrott'], drops: ['Lizard Tail'], loc: [{ ns: 1234, ew: 2345 }] })
      const quest = pack.quests.quests.find(row => row.page === data.quest)!
      quest.giver = data.scout
      quest.startZone = 'The Feerrott'
      quest.relatedNpcs = [data.scout]
      pack.metadata.walkthroughs[data.quest] = { sections: [{ text: data.guide }], truncated: false }
      progress({ state: 'downloading', completedPages: 2, totalPages: 2 })
      return pack
    })
  }, { generation: GENERATION, stamp: STAMP, scout: SCOUT, quest: QUEST, guide: GUIDE })
}

async function startAdventure(app: ElectronApplication, page: Page): Promise<Page> {
  const open = await page.evaluate(() => (window as unknown as Browser).eq.getOverlayState())
  if (!open.adventure) {
    await page.getByRole('button', { name: 'Floating DPS overlays', exact: true }).click()
    await page.locator('[data-testid="overlay-menu-adventure"]').click()
  }
  const overlay = await overlayWindow(app, 'adventure')
  if (!overlay) throw new Error('Adventure did not open')
  await overlay.locator('[data-testid="adventure-overlay"]').waitFor()
  return overlay
}

async function pendingSession(log: FixtureLog, userData: string): Promise<void> {
  const launched = await launchOnFixture(log, { userData })
  const page = await mainWindow(launched.app)
  try {
    await page.locator('[data-testid="nav-preferences"]').waitFor()
    const before = await page.locator('#root').getAttribute('data-wiki-generation')
    await page.evaluate(path => (window as unknown as Browser).eq.setCharacter(path), log.logPath)
    const saved = await page.evaluate(async quest => {
      const eq = (window as unknown as Browser).eq
      const query = await eq.questJournalQuery({ limit: 1 })
      const result = await eq.questJournalMutate({ characterId: query.context.characterId!, id: quest, action: 'track', value: true })
      const detail = await eq.questJournalDetail({ characterId: query.context.characterId, id: quest })
      return { result, tracked: detail.row?.tracked === true }
    }, QUEST)
    if (!saved.result.ok || !saved.tracked) throw new Error(`Tracking fixture was not saved: ${JSON.stringify(saved)}`)
    check('the restart begins with a saved tracked quest', saved.tracked)
    await openSettings(page)
    await page.locator('[data-testid="prefs-search"] input').fill('wiki')
    check('wiki updates are easy to find in Preferences search', await page.locator('[data-testid="wiki-catalog-setting"]').isVisible())
    await page.locator('[data-testid="prefs-search"] input').fill('')
    const activeDate = await page.locator('[data-testid="wiki-active-date"]').innerText()
    check('the card states its daily schedule', (await page.locator('[data-testid="wiki-catalog-setting"]').innerText()).includes('every day'))
    await prepareRunner(launched.app)
    await page.locator('[data-testid="wiki-refresh-now"]').click()
    check('manual refresh reports progress and disables repeat clicks', (await settle(() => page.locator('[data-testid="wiki-refresh-message"]').innerText(), text => text.includes('1 of 2'))).includes('1 of 2') &&
      await page.locator('[data-testid="wiki-refresh-now"]').isDisabled())
    const released = await launched.app.evaluate(() => {
      const release = (globalThis as unknown as Probe).__wikiRelease
      if (!release) return false
      // Let the debugger deliver its reply before the fixture clones/validates a whole pack.
      setTimeout(release, 0)
      return true
    })
    check('the fixture update is allowed to finish', released)
    const ready = await settle(() => page.locator('[data-testid="wiki-refresh-message"]').innerText(), text => text.includes('Restart Companion'))
    check('completion clearly names the Companion restart', ready.includes('Restart Companion') && await page.locator('[data-testid="wiki-pending-date"]').count() === 1)
    check('download does not relabel active data', await page.locator('[data-testid="wiki-active-date"]').innerText() === activeDate)
    check('last checked is recorded separately', !(await page.locator('[data-testid="wiki-last-checked"]').innerText()).includes('Not checked yet'))
    const overlay = await startAdventure(launched.app, page)
    const active = await overlay.evaluate(async scout => {
      const data = await (window as unknown as Browser).eq.getWikiCatalogRendererData()
      return { generation: data.generation, hasScout: data.mobs.mobs.some(row => row.name === scout) }
    }, SCOUT)
    check('an overlay opened after download still uses this launch data', active.generation === before && !active.hasScout)
  } catch (error) { await dumpArtifacts(page, 'wiki-pending-ERROR'); throw error }
  finally { await launched.close() }
}

async function refreshedJournal(page: Page): Promise<void> {
  await page.locator('[data-testid="nav-questJournal"]').click()
  await page.locator('[data-testid="quest-journal-search"] input').fill(QUEST)
  await page.locator('[data-testid="quest-journal-row"]').filter({ hasText: QUEST }).first().click()
  const detail = page.locator('[data-testid="quest-journal-detail"]')
  await detail.waitFor()
  check('quest pickup shows the refreshed NPC and coordinates', (await detail.innerText()).includes(SCOUT) && (await detail.innerText()).includes('1234'))
  const tracking = await page.locator('[data-testid="quest-journal-track"]').evaluate(button => ({
    text: button.textContent, rendered: (button as HTMLElement).innerText, transform: getComputedStyle(button).textTransform
  }))
  check('the player tracking survives the catalog restart', tracking.text === 'Tracking', JSON.stringify(tracking))
  await page.getByRole('tab', { name: 'Walkthrough', exact: true }).click()
  check('refreshed walkthrough is visible', (await page.locator('[data-testid="quest-journal-walkthrough"]').innerText()).includes(GUIDE))
  await page.getByRole('tab', { name: 'Items', exact: true }).click()
  await page.getByRole('button', { name: 'Lizard Tail', exact: true }).click()
  await page.getByRole('button', { name: 'Open item', exact: true }).click()
  check('the item source index includes the newly published mob', (await settle(() => page.locator('[data-testid="loot-detail"]').innerText(), text => text.includes(SCOUT))).includes(SCOUT))
}

async function refreshedAdventure(app: ElectronApplication, page: Page): Promise<void> {
  const overlay = await startAdventure(app, page)
  const generations = await Promise.all([page, overlay].map(window => window.locator('#root').getAttribute('data-wiki-generation')))
  check('main and Adventure boot the same new snapshot', generations.every(value => value === GENERATION))
  await overlay.getByRole('tab', { name: 'Map', exact: true }).click()
  await overlay.locator('[data-testid="maps-find"]').click()
  await overlay.locator('[data-testid="maps-pane-search"]').fill(SCOUT)
  await overlay.locator('[data-testid="maps-pane-hit"][data-kind="mob"]').filter({ hasText: SCOUT }).first().click()
  await overlay.locator('[data-testid="maps-marker"]').waitFor()
  check('Adventure can find and map the newly published NPC', await overlay.locator('[data-testid="maps-zone-filter"]').inputValue() === 'The Feerrott')
  await overlay.getByRole('tab', { name: 'Quests', exact: true }).click()
  await overlay.getByRole('tab', { name: 'Find', exact: true }).click()
  await overlay.getByRole('textbox', { name: 'Find a quest' }).fill(QUEST)
  await overlay.locator('[data-testid="adventure-quest-row"]').filter({ hasText: QUEST }).click()
  check('Adventure quest details use the refreshed pickup too', (await overlay.locator('[data-testid="adventure-quest-detail"]').innerText()).includes(SCOUT))
}

async function failedRefresh(app: ElectronApplication, page: Page): Promise<void> {
  await openSettings(page)
  check('restart activates the downloaded date and clears pending advice', await page.locator('[data-testid="wiki-pending-date"]').count() === 0)
  await app.evaluate(() => {
    (globalThis as unknown as Probe).__eqWikiRefresh.setRunner(async () => { throw new Error('Synthetic offline wiki') })
  })
  await page.locator('[data-testid="wiki-refresh-now"]').click()
  const text = await settle(() => page.locator('[data-testid="wiki-refresh-message"]').innerText(), value => value.includes('retry automatically'))
  check('offline refresh keeps current data with a clear retry action', text.includes('current data is still available') && await page.getByRole('button', { name: 'Try again', exact: true }).count() === 1 &&
    await page.locator('#root').getAttribute('data-wiki-generation') === GENERATION)
  await app.evaluate(() => {
    (globalThis as unknown as Probe).__eqWikiRefresh.setRunner(async base => base)
  })
  await page.getByRole('button', { name: 'Try again', exact: true }).click()
  check('retry succeeds without losing the active pack', (await settle(() => page.locator('[data-testid="wiki-refresh-message"]').innerText(), value => value.includes('up to date'))).includes('up to date'))
}

async function activeSession(log: FixtureLog, userData: string): Promise<void> {
  const launched = await launchOnFixture(log, { userData })
  const page = await mainWindow(launched.app)
  try {
    await page.locator('[data-testid="nav-questJournal"]').waitFor()
    const sameCharacter = await page.evaluate(async path => (await (window as unknown as Browser).eq.getCharacter())?.logPath === path, log.logPath)
    check('restart restores the same character', sameCharacter)
    await refreshedJournal(page)
    await refreshedAdventure(launched.app, page)
    await failedRefresh(launched.app, page)
  } catch (error) { await dumpArtifacts(page, 'wiki-active-ERROR'); throw error }
  finally { await launched.close() }
}

async function main(): Promise<void> {
  buildIfStale()
  const log = stageAdventure()
  const userData = makeUserData()
  try { await pendingSession(log, userData); await activeSession(log, userData) }
  finally { await log.dispose(); await removeUserData(userData) }
  reportRun()
}
main().catch((error: unknown) => { console.error(error); process.exitCode = 1 })
