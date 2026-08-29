<#
    pr-runner.ps1 - controlled GitHub Pull Request preparation/creation for
    the TERAS AI Engineering Orchestrator. Dot-sourced by teras-agent.ps1,
    which must set $RepoRoot, $AiDir before sourcing this file. Depends on
    functions from agent-router.ps1, qa-runner.ps1, and approval-runner.ps1
    (Get-CommitMessage) also being sourced first.

    Hard safety invariants enforced in this file, not just documented:
    - never installs the GitHub CLI
    - never merges (see release-runner.ps1 for the separate, further-gated
      merge step)
    - PR creation only runs after a literal "YES" typed at a live prompt
    - never creates a duplicate PR for a branch that already has one
    - target branch is detected from the remote's actual default branch,
      never assumed to be "main"
#>

function Test-GitHubCliAvailable {
    if ($null -eq (Get-Command "gh" -ErrorAction SilentlyContinue)) { return $false }
    Push-Location $RepoRoot
    try {
        # Not-authenticated is the expected/common failure case, not a real
        # error - the native command's non-zero exit throws under this
        # script's $ErrorActionPreference = "Stop" even with the error
        # stream redirected, so this must be a try/catch.
        gh auth status *> $null
        return $true
    } catch {
        return $false
    } finally {
        Pop-Location
    }
}

# Reads the remote's actual default branch rather than assuming "main" -
# read-only (`git remote show origin` performs no local or remote write).
function Get-TargetBranch {
    Push-Location $RepoRoot
    try {
        $show = git remote show origin 2>&1
    } finally {
        Pop-Location
    }
    if ($LASTEXITCODE -ne 0) { return $null }
    foreach ($line in $show) {
        if ($line -match 'HEAD branch:\s*(\S+)') {
            if ($Matches[1] -and $Matches[1] -ne '(unknown)') { return $Matches[1] }
        }
    }
    return $null
}

function Test-PrEligibility {
    param($State)

    if ($State.State -eq "NONE") {
        return [pscustomobject]@{ Eligible = $false; Reason = "No current task found." }
    }
    if ($State.State -notin @("PREVIEW_APPROVED", "PR_READY", "PR_BLOCKED")) {
        return [pscustomobject]@{ Eligible = $false; Reason = "Task State is $($State.State), not PREVIEW_APPROVED." }
    }
    if ([string]::IsNullOrWhiteSpace($State.CommitSha)) {
        return [pscustomobject]@{ Eligible = $false; Reason = "No local commit recorded (Commit must be CREATED)." }
    }
    if ([string]::IsNullOrWhiteSpace($State.Branch)) {
        return [pscustomobject]@{ Eligible = $false; Reason = "No pushed branch recorded (Branch must be PUSHED)." }
    }
    if ($State.PreviewVerificationStatus -ne "PASS") {
        return [pscustomobject]@{ Eligible = $false; Reason = "Preview is $($State.PreviewVerificationStatus), not PASS." }
    }
    if (-not $State.PreviewApproved) {
        return [pscustomobject]@{ Eligible = $false; Reason = "Preview Approval is not YES." }
    }
    if ($State.ScopeCheck -ne "PASS") {
        return [pscustomobject]@{ Eligible = $false; Reason = "Scope Check is $($State.ScopeCheck), not PASS." }
    }
    if (Test-QaHasBlockingFailure -QaResults $State.QA) {
        return [pscustomobject]@{ Eligible = $false; Reason = "QA has a blocking failure." }
    }
    if ($State.ReviewVerdict -notin @("PASS", "PASS_WITH_NOTES", "NOT_REQUIRED")) {
        return [pscustomobject]@{ Eligible = $false; Reason = "Codex Review verdict is $($State.ReviewVerdict), not PASS / PASS_WITH_NOTES / NOT_REQUIRED." }
    }

    return [pscustomobject]@{ Eligible = $true; Reason = "" }
}

