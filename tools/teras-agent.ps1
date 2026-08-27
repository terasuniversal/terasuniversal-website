<#
    TERAS AI Engineering Orchestrator - main launcher.

    Pipeline: Task -> Classification -> Risk assessment -> Model routing
    (DeepSeek for routine LOW/bounded-MEDIUM work, Claude FAST/DEEP
    otherwise - see agent-router.ps1's Get-TaskClassification) ->
    CURRENT_TASK.md -> implementer handoff -> implementation (DeepSeek can
    return ESCALATE_TO_CLAUDE, handled on -Resume) -> changed files -> QA ->
    Codex review (when required) -> FINAL_REPORT.md -> STOP for human
    approval -> (separately, on request) Approve -> Prepare Commit ->
    Commit. See ..\.ai\ARCHITECTURE.md for the full diagram and
    ..\.ai\BUSINESS_RULES.md / ..\.ai\USAGE_POLICY.md for the constraints
    enforced throughout.

    This script never commits without an explicit -Commit invocation and a
    typed "YES" confirmation, never pushes, never deploys, and never
    applies a migration - see approval-runner.ps1's header comment for the
    specific safety invariants. DeepSeek/Claude/Codex are never invoked
    outside a task this classifier already scoped for them - see
    deepseek-runner.ps1's header comment for that boundary specifically.

    Usage:
      teras-agent                          Interactive menu
      teras-agent "<task description>"     Classify, route, and run the task
      teras-agent -DryRun "<task>"         Classify and generate handoffs only
      teras-agent -Resume                  Continue the current task from its recorded state
      teras-agent -Status                  Show the current task's status
      teras-agent -Review                  Run an independent review pass only
      teras-agent -Approve                 Approve the current task (gated - see approval-runner.ps1)
      teras-agent -Reject                  Reject the current task
      teras-agent -PrepareCommit           Preview the proposed commit (no staging)
      teras-agent -Commit                  Stage approved files and commit, after typed confirmation
      teras-agent -PreparePush             Preview the proposed push (branch/commit/remote, not executed)
      teras-agent -Push                    Push the approved branch, after typed confirmation (never --force)
      teras-agent -Preview                 Deploy/detect a Vercel Preview for the pushed branch and verify it
      teras-agent -PreviewStatus           Show the current task's preview status
      teras-agent -VerifyPreview           Re-run non-destructive verification against the existing preview URL
      teras-agent -DryRunPush              Show what -PreparePush/-Push would do, without executing anything
      teras-agent -DryRunPreview           Show what -Preview would do, without executing anything
      teras-agent -PreparePR               Generate .ai/PR_REPORT.md and a proposed PR title/body
      teras-agent -CreatePR                Create the GitHub PR, after typed confirmation
      teras-agent -PRStatus                Show PR number/state/mergeability/checks
      teras-agent -PrepareRelease          Generate .ai/RELEASE_REPORT.md and .ai/ROLLBACK_PLAN.md
      teras-agent -ApproveRelease          Human release approval (requires typing "APPROVE RELEASE")
      teras-agent -Release                 Merge the approved PR, after re-verification and typing "MERGE APPROVED RELEASE"
      teras-agent -ProductionStatus        Show merge/deployment/verification/rollback status
      teras-agent -VerifyProduction        Non-destructive verification against the detected production URL
      teras-agent -DryRunPR                Show what -PreparePR/-CreatePR would do, without executing anything
      teras-agent -DryRunRelease           Show what -PrepareRelease/-Release would do, without executing anything
      teras-agent -DatabaseStatus          Show the current task's database-migration-safety status (separate track from app State)
      teras-agent -PrepareMigration        Static-scan the migration SQL and generate .ai/DATABASE_HANDOFF.md / .ai/DATABASE_REPORT.md
      teras-agent -ReviewMigration         Run the dedicated Codex database review (never re-run for unchanged SQL)
      teras-agent -ApproveMigration        Human migration approval (requires typing "APPROVE DATABASE MIGRATION")
      teras-agent -ApplyMigration -Target LOCAL|STAGING|PRODUCTION   Environment-gated apply - PRODUCTION never actually executes here, see db-runner.ps1
      teras-agent -VerifyDatabase          Non-destructive verification that the applied migration's objects exist
      teras-agent -DryRunMigration         Show what the database workflow would do, without executing anything
      teras-agent -Validate                Run the full end-to-end dry-run validation suite (SIMULATION ONLY - see .ai/validation/VALIDATION_PLAN.md)
      teras-agent -Validate -Verbose       Same, with per-check pass/fail detail printed as it runs
      teras-agent -TestMode                Non-interactive, non-destructive self-test (implies -DryRun)

    Production deployment, merging, and migration apply are not implemented
    in this or any prior phase - see .ai/BUSINESS_RULES.md and this file's
    -Deploy handler.

    (Not installed on PATH as a bare `teras-agent` command by this script -
    that would mean editing your PowerShell $PROFILE, which is outside this
    repository and something this orchestrator will not do on its own. Add
    an alias/function yourself if you want the bare-word form, e.g.:
      function teras-agent { & "D:\Projects\terasuniversal-website\tools\teras-agent.ps1" @args }
    in your $PROFILE.)
#>

param(
    [Parameter(Position = 0)]
    [string]$Task,
    [switch]$DryRun,
    [switch]$Resume,
    [switch]$Status,
    [switch]$Review,
    [switch]$Approve,
    [switch]$Reject,
    [switch]$PrepareCommit,
    [switch]$Commit,
    [switch]$PreparePush,
    [switch]$Push,
    [switch]$Preview,
    [switch]$PreviewStatus,
    [switch]$VerifyPreview,
    [switch]$DryRunPush,
    [switch]$DryRunPreview,
    [switch]$PreparePR,
    [switch]$CreatePR,
    [switch]$PRStatus,
    [switch]$PrepareRelease,
    [switch]$ApproveRelease,
    [switch]$Release,
    [switch]$ProductionStatus,
    [switch]$VerifyProduction,
    [switch]$DryRunPR,
    [switch]$DryRunRelease,
    [switch]$Validate,
    [switch]$DatabaseStatus,
    [switch]$PrepareMigration,
    [switch]$ReviewMigration,
    [switch]$ApproveMigration,
    [switch]$ApplyMigration,
    [switch]$VerifyDatabase,
    [switch]$DryRunMigration,
    [string]$Target,
    [switch]$TestDeepSeek,
    [switch]$DeepSeekStatus,
    [switch]$PreferDeepSeek,
    [switch]$Deploy,
    [switch]$TestMode,
    [string]$TestDescription = "Fix Template A director signature spacing",
    [int]$TestMenuChoice = 5
)

$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$AiDir = Join-Path $RepoRoot ".ai"
$CurrentTaskPath = Join-Path $AiDir "CURRENT_TASK.md"
$TaskStatePath = Join-Path $AiDir "task-state.json"

. (Join-Path $PSScriptRoot "agent-router.ps1")
. (Join-Path $PSScriptRoot "qa-runner.ps1")
. (Join-Path $PSScriptRoot "agent-runner.ps1")
. (Join-Path $PSScriptRoot "review-runner.ps1")
. (Join-Path $PSScriptRoot "approval-runner.ps1")
. (Join-Path $PSScriptRoot "push-runner.ps1")
. (Join-Path $PSScriptRoot "preview-runner.ps1")
. (Join-Path $PSScriptRoot "pr-runner.ps1")
. (Join-Path $PSScriptRoot "release-runner.ps1")
. (Join-Path $PSScriptRoot "deepseek-runner.ps1")
. (Join-Path $PSScriptRoot "db-runner.ps1")
. (Join-Path $PSScriptRoot "validate-runner.ps1")

$Safety = [ordered]@{
    AUTO_COMMIT             = $false
    AUTO_PUSH               = $false
    AUTO_DEPLOY             = $false
    AUTO_DATABASE_WRITE     = $false
    AUTO_MIGRATION_APPLY    = $false
    SCOPE_LOCK              = $true
    HUMAN_APPROVAL_REQUIRED = $true
}

function Show-Header {
    Write-Host ""
    Write-Host "========================================"
    Write-Host "        TERAS AI ENGINEERING"
    Write-Host "========================================"
    Write-Host ""
}

function Show-Menu {
    Show-Header
    Write-Host "1. New Feature"
    Write-Host "2. Fix Bug"
    Write-Host "3. UI / CSS"
    Write-Host "4. Database / Supabase"
    Write-Host "5. Certificate"
    Write-Host "6. Review Current Changes"
    Write-Host "7. Production Audit"
    Write-Host "8. Resume Current Task"
    Write-Host "9. Show Current Task"
    Write-Host "0. Exit"
    Write-Host ""
    Write-Host "(Approve/Commit/Push/Preview/PR/Release are separate commands: -Approve, -PrepareCommit,"
    Write-Host " -Commit, -Reject, -PreparePush, -Push, -Preview, -PreviewStatus, -VerifyPreview, -PreparePR,"
    Write-Host " -CreatePR, -PRStatus, -PrepareRelease, -ApproveRelease, -Release, -ProductionStatus,"
    Write-Host " -VerifyProduction)"
    Write-Host "(Database changes get their own separate track: -DatabaseStatus, -PrepareMigration,"
    Write-Host " -ReviewMigration, -ApproveMigration, -ApplyMigration -Target ..., -VerifyDatabase)"
    Write-Host ""
}

# ---------------------------------------------------------------------------
# Post-implementation tail: scope check -> QA -> review (+ one repair cycle)
# -> AWAITING_APPROVAL -> FINAL_REPORT.md -> approval screen. Shared by the
# direct pipeline and -Resume so the two never drift apart.
# ---------------------------------------------------------------------------

function Invoke-ReviewStage {
    param($State, [bool]$Mandatory, [bool]$Optional, [string[]]$PreImplementationSnapshot)

    if (-not ($Mandatory -or $Optional)) {
        return $State
    }

    $State.State = "REVIEWING"
    Save-TaskState -State $State

    $handoffPath = New-CodexReviewHandoff -State $State -TaskGeneratedFiles $State.TaskGeneratedFiles
    $ran = Invoke-CodexReview -HandoffPath $handoffPath
    $State.ReviewVerdict = if ($ran) { Get-ReviewVerdict } else { "PENDING" }
    $State.ReviewedDiffHash = Get-DiffHash -Files $State.TaskGeneratedFiles
    Save-TaskState -State $State

    if ($State.ReviewVerdict -ne "BLOCKED") {
        return $State
    }

    if ($State.RepairCyclesUsed -ge 1) {
        $State.State = "BLOCKED"
        Save-TaskState -State $State
        Write-Host ""
        Write-Host "STATUS: HUMAN INTERVENTION REQUIRED"
        Write-Host "Codex review is still BLOCKED after the maximum of 1 automatic repair cycle (MAX_REPAIR_CYCLES=1)."
        Write-Host "No further agent loop will run automatically."
        Write-Host ""
        return $State
    }

    Write-Host ""
    Write-Host "Codex review returned BLOCKED. Starting repair cycle 1 of 1 (MAX_REPAIR_CYCLES=1)."
    Write-Host ""

    $State.State = "REPAIR"
    Save-TaskState -State $State
    $issues = Get-ReviewBlockingIssues
    $repairHandoffPath = New-RepairHandoff -State $State -BlockingIssues $issues

    if (-not (Test-ClaudeAvailable)) {
        Write-Host "Claude Code CLI not detected. REPAIR_HANDOFF.md was generated - run the repair manually, then 'teras-agent -Resume'."
        return $State
    }
    Invoke-ClaudeImplementation -HandoffPath $repairHandoffPath | Out-Null

    $afterRepair = Get-GitStatusSnapshot
    $delta = Get-ImplementationDelta -Before $PreImplementationSnapshot -After $afterRepair
    $State.PreExistingFiles = $delta.PreExisting
    $State.TaskGeneratedFiles = $delta.TaskGenerated

    $scope = Test-ScopeViolation -TaskGeneratedFiles $delta.TaskGenerated -AllowedFiles $State.AllowedFiles
    $State.ScopeCheck = $scope.Status
    Save-TaskState -State $State
    if ($scope.Status -eq "FAIL") {
        $State.State = "BLOCKED"
        Save-TaskState -State $State
        Write-Host ""
        Write-Host "SCOPE VIOLATION DETECTED"
        Write-Host ""
        Write-Host "Unauthorized files changed:"
        foreach ($f in $scope.Unauthorized) { Write-Host "- $f" }
        Write-Host ""
        return $State
    }

    $State.State = "QA"
    Save-TaskState -State $State
    $qa = Invoke-QA -ChangedFiles $delta.TaskGenerated -Lightweight:($State.Implementer -eq "DeepSeek" -or $State.Risk -eq "LOW")
    $State.QA = $qa
    Save-TaskState -State $State
    if (Test-QaHasBlockingFailure -QaResults $qa) {
        $State.State = "BLOCKED"
        Save-TaskState -State $State
        Write-Host "Blocking QA failure detected during the repair cycle. State: BLOCKED."
        return $State
    }

    $State.RepairCyclesUsed = 1
    $State.State = "REVIEWING"
    Save-TaskState -State $State
    $handoffPath2 = New-CodexReviewHandoff -State $State -TaskGeneratedFiles $State.TaskGeneratedFiles
    $ran2 = Invoke-CodexReview -HandoffPath $handoffPath2
    $State.ReviewVerdict = if ($ran2) { Get-ReviewVerdict } else { "PENDING" }
    $State.ReviewedDiffHash = Get-DiffHash -Files $State.TaskGeneratedFiles
    Save-TaskState -State $State

    if ($State.ReviewVerdict -eq "BLOCKED") {
        $State.State = "BLOCKED"
        Save-TaskState -State $State
        Write-Host ""
        Write-Host "STATUS: HUMAN INTERVENTION REQUIRED"
        Write-Host "Codex review is still BLOCKED after the repair cycle. No further agent loop will run automatically."
        Write-Host ""
    }

    return $State
}

function Write-FinalReport {
    param($State)

    $path = Join-Path $AiDir "FINAL_REPORT.md"
    $preText = if (@($State.PreExistingFiles).Count -gt 0) { (@($State.PreExistingFiles) | ForEach-Object { "- $_" }) -join "`n" } else { "- (none)" }
    $genText = if (@($State.TaskGeneratedFiles).Count -gt 0) { (@($State.TaskGeneratedFiles) | ForEach-Object { "- $_" }) -join "`n" } else { "- (none)" }
    $qaOverall = if (Test-QaHasBlockingFailure -QaResults $State.QA) { "FAIL" } else { "PASS" }
    $reviewerText = if ($State.Reviewer -eq "None") { "Not required" } else { "$($State.Reviewer) / $($State.ReviewerModel)" }

    $content = @"
# FINAL_REPORT.md

TERAS AI ENGINEERING - FINAL REPORT

Task:
$($State.Description)

Task ID:
$($State.TaskId)

Category:
$($State.Category)

Risk:
$($State.Risk)

Implementer:
$($State.Implementer) / $($State.ImplementerModel)

Reviewer:
$reviewerText

## FILES

Pre-existing changes:
$preText

Task-generated changes:
$genText

## QA

git diff --check  : $($State.QA.GitDiffCheck.Result)
TypeScript        : $($State.QA.TypeScript.Result)
Tests             : $($State.QA.Tests.Result)
Build             : $($State.QA.Build.Result)

Overall QA: $qaOverall

## Scope Check

$($State.ScopeCheck)

## Independent Review

$($State.ReviewVerdict)

## Overall Status

$($State.State)

## Actions NOT performed

- Commit
- Push
- Deploy
- Migration Apply
- Production DB Write
"@

    Set-Content -Path $path -Value $content -Encoding utf8
}

function Show-ApprovalScreen {
    param($State)

    if ($State.State -eq "BLOCKED") {
        Write-Host ""
        Write-Host "Task is BLOCKED - see .ai/CURRENT_TASK.md and .ai/FINAL_REPORT.md for the reason."
        Write-Host "Approval is not available until this is resolved (fix and 'teras-agent -Resume', or -Reject)."
        Write-Host ""
        return
    }

    Write-Host ""
    Write-Host "========================================"
    Write-Host "        HUMAN APPROVAL REQUIRED"
    Write-Host "========================================"
    Write-Host ""
    Write-Host "Task Status:"
    Write-Host "READY FOR REVIEW"
    Write-Host ""
    Write-Host "Files changed:"
    Write-Host (@($State.TaskGeneratedFiles).Count)
    Write-Host ""
    Write-Host "QA:"
    Write-Host $(if (Test-QaHasBlockingFailure -QaResults $State.QA) { "FAIL" } else { "PASS" })
    Write-Host ""
    Write-Host "Codex Review:"
    Write-Host $State.ReviewVerdict
    Write-Host ""
    Write-Host "No commit has been created."
    Write-Host "No push has been performed."
    Write-Host "No deployment has been performed."
    Write-Host ""
    Write-Host "Available next actions:"
    Write-Host ""
    Write-Host "1. teras-agent -Status          (review the diff summary and current status)"
    Write-Host "2. Open .ai/FINAL_REPORT.md"
    Write-Host "3. teras-agent -Approve         (then -PrepareCommit to preview, -Commit to create it)"
    Write-Host "4. teras-agent -Reject"
    Write-Host ""
    Write-Host "Commit must NOT happen automatically."
    Write-Host ""
}

function Get-ImplementationDelta {
    param([string[]]$Before, [string[]]$After)

    $delta = Get-ChangedFilesDelta -Before $Before -After $After
    # These files are written by the orchestrator while it records the
    # implementation result; they are not files changed by the agent and
    # must not become scope violations or implementation outputs.
    $orchestratorManaged = @(
        ".ai/CURRENT_TASK.md",
        ".ai/PROJECT_STATUS.md",
        ".ai/task-state.json",
        ".ai/CODEX_IMPLEMENTATION_HANDOFF.md",
        ".ai/CODEX_REVIEW_HANDOFF.md",
        ".ai/CLAUDE_REVIEW_HANDOFF.md",
        ".ai/CLAUDE_HANDOFF.md",
        ".ai/REVIEW_REPORT.md",
        ".ai/REPAIR_HANDOFF.md",
        ".ai/FINAL_REPORT.md",
        ".ai/IMPLEMENTATION_REPORT.md"
    )
    $delta.TaskGenerated = @($delta.TaskGenerated | Where-Object { $_ -notin $orchestratorManaged })
    return $delta
}

function Invoke-PostImplementation {
    param($State, [string[]]$PreSnapshot)

    $postSnapshot = Get-GitStatusSnapshot
    $delta = Get-ImplementationDelta -Before $PreSnapshot -After $postSnapshot
    $State.PreExistingFiles = $delta.PreExisting
    $State.TaskGeneratedFiles = $delta.TaskGenerated

    $scope = Test-ScopeViolation -TaskGeneratedFiles $delta.TaskGenerated -AllowedFiles $State.AllowedFiles
    $State.ScopeCheck = $scope.Status
    Save-TaskState -State $State
    if ($scope.Status -eq "FAIL") {
        $State.State = "BLOCKED"
        Save-TaskState -State $State
        Write-Host ""
        Write-Host "SCOPE VIOLATION DETECTED"
        Write-Host ""
        Write-Host "Unauthorized files changed:"
        foreach ($f in $scope.Unauthorized) { Write-Host "- $f" }
        Write-Host ""
        Write-Host "Human decides what happens next - see .ai/CURRENT_TASK.md. No file was reverted automatically."
        Write-Host ""
        return $State
    }

    $claudeReview = Invoke-ClaudeReadOnlyReview -State $State -TaskGeneratedFiles $delta.TaskGenerated
    if (-not $claudeReview.Succeeded) {
        $State.State = "BLOCKED"
        Save-TaskState -State $State
        Write-Host "Claude read-only review did not complete: $($claudeReview.Error)"
        Write-Host "Review handoff retained at: $($claudeReview.HandoffPath)"
        return $State
    }

    Write-Host "Claude review verdict: $($claudeReview.Verdict)"
    if ($claudeReview.Verdict -eq "CHANGES_REQUIRED") {
        $State.State = "BLOCKED"
        Save-TaskState -State $State
        Write-Host "Claude requested changes. Findings are retained in $($claudeReview.HandoffPath). Codex was not rerun."
        return $State
    }

    $State.State = "QA"
    Save-TaskState -State $State
    $qa = Invoke-QA -ChangedFiles $delta.TaskGenerated -Lightweight:($State.Implementer -eq "DeepSeek" -or $State.Risk -eq "LOW")
    $State.QA = $qa
    Save-TaskState -State $State
    if (Test-QaHasBlockingFailure -QaResults $qa) {
        $State.State = "BLOCKED"
        Save-TaskState -State $State
        Write-Host "Blocking QA failure detected. State: BLOCKED."
        return $State
    }

    # Codex implementation tasks now use the Claude read-only adapter above
    # as their reviewer. Skipping the legacy Codex review stage here avoids
    # the old Codex->Claude repair loop; CHANGES_REQUIRED stops for a human.
    if ($State.Implementer -ne "Codex") {
        $mandatory = ($State.Reviewer -eq "Codex" -or $State.Reviewer -eq "Human")
        $optional = ($State.Reviewer -eq "Codex (recommended)")
        $State = Invoke-ReviewStage -State $State -Mandatory $mandatory -Optional $optional -PreImplementationSnapshot $PreSnapshot
    }

    if ($State.State -ne "BLOCKED") {
        $State.State = "AWAITING_APPROVAL"
        Save-TaskState -State $State
    }

    Write-FinalReport -State $State
    Show-ApprovalScreen -State $State
    return $State
}

# ---------------------------------------------------------------------------
# Stable-operational-mode: shared post-DeepSeek-call handling for both
# Invoke-TaskPipeline (first attempt) and Invoke-Resume (retry/resume),
# replacing duplicated inline logic. Distinguishes AGENT ESCALATION
# (DeepSeek itself decided the task is complex - existing behavior,
# unchanged) from PROVIDER_OR_ADAPTER FAILURE (DeepSeek/its adapter is
# unavailable, says nothing about the task) - the DeepSeek Failure Rule.
# Returns $true when this function fully handled the outcome (including
# calling Invoke-PostImplementation where applicable); $false when the
# caller should fall back to its own "not runnable automatically" message
# (an unfilled report - the local-CLI/manual path awaiting a human).
# ---------------------------------------------------------------------------

function Invoke-DeepSeekPostCallResult {
    param($State, [bool]$Ran, [string[]]$PreSnapshot)

    if ($Ran) {
        Invoke-PostImplementation -State $State -PreSnapshot $PreSnapshot | Out-Null
        return $true
    }

    $escalation = Get-DeepSeekEscalation

    # Real defect fix: a stale report (attempt-binding mismatch - see
    # Test-DeepSeekReportStale) must never be reused as though it were the
    # current attempt's outcome, checked BEFORE treating it as either a
    # genuine agent escalation or a live provider failure. A live pilot
    # reused a report written before the literal source-loading fix
    # ("the specified files do not exist") on a task whose files
    # demonstrably exist now - that report no longer reflects reality.
    if (Test-DeepSeekReportStale -State $State -Escalation $escalation) {
        Invoke-DeepSeekImplementerFallback -State $State -Escalation $escalation -PreSnapshot $PreSnapshot -FallbackType "STALE_AGENT_RESULT"
        return $true
    }

    if (Test-DeepSeekAgentEscalation -Escalation $escalation) {
        Write-Host ""
        Write-Host "ESCALATE_TO_CLAUDE"
        Write-Host ""
        Write-Host "Reason: $(if ($escalation.Reason) { $escalation.Reason } else { '(not specified)' })"
        Write-Host ""
        New-ClaudeEscalationHandoff -State $State -Escalation $escalation | Out-Null

        # If the escalation reason itself names a blocked area, this is no
        # longer a routine task - upgrade risk/reviewer to match. This is
        # the ONLY branch that may ever raise risk from a DeepSeek outcome -
        # a provider/adapter or stale-report fallback (below) never does.
        # Real defect fix: uses the narrower, phrase-based
        # Test-EscalationTouchesBlockedArea (agent-router.ps1), not the
        # broad $CertTrustKeywords/$DbSensitiveKeywords single-word lists -
        # those falsely matched "constraint" in "the constraint against new
        # print implementations" (an ordinary task constraint, not a
        # database one) and escalated a routine file-not-found finding to
        # HIGH + mandatory Codex.
        $reasonText = if ($escalation.Reason) { $escalation.Reason } else { "" }
        if (Test-EscalationTouchesBlockedArea -Text $reasonText) {
            $State.Risk = "HIGH"
            $State.Reviewer = "Codex"; $State.ReviewerModel = "CODEX_REVIEW"
            $State.ReviewVerdict = "PENDING"
            $State.HumanApprovalRequired = "REQUIRED"
            Write-Host "Escalation reason touches a blocked area (DB/auth/certificate-trust) - Risk upgraded to HIGH, Codex review is now mandatory."
            Write-Host ""
        }
        $State.OriginalImplementer = $State.Implementer
        $State.Implementer = "Claude Code"
        $State.ImplementerModel = if ($State.Risk -in @("HIGH", "CRITICAL")) { "CLAUDE_DEEP" } else { "CLAUDE_FAST" }
        $State.State = "IMPLEMENTING"
        Save-TaskState -State $State

        $handoffPath = New-ClaudeHandoff -State $State
        Write-Host "Escalated to Claude Code ($($State.ImplementerModel)). See .ai/CLAUDE_ESCALATION_HANDOFF.md."
        $claudeRan = Invoke-ClaudeImplementation -HandoffPath $handoffPath
        if (-not $claudeRan) {
            Write-Host "Run manually using .ai/CLAUDE_HANDOFF.md and .ai/CLAUDE_ESCALATION_HANDOFF.md, then 'teras-agent -Resume' again."
            return $true
        }
        Invoke-PostImplementation -State $State -PreSnapshot $PreSnapshot | Out-Null
        return $true
    }

    if (Test-DeepSeekProviderOrAdapterFailure -Escalation $escalation) {
        Invoke-DeepSeekImplementerFallback -State $State -Escalation $escalation -PreSnapshot $PreSnapshot -FallbackType "PROVIDER_OR_ADAPTER"
        return $true
    }

    # NO_CHANGES (agent produced no files and did not escalate) or any
    # other filled-but-inconclusive report - unchanged existing behavior:
    # proceed straight to scope/QA with whatever (nothing) was generated.
    if ($escalation.Filled) {
        Invoke-PostImplementation -State $State -PreSnapshot $PreSnapshot | Out-Null
        return $true
    }

    return $false
}

# DeepSeek Failure Rule (stable-operational-mode): a provider/adapter
# failure (API error, adapter error, patch-writer rejection, local tooling
# error, timeout, provider outage) must never be treated as the engineering
# task being complex, and must never block delivery - Claude FAST takes
# over automatically with the existing context DeepSeek already gathered,
# never rediscovering the repository from scratch. Risk/reviewer are never
# touched here, unlike a genuine agent escalation.
function Invoke-DeepSeekImplementerFallback {
    param($State, $Escalation, [string[]]$PreSnapshot, [string]$FallbackType = "PROVIDER_OR_ADAPTER")

    Write-Host ""
    Write-Host "IMPLEMENTER_FALLBACK"
    Write-Host ""
    Write-Host "DeepSeek Status:"
    Write-Host "UNAVAILABLE"
    Write-Host ""
    Write-Host "Failure Type:"
    Write-Host $FallbackType
    Write-Host ""
    Write-Host "Fallback:"
    Write-Host "CLAUDE_FAST"
    Write-Host ""

    $failureDetail = if ($FallbackType -eq "STALE_AGENT_RESULT") {
        "STALE_AGENT_RESULT - the existing DeepSeek report no longer reflects the current attempt (Task ID or source-context fingerprint mismatch - see Test-DeepSeekReportStale). Its findings are preserved below for reference but its Escalation Required/Reason are NOT treated as current."
    } elseif ($Escalation.SourceContext -eq "FAIL") {
        "SOURCE_CONTEXT_ERROR (local tooling error) - $($Escalation.OrchestratorReason)"
    } elseif ($Escalation.PatchApplication -eq "REJECTED") {
        "PATCH_WRITER_ERROR (scope validation rejected the proposed patch) - $($Escalation.OrchestratorReason)"
    } else {
        "PROVIDER/API ERROR - HTTP $(if ($Escalation.HttpStatus) { $Escalation.HttpStatus } else { 'N/A' }), Category $($Escalation.ErrorCategory)$(if ($Escalation.ProviderMessage) { ": $($Escalation.ProviderMessage)" })"
    }
    Write-Host "Detail: $failureDetail"
    Write-Host ""

    # Real defect fix: Risk/Reviewer/HumanApprovalRequired are never touched
    # here, for EITHER fallback type - a provider/adapter failure or a
    # stale report says nothing about the engineering task's complexity.
    # Only a genuine, CURRENT agent escalation (handled above) may ever
    # raise risk.
    $State.OriginalImplementer = $State.Implementer
    $State.FallbackImplementer = "Claude Code"
    $State.ImplementerFallbackReason = $failureDetail
    $State.FallbackType = $FallbackType
    $State.Implementer = "Claude Code"
    $State.ImplementerModel = "CLAUDE_FAST"
    $State.State = "IMPLEMENTING"
    Save-TaskState -State $State

    # Reuses the existing escalation-handoff mechanism (with an explicit
    # reason override, since the agent's own Reason field is either "N/A"
    # (provider failure) or stale/untrustworthy) so Claude receives
    # whatever DeepSeek actually attempted plus the real fallback detail,
    # instead of rediscovering the repository from scratch.
    New-ClaudeEscalationHandoff -State $State -Escalation $Escalation -ReasonOverride $failureDetail | Out-Null
    $handoffPath = New-ClaudeHandoff -State $State
    Write-Host "Claude FAST will continue with existing context (original task, approved scope, DeepSeek's findings preserved) - see .ai/CLAUDE_ESCALATION_HANDOFF.md."
    Write-Host ""
    $claudeRan = Invoke-ClaudeImplementation -HandoffPath $handoffPath
    if (-not $claudeRan) {
        Write-Host "Claude did not run automatically. Run manually using .ai/CLAUDE_HANDOFF.md and .ai/CLAUDE_ESCALATION_HANDOFF.md, then 'teras-agent -Resume' again."
        return
    }
    Invoke-PostImplementation -State $State -PreSnapshot $PreSnapshot | Out-Null
}

function Invoke-TaskPipeline {
    param(
        [int]$MenuChoice,
        [string]$Description,
        [switch]$DryRun,
        [switch]$PreferDeepSeek
    )

    if ([string]::IsNullOrWhiteSpace($Description)) {
        Write-Host ""
        Write-Host "Task description cannot be empty. No task file was created."
        return
    }

    $taskId = Get-TaskId
    $classification = Get-TaskClassification -MenuChoice $MenuChoice -Description $Description -PreferDeepSeek:$PreferDeepSeek
    Show-Classification -Description $Description -Classification $classification

    $state = New-TaskState -TaskId $taskId -Description $Description -Classification $classification
    $state.State = "ROUTED"
    Save-TaskState -State $state

    $isDeepSeek = ($state.Implementer -eq "DeepSeek")
    $isCodex = ($state.Implementer -eq "Codex")
    $handoffPath = if ($isDeepSeek) { New-DeepSeekHandoff -State $state } elseif ($isCodex) { New-CodexImplementationHandoff -State $state } else { New-ClaudeHandoff -State $state }
    $handoffFileName = if ($isDeepSeek) { "DEEPSEEK_HANDOFF.md" } elseif ($isCodex) { "CODEX_IMPLEMENTATION_HANDOFF.md" } else { "CLAUDE_HANDOFF.md" }

    if ($DryRun) {
        Write-Host "DRY RUN - the following would happen next (nothing was launched):"
        Write-Host ""
        Write-Host "1. Launch $($classification.Implementer) ($($classification.ImplementerModel)) with handoff: $handoffPath"
        if ($isDeepSeek) {
            Write-Host "   (DeepSeek can return ESCALATE_TO_CLAUDE - see .ai/DEEPSEEK_IMPLEMENTATION_REPORT.md's Escalation Required field)"
        }
        Write-Host "2. Collect changed files (git status --short, before/after - read-only)"
        Write-Host "3. Scope check against Allowed Files"
        if ($isDeepSeek -or $classification.Risk -eq "LOW") {
            Write-Host "4. Run lightweight QA: git diff --check, npx tsc --noEmit, targeted tests (no full build unless justified - see .ai/USAGE_POLICY.md)"
        } else {
            Write-Host "4. Run QA: git diff --check, npx tsc --noEmit, targeted tests, npm run build (if appropriate)"
        }
        if ($classification.Reviewer -ne "None") {
            Write-Host "5. Launch Codex CLI ($($classification.ReviewerModel)) with a diff-scoped review handoff (FULL_REPO_AUDIT=false)"
        } else {
            Write-Host "5. Independent review: not required for this task"
        }
        Write-Host "6. Generate FINAL_REPORT.md and stop for human approval (teras-agent -Status / -Approve)"
        Write-Host ""
        Write-Host "Task ID: $taskId"
        Write-Host "Task file: .ai/CURRENT_TASK.md"
        Write-Host "Handoff: .ai/$handoffFileName"
        Write-Host ""
        return
    }

    $preSnapshot = Get-GitStatusSnapshot
    $state.PreImplementationSnapshot = $preSnapshot
    $state.State = "IMPLEMENTING"
    Save-TaskState -State $state

    $ran = if ($isDeepSeek) { Invoke-DeepSeekImplementation -HandoffPath $handoffPath -State $state } elseif ($isCodex) { Invoke-CodexImplementation -HandoffPath $handoffPath } else { Invoke-ClaudeImplementation -HandoffPath $handoffPath }

    if ($isDeepSeek) {
        $handled = Invoke-DeepSeekPostCallResult -State $state -Ran $ran -PreSnapshot $preSnapshot
        if (-not $handled) {
            Write-Host "Implementation step did not run automatically. State remains IMPLEMENTING."
            Write-Host "Run the task manually with $($state.Implementer) using .ai/$handoffFileName, then 'teras-agent -Resume'."
        }
        return
    }

    if (-not $ran) {
        Write-Host "Implementation step did not run automatically. State remains IMPLEMENTING."
        Write-Host "Run the task manually with $($state.Implementer) using .ai/$handoffFileName, then 'teras-agent -Resume'."
        return
    }

    Invoke-PostImplementation -State $state -PreSnapshot $preSnapshot | Out-Null
}

function Invoke-ReviewCurrentChanges {
    Write-Host ""
    Write-Host "Reviewing current working tree (read-only git status/diff, nothing is staged or committed)..."
    Write-Host ""
    Push-Location $RepoRoot
    try {
        git status --short
        Write-Host ""
        git diff --stat
    } finally {
        Pop-Location
    }
    Write-Host ""
}

function Invoke-ProductionAudit {
    param([string]$Description)

    if ([string]::IsNullOrWhiteSpace($Description)) {
        $Description = "Production audit"
    }

    $taskId = Get-TaskId
    $classification = Get-TaskClassification -MenuChoice 7 -Description $Description
    Show-Classification -Description $Description -Classification $classification

    $state = New-TaskState -TaskId $taskId -Description $Description -Classification $classification
    # A Production Audit is Codex's own deliverable (a full-repo review), not
    # a Claude implementation step - it has no scope/QA/commit path, so it
    # stops at REVIEWING rather than entering the approve/commit state machine.
    $state.State = "REVIEWING"
    Save-TaskState -State $state

    Write-Host "Codex should receive only CURRENT_TASK.md/IMPLEMENTATION_REPORT.md/diff for an ordinary"
    Write-Host "task - this is different: it is an explicit Production Audit (Full Repo Audit: ON),"
    Write-Host "so a full-repository scan is in scope here. See .ai/AGENTS.md."
    Write-Host ""
}

# Pre-commit reviews have no stable commit SHA to key staleness off (that's
# what Test-CodexStale/ReviewVerifiedSha do, post-commit, in release-runner.ps1)
# - so reuse here keys off a hash of the actual working-tree diff content.
function Get-DiffHash {
    param([string[]]$Files)

    if (@($Files).Count -eq 0) { return $null }
    Push-Location $RepoRoot
    try {
        $diff = (git diff -- $Files | Out-String)
    } catch {
        $diff = ""
    } finally {
        Pop-Location
    }
    if ([string]::IsNullOrWhiteSpace($diff)) { return $null }

    $bytes = [System.Text.Encoding]::UTF8.GetBytes($diff)
    $stream = [System.IO.MemoryStream]::new($bytes)
    try {
        return (Get-FileHash -InputStream $stream -Algorithm SHA256).Hash
    } finally {
        $stream.Dispose()
    }
}

function Invoke-ManualReview {
    $state = Get-TaskState
    if ($state.State -eq "NONE") {
        Write-Host ""
        Write-Host "No current task found."
        Write-Host ""
        return
    }

    $currentHash = Get-DiffHash -Files $state.TaskGeneratedFiles

    # Never re-invoke Codex for a diff it already reviewed - see USAGE_POLICY.md.
    if ($currentHash -and $currentHash -eq $state.ReviewedDiffHash -and $state.ReviewVerdict -in @("PASS", "PASS_WITH_NOTES", "BLOCKED")) {
        Write-Host ""
        Write-Host "REUSE EXISTING VALID REVIEW"
        Write-Host ""
        Write-Host "The diff is unchanged since the last review (hash match) - reusing verdict: $($state.ReviewVerdict)."
        Write-Host "Codex was not re-invoked. Change the code, or run -Resume after a repair, to force a fresh review."
        Write-Host ""
        return
    }
    if ($state.ReviewedDiffHash -and $currentHash -ne $state.ReviewedDiffHash) {
        Write-Host ""
        Write-Host "CODEX REVIEW STALE"
        Write-Host "The diff has changed since the last review - requesting a fresh review."
    }

    Write-Host ""
    Write-Host "Running an independent review pass against the current task-generated diff."
    Write-Host "(Implementation and QA are not re-run - use -Resume for that.)"
    Write-Host ""

    $handoffPath = New-CodexReviewHandoff -State $state -TaskGeneratedFiles $state.TaskGeneratedFiles
    $ran = Invoke-CodexReview -HandoffPath $handoffPath
    $state.ReviewVerdict = if ($ran) { Get-ReviewVerdict } else { "PENDING" }
    $state.ReviewedDiffHash = $currentHash
    Save-TaskState -State $state

    Write-Host "Review verdict: $($state.ReviewVerdict)"
    Write-Host ""
}

function Invoke-Resume {
    $state = Get-TaskState
    if ($state.State -eq "NONE") {
        Write-Host ""
        Write-Host "No current task to resume."
        Write-Host ""
        return
    }

    Write-Host ""
    Write-Host "Resuming task $($state.TaskId) from state $($state.State)."
    Write-Host ""

    if ($state.State -in @("APPROVED", "COMMIT_READY", "COMPLETE", "BLOCKED")) {
        Show-Status
        Write-Host "Nothing to resume automatically from this state - use -Status, -Approve, -PrepareCommit, -Commit, or -Reject as appropriate."
        Write-Host ""
        return
    }

    # A JSON null becomes a one-element PowerShell array containing $null;
    # normalize it before checking Count so a missing baseline is captured
    # immediately before the implementation agent starts.
    $preSnapshot = @($state.PreImplementationSnapshot | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) })

    if ($state.State -in @("CREATED", "ROUTED", "IMPLEMENTING")) {
        $isDeepSeek = ($state.Implementer -eq "DeepSeek")
        $isCodex = ($state.Implementer -eq "Codex")

        if ($isDeepSeek) {
            # Check for a report from a prior attempt first (agent
            # escalation / provider-adapter failure / already-filled) before
            # attempting the runner again - Invoke-DeepSeekPostCallResult
            # with Ran=$false inspects the existing report exactly as
            # before, and returns $false only when it's genuinely unfilled.
            $alreadyHandled = Invoke-DeepSeekPostCallResult -State $state -Ran $false -PreSnapshot $preSnapshot
            if ($alreadyHandled) { return }
        }

        $handoffFileName = if ($isDeepSeek) { "DEEPSEEK_HANDOFF.md" } elseif ($isCodex) { "CODEX_IMPLEMENTATION_HANDOFF.md" } else { "CLAUDE_HANDOFF.md" }
        $handoffPath = Join-Path $AiDir $handoffFileName
        # Rebuild the Codex handoff on every resume so it reflects the current
        # shared state, rather than a stale prior task's prompt.
        if ($isCodex) {
            $handoffPath = New-CodexImplementationHandoff -State $state
        } elseif (-not (Test-Path $handoffPath)) {
        $handoffPath = if ($isDeepSeek) { New-DeepSeekHandoff -State $state } elseif ($isCodex) { New-CodexImplementationHandoff -State $state } else { New-ClaudeHandoff -State $state }
        }
        if ($preSnapshot.Count -eq 0) { $preSnapshot = Get-GitStatusSnapshot }
        $state.PreImplementationSnapshot = $preSnapshot
        $state.State = "IMPLEMENTING"
        Save-TaskState -State $state

        $ran = if ($isDeepSeek) { Invoke-DeepSeekImplementation -HandoffPath $handoffPath -State $state } elseif ($isCodex) { Invoke-CodexImplementation -HandoffPath $handoffPath } else { Invoke-ClaudeImplementation -HandoffPath $handoffPath }

        if ($isDeepSeek) {
            $handled = Invoke-DeepSeekPostCallResult -State $state -Ran $ran -PreSnapshot $preSnapshot
            if (-not $handled) {
                Write-Host "Still not runnable automatically. Run manually, then 'teras-agent -Resume' again."
                Write-Host "Remember to fill in .ai/DEEPSEEK_IMPLEMENTATION_REPORT.md, including Escalation Required: YES/NO."
            }
            return
        }

        if (-not $ran) {
            Write-Host "Still not runnable automatically. Run manually, then 'teras-agent -Resume' again."
            return
        }
    }

    Invoke-PostImplementation -State $state -PreSnapshot $preSnapshot | Out-Null
}

