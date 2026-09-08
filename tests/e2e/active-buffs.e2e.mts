/** Preexisting native effects through the real preload, metadata worker and overlay; staged install only. */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ElectronApplication, Page } from 'playwright-core'
import type { PlayerActiveBuff } from '../../src/shared/playerBuffs'
import { buildIfStale, check, reportRun, settle } from './appHarness.mjs'
import { mainWindow, overlayWindow } from './appWindow.mjs'
import { launchOnFixture, stageFixture } from './logFixture.mjs'

interface Observation { name: string; age: number; live: boolean; effects?: PlayerActiveBuff[] }
interface MainFixture { activeEffects: Observation }
interface Bridge { toggleOverlay(kind: string): Promise<boolean> }

function stage(root: string, log: string): void {
  // No cast lines or spellbook data: already-active effects must stand on their own.
  writeFileSync(log, '[Tue Sep 08 10:00:00 2026] [10 MAG/SHM] Primitive (Human)  ZONE: North Qeynos (qeynos2)\n')
  const rows = [[900001, 'Test Enduring Light'], [900002, 'Test Gentle Song']].map(([id, name]) => {
    const fields = Array<string>(173).fill('0')
    fields[0] = String(id); fields[1] = String(name); fields[172] = ''
    return fields.join('^')
  })
  writeFileSync(join(root, 'spells_us.txt'), `${rows.join('\n')}\n`, 'latin1')
}

async function control(app: ElectronApplication, root: string): Promise<void> {
  await app.evaluate((_electron, stagedRoot) => {
    const { Worker } = process.getBuiltinModule('node:worker_threads') as typeof import('node:worker_threads')
    const state = globalThis as unknown as MainFixture
    state.activeEffects = { name: 'Primitive', age: 0, live: true, effects: [
      { spellId: 900001, kind: 'buff', slot: 1, remainingMs: 18_000_000 },
      { spellId: 900002, kind: 'song', slot: 1 }
    ] }
    const original = Worker.prototype.postMessage
    Worker.prototype.postMessage = function (value, ...transfer) {
      const request = value as { type?: string; id?: number; root?: string }
      if (request?.type !== 'read' || request.root !== stagedRoot || typeof request.id !== 'number') return original.call(this, value, ...transfer)
      const current = state.activeEffects
      const result = current.live ? { state: 'live', location: { characterName: current.name, zone: 'qeynos2',
        ns: 1, ew: 2, z: 3, heading: 0, sampledAt: Date.now() - current.age,
        ...(current.effects === undefined ? {} : { activeBuffs: current.effects }) } } : { state: 'unavailable', reason: 'Staged disconnect.' }
      queueMicrotask(() => this.emit('message', { id: request.id, result }))
    }
  }, root)
}

async function publish(app: ElectronApplication, patch: Partial<Observation>): Promise<void> {
  await app.evaluate((_electron, update) => Object.assign((globalThis as unknown as MainFixture).activeEffects, update), patch)
}
async function contains(page: Page, text: string): Promise<void> {
  const body = await settle(() => page.locator('[data-testid="active-self-effects"]').innerText(), (value) => value.includes(text), { timeoutMs: 20_000 })
  check(`active effects show ${text}`, body.includes(text), body)
}
async function fallback(page: Page): Promise<void> {
  const source = await settle(() => page.locator('[data-testid="active-self-effects"]').getAttribute('data-source'), (value) => value === 'log', { timeoutMs: 20_000 })
  check('untrusted native state falls back to logged timers', source === 'log')
  check('old native effects are cleared', await page.locator('[data-testid="active-self-effect"]').count() === 0)
}

async function verify(app: ElectronApplication, main: Page): Promise<void> {
  await main.evaluate(() => (window as unknown as { eq: Bridge }).eq.toggleOverlay('buffs'))
  const page = await overlayWindow(app, 'buffs')
  if (!page) throw new Error('Buffs overlay did not open')
  await contains(page, 'Test Enduring Light')
  await contains(page, 'Test Gentle Song')
  check('already-active effects have names without a cast or owned-spell input', await page.locator('[data-testid="active-self-effect"]').count() === 2)
  check('native remaining time is approximate', (await page.locator('[data-spell-id="900001"]').innerText()).includes('~5h'))
  check('unknown duration is Active, without an invented permanent label', (await page.locator('[data-spell-id="900002"]').innerText()).endsWith('Active'))
  await publish(app, { effects: [{ spellId: 900001, kind: 'buff', slot: 1, remainingMs: 6000 }] })
  await contains(page, '~6s')
  check('a removed effect leaves without needing a log line', await page.locator('[data-testid="active-self-effect"]').count() === 1)
  await publish(app, { effects: [{ spellId: 900099, kind: 'buff', slot: 1 }] })
  await contains(page, 'Spell 900099')
  await publish(app, { effects: [] })
  await contains(page, 'No active effects on you.')
  check('known-empty effects do not ask the player to cast', !(await page.locator('body').innerText()).includes('Watching for buffs you cast'))
  for (const patch of [{ effects: undefined }, { effects: [{ spellId: 900001, kind: 'buff' as const, slot: 1 }], name: 'Other' },
    { name: 'Primitive', age: 5000 }, { age: 0, live: false }]) {
    await publish(app, patch)
    await fallback(page)
  }
  await publish(app, { live: true, effects: [{ spellId: 900001, kind: 'buff', slot: 1 }] })
  await contains(page, 'Test Enduring Light')
  check('recovery does not invent dropped-buff notices', await page.locator('[data-testid="buff-timer-drop"]').count() === 0)
}

async function main(): Promise<void> {
  buildIfStale()
  const log = stageFixture('cw7-who-swap-boundary-aug12.log')
  stage(log.installDir, log.logPath)
  const launched = await launchOnFixture(log)
  try { await control(launched.app, log.installDir); await verify(launched.app, await mainWindow(launched.app)) }
  finally { await launched.close(); await log.dispose() }
  reportRun()
}
main().catch((error: unknown) => { console.error(error); process.exitCode = 1 })