function Get-PrBody {
    param($State, [string]$TargetBranch)

    $changesText = if (@($State.TaskGeneratedFiles).Count -gt 0) { (@($State.TaskGeneratedFiles) | ForEach-Object { "- $_" }) -join "`n" } else { "- (none recorded)" }
    $reviewText = if ($State.Reviewer -eq "None" -or $State.Reviewer -eq "NOT_REQUIRED") { "NOT REQUIRED" } else { $State.ReviewVerdict }
    $migrationText = if ($State.MigrationDetected) { (@($State.MigrationFiles) | ForEach-Object { "- $_" }) -join "`n" } else { "None." }
    $knownIssuesText = if (@($State.PreviewBlockingIssues).Count -gt 0) { (@($State.PreviewBlockingIssues) -join "; ") } else { "None." }

    return @"
## Summary

$($State.Description)

## Changes

$changesText

## Risk

$($State.Risk) - $($State.Reason)

## Verification

- git diff --check: $($State.QA.GitDiffCheck.Result)
- TypeScript: $($State.QA.TypeScript.Result)
- Tests: $($State.QA.Tests.Result)
- Build: $($State.QA.Build.Result)

## Independent Review

Independent Review:
$reviewText

## Preview

$($State.PreviewVerificationStatus) - $(if ($State.PreviewUrl) { $State.PreviewUrl } else { "no URL" })

## Database / Migration Impact

$migrationText

## Known Issues

$knownIssuesText

## Release Notes

$($State.CommitMessage)
"@
}

function Write-PrReport {
    param($State)

    $path = Join-Path $AiDir "PR_REPORT.md"
    $filesText = if (@($State.TaskGeneratedFiles).Count -gt 0) { (@($State.TaskGeneratedFiles) | ForEach-Object { "- $_" }) -join "`n" } else { "- (none)" }
    $migrationText = if ($State.MigrationDetected) { "YES - $((@($State.MigrationFiles) -join ', '))" } else { "NO" }
    $prodImpact = if ($State.Risk -in @("HIGH", "CRITICAL") -or $State.MigrationDetected -or $State.EnvironmentChangeDetected) { "Meaningful - see Risk/Migration/Environment fields." } else { "Minimal - visual/low-risk change." }
    $recommendation = if (Test-QaHasBlockingFailure -QaResults $State.QA) { "DO NOT MERGE - QA failing." } elseif ($State.ReviewVerdict -eq "BLOCKED") { "DO NOT MERGE - Codex review blocked." } elseif ($State.MigrationDetected) { "DO NOT MERGE without separate migration approval (not implemented in this phase)." } else { "Eligible for human release approval (-ApproveRelease)." }

    $content = @"
# PR_REPORT.md

> Regenerated by ``tools/pr-runner.ps1`` each time -PreparePR runs.

Task ID:
$($State.TaskId)

Task Description:
$($State.Description)

Source Branch:
$($State.Branch)

Target Branch:
$($State.PrTargetBranch)

Commit SHA:
$($State.CommitSha)

Risk:
$($State.Risk)

Files Changed:
$filesText

Scope Check:
$($State.ScopeCheck)

QA Results:
git diff --check=$($State.QA.GitDiffCheck.Result), TypeScript=$($State.QA.TypeScript.Result), Tests=$($State.QA.Tests.Result), Build=$($State.QA.Build.Result)

Codex Review:
$($State.ReviewVerdict)

Preview Status:
$($State.PreviewVerificationStatus)

Preview URL:
$(if ($State.PreviewUrl) { $State.PreviewUrl } else { "(none)" })

Known Issues:
$(if (@($State.PreviewBlockingIssues).Count -gt 0) { ($State.PreviewBlockingIssues -join "; ") } else { "None." })

Migration Included:
$migrationText

Production Impact:
$prodImpact

Recommended Merge Decision:
$recommendation

---

## Proposed PR Title

$($State.PrTitle)

## Proposed PR Body

$($State.PrBody)
"@

    Set-Content -Path $path -Value $content -Encoding utf8
}