function Invoke-TestMode {
    Write-Host "Running in TestMode: non-interactive, non-destructive self-test (implies -DryRun)."
    Show-Menu
    Invoke-TaskPipeline -MenuChoice $TestMenuChoice -Description $TestDescription -DryRun
    Show-Status
    Write-Host ""
    Write-Host "TestMode complete. Claude/Codex were not launched (DryRun)."
}

function Invoke-MainLoop {
    while ($true) {
        Show-Menu
        $choice = Read-Host "Select an option (0-9)"

        switch ($choice) {
            "1" { $desc = Read-Host "Describe task"; Invoke-TaskPipeline -MenuChoice 1 -Description $desc }
            "2" { $desc = Read-Host "Describe task"; Invoke-TaskPipeline -MenuChoice 2 -Description $desc }
            "3" { $desc = Read-Host "Describe task"; Invoke-TaskPipeline -MenuChoice 3 -Description $desc }
            "4" { $desc = Read-Host "Describe task"; Invoke-TaskPipeline -MenuChoice 4 -Description $desc }
            "5" { $desc = Read-Host "Describe task"; Invoke-TaskPipeline -MenuChoice 5 -Description $desc }
            "6" { Invoke-ReviewCurrentChanges }
            "7" { $desc = Read-Host "Describe audit scope"; Invoke-ProductionAudit -Description $desc }
            "8" { Invoke-Resume }
            "9" { Show-Status }
            "0" { Write-Host ""; Write-Host "Exiting."; return }
            default { Write-Host ""; Write-Host "Invalid option." }
        }
    }
}

