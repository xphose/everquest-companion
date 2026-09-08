/** Real overlay preloads and renderer polling; native observations apply only to a staged install. */
import type { ElectronApplication, Page } from 'playwright-core'
import type { ClassAbbr } from '../../src/shared/classCombo'
import { buildIfStale, check, reportRun, settle } from './appHarness.mjs'
import { mainWindow, overlayWindow } from './appWindow.mjs'
import { launchOnFixture, stageFixture } from './logFixture.mjs'

interface Observation { name: string; level: number; zone: string; age: number; live: boolean; classes: ClassAbbr[] }
interface MainFixture { overlayPlayer: Observation }
interface Bridge { toggleOverlay(kind: string): Promise<boolean> }

async function control(app: ElectronApplication, root: string): Promise<void> {
  await app.evaluate((_electron, stagedRoot) => {
    const { Worker } = process.getBuiltinModule('node:worker_threads') as typeof import('node:worker_threads')
    const state = globalThis as unknown as MainFixture
    state.overlayPlayer = { name: 'Primitive', level: 10, zone: 'befallen', age: 0, live: true, classes: ['MAG', 'SHM'] }
    const original = Worker.prototype.postMessage
    Worker.prototype.postMessage = function (value, ...transfer) {
      const request = value as { type?: string; id?: number; root?: string }
      if (request?.type !== 'read' || request.root !== stagedRoot || typeof request.id !== 'number') return original.call(this, value, ...transfer)
      const current = state.overlayPlayer
      const result = current.live ? { state: 'live', location: { characterName: current.name, level: current.level, zone: current.zone, classes: current.classes,
        ns: 1, ew: 2, z: 3, heading: 0, sampledAt: Date.now() - current.age } } : { state: 'unavailable', reason: 'Staged disconnect.' }
      queueMicrotask(() => this.emit('message', { id: request.id, result }))
    }
  }, root)
}
async function publish(app: ElectronApplication, patch: Partial<Observation>): Promise<void> {
  await app.evaluate((_electron, update) => Object.assign((globalThis as unknown as MainFixture).overlayPlayer, update), patch)
}
async function open(app: ElectronApplication, main: Page, kind: string): Promise<Page> {
  await main.evaluate((name) => (window as unknown as { eq: Bridge }).eq.toggleOverlay(name), kind)
  const page = await overlayWindow(app, kind)
  if (!page) throw new Error(`${kind} did not open`)
  return page
}
async function source(page: Page, selector: string, attribute: string, expected: string): Promise<void> {
  const value = await settle(() => page.locator(selector).getAttribute(attribute), (read) => read === expected, { timeoutMs: 20_000 })
  if (!check(`${selector} uses ${expected} observations`, value === expected, value ?? 'missing')) throw new Error('Wrong observation source')
}
async function verify(app: ElectronApplication, main: Page): Promise<void> {
  const xp = await open(app, main, 'xp')
  const respawn = await open(app, main, 'respawn')
  await source(xp, '[data-testid="xp-overlay"]', 'data-level-source', 'live')
  check('XP shows the current native level without a log event', (await xp.locator('body').innerText()).includes('lvl 10 Live'))
  check('incompatible logged progress cannot produce a next-level estimate', (await xp.locator('[data-testid="xp-row-eta"]').innerText()).includes('awaiting progress at lvl 10'))
  await source(respawn, '[data-testid="respawn-overlay"]', 'data-zone-source', 'live')
  await publish(app, { level: 12, zone: 'gukbottom' })
  const changed = await settle(() => xp.locator('body').innerText(), (text) => text.includes('lvl 12 Live'), { timeoutMs: 20_000 })
  check('a later native level arrives through continuous overlay polling', changed.includes('lvl 12 Live'))
  const zone = await settle(() => respawn.locator('body').innerText(), (text) => text.includes('The Ruins of Old Guk'), { timeoutMs: 20_000 })
  check('respawn header follows a mapped native zone without an entered-zone line', zone.includes('The Ruins of Old Guk'))
  for (const invalid of [{ name: 'Other' }, { name: 'Primitive', age: 5000 }, { age: 0, live: false }]) {
    await publish(app, invalid)
    await source(xp, '[data-testid="xp-overlay"]', 'data-level-source', 'log')
    await source(respawn, '[data-testid="respawn-overlay"]', 'data-zone-source', 'log')
  }
  await publish(app, { live: true, level: 13, zone: 'befallen' })
  await source(xp, '[data-testid="xp-overlay"]', 'data-level-source', 'live')
  await source(respawn, '[data-testid="respawn-overlay"]', 'data-zone-source', 'live')
  check('polling recovers after native disconnect', (await xp.locator('body').innerText()).includes('lvl 13 Live'))
}
async function leveling(app: ElectronApplication, main: Page): Promise<void> {
  await publish(app, { classes: ['MAG', 'SHM', 'ENC'] })
  await main.click('[data-testid="nav-leveling"]')
  await source(main, '[data-testid="leveling-view"]', 'data-level-source', 'live')
  check('Leveling current hero follows the native level', (await main.locator('[data-testid="leveling-hero-level"]').innerText()) === '13')
  const chips = await main.locator('[data-testid="new-at-level-combo-chip"]').allTextContents()
  check('New at this level includes all three currently selected classes', ['MAG', 'SHM', 'ENC'].every((cls) => chips.includes(cls)), chips.join('/'))
  await main.click('[data-testid="new-at-level-next"]')
  await publish(app, { level: 15 })
  const hero = await settle(() => main.locator('[data-testid="leveling-hero-level"]').innerText(), (text) => text === '15', { timeoutMs: 20_000 })
  check('live hero updates while a manually browsed level remains selected', hero === '15' && (await main.locator('[data-testid="new-at-level-value"]').innerText()).includes('14'))
  await main.getByText('back to 15', { exact: true }).click()
  check('returning to current level resumes following in both spell panels', (await main.locator('[data-testid="new-at-level-value"]').innerText()).includes('15') && await main.locator('[data-testid="best-spells"]').getAttribute('data-level') === '15')
}
async function main(): Promise<void> {
  buildIfStale()
  const log = stageFixture('cw7-who-swap-boundary-aug12.log')
  const launched = await launchOnFixture(log)
  try {
    await control(launched.app, log.installDir)
    const page = await mainWindow(launched.app)
    await verify(launched.app, page)
    await leveling(launched.app, page)
  }
  finally { await launched.close(); await log.dispose() }
  reportRun()
}
main().catch((error: unknown) => { console.error(error); process.exitCode = 1 })
