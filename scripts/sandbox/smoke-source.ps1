# Pure validation plus local staging; no download, execution, VM or cloud operation.
function Get-SmokeSource {
  param([string]$InstallerPath, [string]$ReleaseOwner, [string]$ReleaseRepo)
  if ($InstallerPath) {
    if ($ReleaseOwner -or $ReleaseRepo) { throw 'Choose InstallerPath or ReleaseOwner/ReleaseRepo, not both.' }
    $resolved = (Resolve-Path -LiteralPath $InstallerPath -ErrorAction Stop).ProviderPath
    if (-not (Test-Path -LiteralPath $resolved -PathType Leaf) -or [IO.Path]::GetExtension($resolved) -ne '.exe') {
      throw 'InstallerPath must name a local installer .exe.'
    }
    return [pscustomobject]@{ Mode = 'local'; InstallerPath = $resolved; ReleaseBase = '' }
  }
  if ($ReleaseOwner -notmatch '^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$' -or
      $ReleaseRepo -notmatch '^[a-zA-Z0-9_-][a-zA-Z0-9._-]{0,99}$') {
    throw 'Supply InstallerPath or a valid ReleaseOwner and ReleaseRepo; no upstream release is assumed.'
  }
  return [pscustomobject]@{ Mode = 'release'; InstallerPath = ''; ReleaseBase = "https://github.com/$ReleaseOwner/$ReleaseRepo/releases/latest/download" }
}

function Write-SmokeSource {
  param([Parameter(Mandatory = $true)]$Source, [Parameter(Mandatory = $true)][string]$ResultsDirectory)
  $sourceConfig = @{ mode = $Source.Mode; releaseBase = $Source.ReleaseBase }
  if ($Source.Mode -eq 'local') {
    $staged = Join-Path $ResultsDirectory 'installer-source.exe'
    if ($Source.InstallerPath -ne $staged) { Copy-Item -LiteralPath $Source.InstallerPath -Destination $staged -Force }
    $stream = [IO.File]::OpenRead($staged)
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $sourceConfig.sha256 = [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() }
    finally { $stream.Dispose(); $sha.Dispose() }
  }
  $sourceConfig | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $ResultsDirectory 'smoke-source.json') -Encoding ascii
}
