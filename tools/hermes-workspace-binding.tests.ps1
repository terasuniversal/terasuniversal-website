$ErrorActionPreference = "Stop"
$tempRoot = Join-Path ([IO.Path]::GetTempPath()) ("hermes-workspace-binding-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $tempRoot | Out-Null
$oldHermes = [Environment]::GetEnvironmentVariable("TERAS_HERMES_WORKSPACE", "Process")
$oldCanonical = [Environment]::GetEnvironmentVariable("TERAS_CANONICAL_WORKSPACE", "Process")
try {
    . (Join-Path $PSScriptRoot "agent-router.ps1")
    $canonical = Join-Path $tempRoot "crm"
    $isolated = Join-Path $tempRoot "hermes-a"
    $alternative = Join-Path $tempRoot "hermes-b"
    New-Item -ItemType Directory -Force -Path $canonical, $isolated, $alternative | Out-Null
    [Environment]::SetEnvironmentVariable("TERAS_HERMES_WORKSPACE", $isolated, "Process")
    [Environment]::SetEnvironmentVariable("TERAS_CANONICAL_WORKSPACE", $canonical, "Process")
    if (-not (Test-TerasHermesWorkspaceBinding -RepoRoot $isolated)) { throw "configured Hermes workspace was rejected" }
    if (Test-TerasHermesWorkspaceBinding -RepoRoot $canonical) { throw "canonical CRM workspace was accepted" }
    [Environment]::SetEnvironmentVariable("TERAS_HERMES_WORKSPACE", $alternative, "Process")
    if (-not (Test-TerasHermesWorkspaceBinding -RepoRoot $alternative)) { throw "alternative configured Hermes workspace was rejected" }
    if (Test-TerasHermesWorkspaceBinding -RepoRoot (Join-Path $tempRoot "unknown")) { throw "unknown workspace was accepted" }
    [Environment]::SetEnvironmentVariable("TERAS_HERMES_WORKSPACE", $null, "Process")
    if (Test-TerasHermesWorkspaceBinding -RepoRoot $alternative) { throw "missing Hermes configuration did not fail closed" }
    [Environment]::SetEnvironmentVariable("TERAS_HERMES_WORKSPACE", $oldHermes, "Process")
    [Environment]::SetEnvironmentVariable("TERAS_CANONICAL_WORKSPACE", $oldCanonical, "Process")
    Write-Output "Hermes workspace binding portability tests: PASS"
} finally {
    [Environment]::SetEnvironmentVariable("TERAS_HERMES_WORKSPACE", $oldHermes, "Process")
    [Environment]::SetEnvironmentVariable("TERAS_CANONICAL_WORKSPACE", $oldCanonical, "Process")
    Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
}
