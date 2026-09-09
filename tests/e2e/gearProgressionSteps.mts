import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ElectronApplication, Page } from 'playwright-core'
import { ARTIFACTS, check, settle } from './appHarness.mjs'
import type { FixtureLog } from './logFixture.mjs'

async function select(page: Page, testId: string, value: string): Promise<void> {
  await page.locator(`[data-testid="${testId}"] [role="combobox"]`).click()
  await page.getByRole('option', { name: value, exact: true }).click()
}

export async function gearProgressionJourney(page: Page): Promise<void> {
  await page.locator('[data-testid="gear-more-details"]').click()
  const detail = await page.locator('[data-testid="gear-recommendation-details"]').innerText()
  check('details explain evidence and catalog age', detail.includes('Catalog snapshot:') && detail.includes('candidate to check'))
  const name = await page.locator('[data-testid="gear-recommendation-name"]').innerText()
  const where = page.locator('[data-testid="gear-show-where"]')
  check('real source offers a map link', await where.isEnabled())
  await where.click()
  await page.locator('[data-testid="maps-gear-focus"]').waitFor({ timeout: 20_000 })
  check('the map labels arrival as a Gear source', (await page.locator('[data-testid="maps-gear-focus"]').innerText()).startsWith('Gear source:'))
  await page.locator('[data-testid="maps-origin-back"]').click()
  await page.locator('[data-testid="gear-recommendation-name"]').waitFor()
  check('map Back restores the same recommendation', await page.locator('[data-testid="gear-recommendation-name"]').innerText() === name)
  await page.locator('[data-testid="gear-more-options"]').click()
  await select(page, 'gear-band', '16 - 20')
  check('five-level planning uses the last exact level of its range', (await page.locator('[data-testid="gear-current-band"]').innerText()).includes('exact level 20'))
  await select(page, 'gear-plan-slot', 'HEAD')
  await select(page, 'gear-mode', 'Maximum potential')
  await select(page, 'gear-tier', '+5')
  await page.locator('[data-testid="gear-next-upgrade"]').waitFor()
  const planned = await page.locator('[data-testid="gear-recommendation-name"]').innerText()
  check('potential planning names the chosen item tier', planned.endsWith(' +5'))
  const easier = page.locator('[data-testid="gear-something-easier"]')
  if (await easier.count()) {
    const before = await page.locator('[data-testid="gear-next-upgrade"]').getAttribute('data-recommendation-id')
    await easier.click()
    check('Something easier chooses a different lower-effort suggestion', await page.locator('[data-testid="gear-next-upgrade"]').getAttribute('data-recommendation-id') !== before)
  }
  await page.locator('[data-testid="nav-overview"]').click()
  await page.locator('[data-testid="gear-view"]').waitFor({ state: 'detached' })
  await page.locator('[data-testid="nav-gear"]').click()
  await page.locator('[data-testid="gear-current-band"]').waitFor()
  check('planning level survives leaving the actual view', (await page.locator('[data-testid="gear-current-band"]').innerText()).includes('exact level 20'))
  await page.locator('[data-testid="gear-more-options"]').click()
  check('planned equipment slot survives leaving the view', (await page.locator('[data-testid="gear-plan-slot"]').innerText()).includes('HEAD'))
  await page.locator('[data-testid="gear-follow-character"]').click()
  check('Follow my character restores live level and default planning', (await page.locator('[data-testid="gear-current-band"]').innerText()).includes('exact level 10') && (await page.locator('[data-testid="gear-mode"]').innerText()).includes('Achievable now'))
}

