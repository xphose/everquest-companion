import type { ElectronApplication, Page } from 'playwright-core'
import { check, settle } from './appHarness.mjs'

interface TickProbe {
  startedAt: number
  section: Element
  rows: Element[]
  removed: number[]
  sourceChanges: number
  times: Set<string>
  observer: MutationObserver
}
interface ProbeWindow { buffTickProbe?: TickProbe }
interface NativeFixture { activeEffectReads: number; activeEffects: { expiresAt?: number } }

/** Record every mutation, including a remove/reinsert that an eventual text check would miss. */
async function startProbe(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const section = document.querySelector('[data-testid="active-self-effects"]')
    const rows = Array.from(document.querySelectorAll('[data-testid="active-self-effect"]'))
    if (!section || section.getAttribute('data-source') !== 'live' || rows.length !== 2) return false
    const probe = { startedAt: performance.now(), section, rows, removed: [0, 0], sourceChanges: 0,
      times: new Set([rows[0].lastElementChild?.textContent ?? '']), observer: undefined as unknown as MutationObserver }
    probe.observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === 'attributes' && record.attributeName === 'data-source') probe.sourceChanges++
        for (const removed of record.removedNodes) {
          probe.rows.forEach((row, index) => { if (removed === row || removed.contains(row)) probe.removed[index]++ })
        }
      }
      probe.times.add(probe.rows[0].lastElementChild?.textContent ?? '')
    })
    probe.observer.observe(document.body, { subtree: true, childList: true, characterData: true,
      attributes: true, attributeFilter: ['data-source'], attributeOldValue: true })
    ;(window as unknown as ProbeWindow).buffTickProbe = probe
    return true
  })
}

export async function verifyStableNativeTicks(app: ElectronApplication, page: Page): Promise<void> {
  const readsBefore = await app.evaluate(() => {
    const fixture = globalThis as unknown as NativeFixture
    fixture.activeEffects.expiresAt = Date.now() + 18_000
    return fixture.activeEffectReads
  })
  const started = await settle(() => startProbe(page), Boolean)
  if (!check('continuous native-effect mutation observer starts on two live rows', started)) return
  const span = await settle(async () => ({
    reads: await app.evaluate(() => (globalThis as unknown as NativeFixture).activeEffectReads),
    elapsed: await page.evaluate(() => performance.now() - (window as unknown as ProbeWindow).buffTickProbe!.startedAt)
  }), (value) => value.reads >= readsBefore + 8 && value.elapsed >= 8000, { timeoutMs: 20_000 })
  check('continuous observation spans at least eight seconds and eight native polls', span.reads >= readsBefore + 8 && span.elapsed >= 8000)
  const state = await page.evaluate(() => {
    const probe = (window as unknown as ProbeWindow).buffTickProbe!
    return {
      retained: probe.rows.every((row) => row.isConnected) && probe.section.isConnected,
      removed: probe.removed, sourceChanges: probe.sourceChanges, times: Array.from(probe.times),
      names: probe.rows.map((row) => row.firstElementChild?.textContent)
    }
  })
  check('refreshes retain the existing section and effect DOM nodes continuously', state.retained && state.removed.every((count) => count === 0), JSON.stringify(state))
  check('fresh native samples never flash the logged fallback', state.sourceChanges === 0, `${state.sourceChanges} source changes`)
  check('retained native rows still update their countdown text', state.times.filter((time) => /^~(?:18|12|6)s$/.test(time)).length >= 2, state.times.join(', '))
  check('resolved spell names stay attached to retained rows', state.names.join('|') === 'Test Enduring Light|Test Gentle Song')
}

export async function verifySingleNativeRemoval(page: Page): Promise<void> {
  const state = await page.evaluate(() => {
    const probe = (window as unknown as ProbeWindow).buffTickProbe!
    probe.observer.disconnect()
    return { removed: probe.removed, sourceChanges: probe.sourceChanges,
      kept: probe.rows[0].isConnected, removedSong: !probe.rows[1].isConnected,
      current: document.querySelector('[data-spell-id="900001"]') === probe.rows[0] }
  })
  check('a real removal detaches only the missing song exactly once', state.kept && state.current && state.removedSong &&
    state.removed[0] === 0 && state.removed[1] === 1 && state.sourceChanges === 0, JSON.stringify(state))
}
