<#
    push-runner.ps1 - controlled branch push for the TERAS AI Engineering
    Orchestrator. Dot-sourced by teras-agent.ps1, which must set $RepoRoot,
    $AiDir before sourcing this file. Depends on Test-QaHasBlockingFailure
    (qa-runner.ps1) and Get-TaskState/Save-TaskState (agent-router.ps1)
    also being sourced first.

    Hard safety invariants enforced in this file, not just documented:
    - never pushes to main/master/production/prod
    - only ever `git push [-u] <remote> <branch>` - no --force, --all, --mirror
    - push only runs after a literal "YES" typed at a live prompt, and only
      after re-verifying HEAD/branch/review/scope immediately before it
    - never creates a branch automatically, never touches remote URLs,
      credentials, or SSH config
#>

$script:ProtectedBranches = @("main", "master", "production", "prod")

function Get-CurrentBranch {
    Push-Location $RepoRoot
    try {
        return (git rev-parse --abbrev-ref HEAD).Trim()
    } finally {
        Pop-Location
    }
}

function Test-ProtectedBranch {
    param([string]$Branch)
    if ([string]::IsNullOrWhiteSpace($Branch)) { return $false }
    return ($script:ProtectedBranches -contains $Branch.ToLowerInvariant())
}

# Strips embedded userinfo credentials (https://user:pass@host/...) and
# common token query params from `git remote -v` output before it is ever
# printed or written to a report.
function Get-RedactedRemotes {
    Push-Location $RepoRoot
    try {
        $lines = @(git remote -v)
    } finally {
        Pop-Location
    }
    return $lines | ForEach-Object {
        $line = $_ -replace 'https://[^@/\s]+@', 'https://'
        $line = $line -replace '(?i)(token|x-access-token|password)=[^&\s]+', '$1=***REDACTED***'
        $line
    }
}