export async function gearProgressionInventory(page: Page, log: FixtureLog): Promise<void> {
  await page.locator('[data-testid="gear-section-owned"]').click()
  check('My gear explains the missing inventory export', await page.locator('[data-testid="gear-inventory-missing"]').count() === 1)
  const dump = 'Location\tName\tID\tCount\tSlots\nHead\tCloth Cap +1\t1\t1\t0\nEar\tBrass Earring\t2\t1\t0\nEar\tBrass Earring +2\t2\t1\t0\nFace\tRaw-Hide Mask\t3\t1\t0\nAny Slot\tCloth Cap +1\t1\t1\t0\nAny Slot\tCloth Cap +2\t1\t1\t0\nGeneral 1\tCloth Cap\t1\t1\t0\n'
  writeFileSync(join(log.installDir, 'Primitive_freeport-Inventory.txt'), dump)
  const count = await settle(() => page.locator('[data-testid="gear-owned-row"]').count(), value => value === 6, { timeoutMs: 20_000 })
  check('a new inventory export automatically fills all real worn cells', count === 6)
  for (const slot of ['EAR', 'FACE']) {
    const text = await page.locator(`[data-testid="gear-owned-row"][data-slot="${slot}"]`).innerText()
    check(`ordinary base gear in ${slot} gets usable advice without a +0 label`, !text.includes('Needs details') && !text.includes(' +0'))
  }
  check('paired and Any slots remain separate cells', await page.locator('[data-testid="gear-owned-row"][data-slot="EAR2"]').count() === 1 && await page.locator('[data-testid="gear-owned-row"][data-slot="ANY2"]').count() === 1)
  await page.locator('[data-testid="gear-owned-row"][data-slot="HEAD"]').click()
  check('owned gear includes a concrete merge guide', await page.locator('[data-testid="gear-merge-details"]').count() > 0)
  const head = page.locator('[data-testid="gear-owned-row"][data-slot="HEAD"]')
  check('an ordinary spare base copy contributes merge XP', (await head.innerText()).includes('1 spare copy (1 XP)'))
  writeFileSync(join(log.installDir, 'Primitive_freeport-Inventory.txt'), dump.replace('Head\tCloth Cap +1\t', 'Head\tCloth Cap\t'))
  const updated = await settle(() => head.innerText(), text => text.includes('Improve +0 → +1'), { timeoutMs: 20_000 })
  check('rewriting an upgraded item as a base item automatically refreshes its known tier', updated.includes('Improve +0 → +1') && !updated.includes('Needs details'))
  await page.locator('[data-testid="gear-section-browse"]').click()
  await page.locator('[data-testid="gear-search"] input').fill('cloth cap')
  const found = await settle(() => page.locator('[data-testid="gear-row"]').count(), value => value > 0)
  check('Browse all retains actual item search', found > 0)
  await page.locator('[data-testid="gear-section-recommended"]').click()
}

export async function gearProgressionLayout(app: ElectronApplication, page: Page): Promise<void> {
  const win = await app.browserWindow(page)
  await page.locator('[data-testid="gear-progression-scroll"]').evaluate(node => { node.scrollTop = 0 })
  await capture(app, page, 'gear-progression-dark-normal')
  await win.evaluate(window => window.setSize(900, 700))
  await settle(() => page.evaluate(() => window.innerWidth), value => value >= 850 && value <= 900)
  await page.locator('[data-testid="gear-progression-scroll"]').evaluate(node => { node.scrollTop = 0 })
  const fits = await page.locator('[data-testid="gear-view"]').evaluate(node => {
    const box = node.getBoundingClientRect()
    return box.right <= window.innerWidth + 1 && node.scrollWidth <= node.clientWidth + 1
  })
  check('the Gear screen fits the minimum desktop width', fits)
  const action = await page.locator('[data-testid="gear-show-where"], [data-testid="gear-show-how"]').boundingBox()
  check('the main action is large enough to target easily', Boolean(action && action.height >= 44 && action.width >= 140))
  await capture(app, page, 'gear-progression-dark-narrow')
}

/** Wake the hidden compositor without making a test window visible on the user's desktop. */
async function capture(app: ElectronApplication, page: Page, tag: string): Promise<void> {
  const win = await app.browserWindow(page)
  await win.evaluate(async window => { await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true }) })
  await settle(() => page.locator('[aria-label="Gear sections"]').evaluate(tabs => {
    const selected = tabs.querySelector('[aria-selected="true"]')?.getBoundingClientRect()
    const indicator = tabs.querySelector('.MuiTabs-indicator')?.getBoundingClientRect()
    return Boolean(selected && indicator && Math.abs(selected.left - indicator.left) < 1 && !tabs.querySelector('.MuiTouchRipple-ripple'))
  }), Boolean, { timeoutMs: 5_000 })
  const base64 = await win.evaluate(async window => {
    window.webContents.invalidate()
    await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })
    const image = await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })
    return image.toPNG().toString('base64')
  })
  mkdirSync(ARTIFACTS, { recursive: true })
  writeFileSync(join(ARTIFACTS, `${tag}.png`), Buffer.from(base64, 'base64'))
}
