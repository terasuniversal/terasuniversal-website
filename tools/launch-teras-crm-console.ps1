<#
    TERAS CRM Development Console launcher.

    Router source lives in this clean tooling worktree. The target workspace is
    passed explicitly so the router never treats its own worktree as the CRM
    project. Auto Routing is the default entrypoint; provider-specific choices
    remain governed by teras-agent.ps1 and the approved router policy.
#>

param(
    [Parameter(Position = 0)]
    [string]$Task,
    [switch]$DryRun,
    [switch]$PreferDeepSeek,
    [switch]$LiveReadOnlyProbe
)

$ErrorActionPreference = "Stop"
$router = Join-Path $PSScriptRoot "teras-agent.ps1"
$targetWorkspace = "D:\Projects\terasuniversal-website-clean"

if (-not (Test-Path -LiteralPath $router -PathType Leaf)) {
    throw "TERAS router entrypoint not found: $router"
}

Write-Host "TERAS CRM Development Console"
Write-Host "Mode: AUTO ROUTING (Recommended)"
Write-Host "Router source: $PSScriptRoot"
Write-Host "Target workspace: $targetWorkspace"
Write-Host ""

if ($LiveReadOnlyProbe) {
    if ([string]::IsNullOrWhiteSpace($Task)) {
        throw "LiveReadOnlyProbe requires a read-only task description."
    }
    $authOutput = @(& hermes auth status deepseek 2>$null)
    if ($LASTEXITCODE -ne 0 -or (($authOutput -join "`n") -notmatch "(?i)\blogged\s+in\b")) {
        throw "Hermes official DeepSeek credential status is not authenticated."
    }
    Write-Host "Selected provider: deepseek"
    Write-Host "Selected model: deepseek-flash"
    Write-Host "Target workspace: $targetWorkspace"
    Push-Location $targetWorkspace
    try {
        & hermes -z $Task --provider deepseek --model deepseek-flash
        if ($LASTEXITCODE -ne 0) {
            throw "Hermes DeepSeek read-only probe failed with exit code $LASTEXITCODE."
        }
    } finally {
        Pop-Location
    }
    exit 0
}

$arguments = @{
    TargetWorkspacePath = $targetWorkspace
    PreferDeepSeek = $true
}
if (-not [string]::IsNullOrWhiteSpace($Task)) { $arguments.Task = $Task }
if ($DryRun) { $arguments.DryRun = $true }
if ($PreferDeepSeek) { $arguments.PreferDeepSeek = $true }

exit $LASTEXITCODE