/** Explicit repair UI uses synthetic files and the real stopped-game atomic installer. */
import { readFileSync, writeFileSync } from 'node:fs'
import type { Page } from 'playwright-core'
import type { MacroAssistantSnapshot } from '../../src/shared/macroAssistant'
import { buildIfStale, check, dumpArtifacts, failures, reportRun, settle } from './appHarness.mjs'
import { mainWindow, makeUserData, removeUserData } from './appWindow.mjs'
import { launchOnFixture, stageFixture } from './logFixture.mjs'
import { controlMacroWorker, publishMacroPlayer, stageMacros, PERSONAL_INI } from './macroFixture.mjs'

function snapshot(page: Page): Promise<MacroAssistantSnapshot> {
  return page.evaluate(() => (window as unknown as { eq: { getMacroAssistant(): Promise<MacroAssistantSnapshot> } }).eq.getMacroAssistant())
}
async function repairedFile(file: string, original: string): Promise<void> {
  const written = await settle(() => readFileSync(file, 'latin1'), (value) => value !== original, { timeoutMs: 20_000 })
  check('verified exit applies the explicitly reviewed replacement', written !== original)
  check('the repaired slot keeps its name and casts verified full buff names',
    written.includes('Page2Button9Name=Buffs') && written.includes('/cast Test Armor') && written.includes('/cast Test Strength') &&
    !written.includes('Page2Button9Line1=/cast 1'))
  check('the original hotbutton reference and other personal social remain unchanged',
    written.includes('Page1Button2=E20,@-1,0000000000000000,0,Old Buffs,') &&
    written.includes('Page2Button6Line2=/pause 30, cast 1'))
}
async function main(): Promise<void> {
  buildIfStale()
  const log = stageFixture('cw7-who-swap-boundary-aug12.log')
  const userData = makeUserData()
  const file = stageMacros(log.installDir)
  const original = PERSONAL_INI.replace('[Socials]\r\n', '[Socials]\r\nPage2Button9Name=Buffs\r\nPage2Button9Color=3\r\nPage2Button9Line1=/cast 1\r\n')
    .replace('[HotButtons2]\r\n', '[HotButtons2]\r\nPage1Button2=E20,@-1,0000000000000000,0,Old Buffs,\r\n')
  writeFileSync(file, original, 'latin1')
  const launched = await launchOnFixture(log, { userData })
  let page: Page | null = null
  try {
    await controlMacroWorker(launched.app, log.installDir)
    page = await mainWindow(launched.app)
    await page.waitForSelector('[data-testid="nav-macros"]', { timeout: 30_000 })
    const notice = page.locator('[data-testid="telemetry-notice-off"]')
    if (await notice.count()) await notice.click()
    await page.click('[data-testid="nav-macros"]')
    const activePage = page
    const state = await settle(() => snapshot(activePage), (value) => value.existing.some((social) => social.repair !== undefined), { timeoutMs: 20_000 })
    check('a stale personal Buffs social gets a fresh scoped repair offer', state.existing.some((social) => social.name === 'Buffs' && social.repair))
    await page.getByTestId('macros-existing').getByRole('button', { name: /^Buffs / }).click()
    const repair = page.getByTestId('macros-repair-2-9')
    await repair.waitFor({ state: 'visible' })
    const preview = await repair.innerText()
    check('the repair shows exact replacement commands before the explicit action', preview.includes('/cast Test Armor') && preview.includes('/cast Test Strength'))
    await repair.getByRole('button', { name: 'Replace with Self Buffs' }).click()
    await page.getByTestId('macros-notification').waitFor({ state: 'visible' })
    check('the explicit click acknowledges queuing without claiming a running-game write',
      (await page.getByTestId('macros-notification').innerText()).includes('Queued, not written yet') && readFileSync(file, 'latin1') === original)
    await publishMacroPlayer(launched.app, { mode: 'unsupported' })
    await settle(() => snapshot(activePage), (value) => !value.context.live)
    check('an unsupported native response preserves the queued repair without writing', readFileSync(file, 'latin1') === original)
    await publishMacroPlayer(launched.app, { mode: 'not-running' })
    await repairedFile(file, original)
    const saved = await settle(() => page!.getByTestId('macros-status').innerText(), (text) => text.includes('Saved to character settings'), { timeoutMs: 20_000 })
    check('the completed repair reports a saved receipt and restart instructions', saved.includes('Start EverQuest'))
    const installed = await snapshot(page)
    check('the repaired personal slot now has distinct managed ownership', installed.existing.some((social) => social.page === 2 && social.button === 9 && social.managed))
    await page.getByTestId('macros-restore').click()
    await settle(() => readFileSync(file, 'latin1'), (value) => value === original, { timeoutMs: 20_000 })
    check('restore returns the exact original personal macro and hotbuttons', readFileSync(file, 'latin1') === original)
    if (failures.length) await dumpArtifacts(page, 'macros-repair-FAIL')
  } catch (error) {
    if (page) await dumpArtifacts(page, 'macros-repair-ERROR')
    throw error
  } finally { await launched.close(); await log.dispose(); await removeUserData(userData) }
  reportRun()
}
main().catch((error: unknown) => { console.error(error); process.exitCode = 1 })
