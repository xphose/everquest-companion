/** Real renderer, preload, metadata worker, service and disk installer against an isolated game.
 * Only native replies for the staged install are controlled; no real character file is opened. */
import { readFileSync } from 'node:fs'
import type { ElectronApplication, Page } from 'playwright-core'
import type { MacroAssistantMutation, MacroAssistantMutationResult, MacroAssistantSnapshot } from '../../src/shared/macroAssistant'
import { buildIfStale, check, dumpArtifacts, failures, reportRun, settle } from './appHarness.mjs'
import { mainWindow, makeUserData, removeUserData } from './appWindow.mjs'
import { launchOnFixture, stageFixture, type FixtureLog } from './logFixture.mjs'
import { CHARACTER_INI, PERSONAL_INI, controlMacroWorker, macroReads, publishMacroPlayer, stageMacros } from './macroFixture.mjs'
import { verifyMacroSlots } from './macroSlots.mjs'

interface Bridge {
  getMacroAssistant(): Promise<MacroAssistantSnapshot>
  mutateMacroAssistant(mutation: MacroAssistantMutation): Promise<MacroAssistantMutationResult>
}
function snapshot(page: Page): Promise<MacroAssistantSnapshot> {
  return page.evaluate(() => (window as unknown as { eq: Bridge }).eq.getMacroAssistant())
}
function mutate(page: Page, mutation: MacroAssistantMutation): Promise<MacroAssistantMutationResult> {
  return page.evaluate((value) => (window as unknown as { eq: Bridge }).eq.mutateMacroAssistant(value), mutation)
}
async function expectSnapshot(page: Page, predicate: (value: MacroAssistantSnapshot) => boolean, label: string): Promise<MacroAssistantSnapshot> {
  const value = await settle(() => snapshot(page), predicate, { timeoutMs: 20_000 })
  if (!check(label, predicate(value), value.installation.message)) throw new Error(label)
  return value
}
async function openMacros(page: Page): Promise<void> {
  await page.click('[data-testid="nav-macros"]')
  await page.waitForSelector('[data-testid="macros-view"]', { timeout: 30_000 })
}

async function liveSuggestions(app: ElectronApplication, page: Page): Promise<void> {
  await openMacros(page)
  let state = await expectSnapshot(page, (s) => s.context.live && s.context.knownSpells === 6,
    'the native spellbook joins the installed client table through the real worker')
  check('the header reports the current level and filled gems', state.context.level === 10 && state.context.memorizedSpells === 6)
  check('ownership and selected classes gate suggestions', !state.recipes.some((r) => r.role === 'mez' || r.requiredSpellIds.includes(1003)))
  check('compound preparation and pet opener recipes are executable',
    state.recipes.some((r) => r.role === 'self-buffs' && r.ready && r.lines.length === 3 && r.lines[0] === '/pause 3, /target Primitive') &&
    state.recipes.some((r) => r.role === 'pet-opener' && r.ready && r.lines[0] === '/pet attack'))
  check('an existing broken personal macro has a precise repair suggestion', state.existing.some((s) =>
    s.name === 'Pet Opener' && !s.managed && s.issues.some((i) => i.code === 'missing-slash' && i.suggestion === '/pause 30, /cast 1')))
  check('the single matching loadout is discovered', state.installation.targetFile === CHARACTER_INI)
  const wrong = await mutate(page, { characterId: 'OtherCharacter@freeport', action: 'configure', settings: { autoUpdate: true } })
  check('a stale character mutation is rejected', !wrong.ok)
  await publishMacroPlayer(app, { classes: ['MAG', 'SHM', 'ENC'] })
  state = await expectSnapshot(page, (s) => s.context.classes.includes('ENC') && s.recipes.some((r) => r.role === 'mez' && r.ready),
    'a newly selected third class adds crowd-control suggestions automatically')
  check('the visible view shows current classes', (await page.locator('[data-testid="macros-context"]').innerText()).includes('10'))
  await publishMacroPlayer(app, { book: [1001, 1002, 2001, 3001, 3002, 4001, 5001] })
  await expectSnapshot(page, (s) => s.recipes.some((r) => r.role === 'damage' && r.ready && r.upgrade?.to.id === 1002 && r.requiredSpellIds.includes(1001)),
    'learning a rank offers an upgrade while retaining the currently memorized rank')
}

