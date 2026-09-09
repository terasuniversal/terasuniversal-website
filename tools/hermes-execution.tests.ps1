$ErrorActionPreference = "Stop"

$tempRoot = Join-Path ([IO.Path]::GetTempPath()) ("hermes-h11-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $tempRoot | Out-Null
try {
    $RepoRoot = $tempRoot
    $AiDir = $tempRoot
    $CurrentTaskPath = Join-Path $tempRoot "CURRENT_TASK.md"
    $TaskStatePath = Join-Path $tempRoot "task-state.json"
    . (Join-Path $PSScriptRoot "agent-router.ps1")
    . (Join-Path $PSScriptRoot "hermes-execution.ps1")

    function Assert-Equal { param($Actual, $Expected, [string]$Name); if ($Actual -ne $Expected) { throw "$Name failed. Expected '$Expected', got '$Actual'." } }
    function Assert-True { param([bool]$Value, [string]$Name); if (-not $Value) { throw "$Name failed." } }
    function New-LeaseTestState {
        param([string]$TaskId = ("H11-" + [guid]::NewGuid().ToString("N")), [string]$Risk = "LOW")
        $state = New-EmptyTaskState
        $state.TaskId = $TaskId
        $state.State = "ROUTED"
        $state.Risk = $Risk
        $state.Implementer = if ($Risk -in @("HIGH", "CRITICAL")) { "Claude Code" } else { "Codex" }
        $state.ImplementerProvider = if ($Risk -in @("HIGH", "CRITICAL")) { "Anthropic" } else { "OpenAI Codex" }
        $state.ImplementerModel = if ($Risk -in @("HIGH", "CRITICAL")) { "Claude Sonnet 5" } else { "GPT-5.6 Luna" }
        $state.WorkspaceBoundary.CanonicalWorkspace = $tempRoot
        if ($Risk -in @("HIGH", "CRITICAL")) { $state.HumanApprovalRequired = "REQUIRED"; $state.HumanDecision = "APPROVED" }
        return $state
    }
    function New-Lease { param($State, [int]$TtlSeconds = 30); return (Acquire-HermesExecutionLease -State $State -Agent $State.Implementer -Provider $State.ImplementerProvider -Model $State.ImplementerModel -Workspace $tempRoot -TtlSeconds $TtlSeconds) }

    # A/C: one lease is acquired, a heartbeat keeps it alive, and a duplicate is explicit.
    $single = New-LeaseTestState "H11-SINGLE"
    $first = New-Lease $single
    Assert-True $first.acquired "single start acquires a lease"
    $duplicate = New-Lease $single
    Assert-Equal $duplicate.status "ALREADY_RUNNING" "duplicate start is blocked"
    Assert-True (Update-HermesExecutionHeartbeat -LeaseHandle $first -State $single -TtlSeconds 30) "valid heartbeat succeeds"
    $liveLease = Get-HermesExecutionLease $single.TaskId
    Assert-True (Test-HermesLeaseFresh $liveLease) "heartbeat preserves RUNNING"

    # E/F: terminal completion/failure finalizes the lease and releases ownership.
    Assert-True (Complete-HermesExecutionLease -LeaseHandle $first -State $single -Status "COMPLETED" -Result @{ result = "ok" }) "success finalizes lease"
    Assert-Equal (Get-HermesExecutionLease $single.TaskId).status "COMPLETED" "completed lease is terminal"
    $single.State = "COMPLETED"
    $terminalAttempt = New-Lease $single
    Assert-Equal $terminalAttempt.status "TERMINAL" "completed task cannot rerun"
    $failed = New-LeaseTestState "H11-FAILED"; $failedLease = New-Lease $failed
    Complete-HermesExecutionLease -LeaseHandle $failedLease -State $failed -Status "FAILED" -Result @{ error = "fixture" } | Out-Null
    Assert-Equal (Get-HermesExecutionLease $failed.TaskId).status "FAILED" "failed lease is terminal"

    # D/G/H/Q: a simulated gateway restart preserves a fresh lease, but an expired lease becomes interrupted.
    $restart = New-LeaseTestState "H11-RESTART"; $restartLease = New-Lease $restart
    $restartRecovery = Reconcile-HermesExecutionLease -State $restart -Workspace $tempRoot -Now ([datetime]::UtcNow)
    Assert-Equal $restartRecovery.status "ACTIVE" "fresh lease survives restart"
    $expired = Get-HermesExecutionLease $restart.TaskId
    $expired.heartbeatAt = [datetime]::UtcNow.AddMinutes(-5).ToString("o")
    $expired.leaseExpiresAt = [datetime]::UtcNow.AddMinutes(-4).ToString("o")
    Write-HermesAtomicJson -Path (Get-HermesExecutionLeasePath $restart.TaskId) -Value $expired
    $staleRecovery = Reconcile-HermesExecutionLease -State $restart -Workspace $tempRoot -Now ([datetime]::UtcNow)
    Assert-Equal $staleRecovery.status "INTERRUPTED" "expired lease reconciles to interruption"
    Assert-Equal (Get-HermesExecutionLease $restart.TaskId).status "INTERRUPTED" "crash never becomes success"
    Assert-Equal $restart.State "BLOCKED" "stale execution is blocked"

    # I/J/P: stale locks can be recovered; valid locks cannot be stolen and races are deterministic.
    $stale = New-LeaseTestState "H11-STALE-LOCK"
    $staleLease = [pscustomobject]@{ taskId = $stale.TaskId; executionId = "old"; status = "INTERRUPTED"; workspace = $tempRoot; heartbeatAt = [datetime]::UtcNow.AddMinutes(-5).ToString("o"); leaseExpiresAt = [datetime]::UtcNow.AddMinutes(-4).ToString("o"); attempt = 1 }
    New-Item -ItemType Directory -Path (Get-HermesExecutionDirectory) -Force | Out-Null
    Write-HermesAtomicJson -Path (Get-HermesExecutionLeasePath $stale.TaskId) -Value $staleLease
    Set-Content -LiteralPath (Get-HermesExecutionLockPath $stale.TaskId) -Value "stale" -Encoding utf8
    $recoveredLock = New-Lease $stale
    Assert-True $recoveredLock.acquired "stale lock recovered"
    Complete-HermesExecutionLease -LeaseHandle $recoveredLock -State $stale -Status "BLOCKED" -Result "fixture" | Out-Null
    $owner = New-LeaseTestState "H11-OWNER"; $ownerLease = New-Lease $owner
    $steal = New-Lease $owner
    Assert-True ($steal.status -in @("ALREADY_RUNNING", "EXECUTION_LOCKED")) "valid owner cannot be stolen"
    Complete-HermesExecutionLease -LeaseHandle $ownerLease -State $owner -Status "CANCELLED" | Out-Null

    # K/O/N: terminal, approval, and workspace guards happen before ownership.
    $approved = New-LeaseTestState "H11-APPROVAL" "HIGH"; $approved.HumanDecision = "PENDING"
    Assert-Equal (New-Lease $approved).status "APPROVAL_REQUIRED" "HIGH approval gate precedes lease"
    $wrong = New-LeaseTestState "H11-WORKSPACE"; $wrong.WorkspaceBoundary.CanonicalWorkspace = "D:\Projects\terasuniversal-website-clean"
    Assert-Equal (New-Lease $wrong).status "WORKSPACE_BLOCKED" "stale workspace binding is blocked"

    # L/M: repair executions have unique IDs and attempt count is durable across reload.
    $repair = New-LeaseTestState "H11-REPAIR"; $repair.RepairCyclesUsed = 1
    $repairOne = New-Lease $repair; Complete-HermesExecutionLease -LeaseHandle $repairOne -State $repair -Status "FAILED" | Out-Null
    $repair.State = "REPAIR_REQUIRED"; Save-TaskState -State $repair
    $repairReload = Get-TaskState
    Assert-Equal $repairReload.RepairCyclesUsed 1 "repair count survives restart"
    $repairTwo = New-Lease $repairReload
    Assert-True ($repairTwo.executionId -ne $repairOne.executionId) "repair gets unique execution ID"
    Complete-HermesExecutionLease -LeaseHandle $repairTwo -State $repairReload -Status "BLOCKED" | Out-Null

    # R: legacy state without lease fields is backfilled and remains recoverable, never successful.
    $legacy = [pscustomobject]@{ TaskId = "H11-LEGACY"; State = "RUNNING"; Risk = "LOW"; WorkspaceBoundary = [pscustomobject]@{ CanonicalWorkspace = $tempRoot }; ExecutionStatus = "RUNNING" }
    Repair-TaskStateSchema -State $legacy | Out-Null
    $legacyRecovery = Reconcile-HermesExecutionLease -State $legacy -Workspace $tempRoot
    Assert-Equal $legacyRecovery.status "NO_LEASE" "legacy task without lease is safe"
    Assert-True ($legacy.PSObject.Properties.Name -contains "ActiveExecutionId") "legacy fields backfilled"

    Write-Output "Hermes H1.1 execution lease tests: PASS"
} finally {
    if (Test-Path -LiteralPath $tempRoot) { Start-Sleep -Milliseconds 100; Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue }
}
