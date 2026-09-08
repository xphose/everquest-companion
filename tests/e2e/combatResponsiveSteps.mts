/** Responsive assertions use Chromium's CSS viewport, not the OS window's outer rectangle. */
import type { ElectronApplication, Page } from 'playwright-core'
import { check, checkGrid, checkHeader, narrowPanelCheck, pageOverflow, settle, settleStable } from './appHarness.mjs'

type WindowHandle = Awaited<ReturnType<ElectronApplication['browserWindow']>>
function panelBoxes(page: Page): Promise<string> {
  return page.evaluate(() => [...document.querySelectorAll('[data-testid="dash-panel"]')].map((el) => {
    const r = el.getBoundingClientRect()
    return `${Math.round(r.x)}:${Math.round(r.y)}:${Math.round(r.width)}:${Math.round(r.height)}`
  }).join('|'))
}
async function settleViewport(win: WindowHandle, page: Page, width: number, kind: 'outer' | 'content'): Promise<number> {
  const native = await settle(() => win.evaluate((w) => ({ outer: w.getBounds().width, content: w.getContentBounds().width })),
    (value) => value[kind] === width, { timeoutMs: 15_000 })
  if (!check(`resize reaches ${kind} width ${width}`, native[kind] === width, JSON.stringify(native))) throw new Error('Window resize did not land')
  const viewport = await settle(() => page.evaluate(() => window.innerWidth), (value) => value === native.content, { timeoutMs: 15_000 })
  if (!check('CSS viewport reaches the requested native content width', viewport === native.content, `${viewport}px`)) throw new Error('Viewport resize did not land')
  // Stable old panel boxes are insufficient: first require the new viewport above.
  await settleStable(() => panelBoxes(page), { timeoutMs: 15_000 })
  return viewport
}
async function narrowLayout(page: Page): Promise<void> {
  const narrow = await narrowPanelCheck(page)
  check('narrow: the grid collapses to a single column', narrow.cols === 1, `${narrow.cols} column(s)`)
  check('narrow: each stacked panel keeps a usable height', narrow.minH >= 250, `shortest ${narrow.minH}px`)
  check('narrow: the dashboard REGION is the scroller', narrow.scrolls, `region scrolls=${narrow.scrolls}`)
  await checkHeader(page, 'narrow (720 outer)', true, 150)
  const overflow = await pageOverflow(page)
  check('narrow: …and the PAGE still does not scroll', overflow.doc === 0 && overflow.content === 0,
    `document +${overflow.doc}px · content +${overflow.content}px`)
}

export async function stepResponsive(app: ElectronApplication, page: Page): Promise<void> {
  const win = await app.browserWindow(page)
  const original = await win.evaluate((w) => ({ bounds: w.getBounds(), minimum: w.getMinimumSize() }))
  try {
    // Native borders/DPI rounding can make a 900px outer window 899 CSS pixels wide.
    await win.evaluate((w, bounds) => w.setBounds({ ...bounds, width: 900 }), original.bounds)
    const minimumWidth = await settleViewport(win, page, 900, 'outer')
    if (minimumWidth >= 900) await checkGrid(page, `minimum window (${minimumWidth} CSS px)`)
    else {
      const minimum = await narrowPanelCheck(page)
      check('minimum window below md uses the single-column layout', minimum.cols === 1, `${minimumWidth} CSS px · ${minimum.cols} column(s)`)
    }
    await checkHeader(page, 'minimum outer width (900)', true)

    // Independently exercise the exact CSS breakpoint: 900 content pixels must produce 2x2.
    await win.evaluate((w) => {
      const bounds = w.getBounds()
      const content = w.getContentBounds()
      // setContentSize itself rounds down on this Windows/DPI combination. Use the measured inset.
      w.setBounds({ ...bounds, width: bounds.width + 900 - content.width })
    })
    await settleViewport(win, page, 900, 'content')
    await checkGrid(page, 'md breakpoint (900 CSS px)')
    await checkHeader(page, 'md breakpoint (900 CSS px)', true)

    // Preserve the full narrow 720px checks; this requires lifting the normal window minimum.
    await win.evaluate((w, bounds) => { w.setMinimumSize(400, 400); w.setBounds({ ...bounds, width: 720 }) }, original.bounds)
    await settleViewport(win, page, 720, 'outer')
    await narrowLayout(page)
  } finally {
    await win.evaluate((w, saved) => { w.setMinimumSize(saved.minimum[0], saved.minimum[1]); w.setBounds(saved.bounds) }, original)
  }
  await settleViewport(win, page, original.bounds.width, 'outer')
  await checkGrid(page, 'restored wide')
  await checkHeader(page, 'restored wide', true)
}
