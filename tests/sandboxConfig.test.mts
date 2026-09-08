import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sandbox = join(repository, 'scripts', 'sandbox')
const windows = process.platform === 'win32'

// Environment arguments avoid interpolation into PowerShell source. This helper only
// generates/reads configuration; neither VM lifecycle nor cloud operations may run.
function powershell(source: string, values: Record<string, string>, cwd: string): string {
  const result = spawnSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand',
    Buffer.from(`$ErrorActionPreference = 'Stop'; ${source}`, 'utf16le').toString('base64')
  ], { encoding: 'utf8', cwd, env: { ...process.env, SANDBOX_SCRIPTS: sandbox, ...values } })
  // Do not expose a local account path if configuration fails.
  const errorId = /<S S="Error">([^<]*?)(?:_x000D_|<)/.exec(result.stderr)?.[1] ?? ''
  assert.equal(result.status, 0, `PowerShell configuration verification must succeed: ${errorId.replace(/[A-Z]:\\[^ ]*/gi, '<path>')}`)
  return result.stdout.trim()
}

function fixture(run: (directory: string, checkout: string) => void): void {
  const directory = mkdtempSync(join(tmpdir(), 'eqc-sandbox-config-'))
  const checkout = join(directory, "Sample & Tools' [checkout]")
  mkdirSync(join(checkout, 'scripts', 'sandbox'), { recursive: true })
  mkdirSync(join(checkout, 'release'))
  try { run(directory, checkout) }
  finally { rmSync(directory, { recursive: true, force: true }) }
}

test('sandbox wrappers generate escaped custom mappings without running a VM', { skip: !windows }, () => {
  fixture((directory, checkout) => {
    for (const kind of ['installer-test', 'smoke-feedback']) {
      const template = readFileSync(join(sandbox, `${kind}.wsb`), 'utf8')
      const destination = join(directory, `Results & Copies' [${kind}]`)
      const output = powershell(`
        & (Join-Path $env:SANDBOX_SCRIPTS ('run-' + $env:CONFIG_KIND + '.ps1')) -RepositoryRoot $env:CONFIG_REPO -ResultsDirectory $env:CONFIG_RESULTS -ConfigurationOnly
      `, { CONFIG_KIND: kind, CONFIG_REPO: checkout, CONFIG_RESULTS: destination }, directory)
      assert.ok(output === join(destination, `${kind}.generated.wsb`), 'configuration uses the requested results directory')
      assert.deepEqual(readdirSync(destination), [`${kind}.generated.wsb`])
      const xml = readFileSync(output, 'utf8')
      assert.match(xml, /&amp;/, 'host paths must be XML escaped')
      assert.doesNotMatch(xml, /\{\{(?:RELEASE|HARNESS|RESULTS)_DIR\}\}/)
      assert.equal(readFileSync(join(sandbox, `${kind}.wsb`), 'utf8'), template)
      verifyMappings({ file: output, checkout, results: destination, kind }, directory)
    }
  })
})

function verifyMappings(config: { file: string; checkout: string; results: string; kind: string }, cwd: string): void {
  const { file, checkout, results, kind } = config
  const verdict = powershell(`
    $xml = New-Object System.Xml.XmlDocument
    $xml.XmlResolver = $null
    $xml.Load($env:CONFIG_FILE)
    $folders = @($xml.Configuration.MappedFolders.MappedFolder)
    $expected = @((Join-Path $env:CONFIG_REPO 'scripts\\sandbox'), $env:CONFIG_RESULTS)
    $guests = @('C:\\harness', 'C:\\results')
    if ($env:CONFIG_KIND -eq 'installer-test') { $expected = @((Join-Path $env:CONFIG_REPO 'release')) + $expected; $guests = @('C:\\release') + $guests }
    if ($folders.Count -ne $expected.Count) { throw 'Incorrect mapping count' }
    for ($i = 0; $i -lt $folders.Count; $i++) {
      if ($folders[$i].HostFolder -cne $expected[$i]) { throw 'Host path did not round trip' }
      if ($folders[$i].SandboxFolder -cne $guests[$i]) { throw 'Guest path changed' }
      $readOnly = if ($i -eq $folders.Count - 1) { 'false' } else { 'true' }
      if ($folders[$i].ReadOnly -ne $readOnly) { throw 'Mapping access changed' }
    }
    if ($xml.Configuration.LogonCommand.Command -notlike ('*C:\\harness\\' + $env:CONFIG_KIND + '.ps1*')) { throw 'Guest installer command changed' }
    'verified'
  `, { CONFIG_FILE: file, CONFIG_REPO: checkout, CONFIG_RESULTS: results, CONFIG_KIND: kind }, cwd)
  assert.equal(verdict, 'verified')
}

