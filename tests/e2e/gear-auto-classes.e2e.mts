/** Native selection → real worker client/IPC → Gear filters and journal profile. Only staged-root
 * worker replies are controlled. No Maps visit, real game access, or historical combo rewrite. */
import type { ElectronApplication, Page } from 'playwright-core'
import type { ClassAbbr } from '../../src/shared/classCombo'
import { classDisplayName } from '../../src/shared/spellLevels'
import { buildIfStale, check, dumpArtifacts, failures, reportRun, settle, sleep } from './appHarness.mjs'
import { mainWindow, makeUserData, removeUserData } from './appWindow.mjs'
import { launchOnFixture, stageFixture, type FixtureLog } from './logFixture.mjs'
import { clearPicks, pickIn } from './gearFilterSteps.mjs'

type Mode = 'live' | 'unavailable' | 'mismatch' | 'stale' | 'missing-level'
interface Selection { classes: ClassAbbr[]; mode: Mode; reads: number; level: number }
interface MainFixture { gearClassesFixture: Selection }
const PICKER = '[data-testid="gear-classes"]'
const AUTO = '[data-testid="gear-auto-classes"]'
const TRIO: ClassAbbr[] = ['MAG', 'SHM', 'ENC']
const LOG_CLASSES: ClassAbbr[] = ['PAL', 'RNG', 'SHM']

async function controlWorker(app: ElectronApplication, root: string): Promise<void> {
  await app.evaluate((_electron, stagedRoot) => {
    const { Worker } = process.getBuiltinModule('node:worker_threads') as typeof import('node:worker_threads')
    const state = globalThis as unknown as MainFixture
    state.gearClassesFixture = { classes: ['MAG', 'SHM'], mode: 'unavailable', reads: 0, level: 10 }
    const original = Worker.prototype.postMessage
    Worker.prototype.postMessage = function (value, ...transfer) {
      const request = value as { type?: string; id?: number; root?: string }
      if (request?.type !== 'read' || request.root !== stagedRoot || typeof request.id !== 'number') {
        return original.call(this, value, ...transfer)
      }
      const selected = state.gearClassesFixture
      selected.reads++
      const result = selected.mode === 'unavailable' ? { state: 'unavailable', reason: 'Staged reader unavailable.' } : {
        state: 'live', location: { classes: selected.classes,
          characterName: selected.mode === 'mismatch' ? 'OtherCharacter' : 'Primitive', zone: 'qeynos2',
          ...(selected.mode === 'missing-level' ? {} : { level: selected.level }),
          ns: 1, ew: 2, z: 3, heading: 0, sampledAt: Date.now() - (selected.mode === 'stale' ? 60_000 : 0) }
      }
      queueMicrotask(() => this.emit('message', { id: request.id, result }))
    }
  }, root)
}

function publish(app: ElectronApplication, classes: ClassAbbr[], mode: Mode = 'live', level = 10): Promise<void> {
  return app.evaluate((_electron, value) => {
    const state = (globalThis as unknown as MainFixture).gearClassesFixture
    state.classes = value.classes
    state.mode = value.mode
    state.level = value.level
  }, { classes, mode, level })
}

async function openGear(page: Page): Promise<void> {
  await page.click('[data-testid="nav-gear"]')
  await page.click('[data-testid="tab-gear"]')
  await page.click('[data-testid="gear-section-browse"]')
  await page.waitForSelector(PICKER, { timeout: 30_000 })
}

async function expectGear(page: Page, classes: ClassAbbr[], label: string): Promise<void> {
  const expected = classes.map(classDisplayName).sort().join(',')
  const found = await settle(() => page.locator(`${PICKER} .MuiChip-label`).allTextContents().then((names) => names.sort().join(',')),
    (value) => value === expected, { timeoutMs: 15_000 })
  if (!check(label, found === expected, found)) throw new Error(`Expected gear classes ${expected}`)
}

