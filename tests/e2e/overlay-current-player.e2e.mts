/** Real overlay preloads and renderer polling; native observations apply only to a staged install. */
import type { ElectronApplication, Page } from 'playwright-core'
import { buildIfStale, check, reportRun, settle } from './appHarness.mjs'
import { mainWindow, overlayWindow } from './appWindow.mjs'
import { launchOnFixture, stageFixture } from './logFixture.mjs'

interface Observation { name: string; level: number; zone: string; age: number; live: boolean }
interface MainFixture { overlayPlayer: Observation }
interface Bridge { toggleOverlay(kind: string): Promise<boolean> }

async function control(app: ElectronApplication, root: string): Promise<void> {
  await app.evaluate((_electron, stagedRoot) => {
    const { Worker } = process.getBuiltinModule('node:worker_threads') as typeof import('node:worker_threads')
    const state = globalThis as unknown as MainFixture
    state.overlayPlayer = { name: 'Primitive', level: 10, zone: 'befallen', age: 0, live: true }
    const original = Worker.prototype.postMessage
    Worker.prototype.postMessage = function (value, ...transfer) {
      const request = value as { type?: string; id?: number; root?: string }
      if (request?.type !== 'read' || request.root !== stagedRoot || typeof request.id !== 'number') return original.call(this, value, ...transfer)
      const current = state.overlayPlayer
      const result = current.live ? { state: 'live', location: { characterName: current.name, level: current.level, zone: current.zone,
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
async function main(): Promise<void> {
  buildIfStale()
  const log = stageFixture('cw7-who-swap-boundary-aug12.log')
  const launched = await launchOnFixture(log)
  try { await control(launched.app, log.installDir); await verify(launched.app, await mainWindow(launched.app)) }
  finally { await launched.close(); await log.dispose() }
  reportRun()
}
main().catch((error: unknown) => { console.error(error); process.exitCode = 1 })