test('sandbox checkout defaults are independent of working directory and relative results resolve beneath checkout', { skip: !windows }, () => {
  fixture((directory, checkout) => {
    const verdict = powershell(`
      . (Join-Path $env:SANDBOX_SCRIPTS 'sandbox-config.ps1')
      $default = New-SandboxConfiguration -Kind installer-test -ResultsDirectory $env:CONFIG_RESULTS
      if ($default.RepositoryRoot -cne $env:EXPECTED_REPO) { throw 'Default checkout used caller working directory' }
      $relative = New-SandboxConfiguration -Kind smoke-feedback -RepositoryRoot $env:CONFIG_REPO -ResultsDirectory 'nested results'
      if ($relative.ResultsDirectory -cne (Join-Path $env:CONFIG_REPO 'nested results')) { throw 'Relative results used caller working directory' }
      $selected = New-SandboxConfiguration -Kind installer-test -RepositoryRoot $env:CONFIG_REPO
      if ($selected.ResultsDirectory -cne (Join-Path $env:CONFIG_REPO 'scripts\\sandbox\\results')) { throw 'Selected checkout default results incorrect' }
      'verified'
    `, { CONFIG_REPO: checkout, CONFIG_RESULTS: join(directory, 'default results'), EXPECTED_REPO: repository }, directory)
    assert.equal(verdict, 'verified')
  })
})

test('sandbox scripts parse and reject a drive root results directory before writing', { skip: !windows }, () => {
  fixture((directory, checkout) => {
    const verdict = powershell(`
      foreach ($script in Get-ChildItem -LiteralPath $env:SANDBOX_SCRIPTS -Filter '*.ps1') {
        $tokens = $null; $parseErrors = $null
        [void][System.Management.Automation.Language.Parser]::ParseFile($script.FullName, [ref]$tokens, [ref]$parseErrors)
        if ($parseErrors.Count) { throw 'Sandbox PowerShell syntax failed' }
      }
      . (Join-Path $env:SANDBOX_SCRIPTS 'sandbox-config.ps1')
      try { New-SandboxConfiguration -Kind installer-test -RepositoryRoot $env:CONFIG_REPO -ResultsDirectory ([IO.Path]::GetPathRoot($env:CONFIG_REPO)); throw 'Root accepted' }
      catch { if ($_.Exception.Message -notlike 'ResultsDirectory must be a dedicated*') { throw } }
      'verified'
    `, { CONFIG_REPO: checkout }, directory)
    assert.equal(verdict, 'verified')
  })
})

test('smoke installer sources are explicit and local staging preserves exact bytes and checksum', { skip: !windows }, () => {
  fixture((directory) => {
    const installer = join(directory, "Example & Setup' [test].exe")
    writeFileSync(installer, 'inert synthetic installer bytes; never execute')
    const verdict = powershell(`
      . (Join-Path $env:SANDBOX_SCRIPTS 'smoke-source.ps1')
      try { Get-SmokeSource; throw 'Implicit source accepted' }
      catch { if ($_.Exception.Message -notlike 'Supply InstallerPath*') { throw } }
      $release = Get-SmokeSource -ReleaseOwner example-project -ReleaseRepo companion
      if ($release.ReleaseBase -ne 'https://github.com/example-project/companion/releases/latest/download') { throw 'Wrong release' }
      try { Get-SmokeSource -ReleaseOwner '../invalid' -ReleaseRepo companion; throw 'Invalid source accepted' }
      catch { if ($_.Exception.Message -notlike 'Supply InstallerPath*') { throw } }
      $local = Get-SmokeSource -InstallerPath $env:CONFIG_INSTALLER
      Write-SmokeSource -Source $local -ResultsDirectory $env:CONFIG_RESULTS
      $config = Get-Content -LiteralPath (Join-Path $env:CONFIG_RESULTS 'smoke-source.json') -Raw | ConvertFrom-Json
      if ($config.mode -ne 'local' -or $config.releaseBase -ne '') { throw 'Local source changed' }
      if ($config.sha256 -cne $env:EXPECTED_HASH) { throw 'Staged installer checksum changed' }
      'verified'
    `, { CONFIG_INSTALLER: installer, CONFIG_RESULTS: directory,
      EXPECTED_HASH: createHash('sha256').update(readFileSync(installer)).digest('hex') }, directory)
    assert.equal(verdict, 'verified')
    assert.equal(readFileSync(join(directory, 'installer-source.exe'), 'utf8'), readFileSync(installer, 'utf8'))
    assert.doesNotMatch(readFileSync(join(directory, 'smoke-source.json'), 'utf8'), /InstallerPath|[A-Z]:\\/)
  })
})