# ---------------------------------------------------------------------------
# Dispatch
# ---------------------------------------------------------------------------

if ($Validate) {
    # -Verbose is PowerShell's own built-in common parameter (available on
    # every script even without [CmdletBinding()]) - read it via
    # $VerbosePreference rather than declaring a colliding custom switch.
    Invoke-Validate -VerboseOutput:($VerbosePreference -eq "Continue")
} elseif ($TestDeepSeek) {
    Invoke-DeepSeekConnectivityTest
} elseif ($DeepSeekStatus) {
    Invoke-DeepSeekStatus
} elseif ($Deploy) {
    Show-DeployBlocked
} elseif ($DryRunPush) {
    Invoke-DryRunPush
} elseif ($DryRunPreview) {
    Invoke-DryRunPreview
} elseif ($PreparePush) {
    Invoke-PreparePush
} elseif ($Push) {
    Invoke-Push
} elseif ($Preview) {
    Invoke-Preview
} elseif ($PreviewStatus) {
    Invoke-PreviewStatus
} elseif ($VerifyPreview) {
    Invoke-VerifyPreview
} elseif ($DryRunPR) {
    Invoke-DryRunPR
} elseif ($DryRunRelease) {
    Invoke-DryRunRelease
} elseif ($PreparePR) {
    Invoke-PreparePR
} elseif ($CreatePR) {
    Invoke-CreatePR
} elseif ($PRStatus) {
    Invoke-PRStatus
} elseif ($PrepareRelease) {
    Invoke-PrepareRelease
} elseif ($ApproveRelease) {
    Invoke-ApproveRelease
} elseif ($Release) {
    Invoke-Release
} elseif ($ProductionStatus) {
    Invoke-ProductionStatus
} elseif ($VerifyProduction) {
    Invoke-VerifyProduction
} elseif ($DryRunMigration) {
    Invoke-DryRunMigration
} elseif ($PrepareMigration) {
    Invoke-PrepareMigration
} elseif ($ReviewMigration) {
    Invoke-ReviewMigration
} elseif ($ApproveMigration) {
    Invoke-ApproveMigration
} elseif ($ApplyMigration) {
    Invoke-ApplyMigration -Target $Target
} elseif ($VerifyDatabase) {
    Invoke-VerifyDatabase
} elseif ($DatabaseStatus) {
    Invoke-DatabaseStatus
} elseif ($Status) {
    Show-Status
} elseif ($Approve) {
    Invoke-Approve
} elseif ($Reject) {
    Invoke-Reject
} elseif ($PrepareCommit) {
    Invoke-PrepareCommit
} elseif ($Commit) {
    Invoke-Commit
} elseif ($Review) {
    Invoke-ManualReview
} elseif ($Resume) {
    Invoke-Resume
} elseif ($TestMode) {
    Invoke-TestMode
} elseif ($DryRun) {
    if ([string]::IsNullOrWhiteSpace($Task)) {
        Write-Host 'Provide a task description with -DryRun, e.g. teras-agent.ps1 -DryRun "Fix X"'
    } else {
        $menuChoice = Get-AutoMenuChoice -Description $Task
        Invoke-TaskPipeline -MenuChoice $menuChoice -Description $Task -DryRun -PreferDeepSeek:$PreferDeepSeek
    }
} elseif (-not [string]::IsNullOrWhiteSpace($Task)) {
    $menuChoice = Get-AutoMenuChoice -Description $Task
    Invoke-TaskPipeline -MenuChoice $menuChoice -Description $Task -PreferDeepSeek:$PreferDeepSeek
} else {
    Invoke-MainLoop
}
