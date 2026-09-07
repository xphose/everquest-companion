/** Recovery through real Electron IPC, saved exports and native Windows OCR. The generated PNG
 * is explicitly synthetic. The OS picker and one transient source-list miss are staged;
 * OCR and recovery results are never mocked. */
import type { ElectronApplication, Page } from 'playwright-core'
import type { EqApi } from '../../src/preload/index'
import { ARTIFACTS, buildIfStale, check, dumpArtifacts, failures, reportRun, settle, settleGone } from './appHarness.mjs'
import { mainWindow, makeUserData, removeUserData } from './appWindow.mjs'
import { launchOnFixture, stageFixture, type FixtureLog } from './logFixture.mjs'
import { chooseRecoveryPicture, holdRecoveryPicker, recoveryPicture, releaseRecoveryPicker } from './quest-recovery-images.mjs'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { checkRetriedGameCapture } from './quest-recovery-window.mjs'

type Bridge = Pick<EqApi, 'questJournalQuery' | 'questJournalDetail' | 'questJournalRecoverScan' | 'questJournalRecoverCommit' | 'setCharacter'>
const DIALOG = '[data-testid="quest-recovery-dialog"]'
const CANDIDATE = '[data-testid="quest-recovery-candidate"]'
const APPLY = '[data-testid="quest-recovery-apply"]'
const CONFIRM = '[data-testid="quest-recovery-character-confirm"] input'
const ACTIVE = 'Blackburrow Brewers'
const HISTORY = 'Clay Bracelet Quest'
const EARNED = 'posky:Ranger::Ranger Test of Defense'
const shown = (page: Page, selector: string): Promise<string> => page.locator(selector).first().innerText().catch(() => '')
const query = (page: Page) => page.evaluate(() => (window as unknown as { eq: Bridge }).eq.questJournalQuery({}))
const detail = (page: Page, characterId: string, id: string) => page.evaluate((value) => (window as unknown as { eq: Bridge }).eq.questJournalDetail(value), { characterId, id })

async function pickCharacter(page: Page, path: string, name: string): Promise<string> {
  await page.evaluate((value) => (window as unknown as { eq: Bridge }).eq.setCharacter(value), path)
  const ready = await settle(() => query(page), (value) => value.context.characterName === name && value.context.readiness === 'ready', { timeoutMs: 60_000 })
  if (!ready.context.characterId || ready.context.characterName !== name) throw new Error('Fixture character did not load')
  return ready.context.characterId
}

async function openJournal(page: Page): Promise<void> {
  await page.waitForSelector('[data-testid="nav-questJournal"]', { timeout: 60_000 })
  const notice = page.locator('[data-testid="telemetry-notice-off"]')
  if (await notice.count()) await notice.click()
  await page.click('[data-testid="nav-questJournal"]')
  await page.waitForSelector('[data-testid="quest-journal-recover"]')
}

async function openRecovery(page: Page): Promise<void> {
  await page.click('[data-testid="quest-journal-recover"]')
  await page.waitForSelector(DIALOG)
  await page.waitForSelector('[data-testid="quest-recovery-count"]', { timeout: 60_000 })
}

async function waitReview(page: Page): Promise<void> {
  await page.waitForSelector('[data-testid="quest-recovery-count"]', { timeout: 60_000 })
  check('review identifies source availability', await page.locator('[data-testid="quest-recovery-sources"]').count() === 1)
}

async function confirmAndApply(page: Page): Promise<void> {
  check('saving requires an explicit character confirmation', await page.locator(APPLY).isDisabled())
  await page.locator(CONFIRM).check()
  await page.click(APPLY)
  check('a reviewed recovery saves and returns to the journal', await settleGone(page, DIALOG, { timeoutMs: 30_000 }))
}

async function savedFiles(page: Page, characterId: string): Promise<void> {
  await openRecovery(page)
  await waitReview(page)
  const exact = page.locator(CANDIDATE).filter({ hasText: 'Ranger Test of Defense' })
  check('the earned achievement is a confirmed, preselected recovery', await exact.getAttribute('data-confidence') === 'confirmed' && await exact.locator('input').isChecked())
  const likely = page.locator(`${CANDIDATE}[data-confidence="likely"]`)
  check('inventory-only clues are shown for review', await likely.count() > 0)
  check('likely evidence is never selected by default', await likely.locator('input:checked').count() === 0)
  await page.getByRole('button', { name: 'Select all suggestions too', exact: true }).click()
  check('selecting every suggestion is an explicit bulk review action', await likely.locator('input:checked').count() === await likely.count())
  await page.getByRole('button', { name: 'Clear selection', exact: true }).click()
  check('bulk clear removes the review selection', await page.locator(`${CANDIDATE} input:checked`).count() === 0)
  await page.getByRole('button', { name: 'Select confirmed', exact: true }).click()
  check('bulk select still leaves likely evidence unselected', await likely.locator('input:checked').count() === 0)
  await confirmAndApply(page)
  const recovered = await detail(page, characterId, EARNED)
  check('saved-file recovery persists evidence separately from manual corrections', recovered.recovered?.source === 'achievement' && recovered.manual.status === undefined)
}

