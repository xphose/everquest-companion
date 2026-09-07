/** Reproduce a transient native source-list miss. Only desktop source discovery is staged;
 * the selected image still runs through the app's acquisition, native OCR, IPC and review. */
import type { ElectronApplication, Page } from 'playwright-core'
import { check } from './appHarness.mjs'

export async function checkRetriedGameCapture(app: ElectronApplication, page: Page, picture: string): Promise<void> {
  await app.evaluate(({ desktopCapturer, nativeImage }, path) => {
    const state = globalThis as unknown as { recoverySources?: { original: typeof desktopCapturer.getSources; calls: number } }
    state.recoverySources = { original: desktopCapturer.getSources, calls: 0 }
    desktopCapturer.getSources = async (options) => {
      if (options.types.length !== 1 || options.types[0] !== 'window') throw new Error('Recovery must request windows only')
      state.recoverySources!.calls += 1
      if (state.recoverySources!.calls === 1) return []
      return [{ id: 'window:7001:0', name: 'EverQuest Legends', display_id: '', appIcon: null, thumbnail: nativeImage.createFromPath(path) }]
    }
  }, picture)
  try {
    await page.click('[data-testid="quest-journal-recover"]')
    await page.waitForSelector('[data-testid="quest-recovery-count"]', { timeout: 60_000 })
    await page.click('[data-testid="quest-recovery-game"]')
    await page.getByRole('status').filter({ hasText: 'Switch back to EverQuest' }).waitFor()
    await page.waitForSelector('[data-testid="quest-recovery-count"]', { timeout: 60_000 })
    const calls = await app.evaluate(() => (globalThis as unknown as { recoverySources: { calls: number } }).recoverySources.calls)
    check('Read game journal automatically retries a missing native window', calls === 2, `${calls} acquisitions`)
    const row = page.locator('[data-testid="quest-recovery-candidate"][data-source="task-window"]').filter({ hasText: 'Blackburrow Brewers' })
    check('the retried game image reaches native OCR and the quest review', await row.count() === 1)
    await page.click('[data-testid="quest-recovery-recognized"]')
    check('the retried capture retains its exact objective count', /2\s*\/\s*3/u.test(await page.locator('[data-testid="quest-recovery-text"]').innerText()))
    await page.click('[data-testid="quest-recovery-cancel"]')
  } finally {
    await app.evaluate(({ desktopCapturer }) => {
      const state = globalThis as unknown as { recoverySources?: { original: typeof desktopCapturer.getSources } }
      if (state.recoverySources) desktopCapturer.getSources = state.recoverySources.original
      delete state.recoverySources
    })
  }
}