function Get-ExistingPr {
    param([string]$Branch)

    if (-not (Test-GitHubCliAvailable) -or [string]::IsNullOrWhiteSpace($Branch)) { return $null }

    Push-Location $RepoRoot
    try {
        # "No PR exists for this branch" is the expected/common case (every
        # first-time PR creation starts here), not a real error - gh's
        # non-zero exit throws under this script's $ErrorActionPreference =
        # "Stop" even with the error stream redirected, so this must be a
        # try/catch, not a bare $LASTEXITCODE check.
        $json = gh pr view $Branch --json number,url,state,baseRefName,headRefName,mergeable,mergeStateStatus 2>&1
        if ($LASTEXITCODE -ne 0) { return $null }
    } catch {
        return $null
    } finally {
        Pop-Location
    }

    try {
        return ($json | ConvertFrom-Json)
    } catch {
        return $null
    }
}

function Invoke-PreparePR {
    $state = Get-TaskState
    $eligibility = Test-PrEligibility -State $state
    if (-not $eligibility.Eligible) {
        Write-Host ""
        Write-Host "PR PREPARATION BLOCKED"
        Write-Host ""
        Write-Host "Reason:"
        Write-Host $eligibility.Reason
        Write-Host ""
        return
    }

    $targetBranch = Get-TargetBranch
    if (-not $targetBranch) {
        Write-Host ""
        Write-Host "TARGET BRANCH VERIFICATION REQUIRED"
        Write-Host ""
        Write-Host "Could not safely detect the repository's default integration branch"
        Write-Host "(git remote show origin did not report a HEAD branch). No PR was prepared."
        Write-Host ""
        return
    }

    $state.PrSourceBranch = $state.Branch
    $state.PrTargetBranch = $targetBranch
    $state.PrApprovedCommitSha = $state.CommitSha
    $state.QaVerifiedSha = $state.CommitSha
    $state.ReviewVerifiedSha = $state.CommitSha
    $state.PrTitle = $state.CommitMessage
    $state.PrBody = Get-PrBody -State $state -TargetBranch $targetBranch
    $state.State = "PR_READY"
    Save-TaskState -State $state

    Write-PrReport -State $state

    Write-Host ""
    Write-Host "PR prepared."
    Write-Host "Source: $($state.PrSourceBranch)  ->  Target: $($state.PrTargetBranch)"
    Write-Host "Title:  $($state.PrTitle)"
    Write-Host ""
    Write-Host "See .ai/PR_REPORT.md for the full body. Next: teras-agent -CreatePR"
    Write-Host ""
}