async function autoAndManual(app: ElectronApplication, page: Page): Promise<void> {
  await openGear(page)
  await expectGear(page, LOG_CLASSES, 'the staged log provides a resolved fallback before native observations')
  await publish(app, ['MAG', 'SHM'])
  await expectGear(page, ['MAG', 'SHM'], 'Gear alone defaults to the live two-class selection')
  check('Auto classes is enabled by default', await page.locator(AUTO).getAttribute('aria-pressed') === 'true')
  await page.locator('[data-testid="gear-search"] input').fill('robe')
  await publish(app, TRIO)
  await expectGear(page, TRIO, 'newly selected Enchanter appears without a log line or a refresh click')
  await clearPicks(page, PICKER)
  await pickIn(page, PICKER, 'Wizard')
  await publish(app, ['SHD', 'ROG', 'DRU'])
  await settle(() => page.locator('[data-testid="gear-class-offer"]').innerText(), (text) => text.includes('Rogue'))
  await expectGear(page, ['WIZ'], 'a manual browsing filter survives a native class switch')
  await page.click('[data-testid="nav-overview"]')
  await openGear(page)
  await expectGear(page, ['WIZ'], 'manual classes persist across remount')
  await page.click('[data-testid="gear-class-offer"]')
  await expectGear(page, ['SHD', 'ROG', 'DRU'], 'the detected offer resumes automatic following')
  await publish(app, LOG_CLASSES)
  await expectGear(page, LOG_CLASSES, 'accepting the offer follows a later class switch too')
  await page.click(AUTO)
  await publish(app, ['MAG', 'SHM'])
  await settle(() => page.locator('[data-testid="gear-class-offer"]').innerText(), (text) => text.includes('Magician'))
  await expectGear(page, LOG_CLASSES, 'turning Auto classes off keeps the explicit browsing selection')
  await page.click(AUTO)
  await expectGear(page, ['MAG', 'SHM'], 'Auto classes restores the latest native selection')
  check('class updates preserve the other Gear filters', await page.locator('[data-testid="gear-search"] input').inputValue() === 'robe')
}

async function remountAndFallback(app: ElectronApplication, page: Page): Promise<void> {
  await page.click('[data-testid="nav-overview"]')
  await page.waitForSelector('[data-testid="gear-view"]', { state: 'detached' })
  const reads = () => app.evaluate(() => (globalThis as unknown as MainFixture).gearClassesFixture.reads)
  const before = await reads()
  await publish(app, TRIO)
  // GameConnectionStatus now owns an independent, always-mounted reader. A stopped shared worker
  // would be a regression; Gear's own session cleanup is tested separately at its lifecycle seam.
  const continued = await settle(reads, count => count > before, { timeoutMs: 5_000 })
  check('global game status keeps its shared reader active after Gear unmounts', continued > before &&
    await page.locator('[data-testid="game-connection"]').getAttribute('data-state') === 'connected')
  await openGear(page)
  await expectGear(page, TRIO, 'automatic mode survives remount and reads the latest selection')
  check('following mode persists as an unpinned filter', await page.evaluate(() => localStorage.getItem('eq.gear.classes')) === null)
  for (const mode of ['unavailable', 'mismatch', 'stale'] as const) {
    await publish(app, TRIO)
    await expectGear(page, TRIO, `live classes resume before ${mode} observation`)
    await publish(app, ['WIZ', 'MAG'], mode)
    await expectGear(page, LOG_CLASSES, `${mode} native classes fall back to the existing log combo`)
  }
  await page.click('[data-testid="nav-overview"]')
  await page.evaluate(() => localStorage.setItem('eq.gear.classes', JSON.stringify(['WIZ'])))
  await publish(app, TRIO)
  await openGear(page)
  await expectGear(page, ['WIZ'], 'an existing bare-array manual preference remains a manual filter')
  await page.click(AUTO)
  await expectGear(page, TRIO, 'Auto classes resumes continuous following from an existing manual preference')
}