async function imageRecovery(app: ElectronApplication, page: Page, options: { path: string; quest: string; characterId: string; state: 'active' | 'completed' }): Promise<void> {
  const { path, quest, characterId, state } = options
  await chooseRecoveryPicture(app, path)
  await openRecovery(page)
  await page.click('[data-testid="quest-recovery-image"]')
  await waitReview(page)
  const row = page.locator(CANDIDATE).filter({ hasText: quest })
  check(`actual Windows OCR recognizes ${quest}`, await row.count() === 1)
  await page.click('[data-testid="quest-recovery-recognized"]')
  check('recognized text and original image are available for review',
    (await shown(page, '[data-testid="quest-recovery-text"]')).includes(quest) && await page.getByAltText('Journal image used for recovery').count() === 1)
  if (state === 'active') {
    const owner = page.locator('[data-testid="quest-recovery-objective-owner"] [role="combobox"]')
    const available = await owner.count() === 1
    check('the visible objectives are recovered for optional association', available)
    if (available) {
      check('objectives start unassigned until the visible task is identified', (await owner.innerText()).includes('Leave unassigned'))
      await owner.click()
      await page.getByRole('option', { name: quest, exact: true }).click()
    }
  }
  await confirmAndApply(page)
  const recovered = await settle(() => detail(page, characterId, quest), (value) => value.row?.state === state, { timeoutMs: 15_000 })
  check(`recovered ${state} state appears in the ordinary journal`, recovered.row?.state === state && recovered.recovered !== undefined)
  await page.locator('[data-testid="quest-journal-search"] input').fill(quest)
  await page.locator(`[data-testid="quest-journal-row"][data-quest-id="${quest}"]`).click()
  await page.waitForSelector('[data-testid="quest-journal-recovered"]')
  if (state === 'active') check('recovered objective counts are visible without a duplicate checklist', (await shown(page, '[data-testid="quest-journal-recovered"]')).includes('2 / 3'))
}

async function unrelatedImage(app: ElectronApplication, page: Page, path: string): Promise<void> {
  await chooseRecoveryPicture(app, path)
  await openRecovery(page)
  await page.click('[data-testid="quest-recovery-image"]')
  await waitReview(page)
  check('a companion source page cannot produce quest-window completion evidence', await page.locator(`${CANDIDATE}[data-source="history-window"], ${CANDIDATE}[data-source="task-window"]`).count() === 0)
  check('unrelated images leave an explicit explanation', (await shown(page, '[data-testid="quest-recovery-sources"]')).length > 30)
  await page.click('[data-testid="quest-recovery-cancel"]')
}

async function staleReview(app: ElectronApplication, page: Page, options: { log: FixtureLog; characterId: string; image: string }): Promise<void> {
  const { log, characterId, image } = options
  const draft = await page.evaluate((value) => (window as unknown as { eq: Bridge }).eq.questJournalRecoverScan({ characterId: value, source: 'files' }), characterId)
  if (!draft.ok) throw new Error(draft.error)
  await holdRecoveryPicker(app)
  await openRecovery(page)
  await page.click('[data-testid="quest-recovery-image"]')
  await page.getByRole('status').filter({ hasText: 'Reading the selected source' }).waitFor()
  const altId = await pickCharacter(page, log.others.Recoveryalt, 'Recoveryalt')
  check('a character switch closes and discards the pending scan', await settleGone(page, DIALOG))
  await releaseRecoveryPicker(app, image)
  const refused = await page.evaluate((request) => (window as unknown as { eq: Bridge }).eq.questJournalRecoverCommit(request), {
    action: 'apply' as const, characterId, draftId: draft.draft.id, candidateIds: draft.draft.candidates.map((row) => row.id), confirmedCharacter: true
  })
  check('the backend refuses a stale-character recovery draft', !refused.ok)
  check('the other character inherits no recovered quest history', (await detail(page, altId, HISTORY)).recovered === undefined)
  // A cancelled UI no longer owns the native OCR operation. Wait for its actual completion
  // before asking the new character to read another source; do not bet on an OCR duration.
  await settle(() => page.evaluate((value) => (window as unknown as { eq: Bridge }).eq.questJournalRecoverScan({ characterId: value, source: 'files' }), altId), (value) => value.ok, { timeoutMs: 60_000 })
  await openRecovery(page)
  await waitReview(page)
  check('missing saved files produce a readable empty review', (await shown(page, '[data-testid="quest-recovery-count"]')).includes('0 found') && (await shown(page, '[data-testid="quest-recovery-sources"]')).includes('missing'))
  await page.click('[data-testid="quest-recovery-cancel"]')
  await pickCharacter(page, log.logPath, 'Primitive')
}

