import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ElectronApplication, Page } from 'playwright-core'
import { IPC } from '../../src/shared/ipc'
import { check, settle } from './appHarness.mjs'
import type { FixtureLog } from './logFixture.mjs'

/** Exercise the periodic backstop without delivering the ordinary file watcher event. */
async function suppressInventoryEvents(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ BrowserWindow }, channel) => {
    for (const win of BrowserWindow.getAllWindows()) {
      const send = win.webContents.send.bind(win.webContents)
      win.webContents.send = (name, ...args): void => { if (name !== channel) send(name, ...args) }
    }
  }, IPC.onInventoryReload)
}

async function sameCharacter(app: ElectronApplication, page: Page): Promise<void> {
  const character = await page.evaluate(() => window.eq.getCharacter())
  await app.evaluate(({ BrowserWindow }, payload) => {
    for (const win of BrowserWindow.getAllWindows()) win.webContents.send(payload.channel, payload.character)
  }, { channel: IPC.onCharacter, character })
}

export async function gearProgressionRefresh(app: ElectronApplication, page: Page, log: FixtureLog): Promise<void> {
  const status = page.locator('[data-testid="gear-refresh-checked"]')
  const stamp = (): Promise<string | null> => status.getAttribute('data-inventory-checked')
  check('refresh cadence is explicit beside the current character', (await page.locator('[data-testid="gear-refresh-status"]').innerText()).includes('character every 2 seconds · equipment every 30 seconds'))
  if (!await page.locator('[data-testid="gear-recommendation-details"]').isVisible()) await page.locator('[data-testid="gear-more-details"]').click()
  const card = await page.locator('[data-testid="gear-next-upgrade"]').elementHandle()
  const first = await stamp()
  await page.locator('[data-testid="gear-refresh-now"]').click()
  check('Refresh now confirms a completed check', await settle(() => page.locator('[data-testid="gear-refresh-feedback"]').innerText(), text => text === 'Refresh complete.') === 'Refresh complete.')
  check('a manual check advances the successful equipment time', await stamp() !== first)
  const manual = await stamp()
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  check('returning focus refreshes equipment immediately', await settle(stamp, value => value !== manual) !== manual)
  const prior = await stamp()
  await sameCharacter(app, page)
  check('same-character rebuild keeps the same recommendation card', await card?.evaluate(node => node.isConnected) === true)
  check('same-character rebuild refreshes instead of disabling inventory', await settle(stamp, value => value !== prior) !== prior)
  const periodic = await stamp()
  check('the equipment cadence checks without user action', await settle(stamp, value => value !== periodic, { timeoutMs: 35_000 }) !== periodic)
  check('automatic checks preserve the recommendation DOM and expanded details', await card?.evaluate(node => node.isConnected) === true && await page.locator('[data-testid="gear-recommendation-details"]').isVisible())
  await card?.dispose()
  await suppressInventoryEvents(app)
  await missedExport(page, log)
}

async function missedExport(page: Page, log: FixtureLog): Promise<void> {
  const dump = (tier: number): string => `Location\tName\tID\tCount\tSlots\nHead\tCloth Cap +${tier}\t1\t1\t0\nGeneral 1\tCloth Cap\t1\t1\t0\n`
  const output = join(log.installDir, 'Primitive_freeport-Inventory.txt')
  await page.locator('[data-testid="gear-section-owned"]').click()
  writeFileSync(output, dump(2))
  const head = page.locator('[data-testid="gear-owned-row"][data-slot="HEAD"]')
  check('a missed watcher event recovers on the automatic equipment cadence', (await settle(() => head.innerText(), text => text.includes('Cloth Cap +2'), { timeoutMs: 35_000 })).includes('Cloth Cap +2'))
  writeFileSync(output, dump(3))
  const before = await page.locator('[data-testid="gear-refresh-checked"]').getAttribute('data-inventory-checked')
  await page.locator('[data-testid="gear-section-recommended"]').click()
  await settle(() => page.locator('[data-testid="gear-refresh-checked"]').getAttribute('data-inventory-checked'), value => value !== before)
  await page.locator('[data-testid="gear-section-owned"]').click()
  check('re-entering Recommended checks the newest export immediately', (await head.innerText()).includes('Cloth Cap +3'))
  await page.locator('[data-testid="gear-section-recommended"]').click()
}