function Invoke-CreatePR {
    $state = Get-TaskState
    if ($state.State -notin @("PR_READY", "PR_BLOCKED")) {
        Write-Host ""
        Write-Host "PR CREATION BLOCKED"
        Write-Host ""
        Write-Host "Reason:"
        Write-Host "Task must be PR_READY (run -PreparePR first). Current state: $($state.State)."
        Write-Host ""
        return
    }

    Push-Location $RepoRoot
    try {
        $headSha = (git rev-parse HEAD).Trim()
    } finally {
        Pop-Location
    }
    if ($headSha -ne $state.PrApprovedCommitSha) {
        Write-Host ""
        Write-Host "PR PREPARATION STALE"
        Write-Host ""
        Write-Host "HEAD ($headSha) has moved since -PreparePR ran ($($state.PrApprovedCommitSha))."
        Write-Host "Re-run 'teras-agent -PreparePR'."
        Write-Host ""
        return
    }

    # Only an OPEN PR is a duplicate to avoid recreating - `gh pr view <branch>`
    # can resolve to a MERGED/CLOSED PR from an earlier task that reused this
    # branch name, which must not block a new PR for new work.
    $existing = Get-ExistingPr -Branch $state.Branch
    if ($existing -and $existing.state -eq "OPEN") {
        $state.PrNumber = $existing.number
        $state.PrUrl = $existing.url
        $state.State = "PR_OPEN"
        Save-TaskState -State $state

        Write-Host ""
        Write-Host "EXISTING PR DETECTED"
        Write-Host ""
        Write-Host "PR #$($existing.number): $($existing.url)"
        Write-Host "State: $($existing.state)"
        Write-Host ""
        Write-Host "No duplicate PR was created."
        Write-Host ""
        Write-Host "1. Update existing PR metadata -> re-run 'teras-agent -CreatePR' after confirming (not yet automated in this phase; edit via GitHub or 'gh pr edit' manually)"
        Write-Host "2. Show PR status -> teras-agent -PRStatus"
        Write-Host "3. Exit"
        Write-Host ""
        return
    }

    if (-not (Test-GitHubCliAvailable)) {
        Write-Host ""
        Write-Host "PR automation unavailable."
        Write-Host ""
        Write-Host "PR title and body have been prepared for manual creation. See .ai/PR_REPORT.md."
        Write-Host ""
        return
    }

    Write-Host ""
    Write-Host "========================================"
    Write-Host "TERAS PR CONFIRMATION"
    Write-Host "========================================"
    Write-Host ""
    Write-Host "Task:"
    Write-Host $state.Description
    Write-Host ""
    Write-Host "Source:"
    Write-Host $state.PrSourceBranch
    Write-Host ""
    Write-Host "Target:"
    Write-Host $state.PrTargetBranch
    Write-Host ""
    Write-Host "Commit:"
    Write-Host $state.CommitSha
    Write-Host ""
    Write-Host "Preview:"
    Write-Host $state.PreviewVerificationStatus
    Write-Host ""
    Write-Host "QA:"
    Write-Host $(if (Test-QaHasBlockingFailure -QaResults $state.QA) { "FAIL" } else { "PASS" })
    Write-Host ""
    Write-Host "Codex:"
    Write-Host $(if ($state.Reviewer -eq "None") { "NOT REQUIRED" } else { $state.ReviewVerdict })
    Write-Host ""
    Write-Host "This will create a GitHub Pull Request."
    Write-Host ""
    Write-Host "It will NOT:"
    Write-Host "- merge the PR"
    Write-Host "- deploy production"
    Write-Host "- apply migrations"
    Write-Host "- write production database data"
    Write-Host ""

    $confirm = Read-Host "Type YES to create PR"
    if ($confirm -cne "YES") {
        Write-Host ""
        Write-Host "PR creation cancelled. No PR was created."
        Write-Host ""
        return
    }

    Push-Location $RepoRoot
    try {
        $bodyFile = Join-Path $env:TEMP "teras-pr-body-$($state.TaskId).md"
        Set-Content -Path $bodyFile -Value $state.PrBody -Encoding utf8
        try {
            # A validation failure (diverged branch, no commits, etc.) must
            # report PR_BLOCKED cleanly below, not crash - try/catch, same
            # reasoning as Get-ExistingPr above.
            $output = gh pr create --title $state.PrTitle --body-file $bodyFile --base $state.PrTargetBranch --head $state.PrSourceBranch 2>&1
            $exitCode = $LASTEXITCODE
        } catch {
            $output = @($_.Exception.Message)
            $exitCode = 1
        } finally {
            Remove-Item -Path $bodyFile -Force -ErrorAction SilentlyContinue
        }
    } finally {
        Pop-Location
    }

    $urlLine = $output | Where-Object { $_ -match 'https://\S+' } | Select-Object -Last 1
    if ($exitCode -eq 0 -and $urlLine -match '(https://\S+)') {
        $state.PrUrl = $Matches[1]
        if ($state.PrUrl -match '/pull/(\d+)') { $state.PrNumber = [int]$Matches[1] }
        $state.State = "PR_OPEN"
        Save-TaskState -State $state
        Write-Host ""
        Write-Host "PR created: $($state.PrUrl)"
        Write-Host ""
        Write-Host "Next: teras-agent -PrepareRelease"
        Write-Host ""
    } else {
        $state.State = "PR_BLOCKED"
        Save-TaskState -State $state
        Write-Host ""
        Write-Host "PR CREATION BLOCKED"
        Write-Host "gh pr create failed - see output above."
        Write-Host ""
    }
}

