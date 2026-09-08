# Build local Windows Sandbox configuration from portable tracked templates.
# Dot-sourcing defines functions only; no VM, process, or network operation runs here.

function New-SandboxConfiguration {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][ValidateSet('installer-test', 'smoke-feedback')][string]$Kind,
    [string]$RepositoryRoot,
    [string]$ResultsDirectory
  )
  if (-not $RepositoryRoot) { $RepositoryRoot = Join-Path $PSScriptRoot '..\..' }
  $resolvedRepo = (Resolve-Path -LiteralPath $RepositoryRoot -ErrorAction Stop).ProviderPath
  if (-not (Test-Path -LiteralPath $resolvedRepo -PathType Container)) { throw 'RepositoryRoot must be a directory.' }
  $resolvedSandbox = Join-Path $resolvedRepo 'scripts\sandbox'
  if (-not (Test-Path -LiteralPath $resolvedSandbox -PathType Container)) { throw 'RepositoryRoot must contain scripts/sandbox.' }
  if (-not $ResultsDirectory) { $ResultsDirectory = Join-Path $resolvedSandbox 'results' }
  if (-not [IO.Path]::IsPathRooted($ResultsDirectory)) { $ResultsDirectory = Join-Path $resolvedRepo $ResultsDirectory }
  $resolvedResults = [IO.Path]::GetFullPath($ResultsDirectory)
  if ($resolvedResults.TrimEnd('\', '/') -eq [IO.Path]::GetPathRoot($resolvedResults).TrimEnd('\', '/')) {
    throw 'ResultsDirectory must be a dedicated results directory, not a drive root.'
  }
  $bindings = @{
    '{{RELEASE_DIR}}' = Join-Path $resolvedRepo 'release'
    '{{HARNESS_DIR}}' = $resolvedSandbox
    '{{RESULTS_DIR}}' = $resolvedResults
  }
  $document = New-Object System.Xml.XmlDocument
  $document.XmlResolver = $null
  $document.Load((Join-Path $PSScriptRoot "$Kind.wsb"))
  foreach ($node in $document.SelectNodes('/Configuration/MappedFolders/MappedFolder/HostFolder')) {
    if (-not $bindings.ContainsKey($node.InnerText)) { throw 'Unknown sandbox path placeholder.' }
    # InnerText performs XML escaping, including ampersands in real repository names.
    $node.InnerText = $bindings[$node.InnerText]
  }
  if (-not (Test-Path -LiteralPath $resolvedResults)) { [IO.Directory]::CreateDirectory($resolvedResults) | Out-Null }
  if (-not (Test-Path -LiteralPath $resolvedResults -PathType Container)) { throw 'ResultsDirectory must be a directory.' }
  $generated = Join-Path $resolvedResults "$Kind.generated.wsb"
  $document.Save($generated)
  return [pscustomobject]@{
    RepositoryRoot = $resolvedRepo; SandboxDirectory = $resolvedSandbox
    ResultsDirectory = $resolvedResults; ReleaseDirectory = $bindings['{{RELEASE_DIR}}']; Wsb = $generated
  }
}
