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

function Get-PowerShellExecutable {
    $pwsh = Get-Command "pwsh" -ErrorAction SilentlyContinue
    if ($pwsh) { return $pwsh.Source }
    $powershell = Get-Command "powershell" -ErrorAction SilentlyContinue
    if ($powershell) { return $powershell.Source }
    throw "PowerShell executable not found."
}

function Show-RoutingSummary {
    $statePath = Join-Path $targetWorkspace ".ai\task-state.json"
    if (-not (Test-Path -LiteralPath $statePath -PathType Leaf)) { return }

    try {
        $state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
        $originalWorker = if ($state.OriginalImplementer) { $state.OriginalImplementer } else { $state.Implementer }
        $workerProvider = if ($originalWorker -eq "DeepSeek") { "deepseek" } else { "openai-codex" }
        $workerModel = if ($originalWorker -eq "DeepSeek") { "deepseek-flash" } else { [string]$state.ImplementerModel }
        $fallback = if ($state.FallbackType -or $state.FallbackImplementer) { "YES" } else { "NO" }

        Write-Host ""
        Write-Host "--- ROUTING EVIDENCE ---"
        Write-Host "Parent/Console: openai-codex / gpt-5.6-luna"
        Write-Host "Classification: $($state.Category) / $($state.Risk)"
        Write-Host "Selected worker: $workerProvider / $workerModel"
        Write-Host "Actual state implementer: $($state.Implementer) / $($state.ImplementerModel)"
        Write-Host "Reviewer: $($state.Reviewer) / $($state.ReviewerModel)"
        Write-Host "Fallback: $fallback"
        if ($state.ImplementerFallbackReason) { Write-Host "Fallback reason: $($state.ImplementerFallbackReason)" }
        Write-Host "Target workspace: $($state.WorkspaceBoundary.CanonicalWorkspace)"
        Write-Host "Task ID: $($state.TaskId)"
        Write-Host "-------------------------"
        Write-Host ""
    } catch {
        Write-Host "Routing summary unavailable: $($_.Exception.Message)"
    }
}

function Invoke-RoutedPrompt {
    param(
        [Parameter(Mandatory = $true)][string]$Prompt,
        [switch]$RunDryRun
    )

    $powershell = Get-PowerShellExecutable
    $childArgs = @(
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-File", $router,
        "-TargetWorkspacePath", $targetWorkspace,
        "-Task", $Prompt,
        "-PreferDeepSeek"
    )
    if ($RunDryRun) { $childArgs += "-DryRun" }

    Write-Host ""
    Write-Host "Routing prompt through TERAS classifier/router..."
    $quotedArgs = $childArgs | ForEach-Object {
        if ($_ -match '[\s"]') { '"' + $_.Replace('"', '\"') + '"' } else { $_ }
    }
    $child = Start-Process -FilePath $powershell -ArgumentList ($quotedArgs -join ' ') -Wait -NoNewWindow -PassThru
    $exitCode = $child.ExitCode
    if (-not $RunDryRun) { Show-RoutingSummary }
    return $exitCode
}

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

if (-not [string]::IsNullOrWhiteSpace($Task)) {
    if ($DryRun) {
        $powershell = Get-PowerShellExecutable
        & $powershell -NoProfile -ExecutionPolicy Bypass -File $router -TargetWorkspacePath $targetWorkspace -Task $Task -DryRun -PreferDeepSeek
        $exitCode = $LASTEXITCODE
        exit $exitCode
    }
    exit (Invoke-RoutedPrompt -Prompt $Task)
}

Write-Host "Enter a prompt for every task. Type 'exit' or 'quit' to close."
while ($true) {
    $prompt = Read-Host "TERAS prompt"
    if ([string]::IsNullOrWhiteSpace($prompt)) { continue }
    if ($prompt.Trim().ToLowerInvariant() -in @("exit", "quit")) { break }
    [void](Invoke-RoutedPrompt -Prompt $prompt -RunDryRun:$DryRun)
}

Write-Host "TERAS CRM Development Console closed."