$ErrorActionPreference = "Stop"

$tempRoot = Join-Path ([IO.Path]::GetTempPath()) ("hermes-h1-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $tempRoot | Out-Null
try {
    $RepoRoot = $tempRoot
    $AiDir = $tempRoot
    $CurrentTaskPath = Join-Path $tempRoot "CURRENT_TASK.md"
    $TaskStatePath = Join-Path $tempRoot "task-state.json"
    . (Join-Path $PSScriptRoot "agent-router.ps1")
    . (Join-Path $PSScriptRoot "agent-runner.ps1")

    function Assert-Equal {
        param($Actual, $Expected, [string]$Name)
        if ($Actual -ne $Expected) { throw "$Name failed. Expected '$Expected', got '$Actual'." }
    }

    function Assert-True {
        param([bool]$Value, [string]$Name)
        if (-not $Value) { throw "$Name failed." }
    }

    function New-TestState {
        $state = New-EmptyTaskState
        $state.TaskId = "H1-TEST"
        $state.Risk = "LOW"
        $state.Implementer = "Codex"
        $state.ImplementerProvider = "OpenAI Codex"
        $state.ImplementerModel = "GPT-5.6 Luna"
        $state.WorkspaceBoundary.CanonicalWorkspace = $tempRoot
        return $state
    }

    # A/C: an active task without a live lease is interrupted, never successful.
    $running = New-TestState
    $running.State = "RUNNING"
    $running.ExecutionStatus = "RUNNING"
    $recovered = Reconcile-HermesTaskState -State $running -WorkspaceRoot $tempRoot
    Assert-Equal $recovered.State.State "BLOCKED" "interrupted RUNNING task is blocked"
    Assert-Equal $recovered.State.ExecutionStatus "INTERRUPTED" "interrupted execution status"
    Assert-True ($recovered.Findings -contains "INTERRUPTED_EXECUTION") "interruption finding"
    Assert-True (-not ($recovered.State.ExecutionResultSummary -match "COMPLETED")) "interruption is not completion"

    # B: completed work is terminal and is not rerun or altered on restart.
    $completed = New-TestState
    $completed.State = "COMPLETED"
    $completed.ExecutionStatus = "COMPLETED"
    $completed.ExecutionAttempt = 1
    $completed.ExecutionResultSummary = "done"
    $completedRecovery = Reconcile-HermesTaskState -State $completed -WorkspaceRoot $tempRoot
    Assert-Equal $completedRecovery.State.State "COMPLETED" "completed task remains terminal"
    Assert-Equal $completedRecovery.State.ExecutionAttempt 1 "completed task is not rerun"
    Assert-Equal $completedRecovery.State.ExecutionResultSummary "done" "completed result remains durable"

    # D: workspace drift is a hard recovery blocker.
    $wrongWorkspace = New-TestState
    $wrongWorkspace.State = "ROUTED"
    $wrongWorkspace.WorkspaceBoundary.CanonicalWorkspace = "D:\\Projects\\terasuniversal-website-clean"
    $workspaceRecovery = Reconcile-HermesTaskState -State $wrongWorkspace -WorkspaceRoot $tempRoot
    Assert-Equal $workspaceRecovery.State.State "BLOCKED" "workspace drift is blocked"
    Assert-True ($workspaceRecovery.Findings -contains "WORKSPACE_BINDING_MISMATCH") "workspace mismatch finding"
    Assert-True (-not $workspaceRecovery.SafeToResume) "workspace mismatch is not resumable"

    # E: invalid transitions are rejected.
    Assert-True (-not (Test-HermesStateTransition -From "ROUTED" -To "COMPLETED").Allowed) "invalid transition rejection"
    try { Set-HermesTaskState -State (New-TestState) -TargetState "COMPLETED" | Out-Null; throw "invalid transition was accepted" } catch { if ($_.Exception.Message -notmatch "Invalid Hermes state transition") { throw } }

    # F/G/H: automatic repair is bounded at two attempts.
    Assert-Equal (Get-ClaudeRepairDecision -Verdict "CHANGES_REQUIRED" -AttemptsUsed 0) "REPAIR" "repair attempt 1"
    Assert-Equal (Get-ClaudeRepairDecision -Verdict "CHANGES_REQUIRED" -AttemptsUsed 1) "REPAIR" "repair attempt 2"
    Assert-Equal (Get-ClaudeRepairDecision -Verdict "CHANGES_REQUIRED" -AttemptsUsed 2) "NEEDS_HUMAN_REVIEW" "repair attempt 3 blocked"

    # I: approval survives restart/reconciliation.
    $approval = New-TestState
    $approval.Risk = "HIGH"
    $approval.HumanApprovalRequired = "REQUIRED"
    $approval.HumanDecision = "PENDING"
    $approval.State = "ROUTED"
    $approvalRecovery = Reconcile-HermesTaskState -State $approval -WorkspaceRoot $tempRoot
    Assert-Equal $approvalRecovery.State.State "WAITING_APPROVAL" "approval state survives restart"
    Assert-True (-not (Test-McpStartAllowed -State $approvalRecovery.State -TaskId $approval.TaskId).Allowed) "approval gate remains enforced"

    # J/M/N: handoff, legacy metadata, and routing survive a save/reload cycle.
    $handoff = New-TestState
    $handoff.State = "REVIEW_PENDING"
    $handoff.ClaudeReviewStatus = "STARTED"
    Add-AgentHandoffRecord -State $handoff -FromAgent "Codex" -ToAgent "Claude Code" -HandoffType "REVIEW" -HandoffPath ".ai/CLAUDE_REVIEW_HANDOFF.md" -Details "review requested" | Out-Null
    $reloaded = Get-TaskState
    Assert-Equal @($reloaded.HandoffHistory).Count 1 "handoff survives restart"
    Assert-Equal $reloaded.HandoffHistory[0].toAgent "Claude Code" "handoff reviewer survives restart"

    $legacy = New-TestState
    $legacy.State = "IMPLEMENTING"
    $legacy.Risk = "LOW"
    $legacy.Implementer = "DeepSeek"
    $legacy.ImplementerModel = "DEEPSEEK_FAST"
    $legacy.ImplementerProvider = $null
    $legacy.TransitionHistory = @([pscustomobject]@{ from = "CREATED"; to = "ROUTED"; reason = "historical" })
    $legacyRecovery = Reconcile-HermesTaskState -State $legacy -WorkspaceRoot $tempRoot
    Assert-Equal $legacyRecovery.State.Implementer "Codex" "legacy implementer migration"
    Assert-Equal $legacyRecovery.State.ImplementerProvider "OpenAI Codex" "legacy provider migration"
    Assert-Equal $legacyRecovery.State.ImplementerModel "GPT-5.6 Luna" "legacy model migration"
    Assert-Equal @($legacyRecovery.State.TransitionHistory).Count 2 "legacy history preserved"

    $highLegacy = New-TestState
    $highLegacy.Risk = "HIGH"
    $highLegacy.Implementer = "Claude Code"
    $highLegacy.ImplementerModel = "CLAUDE_DEEP"
    $highLegacy.ImplementerProvider = $null
    $highRecovery = Reconcile-HermesTaskState -State $highLegacy -WorkspaceRoot $tempRoot
    Assert-Equal $highRecovery.State.ImplementerProvider "Anthropic" "HIGH provider after resume"
    Assert-Equal $highRecovery.State.ImplementerModel "Claude Sonnet 5" "HIGH model after resume"

    # K: idempotency history is durable and duplicate keys are detected.
    $actionState = New-TestState
    $actionState.State = "ROUTED"
    Add-McpActionRecord -State $actionState -Action "hermes_start_task" -IdempotencyKey "restart-1" -Status "STARTED" -Details "before crash"
    $actionReloaded = Get-TaskState
    Assert-True (Test-McpActionDuplicate -State $actionReloaded -Action "hermes_start_task" -IdempotencyKey "restart-1") "duplicate action detected after restart"
    Assert-Equal @($actionReloaded.McpActionHistory).Count 1 "duplicate action does not duplicate history"

    # L: missing optional fields are backfilled without changing core identity.
    $partial = [pscustomobject]@{ TaskId = "PARTIAL"; State = "ROUTED"; Risk = "MEDIUM"; Description = "legacy" }
    $partialRepaired = Repair-TaskStateSchema -State $partial
    Assert-Equal $partialRepaired.TaskId "PARTIAL" "partial state identity preserved"
    Assert-True ($null -ne $partialRepaired.HandoffHistory -and $null -ne $partialRepaired.TransitionHistory) "optional fields backfilled"

    Write-Output "Hermes H1 reliability tests: PASS"
} finally {
    if (Test-Path -LiteralPath $tempRoot) { Remove-Item -LiteralPath $tempRoot -Recurse -Force }
}
