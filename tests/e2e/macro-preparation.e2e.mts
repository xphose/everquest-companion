/** Real renderer, IPC, metadata worker and atomic installer. Native observations are controlled
 * only for the fixture's temporary install; this spec never opens or commands the real game. */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ElectronApplication, Page } from 'playwright-core'
import type { MacroAssistantMutation, MacroAssistantMutationResult, MacroAssistantSnapshot } from '../../src/shared/macroAssistant'
import type { MacroPreparationPlan } from '../../src/shared/macroPreparation'
import type { MacroSelection } from '../../src/shared/macros'
import { buildIfStale, check, dumpArtifacts, failures, reportRun, settle } from './appHarness.mjs'
import { mainWindow, makeUserData, removeUserData } from './appWindow.mjs'
import { launchOnFixture, stageFixture, type FixtureLog } from './logFixture.mjs'
import { controlMacroWorker, publishMacroPlayer } from './macroFixture.mjs'
import { COMBAT_GEMS, PREPARATION_BOOK, PREPARATION_DEFAULTS, PREPARATION_INI, stagePreparation } from './macroPreparationFixture.mjs'

interface Bridge {
  getMacroAssistant(): Promise<MacroAssistantSnapshot>
  mutateMacroAssistant(mutation: MacroAssistantMutation): Promise<MacroAssistantMutationResult>
}
const COMBAT_SELECTIONS: MacroSelection[] = [{ role: 'damage' }, { role: 'heal-self' }, { role: 'heal-target' },
  { role: 'heal-pet' }, { role: 'buff', spellLine: 'test armor' }, { role: 'buff', spellLine: 'test strength' }, { role: 'summon-pet' }, { role: 'loc' }]
