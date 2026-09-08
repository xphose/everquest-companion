/** npm run privacy:check [-- --staged] [-- --history <base>]. Never print input bytes or Git errors. */
import { execFileSync } from 'node:child_process'
import { lstatSync, readFileSync, readlinkSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { formatPrivacy, safeLocation, scanPrivacy, type PrivacyFinding } from './publicRepoPrivacy.mjs'

interface Options { staged: boolean; history?: string }
function git(root: string, args: string[], input?: string): Buffer {
  return execFileSync('git', args, { cwd: root, input, maxBuffer: 256 * 1024 * 1024, stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'] })
}
/** Bounded batches keep index/history checks fast without one process per file. */
function* blobs(root: string, entries: { file: string; hash: string }[]): Generator<{ file: string; bytes: Buffer }> {
  for (let start = 0; start < entries.length; start += 64) {
    const batch = entries.slice(start, start + 64)
    const data = git(root, ['cat-file', '--batch'], `${batch.map((entry) => entry.hash).join('\n')}\n`)
    let offset = 0
    for (const entry of batch) {
      const end = data.indexOf(10, offset)
      const [hash, kind, rawSize] = data.subarray(offset, end).toString('utf8').split(' ')
      const size = Number(rawSize)
      if (end < offset || hash !== entry.hash || kind !== 'blob' || !Number.isSafeInteger(size) || size < 0) throw new Error('Invalid Git object')
      offset = end + 1
      if (offset + size >= data.length) throw new Error('Incomplete Git object')
      yield { file: entry.file, bytes: data.subarray(offset, offset + size) }
      offset += size + 1
    }
  }
}
function options(args: string[]): Options {
  const result: Options = { staged: false }
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--staged') result.staged = true
    else if (args[index] === '--history' && args[index + 1]) result.history = args[++index]
    else throw new Error('Invalid scan options')
  }
  return result
}
function privateTerms(env: NodeJS.ProcessEnv): string[] {
  const file = env.EQC_PRIVACY_TERMS_FILE ? readFileSync(env.EQC_PRIVACY_TERMS_FILE, 'utf8') : ''
  return [...new Set(`${file}\n${env.EQC_PRIVACY_TERMS ?? ''}`.split(/\r?\n/).map((line) => line.trim()).filter(Boolean))]
}
function text(bytes: Buffer, file: string): string {
  // UTF-16 files need decoding before the binary check; BOM-less binary blobs are not text.
  if (bytes[0] === 255 && bytes[1] === 254) return bytes.subarray(2).toString('utf16le')
  if (bytes[0] === 254 && bytes[1] === 255) return Buffer.from(bytes.subarray(2)).swap16().toString('utf16le')
  const source = /\.(?:[cm]?[jt]sx?|jsonl?|md|txt|log|ya?ml|toml|ini|ps1|sh|rs|html|css|xml|svg)$/i.test(file)
  return bytes.includes(0) && !source ? '' : bytes.toString('utf8')
}
function workingFile(path: string): Buffer | null {
  try { return lstatSync(path).isSymbolicLink() ? Buffer.from(readlinkSync(path)) : readFileSync(path) }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
}
function tracked(root: string, staged: boolean, terms: string[]): PrivacyFinding[] {
  const entries = git(root, ['ls-files', '--stage', '-z']).toString('utf8').split('\0').filter(Boolean)
  const findings: PrivacyFinding[] = []
  const index: { file: string; hash: string }[] = []
  for (const entry of entries) {
    const split = entry.indexOf('\t')
    const [mode, hash, stage] = entry.slice(0, split).split(' ')
    const file = entry.slice(split + 1)
    if (stage !== '0') throw new Error('Unmerged index')
    if (mode === '160000') continue
    if (staged) { index.push({ file, hash }); continue }
    const bytes = workingFile(resolve(root, file))
    if (bytes === null) continue
    findings.push(...scanPrivacy(file, text(bytes, file), terms))
  }
  for (const { file, bytes } of blobs(root, index)) findings.push(...scanPrivacy(file, text(bytes, file), terms))
  return findings
}
function history(root: string, base: string, terms: string[]): PrivacyFinding[] {
  const ancestor = git(root, ['rev-parse', '--verify', '--end-of-options', `${base}^{commit}`]).toString('utf8').trim()
  git(root, ['merge-base', '--is-ancestor', ancestor, 'HEAD'])
  const commits = git(root, ['rev-list', '--reverse', `${ancestor}..HEAD`]).toString('utf8').trim().split('\n').filter(Boolean)
  const findings: PrivacyFinding[] = []
  const seen = new Set<string>()
  const objects: { file: string; hash: string }[] = []
  for (const commit of commits) {
    const label = `history/${commit.slice(0, 12)}`
    const metadata = git(root, ['show', '-s', '--format=%an%n%ae%n%cn%n%ce%n%B', commit]).toString('utf8')
    findings.push(...scanPrivacy(`${label}/metadata`, metadata, terms))
    const changes = git(root, ['diff-tree', '--root', '-m', '--no-commit-id', '--no-renames', '--raw', '-r', '-z', commit]).toString('utf8').split('\0')
    for (let index = 0; index + 1 < changes.length; index += 2) {
      const [, mode, , hash] = changes[index].split(' ')
      const file = changes[index + 1]
      if (mode === '160000' || !hash || /^0+$/.test(hash) || seen.has(`${hash}:${file}`)) continue
      seen.add(`${hash}:${file}`)
      objects.push({ file: `${label}/${file}`, hash })
    }
  }
  for (const { file, bytes } of blobs(root, objects)) findings.push(...scanPrivacy(file, text(bytes, file), terms))
  return findings
}
export function checkPublicRepo(root: string, args: string[], env: NodeJS.ProcessEnv = process.env): PrivacyFinding[] {
  const parsed = options(args)
  const terms = privateTerms(env)
  try { return [...tracked(root, parsed.staged, terms), ...(parsed.history ? history(root, parsed.history, terms) : [])] }
  catch { return [{ file: safeLocation('<scan>', terms), line: 0, category: 'scan-error', count: 1 }] }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const findings = checkPublicRepo(process.cwd(), process.argv.slice(2))
    if (findings.length) console.log(formatPrivacy(findings))
    console.log(`privacy:check findings=${findings.reduce((sum, item) => sum + item.count, 0)}`)
    process.exitCode = findings.length ? 1 : 0
  } catch { console.log('<scan>:0 scan-error count=1'); process.exitCode = 1 }
}
