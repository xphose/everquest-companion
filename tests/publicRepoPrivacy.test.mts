import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { checkPublicRepo } from '../scripts/check-public-repo.mts'
import { formatPrivacy, safeLocation, scanPrivacy, sensitiveArtifact } from '../scripts/publicRepoPrivacy.mts'

const credential = ['ghp', '_'].join('') + 'Z'.repeat(36)
const privateEmail = ['person', 'mail.test'].join('@')
const privateUser = 'private' + 'person'
const home = ['C:', 'Users', privateUser, 'work'].join('\\')
function git(root: string, args: string[], extra: NodeJS.ProcessEnv = {}): string {
  return execFileSync('git', ['-c', 'user.name=Example contributor', '-c', 'user.email=contributor@example.invalid', ...args], {
    cwd: root, encoding: 'utf8', env: { ...process.env, ...extra }, stdio: ['ignore', 'pipe', 'pipe']
  }).trim()
}
function repository(): string {
  const root = mkdtempSync(join(tmpdir(), 'public-repo-privacy-'))
  git(root, ['init', '-q'])
  writeFileSync(join(root, 'safe.md'), 'Public project https://github.com/example/project\n')
  git(root, ['add', '.']); git(root, ['commit', '-qm', 'Public baseline'])
  return root
}
function removeRepository(root: string): void {
  assert.equal(dirname(resolve(root)), resolve(tmpdir()))
  assert.match(basename(root), /^public-repo-privacy-/)
  rmSync(root, { recursive: true, force: true })
}

test('credentials, private keys, private homes and email values are detected without being printed', () => {
  const key = ['-----BEGIN ', 'PRIVATE KEY-----'].join('')
  const found = scanPrivacy('notes.md', [credential, key, home, privateEmail, 'private term'].join('\n'), ['private term'])
  assert.deepEqual(found.map((item) => item.category), ['credential', 'private-key', 'private-home', 'private-email', 'private-term'])
  const report = formatPrivacy(found)
  for (const value of [credential, key, home, privateEmail, 'private term']) assert.ok(!report.includes(value))
  assert.match(report, /notes.md:1 credential count=1/)
  assert.equal(safeLocation(`notes/${privateUser}.md`, [privateUser]), 'notes/[redacted].md')
  assert.equal(scanPrivacy('file.md', '[private.user]', ['[private.user]'])[0].category, 'private-term')
  assert.deepEqual(scanPrivacy('file.md', 'privateXuser', ['[private.user]']), [])
})

test('public profiles and explicit synthetic vectors are narrow exceptions, never whole-directory exclusions', () => {
  const publicText = 'C:/Users/Public/Game /home/<user>/Game C:/Users/%USERNAME%/Game contributor@example.invalid noreply@github.com 123+bot@users.noreply.github.com'
  assert.deepEqual(scanPrivacy('docs/setup.md', publicText), [])
  assert.deepEqual(scanPrivacy('tests/path.test.mts', 'C:/Users/Alice/Game'), [])
  assert.deepEqual(scanPrivacy('src/shared/redact.ts', '/home/test/Game'), [])
  assert.equal(scanPrivacy('docs/notes.md', 'C:/Users/Alice/Game')[0].category, 'private-home')
  assert.equal(scanPrivacy('tests/path.test.mts', home)[0].category, 'private-home')
  assert.equal(scanPrivacy('tests/path.test.mts', credential)[0].category, 'credential')
  assert.deepEqual(scanPrivacy('src/shared/errorReport.ts', '/home/me/file /home/u/file'), [])
  assert.equal(scanPrivacy('src/shared/errorReport.ts', home)[0].category, 'private-home')
  assert.deepEqual(scanPrivacy('package-lock.json', `  "deprecated": "Public maintainer ${privateEmail}"`), [])
  assert.equal(scanPrivacy('package-lock.json', `  "email": "${privateEmail}"`)[0].category, 'private-email')
  assert.equal(scanPrivacy('package-lock.json', `  "deprecated": "${credential}"`)[0].category, 'credential')
})

test('local secrets and private key artifact names are blocked while examples and real lockfiles stay public', () => {
  for (const path of ['.env', 'tool/.env.local', 'local.config.json', 'credentials.json', '.ssh/id_ed25519', 'client.pfx', 'settings.local.json']) {
    assert.equal(sensitiveArtifact(path), true, path)
  }
  for (const path of ['.env.example', 'local.config.example.json', 'credentials.sample.json', 'Cargo.lock', 'package-lock.json', '.terraform.lock.hcl']) {
    assert.equal(sensitiveArtifact(path), false, path)
  }
})

test('index bytes cannot be masked by an unstaged cleanup; tracked text and private term files remain local', () => {
  const root = repository()
  const terms = join(root, '.privacy-terms')
  try {
    writeFileSync(join(root, 'safe.md'), credential)
    git(root, ['add', 'safe.md'])
    writeFileSync(join(root, 'safe.md'), 'Clean working copy')
    assert.deepEqual(checkPublicRepo(root, [], {}), [])
    assert.equal(checkPublicRepo(root, ['--staged'], {})[0].category, 'credential')
    writeFileSync(terms, privateUser)
    writeFileSync(join(root, 'safe.md'), `eqlog_${privateUser}_server.txt`)
    const result = checkPublicRepo(root, [], { EQC_PRIVACY_TERMS_FILE: terms })
    assert.equal(result[0].category, 'private-term')
    assert.ok(!formatPrivacy(result).includes(privateUser))
    assert.equal(readFileSync(terms, 'utf8'), privateUser)
  } finally { removeRepository(root) }
})

test('unpublished history includes deleted content, commit messages and both identities; failures never echo Git inputs', () => {
  const root = repository()
  try {
    const base = git(root, ['rev-parse', 'HEAD'])
    writeFileSync(join(root, 'later-deleted.md'), credential)
    git(root, ['add', '.'])
    git(root, ['commit', '-qm', `Private note ${home}`], { GIT_AUTHOR_EMAIL: privateEmail, GIT_COMMITTER_EMAIL: privateEmail })
    git(root, ['rm', '-q', 'later-deleted.md']); git(root, ['commit', '-qm', 'Remove local artifact'])
    assert.deepEqual(checkPublicRepo(root, [], {}), [])
    const result = checkPublicRepo(root, ['--history', base], {})
    assert.equal(result.filter((item) => item.category === 'private-email').length, 2)
    assert.ok(result.some((item) => item.category === 'private-home'))
    assert.ok(result.some((item) => item.file.endsWith('/later-deleted.md') && item.category === 'credential'))
    const output = formatPrivacy(result)
    assert.ok(!output.includes(credential) && !output.includes(privateEmail) && !output.includes(home))
    assert.deepEqual(checkPublicRepo(root, ['--history', credential], {}), [{ file: '<scan>', line: 0, category: 'scan-error', count: 1 }])
  } finally { removeRepository(root) }
})

test('the real CLI exits nonzero without echoing a sensitive argument or raw Git error', () => {
  const root = repository()
  try {
    assert.throws(() => execFileSync(process.execPath, ['--import', import.meta.resolve('tsx'),
      fileURLToPath(new URL('../scripts/check-public-repo.mts', import.meta.url)), '--history', credential], {
      cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']
    }), (error: unknown) => {
      const failure = error as { status: number; stdout: string; stderr: string }
      assert.equal(failure.status, 1)
      assert.match(failure.stdout, /scan-error count=1/)
      assert.ok(!`${failure.stdout}${failure.stderr}`.includes(credential))
      return true
    })
  } finally { removeRepository(root) }
})
