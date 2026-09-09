$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$AiDir = Join-Path $RepoRoot ".ai"
$CurrentTaskPath = Join-Path $AiDir "CURRENT_TASK.md"
$TaskStatePath = Join-Path $AiDir "task-state.json"
. (Join-Path $PSScriptRoot "agent-router.ps1")

function Assert-Equal {
    param($Actual, $Expected, [string]$Name)
    if ($Actual -ne $Expected) { throw "$Name failed. Expected '$Expected', got '$Actual'." }
}

function Assert-True {
    param([bool]$Value, [string]$Name)
    if (-not $Value) { throw "$Name failed." }
}

$low = Get-TaskClassification -MenuChoice 3 -Description "Fix responsive spacing" -PreferDeepSeek
$medium = Get-TaskClassification -MenuChoice 1 -Description "Add a bounded feature" -PreferDeepSeek
$high = Get-TaskClassification -MenuChoice 4 -Description "Review database policy" -PreferDeepSeek
$critical = Get-TaskClassification -MenuChoice 4 -Description "Apply destructive production migration" -PreferDeepSeek

Assert-Equal $low.Risk "LOW" "LOW risk classification"
Assert-Equal $low.Implementer "Codex" "LOW implementer"
Assert-Equal $low.ImplementerProvider "OpenAI Codex" "LOW provider"
Assert-Equal $low.ImplementerModel "GPT-5.6 Luna" "LOW model"

Assert-Equal $medium.Risk "MEDIUM" "MEDIUM risk classification"
Assert-Equal $medium.Implementer "Codex" "MEDIUM implementer"
Assert-Equal $medium.ImplementerProvider "OpenAI Codex" "MEDIUM provider"
Assert-Equal $medium.ImplementerModel "GPT-5.6 Luna" "MEDIUM model"

Assert-Equal $high.Risk "HIGH" "HIGH risk classification"
Assert-Equal $high.Implementer "Claude Code" "HIGH implementer"
Assert-Equal $high.ImplementerProvider "Anthropic" "HIGH provider"
Assert-Equal $high.ImplementerModel "Claude Sonnet 5" "HIGH model"
Assert-Equal $high.HumanApproval "REQUIRED" "HIGH approval gate"

Assert-Equal $critical.Risk "CRITICAL" "CRITICAL risk classification"
Assert-Equal $critical.Implementer "Claude Code" "CRITICAL implementer"
Assert-Equal $critical.ImplementerProvider "Anthropic" "CRITICAL provider"
Assert-Equal $critical.ImplementerModel "Claude Sonnet 5" "CRITICAL model"
Assert-Equal $critical.HumanApproval "REQUIRED" "CRITICAL approval gate"

$legacyChoice = Get-LowMediumImplementerChoice -PreferDeepSeek:$true
Assert-Equal $legacyChoice.Implementer "Codex" "DeepSeek preference cannot override active routing"
Assert-Equal $legacyChoice.ImplementerModel "GPT-5.6 Luna" "DeepSeek preference model"

$routerSource = Get-Content (Join-Path $PSScriptRoot "agent-router.ps1") -Raw
$pipelineSource = Get-Content (Join-Path $PSScriptRoot "teras-agent.ps1") -Raw
$runnerSource = Get-Content (Join-Path $PSScriptRoot "agent-runner.ps1") -Raw
Assert-True ($routerSource -match 'DeepSeekActive = \$false') "DeepSeek active flag disabled"
Assert-True ($pipelineSource -match "Legacy task state must not re-enter the disabled DeepSeek path") "Legacy DeepSeek state reconciliation"
Assert-True ($pipelineSource -notmatch 'Fallback:\r?\n\s*CLAUDE_FAST') "No Claude FAST fallback"
Assert-True ($pipelineSource -match 'approved model is unavailable|Approved model is unavailable') "Unavailable approved model blocker"
Assert-True ($runnerSource -match 'Test-CodexImplementationAvailable' -and $runnerSource -match 'Test-ClaudeAvailable') "Approved model capability checks"

Write-Output "Hermes model routing tests: PASS"
