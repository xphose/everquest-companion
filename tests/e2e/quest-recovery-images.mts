/** Synthetic journal pictures for testing actual local Windows OCR. No user game window or
 * clipboard is read. Only the native file picker is replaced with the test's own image path. */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ElectronApplication } from 'playwright-core'

export type RecoveryPicture = 'active' | 'history' | 'source-page'

function fixtureHtml(kind: RecoveryPicture): string {
  const header = '<p style="font-size:18px;color:#cfd3e3">SYNTHETIC JOURNAL FIXTURE — OCR AUTOMATION TEST</p>'
  const tabs = '<p style="font-size:23px">Current Tasks　　 Shared Task　　 Quest History</p>'
  let body: string
  if (kind === 'active') body = `${tabs}<table><thead><tr><th>Task Title</th><th>Time Left</th><th>Zone</th></tr></thead><tbody><tr><td>Blackburrow Brewers</td><td>Unlimited</td><td>Blackburrow</td></tr></tbody></table><h2>Task Progression</h2><table><thead><tr><th>Objective Instructions</th><th>Status</th><th>Zone</th></tr></thead><tbody><tr><td>Collect Blackburrow Casks</td><td>2/3</td><td>Blackburrow</td></tr></tbody></table>`
  else if (kind === 'history') body = `${tabs}<table><thead><tr><th>Quest Title</th><th>Completion</th></tr></thead><tbody><tr><td>Clay Bracelet Quest</td><td>09/06/2026</td></tr></tbody></table><h2>Quest Progression</h2><p>Completed quest history</p>`
  else body = '<h1>Quest journal companion</h1><h2>Blackburrow Brewers</h2><p>Source walkthrough</p><p>Possible rewards: Cloak of Jaggedpine</p><p>Speak to Larsk Juton in Surefall Glade.</p><p>Quest history is explained in this reference page.</p>'
  return `<!doctype html><html><head><style>body{margin:0;padding:40px;background:#151c2c;color:#fff;font-family:Arial,sans-serif;font-size:27px}h2{font-size:29px;margin-top:52px}table{width:100%;border-collapse:collapse;table-layout:fixed;margin-top:38px}th,td{text-align:left;padding:20px 12px;border-bottom:2px solid #59647b}th:first-child,td:first-child{width:55%}th{background:#29354c;font-size:25px}</style></head><body>${header}${body}</body></html>`
}

export async function recoveryPicture(app: ElectronApplication, directory: string, kind: RecoveryPicture): Promise<string> {
  const bytes = await app.evaluate(async ({ BrowserWindow }, html) => {
    const win = new BrowserWindow({ width: 1280, height: 820, show: false, webPreferences: { offscreen: true, sandbox: true } })
    try {
      await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
      await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })
      const image = await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })
      if (image.isEmpty()) throw new Error('Synthetic journal fixture did not paint')
      return image.toPNG().toString('base64')
    } finally { win.destroy() }
  }, fixtureHtml(kind))
  const path = join(directory, `synthetic-${kind}.png`)
  writeFileSync(path, Buffer.from(bytes, 'base64'))
  return path
}

export async function chooseRecoveryPicture(app: ElectronApplication, path: string): Promise<void> {
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
  }, path)
}

export async function holdRecoveryPicker(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ dialog }) => {
    const state = globalThis as unknown as { recoveryPicker?: (value: Electron.OpenDialogReturnValue) => void }
    dialog.showOpenDialog = () => new Promise((resolve) => { state.recoveryPicker = resolve })
  })
}

export async function releaseRecoveryPicker(app: ElectronApplication, path: string): Promise<void> {
  await app.evaluate((_, file) => {
    const state = globalThis as unknown as { recoveryPicker?: (value: Electron.OpenDialogReturnValue) => void }
    state.recoveryPicker?.({ canceled: false, filePaths: [file] })
    delete state.recoveryPicker
  }, path)
}