function Test-PushEligibility {
    param($State)

    if ($State.State -eq "NONE") {
        return [pscustomobject]@{ Eligible = $false; Reason = "No current task found." }
    }
    if ($State.State -ne "COMPLETE") {
        return [pscustomobject]@{ Eligible = $false; Reason = "Task State is $($State.State), not COMPLETE." }
    }
    if ([string]::IsNullOrWhiteSpace($State.CommitSha)) {
        return [pscustomobject]@{ Eligible = $false; Reason = "No local commit recorded for this task (Local Commit must be CREATED)." }
    }
    if ($State.HumanDecision -ne "APPROVED") {
        return [pscustomobject]@{ Eligible = $false; Reason = "Human Approval is $($State.HumanDecision), not YES/APPROVED." }
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

    if (@($State.TaskGeneratedFiles).Count -gt 0) {
        Push-Location $RepoRoot
        try {
            $dirty = @(git status --short -- $State.TaskGeneratedFiles)
        } finally {
            Pop-Location
        }
        if ($dirty.Count -gt 0) {
            return [pscustomobject]@{ Eligible = $false; Reason = "Working tree has uncommitted changes in task-related files - commit or discard them first." }
        }
    }

    return [pscustomobject]@{ Eligible = $true; Reason = "" }
}

function Invoke-PreparePush {
    $state = Get-TaskState
    $eligibility = Test-PushEligibility -State $state
    if (-not $eligibility.Eligible) {
        Write-Host ""
        Write-Host "PUSH BLOCKED"
        Write-Host ""
        Write-Host "Reason:"
        Write-Host $eligibility.Reason
        Write-Host ""
        return
    }

    $branch = Get-CurrentBranch
    if (Test-ProtectedBranch -Branch $branch) {
        Write-Host ""
        Write-Host "PUSH BLOCKED"
        Write-Host ""
        Write-Host "Current branch is protected."
        Write-Host "Create or switch to an approved working branch first."
        Write-Host ""
        Write-Host "Protected branches: $($script:ProtectedBranches -join ', ')"
        Write-Host "Preferred naming: agent/<task-slug>"
        Write-Host "Suggested: git checkout -b agent/<task-slug>"
        Write-Host ""
        Write-Host "This orchestrator will not create or switch branches automatically -"
        Write-Host "doing so could hide or move existing work without certainty."
        Write-Host ""
        return
    }

    Push-Location $RepoRoot
    try {
        $remotes = @(git remote)
        $remote = if ($remotes -contains "origin") { "origin" } elseif ($remotes.Count -gt 0) { $remotes[0] } else { $null }
        if (-not $remote) {
            Write-Host ""
            Write-Host "PUSH BLOCKED"
            Write-Host ""
            Write-Host "No git remote configured."
            Write-Host ""
            return
        }
        $target = "$remote/$branch"

        Write-Host ""
        Write-Host "========================================"
        Write-Host "TERAS PUSH PREPARATION"
        Write-Host "========================================"
        Write-Host ""
        Write-Host "Task ID:"
        Write-Host $state.TaskId
        Write-Host ""
        Write-Host "Branch:"
        Write-Host $branch
        Write-Host ""
        Write-Host "Commit:"
        Write-Host $state.CommitSha
        Write-Host ""
        Write-Host "Remote:"
        Write-Host $remote
        Write-Host ""
        Write-Host "Target:"
        Write-Host $target
        Write-Host ""
        Write-Host "Production Branch:"
        Write-Host "NO"
        Write-Host ""
        Write-Host "Push:"
        Write-Host "NOT EXECUTED"
        Write-Host ""
        Write-Host "git status --short:"
        git status --short
        Write-Host ""
        Write-Host "git log -1 --oneline:"
        git log -1 --oneline
        Write-Host ""
        Write-Host "git remote -v (redacted):"
        Get-RedactedRemotes | ForEach-Object { Write-Host $_ }
        Write-Host ""

        $state.Branch = $branch
        $state.PushRemote = $remote
        $state.PushTarget = $target
        $state.State = "PUSH_READY"
        Save-TaskState -State $state

        Write-Host "Next: teras-agent -Push"
        Write-Host ""
    } finally {
        Pop-Location
    }
}

function Invoke-Push {
    $state = Get-TaskState
    if ($state.State -ne "PUSH_READY") {
        Write-Host ""
        Write-Host "PUSH BLOCKED"
        Write-Host ""
        Write-Host "Reason:"
        Write-Host "Task must go through -PreparePush first (current state: $($state.State))."
        Write-Host ""
        return
    }

    Push-Location $RepoRoot
    try {
        # Pre-push validation - re-verify everything immediately before the
        # actual push, not just at -PreparePush time (state may be stale).
        $headSha = (git rev-parse HEAD).Trim()
        $currentBranch = (git rev-parse --abbrev-ref HEAD).Trim()

        if ($headSha -ne $state.CommitSha) {
            Write-Host ""
            Write-Host "PUSH BLOCKED"
            Write-Host ""
            Write-Host "Reason:"
            Write-Host "HEAD commit ($headSha) does not match the approved commit ($($state.CommitSha))."
            Write-Host ""
            return
        }
        if ($currentBranch -ne $state.Branch) {
            Write-Host ""
            Write-Host "PUSH BLOCKED"
            Write-Host ""
            Write-Host "Reason:"
            Write-Host "Current branch ($currentBranch) does not match the approved branch ($($state.Branch))."
            Write-Host ""
            return
        }
        if (Test-ProtectedBranch -Branch $currentBranch) {
            Write-Host ""
            Write-Host "PUSH BLOCKED"
            Write-Host ""
            Write-Host "Current branch is protected."
            Write-Host ""
            return
        }
        if ($state.ReviewVerdict -notin @("PASS", "PASS_WITH_NOTES", "NOT_REQUIRED")) {
            Write-Host ""
            Write-Host "PUSH BLOCKED"
            Write-Host ""
            Write-Host "Reason:"
            Write-Host "Codex Review verdict is $($state.ReviewVerdict) - mandatory review has not passed."
            Write-Host ""
            return
        }
        if ($state.ScopeCheck -ne "PASS") {
            Write-Host ""
            Write-Host "PUSH BLOCKED"
            Write-Host ""
            Write-Host "Reason:"
            Write-Host "Scope Check is $($state.ScopeCheck)."
            Write-Host ""
            return
        }

        Write-Host ""
        Write-Host "This action will push ONE approved branch to the configured remote."
        Write-Host ""
        Write-Host "It will NOT:"
        Write-Host "- merge to main"
        Write-Host "- deploy production"
        Write-Host "- apply migrations"
        Write-Host "- modify production data"
        Write-Host ""

        $confirm = Read-Host "Type YES to push"
        if ($confirm -cne "YES") {
            Write-Host ""
            Write-Host "Push cancelled. No push was performed."
            Write-Host ""
            return
        }

        # A missing upstream is the expected/common case for a first push,
        # not a real error - the native command's non-zero exit throws
        # under this script's $ErrorActionPreference = "Stop" even with the
        # error stream redirected, so this must be a try/catch, not a
        # $LASTEXITCODE check (verified empirically - redirection alone
        # does not suppress it in this environment).
        try {
            git rev-parse --abbrev-ref --symbolic-full-name '@{u}' *> $null
            $hasUpstream = $true
        } catch {
            $hasUpstream = $false
        }

        Write-Host ""
        if ($hasUpstream) {
            git push $state.PushRemote $state.Branch
        } else {
            git push -u $state.PushRemote $state.Branch
        }

        if ($LASTEXITCODE -ne 0) {
            $state.State = "PUSH_BLOCKED"
            Save-TaskState -State $state
            Write-Host ""
            Write-Host "PUSH BLOCKED"
            Write-Host "git push failed - see output above. No further action was taken."
            Write-Host ""
            return
        }

        $state.State = "PUSHED"
        Save-TaskState -State $state
        Write-Host ""
        Write-Host "Push complete."
        Write-Host "Branch: $($state.Branch)"
        Write-Host "Target: $($state.PushTarget)"
        Write-Host ""
        Write-Host "Next: teras-agent -Preview"
        Write-Host ""
    } finally {
        Pop-Location
    }
}

function Invoke-DryRunPush {
    $state = Get-TaskState
    Write-Host ""
    Write-Host "DRY RUN PUSH - nothing will be executed."
    Write-Host ""

    $eligibility = Test-PushEligibility -State $state
    if (-not $eligibility.Eligible) {
        Write-Host "Push would currently be BLOCKED."
        Write-Host "Reason: $($eligibility.Reason)"
        Write-Host ""
        return
    }

    $branch = Get-CurrentBranch
    $protected = Test-ProtectedBranch -Branch $branch
    Push-Location $RepoRoot
    try {
        $remotes = @(git remote)
        $remote = if ($remotes -contains "origin") { "origin" } elseif ($remotes.Count -gt 0) { $remotes[0] } else { "(none configured)" }
    } finally {
        Pop-Location
    }

    Write-Host "Branch:  $branch"
    Write-Host "Commit:  $($state.CommitSha)"
    Write-Host "Remote:  $remote"
    Write-Host "Protected branch: $(if ($protected) { 'YES - push would be BLOCKED' } else { 'NO' })"
    Write-Host ""
    Write-Host "Intended push command:"
    Write-Host "  git push -u $remote $branch     (or 'git push $remote $branch' if upstream already tracked)"
    Write-Host ""
    Write-Host "No --force / --force-with-lease / --all / --mirror is ever used."
    Write-Host ""
}
