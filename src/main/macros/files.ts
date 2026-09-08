import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, open, readFile, readdir, realpath, rename, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import type { CharacterRef } from '../../shared/types'

const MAX_INI_BYTES = 2 * 1024 * 1024
export function bytesHash(bytes: Buffer): string { return createHash('sha256').update(bytes).digest('hex') }
function identity(value: string): string { return process.platform === 'win32' ? value.toLowerCase() : value }
function escapeRegex(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }

export async function characterFiles(root: string, character: CharacterRef): Promise<string[]> {
  if (!/^[a-z0-9-]{1,64}$/i.test(character.name) || !/^[a-z0-9-]{1,64}$/i.test(character.server)) return []
  const names = await readdir(root, { withFileTypes: true })
  if (names.length > 20_000) throw new Error('The game folder has too many entries to inspect safely.')
  const pattern = new RegExp(`^${escapeRegex(character.name)}_${escapeRegex(character.server)}(?:_LO\\d+)?\\.ini$`, 'i')
  return names.filter((entry) => entry.isFile() && pattern.test(entry.name)).map((entry) => entry.name).sort()
}

async function confinedFile(root: string, name: string): Promise<string> {
  if (basename(name) !== name || /[\\/:]/.test(name)) throw new Error('Choose an observed character settings filename.')
  const parent = await realpath(root)
  const target = join(parent, name)
  const stat = await lstat(target)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_INI_BYTES) throw new Error('Character settings must be a regular file smaller than 2 MB.')
  if (identity(await realpath(target)) !== identity(resolve(target))) throw new Error('Character settings point outside the game folder.')
  return target
}

export interface CharacterFile { path: string; bytes: Buffer; text: string; bom: boolean }
export async function readCharacterFile(root: string, name: string): Promise<CharacterFile> {
  const path = await confinedFile(root, name)
  const file = await open(path, 'r')
  try {
    const stat = await file.stat()
    if (!stat.isFile() || stat.size > MAX_INI_BYTES || stat.nlink > 1) throw new Error('Character settings are not a private regular file.')
    const bytes = Buffer.alloc(stat.size)
    const result = await file.read(bytes, 0, bytes.length, 0)
    const after = await file.stat()
    if (result.bytesRead !== stat.size || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs) throw new Error('Character settings changed while being read.')
    if (bytes.includes(0)) throw new Error('This character settings encoding is unsupported.')
    const bom = bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))
    return { path, bytes, text: bytes.subarray(bom ? 3 : 0).toString('latin1'), bom }
  } finally { await file.close() }
}

/** The client inherits missing spell-set keys from this file. It is observed, never edited. */
export async function readMacroDefaults(root: string): Promise<CharacterFile | undefined> {
  try { return await readCharacterFile(root, 'defaults.ini') } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

export function encodeCharacterFile(file: CharacterFile, text: string): Buffer {
  const content = Buffer.from(text, 'latin1')
  return file.bom ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), content]) : content
}

/** Guard runs after preparation and again immediately before compare-and-replace. */
export async function replaceCharacterFile(input: {
  root: string; name: string; original: Buffer; updated: Buffer; backupDir: string
  guard(): Promise<void>
}): Promise<string> {
  await mkdir(input.backupDir, { recursive: true })
  const backup = `${randomUUID()}.ini`
  await writeFile(join(input.backupDir, backup), input.original, { flag: 'wx', mode: 0o600 })
  const path = await confinedFile(input.root, input.name)
  const temp = join(dirname(path), `.eqc-macros-${randomUUID()}.tmp`)
  try {
    await writeFile(temp, input.updated, { flag: 'wx', mode: 0o600 })
    await input.guard()
    const current = await readCharacterFile(input.root, input.name)
    if (!current.bytes.equals(input.original)) throw new Error('Character settings changed before saving. Refresh and try again.')
    await rename(temp, path)
    return backup
  } finally { await unlink(temp).catch(() => undefined) }
}

export async function readBackup(folder: string, name: string): Promise<Buffer> {
  if (!/^[a-f0-9-]{36}\.ini$/.test(name)) throw new Error('The saved backup is invalid.')
  const path = await confinedFile(folder, name)
  return readFile(path)
}