async function narrowReview(app: ElectronApplication, page: Page): Promise<void> {
  const win = await app.browserWindow(page)
  await win.evaluate((w) => { w.setMinimumSize(360, 360); w.setBounds({ ...w.getBounds(), width: 900, height: 850 }) })
  await settle(() => page.evaluate(() => document.documentElement.clientWidth), (v) => Math.abs(v - 900) < 24)
  await openRecovery(page)
  await waitReview(page)
  check('the recovery review fits the narrow window', await page.locator(DIALOG).evaluate((el) => el.scrollWidth <= el.clientWidth + 1))
  await dumpArtifacts(page, 'recovery-narrow')
  const shot = await win.evaluate(async (w) => {
    w.webContents.invalidate()
    await w.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })
    return (await w.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG().toString('base64')
  })
  mkdirSync(ARTIFACTS, { recursive: true })
  writeFileSync(join(ARTIFACTS, 'recovery-narrow.png'), Buffer.from(shot, 'base64'))
  await page.click('[data-testid="quest-recovery-cancel"]')
}

async function runSession(log: FixtureLog, userData: string): Promise<void> {
  const launched = await launchOnFixture(log, { userData })
  let page: Page | undefined
  try {
    page = await mainWindow(launched.app)
    const id = await pickCharacter(page, log.logPath, 'Primitive')
    await openJournal(page)
    const active = await recoveryPicture(launched.app, log.installDir, 'active')
    const history = await recoveryPicture(launched.app, log.installDir, 'history')
    const unrelated = await recoveryPicture(launched.app, log.installDir, 'source-page')
    await savedFiles(page, id)
    await checkRetriedGameCapture(launched.app, page, active)
    await imageRecovery(launched.app, page, { path: active, quest: ACTIVE, characterId: id, state: 'active' })
    await imageRecovery(launched.app, page, { path: history, quest: HISTORY, characterId: id, state: 'completed' })
    await unrelatedImage(launched.app, page, unrelated)
    await staleReview(launched.app, page, { log, characterId: id, image: active })
    await narrowReview(launched.app, page)
    if (failures.length) await dumpArtifacts(page, 'recovery-failed')
  } catch (cause) { if (page) await dumpArtifacts(page, 'recovery-error'); throw cause }
  finally { await launched.close() }
}

async function restartAndForget(log: FixtureLog, userData: string): Promise<void> {
  const launched = await launchOnFixture(log, { userData })
  try {
    const page = await mainWindow(launched.app)
    const id = await pickCharacter(page, log.logPath, 'Primitive')
    await openJournal(page)
    check('active recovery and objectives survive a full restart', (await detail(page, id, ACTIVE)).recovered?.objectives?.[0]?.current === 2)
    check('completed recovery survives a full restart', (await detail(page, id, HISTORY)).row?.state === 'completed')
    await openRecovery(page)
    await page.click('[data-testid="quest-recovery-forget"]')
    await page.waitForSelector('[data-testid="quest-recovery-forget-confirm"]')
    check('forgetting recovery requires an inline confirmation', (await detail(page, id, HISTORY)).recovered !== undefined)
    await page.getByRole('button', { name: 'Forget recovered data', exact: true }).click()
    await settleGone(page, DIALOG)
    check('forget removes recovered history', (await detail(page, id, HISTORY)).recovered === undefined)
    check('forget preserves ordinary achievement evidence', (await detail(page, id, EARNED)).row?.state === 'completed')
  } finally { await launched.close() }
}

async function main(): Promise<void> {
  buildIfStale()
  const log = stageFixture('e2e-deep-link.log', { inventory: 'Primitive_freeport-Inventory.txt', achievements: 'Primitive_freeport-Achievements.txt', others: { Recoveryalt: 'e2e-leveling.log' } })
  const userData = makeUserData()
  try { await runSession(log, userData); await restartAndForget(log, userData) }
  finally { await log.dispose(); await removeUserData(userData) }
  reportRun()
}

main().catch((cause: unknown) => { console.error(cause); process.exitCode = 1 })