function Invoke-PRStatus {
    $state = Get-TaskState
    Write-Host ""
    Write-Host "========================================"
    Write-Host "TERAS PR STATUS"
    Write-Host "========================================"
    Write-Host ""
    if ($state.State -eq "NONE") {
        Write-Host "No current task."
        Write-Host ""
        return
    }

    if (-not $state.PrUrl) {
        Write-Host "PR Number: (none - not created yet)"
        Write-Host "PR URL: (none)"
        Write-Host "Source Branch: $(if ($state.Branch) { $state.Branch } else { '(not pushed)' })"
        Write-Host "Target Branch: $(if ($state.PrTargetBranch) { $state.PrTargetBranch } else { 'PENDING' })"
        Write-Host "PR State: PENDING"
        Write-Host "Mergeability: PENDING"
        Write-Host "Required Checks: PENDING"
        Write-Host "Preview Status: $($state.PreviewVerificationStatus)"
        Write-Host "Codex Review: $($state.ReviewVerdict)"
        Write-Host "Human Release Approval: $(if ($state.ReleaseApproved) { 'YES' } else { 'PENDING' })"
        Write-Host ""
        return
    }

    $checks = "PENDING"
    $prState = "PENDING"
    $mergeable = "PENDING"
    if (Test-GitHubCliAvailable) {
        $json = $null
        Push-Location $RepoRoot
        try {
            $json = gh pr view $state.Branch --json number,url,state,mergeable,mergeStateStatus,statusCheckRollup 2>&1
            if ($LASTEXITCODE -ne 0) { $json = $null }
        } catch {
            $json = $null
        } finally {
            Pop-Location
        }
        if ($json) {
            try {
                $pr = $json | ConvertFrom-Json
                $prState = $pr.state
                $mergeable = if ($pr.mergeable) { "$($pr.mergeable) ($($pr.mergeStateStatus))" } else { "UNKNOWN" }
                $rollup = @($pr.statusCheckRollup)
                if ($rollup.Count -eq 0) {
                    $checks = "PENDING (no checks reported)"
                } else {
                    $failing = @($rollup | Where-Object { $_.conclusion -and $_.conclusion -ne "SUCCESS" })
                    $checks = if ($failing.Count -gt 0) { "FAIL ($($failing.Count) not passing)" } else { "PASS" }
                }
            } catch {
                $checks = "PENDING (could not parse gh output)"
            }
        }
    }

    Write-Host "PR Number: #$($state.PrNumber)"
    Write-Host "PR URL: $($state.PrUrl)"
    Write-Host "Source Branch: $($state.PrSourceBranch)"
    Write-Host "Target Branch: $($state.PrTargetBranch)"
    Write-Host "PR State: $prState"
    Write-Host "Mergeability: $mergeable"
    Write-Host "Required Checks: $checks"
    Write-Host "Preview Status: $($state.PreviewVerificationStatus)"
    Write-Host "Codex Review: $($state.ReviewVerdict)"
    Write-Host "Human Release Approval: $(if ($state.ReleaseApproved) { 'YES' } else { 'PENDING' })"
    Write-Host ""
}

function Invoke-DryRunPR {
    $state = Get-TaskState
    Write-Host ""
    Write-Host "DRY RUN PR - nothing will be executed."
    Write-Host ""

    $eligibility = Test-PrEligibility -State $state
    if (-not $eligibility.Eligible) {
        Write-Host "PR preparation would currently be BLOCKED."
        Write-Host "Reason: $($eligibility.Reason)"
        Write-Host ""
        return
    }

    $targetBranch = Get-TargetBranch
    Write-Host "Source: $($state.Branch)"
    Write-Host "Target: $(if ($targetBranch) { $targetBranch } else { 'UNKNOWN - would require TARGET BRANCH VERIFICATION' })"
    Write-Host "Commit: $($state.CommitSha)"
    Write-Host "Proposed title: $($state.CommitMessage)"
    Write-Host ""
    Write-Host "GitHub CLI: $(if (Test-GitHubCliAvailable) { 'detected and authenticated' } else { 'NOT detected/authenticated - would degrade to manual PR creation' })"
    Write-Host ""
}