function snapshot(page: Page): Promise<MacroAssistantSnapshot> {
  return page.evaluate(() => (window as unknown as { eq: Bridge }).eq.getMacroAssistant())
}
async function expectSnapshot(page: Page, predicate: (value: MacroAssistantSnapshot) => boolean, label: string): Promise<MacroAssistantSnapshot> {
  const value = await settle(() => snapshot(page), predicate, { timeoutMs: 20_000 })
  if (!check(label, predicate(value), value.preparation?.message ?? value.installation.message)) throw new Error(label)
  return value
}
async function phase(page: Page, expected: string): Promise<void> {
  const value = await settle(() => page.locator('[data-testid="macros-preparation-phase"]').getAttribute('data-phase'), (current) => current === expected, { timeoutMs: 20_000 })
  if (!check(`visible preparation phase is ${expected}`, value === expected)) throw new Error(`Expected ${expected}`)
}
async function configureCombat(page: Page, characterId: string): Promise<void> {
  const result = await page.evaluate((mutation) => (window as unknown as { eq: Bridge }).eq.mutateMacroAssistant(mutation),
    { characterId, action: 'configure', settings: { autoUpdate: true, selections: COMBAT_SELECTIONS, destination: { bar: 4, page: 1 } } } satisfies MacroAssistantMutation)
  check('existing eight combat selections are configured independently', result.ok && result.snapshot.settings.selections.length === 8)
}
async function openPreparation(app: ElectronApplication, page: Page): Promise<void> {
  await publishMacroPlayer(app, { book: PREPARATION_BOOK, gems: COMBAT_GEMS })
  await page.click('[data-testid="nav-macros"]')
  await page.waitForSelector('[data-testid="macros-preparation"]', { timeout: 30_000 })
  const state = await expectSnapshot(page, (s) => s.context.live && Boolean(s.preparation?.options.some((o) => o.spellId === 211)), 'owned food and drink arrive through the real metadata worker')
  check('startup selected classes exclude Enchanter-only preparation options', !state.preparation!.options.some((o) => o.spellId === 80))
  const card = page.locator('[data-testid="macros-preparation"]')
  check('new users see the two-supply preset and a separate default destination', (await card.innerText()).includes('2/4 utilities') &&
    (await page.locator('[data-testid="macros-preparation-bar"]').innerText()).includes('3'))
  await configureCombat(page, state.characterId!)
  await expectSnapshot(page, (s) => s.settings.selections.length === 8, 'combat selections persist before preparing supplies')
  await page.click('[data-testid="macros-preparation-food-drink"]')
  await page.locator('[data-testid="macros-preparation-page"] [role="combobox"]').click()
  await page.getByRole('option', { name: '2', exact: true }).click()
  await page.click('[data-testid="macros-preparation-details"]')
  await page.locator('[data-testid="macros-preparation-supplies"]').waitFor({ state: 'visible' })
  check('the preview shows the combined cast/stow commands and exact return spell', (await card.innerText()).includes('/autoinventory') && (await card.innerText()).includes('restore Test Familiar'))
}
async function queue(page: Page, file: string): Promise<MacroPreparationPlan> {
  await page.click('[data-testid="macros-preparation-queue"]')
  const state = await expectSnapshot(page, (s) => s.preparation?.installation?.state === 'pending', 'preparation queues without writing the running game files')
  const text = await settle(() => page.locator('[data-testid="macros-notification"]').innerText(), (value) => value.includes('Preparation queued'), { timeoutMs: 10_000 })
  check('manual preparation acknowledgement includes the chosen hotbar page', text.includes('Preparation queued, not written yet') && text.includes('Hotbar 3 · Page 2'))
  check('ordinary hotbar and eight selected combat macros remain unchanged', state.settings.destination.bar === 4 && JSON.stringify(state.settings.selections) === JSON.stringify(COMBAT_SELECTIONS))
  check('queueing leaves all character settings unchanged', readFileSync(file, 'latin1') === PREPARATION_INI)
  const install = state.preparation!.installation!
  check('personal and defaults-defined set indices are reserved', install.loadSetIndex === 3 && install.combatSetIndex === 4)
  check('default supplies package has five separate hotbuttons', install.buttons?.length === 5)
  return state.preparation!.plan!
}
function preparedGems(plan: MacroPreparationPlan): (number | null)[] {
  return [...plan.baseline.map((id, index) => plan.preparationGems[index] > 0 ? plan.preparationGems[index] : id), ...Array<null>(4).fill(null)]
}
async function transitions(app: ElectronApplication, page: Page, plan: MacroPreparationPlan): Promise<void> {
  const partial = [...COMBAT_GEMS]
  partial[plan.replacements[0].gem - 1] = null
  await publishMacroPlayer(app, { gems: partial })
  await phase(page, 'changing')
  check('partial memorization cannot recapture a combat baseline', await page.locator('[data-testid="macros-preparation-queue"]').isDisabled())
  await publishMacroPlayer(app, { gems: preparedGems(plan) })
  await phase(page, 'utility-ready')
  const ready = await snapshot(page)
  check('live readiness comes from both actual utility gems and preserves the captured baseline', ready.preparation!.readySpellIds.length === 2 &&
    JSON.stringify(ready.preparation!.plan!.baseline) === JSON.stringify(plan.baseline))
  await publishMacroPlayer(app, { classes: ['MAG', 'SHM', 'ENC'] })
  await phase(page, 'changed')
  const changed = await expectSnapshot(page, (s) => Boolean(s.preparation?.options.some((o) => o.spellId === 80)), 'a newly selected class adds its owned utility options')
  check('class changes cannot recapture active temporary utility gems', await page.locator('[data-testid="macros-preparation-queue"]').isDisabled())
  check('class changes never rewrite the saved baseline or combat selections', JSON.stringify(changed.preparation!.plan!.baseline) === JSON.stringify(plan.baseline) && JSON.stringify(changed.settings.selections) === JSON.stringify(COMBAT_SELECTIONS))
  await publishMacroPlayer(app, { gems: COMBAT_GEMS })
  await expectSnapshot(page, (s) => s.recipes.some((r) => r.role === 'mez' && r.ready), 'ordinary class-aware recommendations resume after the real combat gems return')
  const enabled = await settle(() => page.locator('[data-testid="macros-preparation-queue"]').isEnabled(), Boolean, { timeoutMs: 20_000 })
  check('a restored intended combat layout permits a fresh capture for the new classes', enabled)
}
async function installAndRestore(app: ElectronApplication, page: Page, file: string, root: string): Promise<void> {
  const captured = await queue(page, file)
  await publishMacroPlayer(app, { mode: 'unavailable' })
  await phase(page, 'unknown')
  check('an unavailable native observation never authorizes file writes', readFileSync(file, 'latin1') === PREPARATION_INI)
  await publishMacroPlayer(app, { mode: 'not-running' })
  const saved = await expectSnapshot(page, (s) => s.preparation?.installation?.state === 'saved' && s.installation.canRestore, 'a verified stopped game permits one complete settings installation')
  const contents = readFileSync(file, 'latin1')
  check('the atomic package includes both numeric spell-set buttons, combined supplies, and individual supplies',
    ['/memspellset 3', '/memspellset 4', 'Make Supplies', 'Make Food', 'Make Drink', '/cast Summon Food', '/cast Summon Drink'].every((value) => contents.includes(value)))
  check('return sets contain the exact captured positive combat spell IDs', captured.replacements.every((slot) => contents.includes(`SpellLoadout4.slot${slot.gem}=${slot.originalSpellId}`)))
  check('personal socials, hotbuttons, inactive sets and defaults survive', contents.includes('Page2Button6Line2=/pause 30, cast 1\r\n') &&
    contents.includes('Page1Button1=E17,@-1,0000000000000000,0,Personal,\r\n') && contents.includes('SpellLoadout2.name=Personal inactive\r\n') &&
    readFileSync(join(root, 'defaults.ini'), 'latin1') === PREPARATION_DEFAULTS)
  check('combat and preparation hotbar destinations remain separate', contents.includes('[HotButtons4]') && contents.includes('[HotButtons3]') && saved.settings.selections.length === 8)
  await page.locator('[data-testid="macros-preparation-status"][data-state="saved"]').waitFor({ state: 'visible', timeout: 20_000 })
  const notice = await page.locator('[data-testid="macros-preparation-status"]').innerText()
  check('saved feedback includes the requested destination and truthful next-launch instruction', notice.includes('Hotbar 3 · Page 2') && notice.includes('Start or restart EverQuest'), notice)
  await publishMacroPlayer(app, { mode: 'live', gems: COMBAT_GEMS })
  await phase(page, 'combat')
  await publishMacroPlayer(app, { gems: preparedGems(captured) })
  await phase(page, 'utility-ready')
  await publishMacroPlayer(app, { gems: COMBAT_GEMS })
  await phase(page, 'combat')
  check('restoring exact gems is reported from observation without a guessed delay', JSON.stringify((await snapshot(page)).preparation!.plan!.baseline) === JSON.stringify(captured.baseline))
  await publishMacroPlayer(app, { mode: 'not-running' })
  await expectSnapshot(page, (s) => !s.context.live && s.installation.canRestore, 'file restore waits for a verified stopped game')
  await page.click('[data-testid="macros-restore"]')
  await expectSnapshot(page, (s) => !s.settings.autoUpdate && !s.installation.canRestore, 'backup restoration completes without automatic reapplication')
  check('owned backup restoration exactly reproduces original character bytes', readFileSync(file, 'latin1') === PREPARATION_INI)
}
async function session(log: FixtureLog, userData: string, file: string): Promise<void> {
  const launched = await launchOnFixture(log, { userData })
  let page: Page | null = null
  try {
    await controlMacroWorker(launched.app, log.installDir)
    page = await mainWindow(launched.app)
    await page.waitForSelector('[data-testid="nav-macros"]', { timeout: 30_000 })
    const telemetry = page.locator('[data-testid="telemetry-notice-off"]')
    if (await telemetry.count()) await telemetry.click()
    await openPreparation(launched.app, page)
    const plan = await queue(page, file)
    await transitions(launched.app, page, plan)
    await installAndRestore(launched.app, page, file, log.installDir)
    await dumpArtifacts(page, failures.length ? 'macro-preparation-FAIL' : 'macro-preparation-ready')
  } catch (error) { if (page) await dumpArtifacts(page, 'macro-preparation-ERROR'); throw error }
  finally { await launched.close() }
}
async function main(): Promise<void> {
  buildIfStale()
  const log = stageFixture('cw7-who-swap-boundary-aug12.log')
  const userData = makeUserData()
  try { await session(log, userData, stagePreparation(log.installDir)) }
  finally { await log.dispose(); await removeUserData(userData) }
  reportRun()
}
main().catch((error: unknown) => { console.error(error); process.exitCode = 1 })