async function queueInUi(page: Page, file: string): Promise<void> {
  await page.click('[data-testid="macros-starter-set"]')
  await expectSnapshot(page, (s) => s.settings.selections.some((r) => r.role === 'damage'), 'the starter set selects useful ready recipes')
  // This switch reflects an IPC acknowledgement, so wait for the resulting snapshot after click.
  await page.locator('[data-testid="macros-auto-update"]').click()
  await expectSnapshot(page, (s) => s.settings.autoUpdate && s.installation.state === 'pending' && s.installation.pendingCount > 0,
    'automatic installation queues reviewed selections while the client is running')
  check('queuing leaves the running game settings byte-for-byte unchanged', readFileSync(file, 'latin1') === PERSONAL_INI)
  await page.click('[data-testid="nav-overview"]')
  await page.waitForSelector('[data-testid="macros-view"]', { state: 'detached' })
}

async function backgroundInstall(app: ElectronApplication, page: Page, file: string): Promise<void> {
  const first = await macroReads(app)
  await publishMacroPlayer(app, { gems: [2001, 3001, 3002, 4001, 5001, 1002, ...Array<null>(12).fill(null)] })
  const refreshed = await settle(() => macroReads(app), (count) => count >= first + 2, { timeoutMs: 20_000 })
  check('automatic updates keep observing after leaving the Macros tab', refreshed >= first + 2)
  for (const mode of ['unsupported', 'unavailable'] as const) {
    await publishMacroPlayer(app, { mode })
    const before = await macroReads(app)
    await settle(() => macroReads(app), (count) => count >= before + 2, { timeoutMs: 20_000 })
    check(`${mode} does not count as a stopped game`, readFileSync(file, 'latin1') === PERSONAL_INI)
  }
  await publishMacroPlayer(app, { mode: 'not-running' })
  const applied = await settle(async () => readFileSync(file, 'latin1'), (text) => text !== PERSONAL_INI, { timeoutMs: 20_000 })
  check('the background service installs after verified process exit', applied !== PERSONAL_INI)
  check('the latest memorized rank and reordered gem are reflected in installed commands', applied.includes('/cast Test Flare II'))
  check('self-targeting uses the observed character name supported by the client', applied.includes('/target Primitive') && !applied.includes('/target myself'))
  check('personal social, hotbutton and unrelated defaults survive',
    applied.includes('Page2Button6Line2=/pause 30, cast 1\r\n') &&
    applied.includes('Page1Button1=E17,@-1,0000000000000000,0,Personal,\r\n') &&
    applied.includes('[Defaults]\r\nKeep=unchanged\r\n'))
  check('managed buttons use the requested separate hotbar', applied.includes('[HotButtons4]'))
  await openMacros(page)
  const state = await expectSnapshot(page, (s) => s.installation.state === 'applied' && s.installation.canRestore,
    'reopening the view reports application and offers its saved backup')
  check('installed socials are identified as managed', state.existing.some((s) => s.managed))
  await page.click('[data-testid="macros-restore"]')
  await expectSnapshot(page, (s) => !s.settings.autoUpdate && s.installation.pendingCount === 0 && !s.installation.canRestore,
    'restore also disables automatic reapplication and clears the queue')
  check('restore reproduces the exact original bytes', readFileSync(file, 'latin1') === PERSONAL_INI)
}

async function session(log: FixtureLog, userData: string, file: string): Promise<void> {
  const launched = await launchOnFixture(log, { userData })
  let page: Page | null = null
  try {
    await controlMacroWorker(launched.app, log.installDir)
    page = await mainWindow(launched.app)
    await page.waitForSelector('[data-testid="nav-macros"]', { timeout: 30_000 })
    const notice = page.locator('[data-testid="telemetry-notice-off"]')
    if (await notice.count()) await notice.click()
    await liveSuggestions(launched.app, page)
    await verifyMacroSlots(launched.app, page)
    await dumpArtifacts(page, 'macros-ready')
    await queueInUi(page, file)
    await backgroundInstall(launched.app, page, file)
    if (failures.length) await dumpArtifacts(page, 'macros-FAIL')
  } catch (cause) {
    if (page) await dumpArtifacts(page, 'macros-ERROR')
    throw cause
  } finally { await launched.close() }
}

async function main(): Promise<void> {
  buildIfStale()
  const log = stageFixture('cw7-who-swap-boundary-aug12.log')
  const userData = makeUserData()
  try { await session(log, userData, stageMacros(log.installDir)) }
  finally { await log.dispose(); await removeUserData(userData) }
  reportRun()
}
main().catch((cause: unknown) => { console.error(cause); process.exitCode = 1 })
