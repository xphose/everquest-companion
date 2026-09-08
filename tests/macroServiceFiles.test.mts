import assert from 'node:assert/strict'
import test from 'node:test'
import { link, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { readCharacterFile, replaceCharacterFile, encodeCharacterFile } from '../src/main/macros/files.ts'
import { worldKey } from '../src/main/macros/settings.ts'
import { macroFixture, ORIGINAL_INI } from './macroServiceFixture.mts'

test('byte compare refuses a file edit during preparation and preserves the edited bytes', async (t) => {
  const f = await macroFixture(t)
  const file = await readCharacterFile(f.root, f.name)
  await assert.rejects(replaceCharacterFile({ root: f.root, name: f.name, original: file.bytes, updated: Buffer.from('new'),
    backupDir: f.deps.backupDir, guard: async () => { await f.write('concurrent user edit') } }), /changed before/)
  assert.equal(await f.read(), 'concurrent user edit')
})

test('reader rejects arbitrary paths, hardlinks, oversized files and unsupported encodings', async (t) => {
  const f = await macroFixture(t)
  await assert.rejects(readCharacterFile(f.root, '../outside.ini'), /observed/)
  await link(join(f.root, f.name), join(f.root, 'linked.ini'))
  await assert.rejects(readCharacterFile(f.root, f.name), /private regular/)
  await writeFile(join(f.root, 'large.ini'), Buffer.alloc(2 * 1024 * 1024 + 1, 32))
  await assert.rejects(readCharacterFile(f.root, 'large.ini'), /smaller/)
  await writeFile(join(f.root, 'unicode.ini'), Buffer.from([255, 254, 91, 0]))
  await assert.rejects(readCharacterFile(f.root, 'unicode.ini'), /encoding/)
})

test('UTF-8 BOM and legacy high bytes round trip unchanged', async (t) => {
  const f = await macroFixture(t)
  const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(ORIGINAL_INI, 'latin1')])
  await writeFile(join(f.root, f.name), bytes)
  const file = await readCharacterFile(f.root, f.name)
  assert.equal(file.bom, true)
  assert.deepEqual(encodeCharacterFile(file, file.text), bytes)
})

test('unchanged queries do not rewrite private state; ambiguous social slots are flagged', async (t) => {
  const f = await macroFixture(t)
  await f.write(ORIGINAL_INI.replace('[HotButtons]', 'Page1Button1Name=Duplicate\r\n[HotButtons]'))
  const first = await f.service.query()
  assert.ok(first.existing[0].issues.some((issue) => issue.code === 'ambiguous-settings'))
  const path = join(f.folder, 'private', `${worldKey(f.world)}.json`)
  const before = await stat(path)
  const content = await readFile(path, 'utf8')
  await f.service.query()
  assert.equal(await readFile(path, 'utf8'), content)
  assert.equal((await stat(path)).mtimeMs, before.mtimeMs)
})
