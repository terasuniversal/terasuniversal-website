$ErrorActionPreference = "Stop"

$tempRoot = Join-Path ([IO.Path]::GetTempPath()) ("hermes-h4-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $tempRoot | Out-Null
try {
    $RepoRoot = $tempRoot; $AiDir = $tempRoot; $CurrentTaskPath = Join-Path $tempRoot "CURRENT_TASK.md"; $TaskStatePath = Join-Path $tempRoot "task-state.json"
    git -C $tempRoot init -b main | Out-Null; git -C $tempRoot config user.email "hermes-tests@example.invalid"; git -C $tempRoot config user.name "Hermes Tests"
    Set-Content -LiteralPath (Join-Path $tempRoot "README.md") -Value "fixture"; git -C $tempRoot add README.md; git -C $tempRoot commit -m fixture | Out-Null
    . (Join-Path $PSScriptRoot "agent-router.ps1")
    . (Join-Path $PSScriptRoot "hermes-execution.ps1")
    function Assert-True { param([bool]$Value, [string]$Name); if (-not $Value) { throw "$Name failed." } }
    $state = New-EmptyTaskState; $state.TaskId = "H4-LEASE"; $state.State = "ROUTED"; $state.Risk = "LOW"; $state.WorkspaceBoundary.CanonicalWorkspace = $tempRoot
    $state.Implementer = "Codex"; $state.ImplementerProvider = "OpenAI Codex"; $state.ImplementerModel = "GPT-5.6 Luna"
    $missing = Acquire-HermesExecutionLease -State $state -Agent "Codex" -Provider "OpenAI Codex" -Model "GPT-5.6 Luna" -Workspace $tempRoot -RequireDecision
    Assert-True ($missing.status -eq "DECISION_BLOCKED") "missing decision blocks lease"
    $decisionDir = Join-Path $AiDir "hermes-decisions"; New-Item -ItemType Directory -Path $decisionDir | Out-Null
    $decisionPath = Join-Path $decisionDir "H4-LEASE.json"
    $branch = (git -C $tempRoot branch --show-current 2>$null | Select-Object -First 1).Trim()
    $head = (git -C $tempRoot rev-parse HEAD 2>$null | Select-Object -First 1).Trim()
    $status = @(git -C $tempRoot status --porcelain --untracked-files=all -- . ':(exclude).ai/hermes-decisions/**' ':(exclude).ai/hermes-execution/**' 2>$null); $bytes = [Text.Encoding]::UTF8.GetBytes(($status -join "`n")); $hash = ([BitConverter]::ToString(([Security.Cryptography.SHA256]::Create().ComputeHash($bytes))) -replace '-', '').ToLowerInvariant()
    $baseDecision = [pscustomobject]@{ DecisionId = "decision-h4"; TaskId = "H4-LEASE"; Decision = "BLOCK"; LeaseEligible = $false; Workspace = $tempRoot; Branch = $branch; ObservedHeadSha = $head; StatusFingerprint = $null; ExpiresAt = [datetime]::UtcNow.AddMinutes(5).ToString("o") }
    $baseDecision | ConvertTo-Json | Set-Content -LiteralPath $decisionPath -Encoding utf8
    $blocked = Acquire-HermesExecutionLease -State $state -Agent "Codex" -Provider "OpenAI Codex" -Model "GPT-5.6 Luna" -Workspace $tempRoot -RequireDecision
    Assert-True ($blocked.status -eq "DECISION_BLOCKED") "non-ALLOW decision blocks lease"
    $baseDecision.Decision = "ALLOW"; $baseDecision.LeaseEligible = $true; $baseDecision | ConvertTo-Json | Set-Content -LiteralPath $decisionPath -Encoding utf8
    $allowed = Acquire-HermesExecutionLease -State $state -Agent "Codex" -Provider "OpenAI Codex" -Model "GPT-5.6 Luna" -Workspace $tempRoot -RequireDecision
    Assert-True $allowed.acquired "ALLOW decision permits lease"
    Complete-HermesExecutionLease -LeaseHandle $allowed -State $state -Status "COMPLETED" | Out-Null
    git -C $tempRoot checkout -b drift | Out-Null
    $drift = Acquire-HermesExecutionLease -State $state -Agent "Codex" -Provider "OpenAI Codex" -Model "GPT-5.6 Luna" -Workspace $tempRoot -RequireDecision
    Assert-True ($drift.status -eq "DECISION_BLOCKED") "TOCTOU status drift blocks lease"
    Write-Output "Hermes H4 PowerShell decision/lease gate tests: PASS"
} finally { if (Test-Path -LiteralPath $tempRoot) { Start-Sleep -Milliseconds 100; Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue } }
