import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

for (const mode of ['pinned', 'unwritable']) {
  test(`wiki bootstrap ${mode}: all consumers keep a single catalog without blocking startup`, async (t) => {
    const directory = mkdtempSync(join(tmpdir(), 'eqc-wiki-bootstrap-'))
    t.after(() => rmSync(directory, { recursive: true, force: true }))
    const result = await promisify(execFile)(process.execPath, [
      '--import', 'tsx', fileURLToPath(new URL('./wikiRuntimeBootstrapProbe.mts', import.meta.url)), directory, mode
    ], { timeout: 20_000, windowsHide: true })
    assert.equal(result.stdout, 'verified')
  })
}
