/** Real macro UI/metadata worker with synthetic game files and controlled native observations. */
import { appendFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ElectronApplication, Page } from 'playwright-core'
import type { MacroAssistantSnapshot } from '../../src/shared/macroAssistant'
import { buildIfStale, check, dumpArtifacts, failures, reportRun, settle } from './appHarness.mjs'
import { mainWindow, makeUserData, removeUserData } from './appWindow.mjs'
import { launchOnFixture, stageFixture, type FixtureLog } from './logFixture.mjs'
import { controlMacroWorker, publishMacroPlayer, stageMacros } from './macroFixture.mjs'

function stageFinisher(root: string): string {
  const file = stageMacros(root)
  const fields = Array<string>(173).fill('0')
  fields[0] = '6001'; fields[1] = 'Flame Bolt'
  fields[8] = '1800'; fields[9] = '1500'; fields[10] = '2000'; fields[14] = '20'
  fields[30] = '1'
  for (let index = 36; index <= 51; index++) fields[index] = '255'
  fields[48] = '5'; fields[172] = '0|0|-40|0|102|55'
  appendFileSync(join(root, 'spells_us.txt'), `${fields.join('^')}\n`, 'latin1')
  appendFileSync(file, '[Socials]\r\nPage2Button9Name=Buffs\r\nPage2Button9Line1=/pause 45, /cast 4\r\nPage2Button9Line2=/cast 5\r\n', 'latin1')
  return file
}
function snapshot(page: Page): Promise<MacroAssistantSnapshot> {
  return page.evaluate(() => (window as unknown as { eq: { getMacroAssistant(): Promise<MacroAssistantSnapshot> } }).eq.getMacroAssistant())
}
async function bindingText(page: Page, pattern: RegExp): Promise<string> {
  const card = page.getByTestId('macros-recipe-finisher:flame bolt')
  const text = await settle(() => card.innerText(), (value) => pattern.test(value), { timeoutMs: 20_000 })
  check(`finisher preview ${pattern.source}`, pattern.test(text), text)
  return text
}
async function preview(app: ElectronApplication, page: Page): Promise<void> {
  await page.click('[data-testid="nav-macros"]')
  await page.waitForSelector('[data-testid="macros-view"]')
  await bindingText(page, /Gem 4: Flame Bolt/)
  const card = page.getByTestId('macros-recipe-finisher:flame bolt')
  check('projectile guidance accompanies the ready command', (await card.innerText()).includes('Projectiles take time'))
  await page.getByTestId('macros-select-finisher:flame bolt').click()
  const selected = await settle(() => snapshot(page), (state) => state.settings.selections.some((s) => s.role === 'finisher' && s.spellLine === 'flame bolt'))
  check('choosing the finisher pins its spell family', selected.settings.selections.some((s) => s.role === 'finisher' && s.spellLine === 'flame bolt'))
  const existing = page.getByTestId('macros-existing')
  await existing.getByRole('button', { name: /^Buffs / }).click()
  const audit = await existing.innerText()
  check('personal Buffs exposes a semantic binding warning', audit.includes('Flame Bolt from gem 4') && audit.includes('binding may be stale'))
  await publishMacroPlayer(app, { gems: [1001, 6001, 3002, 3001, 4001, 5001, 2001, ...Array<null>(11).fill(null)] })
  await bindingText(page, /Gem 2: Flame Bolt/)
  check('the same named command survives a gem reorder', (await card.locator('code').innerText()).includes('/cast Flame Bolt'))
  check('the chosen family remains selected', await page.getByTestId('macros-select-finisher:flame bolt').isChecked())
  await publishMacroPlayer(app, { unlockedSpellSlots: [1] })
  await bindingText(page, /Needs memorizing/)
  check('an occupied locked finisher has no executable preview', await card.locator('code').count() === 0)
  await publishMacroPlayer(app, { mode: 'unavailable' })
  await bindingText(page, /Current gem bindings are unavailable/)
  check('unknown native observations never display old gems as current', await card.getByTestId('macros-bindings').count() === 0)
}
async function session(log: FixtureLog, userData: string, file: string): Promise<void> {
  const before = readFileSync(file, 'latin1')
  const launched = await launchOnFixture(log, { userData })
  let page: Page | null = null
  try {
    await controlMacroWorker(launched.app, log.installDir)
    await publishMacroPlayer(launched.app, { book: [1001, 2001, 3001, 3002, 4001, 5001, 6001],
      gems: [1001, 3001, 3002, 6001, 4001, 5001, 2001, ...Array<null>(11).fill(null)] })
    page = await mainWindow(launched.app)
    await page.waitForSelector('[data-testid="nav-macros"]', { timeout: 30_000 })
    const notice = page.locator('[data-testid="telemetry-notice-off"]')
    if (await notice.count()) await notice.click()
    await preview(launched.app, page)
    check('preview and auditing never change personal game macros', readFileSync(file, 'latin1') === before)
    if (failures.length) await dumpArtifacts(page, 'macros-finisher-FAIL')
  } catch (cause) {
    if (page) await dumpArtifacts(page, 'macros-finisher-ERROR')
    throw cause
  } finally { await launched.close() }
}
async function main(): Promise<void> {
  buildIfStale()
  const log = stageFixture('cw7-who-swap-boundary-aug12.log')
  const userData = makeUserData()
  try { await session(log, userData, stageFinisher(log.installDir)) }
  finally { await log.dispose(); await removeUserData(userData) }
  reportRun()
}
main().catch((cause: unknown) => { console.error(cause); process.exitCode = 1 })
