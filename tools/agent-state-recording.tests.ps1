$ErrorActionPreference = "Stop"

$tempRoot = Join-Path ([IO.Path]::GetTempPath()) ("hermes-p47-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $tempRoot | Out-Null
try {
    $RepoRoot = $tempRoot
    $AiDir = $tempRoot
    $CurrentTaskPath = Join-Path $tempRoot "CURRENT_TASK.md"
    $TaskStatePath = Join-Path $tempRoot "task-state.json"
    . (Join-Path $PSScriptRoot "agent-router.ps1")

    $state = New-EmptyTaskState
    $state.TaskId = "P4.7-TEST"
    $state.HumanApprovalRequired = "REQUIRED"
    Set-CodexExecutionRecord -State $state -Status "STARTED" -Result ([pscustomobject]@{ agent = "Codex" })
    Set-CodexExecutionRecord -State $state -Status "COMPLETED" -Result ([pscustomobject]@{ exitCode = 0; result = "ok" })
    Set-ClaudeReviewRecord -State $state -Status "COMPLETED" -Findings @("finding") -Result ([pscustomobject]@{ verdict = "PASS_WITH_NOTES" })
    Add-AgentHandoffRecord -State $state -FromAgent "Codex" -ToAgent "Claude Code" -HandoffType "REVIEW" -HandoffPath ".ai/CLAUDE_REVIEW_HANDOFF.md"
    Add-McpActionRecord -State $state -Action "hermes_run_tests" -IdempotencyKey "qa-1" -Status "COMPLETED" -Details ([pscustomobject]@{ scope = "targeted" })
    Save-TaskState -State $state

    $restarted = Get-TaskState
    if ($restarted.CodexExecutionStatus -ne "COMPLETED") { throw "Codex execution status did not persist." }
    if ($restarted.CodexExecutionResult.result -ne "ok") { throw "Codex execution result did not persist." }
    if ($restarted.ClaudeReviewFindings[0] -ne "finding") { throw "Claude findings did not persist." }
    if ($restarted.ClaudeReviewResult.verdict -ne "PASS_WITH_NOTES") { throw "Claude review result did not persist." }
    if (@($restarted.HandoffHistory).Count -ne 1) { throw "Handoff history did not persist." }
    if (@($restarted.PendingHumanApprovals).Count -ne 1) { throw "Pending approval metadata did not persist." }
    if (@($restarted.McpActionHistory).Count -ne 1 -or $restarted.McpActionHistory[0].idempotencyKey -ne "qa-1") { throw "MCP action audit did not persist." }
    if (-not $restarted.CodexExecutionStartedAt -or -not $restarted.CodexExecutionCompletedAt -or -not $restarted.ClaudeReviewCompletedAt) { throw "Event timestamps did not persist." }
    if (-not (Test-McpActionDuplicate -State $restarted -Action "hermes_run_tests" -IdempotencyKey "qa-1")) { throw "Duplicate action was not detected." }
    $approvalState = New-EmptyTaskState
    $approvalState.TaskId = "HIGH-TEST"; $approvalState.State = "ROUTED"; $approvalState.Risk = "HIGH"; $approvalState.HumanApprovalRequired = "REQUIRED"; $approvalState.HumanDecision = "PENDING"
    if ((Test-McpStartAllowed -State $approvalState -TaskId "HIGH-TEST").Allowed) { throw "Approval-required start was not refused." }
    $approvalState.Risk = "LOW"; $approvalState.HumanApprovalRequired = "NOT REQUIRED"
    if (-not (Test-McpStartAllowed -State $approvalState -TaskId "HIGH-TEST").Allowed) { throw "Low-risk start was incorrectly refused." }
    Write-Output "P4.7 durable state recording passed"
} finally {
    if (Test-Path -LiteralPath $tempRoot) { Remove-Item -LiteralPath $tempRoot -Recurse -Force }
}