async function journalConsistency(app: ElectronApplication, page: Page): Promise<void> {
  await publish(app, TRIO)
  await page.click('[data-testid="nav-questJournal"]')
  const header = () => page.locator('[data-testid="quest-journal-context"] > div').first().innerText()
  const trio = await settle(header, (text) => text.includes('Magician') && text.includes('Shaman') && text.includes('Enchanter'))
  check('journal also uses the complete current selection without inferred labels',
    trio.includes('Magician') && trio.includes('Shaman') && trio.includes('Enchanter') && !trio.includes('inferred'))
  await page.click('[data-testid="quest-journal-profile-toggle"]')
  await page.getByLabel('Classes, separated by commas', { exact: true }).fill('Wizard')
  await page.getByRole('button', { name: 'Save correction', exact: true }).click()
  await settle(header, (text) => text.includes('Wizard'))
  await publish(app, ['SHD', 'ROG', 'DRU'])
  await sleep(5500)
  check('an explicit journal class correction still overrides native changes', (await header()).includes('Wizard') && !(await header()).includes('Rogue'))
  await page.getByRole('button', { name: 'Use detected profile', exact: true }).click()
  const detected = await settle(header, (text) => text.includes('Rogue') && text.includes('Druid'))
  check('journal detection reset restores the latest native classes', detected.includes('Shadow Knight'))
}

async function characterConsistency(app: ElectronApplication, page: Page): Promise<void> {
  await publish(app, TRIO)
  await page.click('[data-testid="nav-gear"]')
  await page.click('[data-testid="tab-character"]')
  const identity = () => page.locator('[data-testid="character-identity"]').innerText()
  const live = await settle(identity, text => text.includes('ENC') && text.includes('Live classes'))
  check('Character sheet automatically shows all three native classes and live level', live.includes('Level 10') && live.includes('MAG') && live.includes('SHM'))
  for (const level of [11, 9]) {
    await publish(app, TRIO, 'live', level)
    const changedLevel = await settle(() => page.locator('[data-testid="character-level"]').innerText(),
      text => text.includes(`Level ${level}`))
    check(`Character sheet automatically follows a live level change to ${level} without a log line`,
      changedLevel.includes(`Level ${level}`) && changedLevel.includes('Live'))
  }
  await publish(app, ['PAL', 'ROG', 'DRU'])
  const changed = await settle(identity, text => text.includes('ROG') && text.includes('DRU') && !text.includes('ENC'))
  check('Character sheet follows a class switch without a log line', changed.includes('PAL'))
  await publish(app, TRIO, 'missing-level')
  const partial = await settle(identity, text => text.includes('ENC') && text.includes('From log'))
  check('missing native level uses a labeled log level while retaining live classes', partial.includes('Live classes'))
  for (const mode of ['unavailable', 'mismatch', 'stale'] as const) {
    await publish(app, TRIO)
    await settle(identity, text => text.includes('Live classes'))
    await publish(app, TRIO, mode)
    const fallback = await settle(identity, text => text.includes('From log') && !text.includes('Live classes'))
    check(`Character sheet rejects ${mode} observations for both classes and level`,
      LOG_CLASSES.every(cls => fallback.includes(cls)) && !fallback.includes('ENC'))
  }
}

async function plannerConsistency(app: ElectronApplication, page: Page): Promise<void> {
  const picker = '[data-testid="planner-classes"]'
  const names = () => page.locator(`${picker} .MuiChip-label`).allTextContents().then(value => value.sort().join(','))
  await publish(app, TRIO)
  await page.click('[data-testid="tab-planner"]')
  const expected = TRIO.map(classDisplayName).sort().join(',')
  const live = await settle(names, text => text === expected)
  check('Exaltations follows the same current native classes', live === expected)
  await clearPicks(page, picker)
  await pickIn(page, picker, 'Wizard')
  await publish(app, ['PAL', 'ROG', 'DRU'])
  const offer = await settle(() => page.locator('[data-testid="planner-detected-chip"]').innerText(), text => text.includes('Rogue'))
  check('a manual Exaltations filter stays pinned while offering the current selection',
    await names() === 'Wizard' && offer.includes('Druid'))
  check('the Exaltations offer labels native provenance truthfully',
    await page.locator('[data-testid="planner-detected-chip"]').getAttribute('title') === 'Use the current classes read from the game')
}

