<#
    review-runner.ps1 - Codex CLI detection/handoff/launch and review-verdict
    parsing for the TERAS AI Engineering Orchestrator. Dot-sourced by
    teras-agent.ps1, which must set $RepoRoot, $AiDir before sourcing this
    file.

    Codex never receives the full repository by default (FULL_REPO_AUDIT
    stays false unless the task is an explicit Production Audit). If Codex
    is unavailable, the review is marked PENDING - never silently treated
    as passed. See .ai/MODEL_ROUTING.md's Codex context limiting section.
#>

function Test-CodexAvailable {
    return $null -ne (Get-Command "codex" -ErrorAction SilentlyContinue)
}

function New-CodexReviewHandoff {
    param($State, [string[]]$TaskGeneratedFiles)

    $path = Join-Path $AiDir "CODEX_REVIEW_HANDOFF.md"
    $filesText = if (@($TaskGeneratedFiles).Count -gt 0) { ($TaskGeneratedFiles | ForEach-Object { "- $_" }) -join "`n" } else { "- (no task-generated files recorded yet)" }

    $diffText = ""
    Push-Location $RepoRoot
    try {
        if (@($TaskGeneratedFiles).Count -gt 0) {
            $diffText = (git diff -- $TaskGeneratedFiles | Out-String)
        }
    } finally {
        Pop-Location
    }
    if ([string]::IsNullOrWhiteSpace($diffText)) { $diffText = "(no diff captured - files may be untracked; see git status)" }

    $content = @"
# CODEX_REVIEW_HANDOFF.md

> Generated per task by ``tools/review-runner.ps1``. READ ONLY REVIEW - do not modify code during this pass. FULL_REPO_AUDIT=false: Codex receives only what is listed below, never the full repository, unless this task is an explicit Production Audit.

## TASK

Task ID: $($State.TaskId)
Description: $($State.Description)
Category: $($State.Category)
Risk: $($State.Risk)

## WHAT YOU RECEIVE

- .ai/CURRENT_TASK.md
- .ai/IMPLEMENTATION_REPORT.md
- Changed file list (below)
- git diff (below)
- The changed source files themselves, read directly from the working tree

## CHANGED FILE LIST

$filesText

## GIT DIFF

``````diff
$diffText
``````

## YOUR TASK

Perform an independent, read-only review. Do not edit files. Write your findings to ``.ai/REVIEW_REPORT.md`` with exactly this structure:

Verdict:
PASS / PASS_WITH_NOTES / BLOCKED

Blocking Issues:
Non-blocking Issues:
Security Concerns:
Database Concerns:
Regression Risks:
Recommended Actions:
"@

    Set-Content -Path $path -Value $content -Encoding utf8
    return $path
}

function Invoke-CodexReview {
    param([string]$HandoffPath)

    if (-not (Test-CodexAvailable)) {
        Write-Host ""
        Write-Host "Codex CLI not detected."
        Write-Host "Independent review marked PENDING."
        Write-Host ""
        return $false
    }

    Write-Host ""
    Write-Host "Codex CLI detected. Launching read-only review with the controlled handoff at:"
    Write-Host "  $HandoffPath"
    Write-Host ""

    $prompt = Get-Content -Path $HandoffPath -Raw
    Push-Location $RepoRoot
    try {
        $prompt | & codex exec
        if ($LASTEXITCODE -ne 0) {
            Write-Host "Codex CLI exited with code $LASTEXITCODE. Independent review marked PENDING."
            return $false
        }
        return $true
    } catch {
        Write-Host "Codex CLI invocation failed: $($_.Exception.Message)"
        Write-Host "Independent review marked PENDING."
        return $false
    } finally {
        Pop-Location
    }
}

function Get-ReviewVerdict {
    $path = Join-Path $AiDir "REVIEW_REPORT.md"
    if (-not (Test-Path $path)) { return "PENDING" }

    $content = Get-Content -Path $path -Raw
    if ($content -match "(?m)^Verdict:\s*\r?\n\s*(PASS_WITH_NOTES|PASS|BLOCKED)\b") {
        return $Matches[1]
    }
    if ($content -match "(?m)^Verdict:\s*(PASS_WITH_NOTES|PASS|BLOCKED)\b") {
        return $Matches[1]
    }
    return "PENDING"
}

function Get-ReviewBlockingIssues {
    $path = Join-Path $AiDir "REVIEW_REPORT.md"
    if (-not (Test-Path $path)) { return @() }

    $content = Get-Content -Path $path
    $capture = $false
    $issues = @()
    foreach ($line in $content) {
        if ($line -match "^Blocking Issues:") { $capture = $true; continue }
        if ($capture -and $line -match "^[A-Z][A-Za-z ]+:") { break }
        if ($capture -and $line.Trim().Length -gt 0) { $issues += $line.Trim() }
    }
    return $issues
}
