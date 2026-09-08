import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'
import { loadConfigFromFile } from 'electron-vite'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
async function configuration(command: 'serve' | 'build', mode: string) {
  return (await loadConfigFromFile({ command, mode }, join(ROOT, 'electron.vite.config.ts'), ROOT, 'silent')).config
}

test('only the serve command keeps previous main and preload output, including custom build modes', async () => {
  for (const mode of ['development', 'production', 'test']) {
    const dev = await configuration('serve', mode)
    const packaged = await configuration('build', mode)
    assert.equal(dev.main?.build?.emptyOutDir, false)
    assert.equal(dev.preload?.build?.emptyOutDir, false)
    assert.equal(packaged.main?.build?.emptyOutDir, undefined)
    assert.equal(packaged.preload?.build?.emptyOutDir, undefined)
    assert.equal(dev.renderer?.build?.emptyOutDir, undefined)
  }
})

/** A tiny two-entry bundle exercises Vite's real output cleanup hook without starting Electron
 * or a worker. generateBundle runs after renderStart, when Vite used to remove their files. */
async function fixtureBuild(folder: string, emptyOutDir: boolean | undefined, verify?: () => Promise<void>): Promise<void> {
  await build({ configFile: false, root: folder, publicDir: false, logLevel: 'silent',
    plugins: verify ? [{ name: 'verify-previous-output', generateBundle: verify }] : [],
    build: { emptyOutDir, minify: false, outDir: join(folder, 'out'), rollupOptions: {
      input: { index: join(folder, 'index.js'), worker: join(folder, 'worker.js') },
      output: { format: 'cjs', entryFileNames: '[name].js', chunkFileNames: 'chunks/[name]-[hash].js' }
    } } })
}

test('development retains chunks and worker entries across rebuilds; production removes obsolete chunks', async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'eq-dev-output-'))
  t.after(() => rm(folder, { recursive: true, force: true }))
  await mkdir(join(folder, 'out'))
  await writeFile(join(folder, 'index.js'), "import { value } from './shared.js'; console.log('main', value)")
  await writeFile(join(folder, 'worker.js'), "import { value } from './shared.js'; console.log('worker', value)")
  await writeFile(join(folder, 'shared.js'), "export const value = { version: 'previous' }")
  const dev = await configuration('serve', 'development')
  await fixtureBuild(folder, dev.main?.build?.emptyOutDir)
  const chunks = join(folder, 'out', 'chunks')
  const previous = await readdir(chunks)
  assert.ok(previous.length > 0, 'The fixture must emit a shared hashed chunk')
  const worker = await readFile(join(folder, 'out', 'worker.js'), 'utf8')
  let verified = false
  await writeFile(join(folder, 'shared.js'), "export const value = { version: 'next' }")
  await fixtureBuild(folder, dev.main?.build?.emptyOutDir, async () => {
    for (const name of previous) assert.match(await readFile(join(chunks, name), 'utf8'), /previous/)
    assert.equal(await readFile(join(folder, 'out', 'worker.js'), 'utf8'), worker)
    verified = true
  })
  assert.equal(verified, true)
  const retained = await readdir(chunks)
  assert.ok(retained.length > previous.length, 'Both generations must exist after the development rebuild')
  const packaged = await configuration('build', 'production')
  await fixtureBuild(folder, packaged.main?.build?.emptyOutDir)
  const cleaned = await readdir(chunks)
  for (const name of previous) assert.equal(cleaned.includes(name), false, 'Production must remove old development chunks')
  assert.equal(cleaned.length, previous.length)
})