async function levelingConsistency(app: ElectronApplication, page: Page): Promise<void> {
  await publish(app, TRIO)
  await page.click('[data-testid="nav-leveling"]')
  const chips = () => page.locator('[data-testid="new-at-level-combo-chip"]').allTextContents().then(value => value.sort().join(','))
  const live = await settle(chips, text => text === [...TRIO].sort().join(','))
  check('current spell unlocks use all three native classes', live === [...TRIO].sort().join(','))
  check('the current unlock level comes from the same live profile',
    await page.locator('[data-testid="new-at-level-value"]').innerText() === 'Level 10')
  await publish(app, ['PAL', 'ROG', 'DRU'])
  const changed = await settle(chips, text => text === 'DRU,PAL,ROG')
  check('spell unlock classes follow native changes without reloading', changed === 'DRU,PAL,ROG')
  await page.click('[data-testid="nav-overview"]')
  const level = () => page.locator('[data-testid="overview-leveling-tile-level"]').innerText()
  const overview = await settle(level, text => text.includes('10') && text.includes('Live'))
  check('Overview uses the live level on its current level tile', overview.includes('10') && overview.includes('Live'))
  await publish(app, TRIO, 'live', 11)
  const increased = await settle(level, text => text.includes('11') && text.includes('Live'))
  check('Overview follows a new native level without historical log changes', increased.includes('11') && increased.includes('Live'))
}

async function alertsConsistency(app: ElectronApplication, page: Page): Promise<void> {
  await publish(app, TRIO)
  await page.click('[data-testid="nav-alerts"]')
  await page.click('[data-testid="alerts-add-suggestion"]')
  await page.locator('[data-testid="suggest-search"] input').fill('mesmerization')
  const mine = () => page.locator('[data-testid="suggest-dialog"] [aria-label^="ENC learns"][aria-label$="one of your classes"]').count()
  const live = await settle(mine, count => count > 0)
  check('alert spell suggestions recognize the newly selected Enchanter as one of your classes', live > 0)
  await publish(app, ['PAL', 'ROG', 'DRU'])
  const changed = await settle(mine, count => count === 0)
  check('alert spell suggestions stop claiming a class after the native selection changes', changed === 0)
  await page.keyboard.press('Escape')
}

async function session(log: FixtureLog, userData: string): Promise<void> {
  const launched = await launchOnFixture(log, { userData })
  let page: Page | null = null
  try {
    await controlWorker(launched.app, log.installDir)
    page = await mainWindow(launched.app)
    await page.waitForSelector('[data-testid="nav-gear"]', { timeout: 30_000 })
    const notice = page.locator('[data-testid="telemetry-notice-off"]')
    if (await notice.count()) await notice.click()
    await autoAndManual(launched.app, page)
    await remountAndFallback(launched.app, page)
    await characterConsistency(launched.app, page)
    await plannerConsistency(launched.app, page)
    await levelingConsistency(launched.app, page)
    await alertsConsistency(launched.app, page)
    await journalConsistency(launched.app, page)
    if (failures.length) await dumpArtifacts(page, 'gear-auto-classes-FAIL')
  } catch (cause) {
    if (page) await dumpArtifacts(page, 'gear-auto-classes-ERROR')
    throw cause
  } finally { await launched.close() }
}

async function main(): Promise<void> {
  buildIfStale()
  const log = stageFixture('cw7-who-swap-boundary-aug12.log')
  const userData = makeUserData()
  try { await session(log, userData) }
  finally { await log.dispose(); await removeUserData(userData) }
  reportRun()
}

main().catch((cause: unknown) => { console.error(cause); process.exitCode = 1 })
