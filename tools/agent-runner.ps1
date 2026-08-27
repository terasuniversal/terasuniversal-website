<#
    agent-runner.ps1 - Claude Code CLI detection/handoff/launch, git change
    tracking, and scope-boundary detection for the TERAS AI Engineering
    Orchestrator. Dot-sourced by teras-agent.ps1, which must set $RepoRoot,
    $AiDir before sourcing this file.

    Never runs a destructive git command. Never invents a pass/fail result
    for a step it did not actually perform - if the Claude CLI is not
    detected, the pipeline stops and says so rather than pretending the
    implementation happened.
#>

function Test-ClaudeAvailable {
    return $null -ne (Get-Command "claude" -ErrorAction SilentlyContinue)
}

function New-ClaudeHandoff {
    param($State)

    $path = Join-Path $AiDir "CLAUDE_HANDOFF.md"
    $allowedText = if (@($State.AllowedFiles).Count -gt 0) { ($State.AllowedFiles | ForEach-Object { "- $_" }) -join "`n" } else { "- (not yet specified - confirm scope with the human before editing anything)" }
    $blockedText = if (@($State.BlockedFiles).Count -gt 0) { ($State.BlockedFiles | ForEach-Object { "- $_" }) -join "`n" } else { "- (none specified)" }
    # OriginalImplementer is only ever set when this task transitioned from
    # another implementer (agent escalation or a PROVIDER_OR_ADAPTER
    # fallback) - surface CLAUDE_ESCALATION_HANDOFF.md explicitly so Claude
    # actually reads what was already found/attempted instead of only
    # possibly discovering it on its own. Fixes a real gap: this handoff
    # previously never referenced that file even when one existed.
    $escalationContextLine = if ($State.OriginalImplementer) { "`n- .ai/CLAUDE_ESCALATION_HANDOFF.md (read this first - $($State.OriginalImplementer) already worked on this task; do not rediscover from scratch)" } else { "" }

    $content = @"
# CLAUDE_HANDOFF.md

> Generated per task by ``tools/agent-runner.ps1``. This is the controlled context Claude Code receives - not the full repository. Claude also has read access to the files listed under CONTEXT below, since those are this orchestrator's own operating rules.

## ROLE

You are the Implementer for this task, per ``.ai/AGENTS.md``. You are bound by every rule in the repository's root ``CLAUDE.md`` in addition to everything below - this handoff adds task-specific scope and constraints on top, it does not relax anything ``CLAUDE.md`` already requires.

## TASK

Task ID: $($State.TaskId)
Description: $($State.Description)
Category: $($State.Category)

## RISK

$($State.Risk)

Reason: $($State.Reason)

## APPROVED SCOPE

Only the files listed under ALLOWED FILES below may be created or modified. Everything else in the repository is out of scope for this task, even if it looks related.

## ALLOWED FILES

$allowedText

## BLOCKED FILES

$blockedText

If you believe you need to touch a file outside Allowed Files, stop and report that need instead of editing it - see ``.ai/BUSINESS_RULES.md``'s SCOPE_LOCK rule.

## BUSINESS RULES

- AUTO_COMMIT=false, AUTO_PUSH=false, AUTO_DEPLOY=false, AUTO_DATABASE_WRITE=false, AUTO_MIGRATION_APPLY=false
- SCOPE_LOCK=true, HUMAN_APPROVAL_REQUIRED=true
- Full rules: ``.ai/BUSINESS_RULES.md``

## REQUIRED VERIFICATION

- Inspect relevant code before changing anything
- Implement the change within Approved Scope only
- Manually verify the specific behavior changed
- Do not run ``npm run build`` repeatedly while investigating - this orchestrator runs QA once, after your implementation is complete

## PROHIBITED ACTIONS

DO NOT:
- modify unrelated files
- refactor outside approved scope
- commit
- push
- deploy
- apply migrations
- modify production data

## FINAL REPORT FORMAT

When done, write your result to ``.ai/IMPLEMENTATION_REPORT.md`` using the template already in that file (task, root cause, changes made, exact files changed, tests performed, known risks, unresolved issues).

## CONTEXT

- .ai/PROJECT.md
- .ai/ARCHITECTURE.md
- .ai/BUSINESS_RULES.md
- .ai/AGENTS.md
- .ai/CURRENT_TASK.md
- .ai/CLAUDE_HANDOFF.md (this file)$escalationContextLine
"@

    Set-Content -Path $path -Value $content -Encoding utf8
    return $path
}

function New-RepairHandoff {
    param($State, [string[]]$BlockingIssues)

    $path = Join-Path $AiDir "REPAIR_HANDOFF.md"
    $issuesText = if (@($BlockingIssues).Count -gt 0) { ($BlockingIssues | ForEach-Object { "- $_" }) -join "`n" } else { "- (Codex marked BLOCKED but listed no specific issues - re-read .ai/REVIEW_REPORT.md before proceeding.)" }

    $content = @"
# REPAIR_HANDOFF.md

> Generated only when Codex review returns BLOCKED. Contains ONLY the blocking issues - not a general re-implementation request. This is repair cycle $($State.RepairCyclesUsed + 1) of a maximum of 1 automatic cycle (MAX_REPAIR_CYCLES=1, see .ai/USAGE_POLICY.md). If this cycle does not resolve the issues, the task stops and requires human intervention - no further automatic loop.

## TASK

Task ID: $($State.TaskId)
Description: $($State.Description)

## BLOCKING ISSUES TO FIX

$issuesText

## SCOPE

Fix only the issues listed above, within the original Approved Scope in ``.ai/CURRENT_TASK.md``. Do not use this as an opportunity to make unrelated changes.

## AFTER FIXING

Update ``.ai/IMPLEMENTATION_REPORT.md`` to describe what changed for the repair. Do not commit, push, deploy, or apply a migration.
"@

    Set-Content -Path $path -Value $content -Encoding utf8
    return $path
}

function Invoke-ClaudeImplementation {
    param([string]$HandoffPath)

    if (-not (Test-ClaudeAvailable)) {
        Write-Host ""
        Write-Host "Claude Code CLI not detected."
        Write-Host ""
        Write-Host "CURRENT_TASK.md and CLAUDE_HANDOFF.md were generated."
        Write-Host "Run the task manually with Claude Code."
        Write-Host ""
        return $false
    }

    Write-Host ""
    Write-Host "Claude Code CLI detected. Launching with the controlled handoff at:"
    Write-Host "  $HandoffPath"
    Write-Host ""

    $prompt = Get-Content -Path $HandoffPath -Raw
    Push-Location $RepoRoot
    try {
        $prompt | & claude -p
        if ($LASTEXITCODE -ne 0) {
            Write-Host "Claude Code CLI exited with code $LASTEXITCODE. Review its output above before continuing."
            return $false
        }
        return $true
    } catch {
        Write-Host "Claude Code CLI invocation failed: $($_.Exception.Message)"
        Write-Host "CURRENT_TASK.md and CLAUDE_HANDOFF.md were generated - run the task manually with Claude Code."
        return $false
    } finally {
        Pop-Location
    }
}

function Get-ClaudeReviewCapabilities {
    $help = (& claude --help 2>&1 | Out-String)
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) {
        return [pscustomobject]@{
            Supported = $false
            Reason = "Unable to read Claude CLI capabilities (exit code $exitCode)."
            Arguments = @()
        }
    }

    # The reviewer must have an explicit read-only permission mode and a
    # restricted built-in tool set. Never substitute an unsafe mode if a
    # future Claude CLI changes either contract.
    if ($help -notmatch '(?m)-p, --print' -or
        $help -notmatch '(?m)--permission-mode <mode>' -or
        $help -notmatch '(?is)--permission-mode <mode>.*?choices:.*?plan' -or
        $help -notmatch '(?m)--tools <tools\.\.\.>') {
        return [pscustomobject]@{
            Supported = $false
            Reason = "This Claude CLI does not expose the required read-only review controls (-p, --permission-mode plan, and --tools)."
            Arguments = @()
        }
    }

    return [pscustomobject]@{
        Supported = $true
        Reason = "Claude review will run in plan mode with only Read, Glob, and Grep tools."
        Arguments = @("-p", "--permission-mode", "plan", "--tools", "Read,Glob,Grep")
    }
}

function New-ClaudeReviewHandoff {
    param($State, [string[]]$TaskGeneratedFiles)

    $path = Join-Path $AiDir "CLAUDE_REVIEW_HANDOFF.md"
    $filesText = if (@($TaskGeneratedFiles).Count -gt 0) {
        ($TaskGeneratedFiles | ForEach-Object { "- $_" }) -join "`n"
    } else { "- (Codex produced no working-tree file delta)" }

    $content = @"
# CLAUDE_REVIEW_HANDOFF.md

> Generated by ``tools/agent-runner.ps1`` after Codex implementation and scope validation. This is a reviewer handoff, not an implementation request.

## REQUIRED CONTEXT

Read these files first, using read-only tools only:
- AGENTS.md
- CLAUDE.md
- .ai/CURRENT_TASK.md
- .ai/PROJECT_STATUS.md
- .ai/DECISIONS.md

## TASK

Task ID: $($State.TaskId)
Description: $($State.Description)
Category: $($State.Category)
Risk: $($State.Risk)

## CODEX-GENERATED FILES TO REVIEW

Review only the following Codex-generated files and their relevant diff/content:
$filesText

Do not broaden the review to unrelated repository files. Do not modify any file, including this handoff. Do not run Bash or Git commands. Do not commit, push, merge, deploy, apply migrations, or touch production data. Do not invoke another agent.

## REQUIRED RESULT

Return exactly one of these tokens as the first non-empty output line:
- PASS
- PASS_WITH_NOTES
- CHANGES_REQUIRED

Then provide concise findings, limited to the listed Codex-generated files and relevant task context. If CHANGES_REQUIRED, explain the concrete changes needed; do not make them and do not rerun Codex.
"@

    Set-Content -LiteralPath $path -Value $content -Encoding utf8
    return $path
}

function Invoke-ClaudeReadOnlyReview {
    param($State, [string[]]$TaskGeneratedFiles)

    $handoffPath = New-ClaudeReviewHandoff -State $State -TaskGeneratedFiles $TaskGeneratedFiles
    $result = [ordered]@{
        Succeeded = $false
        Verdict = "UNAVAILABLE"
        HandoffPath = $handoffPath
        Output = ""
        Error = ""
        ChangedFiles = @()
    }

    if (-not (Test-ClaudeAvailable)) {
        $result.Error = "Claude Code CLI not detected. No fallback agent was invoked."
        return [pscustomobject]$result
    }

    $capabilities = Get-ClaudeReviewCapabilities
    if (-not $capabilities.Supported) {
        $result.Error = "Claude reviewer capability check failed: $($capabilities.Reason) No fallback agent was invoked."
        return [pscustomobject]$result
    }

    Write-Host ""
    Write-Host "Claude read-only reviewer starting after Codex scope validation."
    Write-Host "  Handoff: $handoffPath"
    Write-Host "  Controls: $($capabilities.Reason)"
    Write-Host ""

    $prompt = Get-Content -LiteralPath $handoffPath -Raw
    $beforeReview = Get-GitStatusSnapshot
    $previousErrorActionPreference = $ErrorActionPreference
    Push-Location $RepoRoot
    try {
        $ErrorActionPreference = "Continue"
        $reviewArguments = @($capabilities.Arguments)
        $output = $prompt | & claude @reviewArguments 2>&1
        $exitCode = $LASTEXITCODE
        $rendered = ($output | Out-String)
        $result.Output = $rendered
        if ($rendered) { $rendered | Out-Host }

        $afterReview = Get-GitStatusSnapshot
        $reviewDelta = Get-ChangedFilesDelta -Before $beforeReview -After $afterReview
        $result.ChangedFiles = @($reviewDelta.TaskGenerated)
        if ($result.ChangedFiles.Count -gt 0) {
            $result.Error = "Claude reviewer changed files despite read-only controls: $($result.ChangedFiles -join ', ')"
            return [pscustomobject]$result
        }

        if ($exitCode -ne 0) {
            if ($rendered -match '(?i)auth|login|credential|token|unauthor') {
                $result.Error = "Claude CLI authentication failure (exit code $exitCode). No fallback agent was invoked."
            } else {
                $result.Error = "Claude CLI exited with code $exitCode. No fallback agent was invoked."
            }
            return [pscustomobject]$result
        }

        $verdictMatch = [regex]::Match($rendered, '(?m)^\s*(PASS_WITH_NOTES|CHANGES_REQUIRED|PASS)\s*$')
        if (-not $verdictMatch.Success) {
            $result.Error = "Claude reviewer returned no supported structured verdict (PASS, PASS_WITH_NOTES, or CHANGES_REQUIRED)."
            return [pscustomobject]$result
        }

        $result.Succeeded = $true
        $result.Verdict = $verdictMatch.Groups[1].Value
        Add-Content -LiteralPath $handoffPath -Value ("`n## REVIEW RESULT`n`n" + $rendered) -Encoding utf8
        return [pscustomobject]$result
    } catch {
        $result.Error = "Claude CLI invocation failed: $($_.Exception.Message). No fallback agent was invoked."
        return [pscustomobject]$result
    } finally {
        $ErrorActionPreference = $previousErrorActionPreference
        Pop-Location
    }
}

function Get-ClaudeRepairDecision {
    param([string]$Verdict, [int]$AttemptsUsed, [int]$MaximumAttempts = 2)

    if ($Verdict -in @("PASS", "PASS_WITH_NOTES")) { return "NO_REPAIR" }
    if ($Verdict -eq "CHANGES_REQUIRED" -and $AttemptsUsed -lt $MaximumAttempts) { return "REPAIR" }
    if ($Verdict -eq "CHANGES_REQUIRED" -and $AttemptsUsed -ge $MaximumAttempts) { return "NEEDS_HUMAN_REVIEW" }
    return "REVIEW_FAILED"
}

function Set-TaskStateProperty {
    param($State, [string]$Name, $Value)

    if ($State.PSObject.Properties.Name -contains $Name) {
        $State.$Name = $Value
    } else {
        $State | Add-Member -MemberType NoteProperty -Name $Name -Value $Value
    }
}

function Test-RepairMigrationGate {
    param($State)

    $allowed = @($State.AllowedFiles)
    $migrationScoped = [bool]$State.DbRequired -or @($allowed | Where-Object { $_ -match '(?i)(^|/)(supabase/|.*\.sql$)' }).Count -gt 0
    if ($migrationScoped) {
        return [pscustomobject]@{
            Allowed = $true
            Mode = "EDIT_ONLY_NO_APPLY"
            Reason = "Migration/high-risk repair is limited to approved files; apply, merge, and production release remain explicitly blocked."
        }
    }
    return [pscustomobject]@{
        Allowed = $true
        Mode = "STANDARD"
        Reason = "Repair is limited to the original approved implementation scope."
    }
}

function New-CodexRepairHandoff {
    param($State, [string]$ClaudeFindings, [int]$Attempt)

    $path = Join-Path $AiDir "CODEX_REPAIR_HANDOFF.md"
    $scopeText = if (@($State.AllowedFiles).Count -gt 0) { ($State.AllowedFiles | ForEach-Object { "- $_" }) -join "`n" } else { "- (no approved scope - stop)" }
    $content = @"
# CODEX_REPAIR_HANDOFF.md

> Generated after Claude returned CHANGES_REQUIRED. This is bounded repair attempt $Attempt of 2. Codex remains the implementation agent.

## ORIGINAL TASK

Task ID: $($State.TaskId)
Description: $($State.Description)
Category: $($State.Category)
Risk: $($State.Risk)

## CLAUDE FINDINGS

$ClaudeFindings

## APPROVED FILES IN SCOPE

$scopeText

Codex may modify only files already listed above. Do not create or modify any other file.

## PROHIBITED ACTIONS

- Do not commit, push, merge, deploy, or apply a migration.
- Do not modify CRM/application/auth/production files outside the approved scope.
- Do not run destructive Git commands.
- Do not invoke Claude, DeepSeek, or another agent.
- For migration/high-risk scope, edit only the approved migration file; application to any environment remains blocked pending explicit human approval.

## AFTER REPAIR

Run relevant verification and report the exact files changed. The orchestrator will re-run scope validation and Claude read-only review. Do not start another repair loop yourself.
"@

    Set-Content -LiteralPath $path -Value $content -Encoding utf8
    return $path
}

function Test-CodexImplementationAvailable {
    return $null -ne (Get-Command "codex" -ErrorAction SilentlyContinue)
}

function Get-CodexExecCapabilities {
    $help = (& codex exec --help 2>&1 | Out-String)
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) {
        return [pscustomobject]@{
            Supported = $false
            Reason = "Unable to read codex exec capabilities (exit code $exitCode)."
            Arguments = @()
            ApprovalMode = "UNAVAILABLE"
        }
    }

    if ($help -notmatch '(?m)--sandbox <SANDBOX_MODE>' -or
        $help -notmatch '(?m)-C, --cd <DIR>') {
        return [pscustomobject]@{
            Supported = $false
            Reason = "This Codex CLI does not expose the required codex exec workspace controls (--sandbox and --cd)."
            Arguments = @()
            ApprovalMode = "UNAVAILABLE"
        }
    }

    $arguments = @("--cd", $RepoRoot, "--sandbox", "workspace-write")
    $approvalMode = "HANDOFF_BOUNDARY_ONLY"
    if ($help -match '(?m)--ask-for-approval <APPROVAL_POLICY>' -and $help -match '(?m)- on-request:') {
        $arguments += @("--ask-for-approval", "on-request")
        $approvalMode = "ON_REQUEST"
    }

    return [pscustomobject]@{
        Supported = $true
        Reason = if ($approvalMode -eq "ON_REQUEST") {
            "codex exec supports interactive on-request approval."
        } else {
            "codex exec does not support interactive on-request approval in this installed version; no auto-approval flag will be used."
        }
        Arguments = $arguments
        ApprovalMode = $approvalMode
    }
}

function New-CodexImplementationHandoff {
    param($State)

    $path = Join-Path $AiDir "CODEX_IMPLEMENTATION_HANDOFF.md"
    $allowedText = if (@($State.AllowedFiles).Count -gt 0) { ($State.AllowedFiles | ForEach-Object { "- $_" }) -join "`n" } else { "- (not yet specified - stop and request scope)" }
    $content = @"
# CODEX_IMPLEMENTATION_HANDOFF.md

> Generated per task by ``tools/agent-runner.ps1``. Codex is the primary implementation agent for this task.

## REQUIRED CONTEXT

Read these files from the repository before editing:
- AGENTS.md
- .ai/CURRENT_TASK.md
- .ai/PROJECT_STATUS.md
- .ai/DECISIONS.md

## TASK

Task ID: $($State.TaskId)
Description: $($State.Description)
Category: $($State.Category)
Risk: $($State.Risk)

## APPROVED SCOPE

Only the following paths may be created or modified:

$allowedText

Do not expand scope. Do not modify CRM application files, database migrations, Supabase schema, or production data unless they are explicitly listed above and separately approved by the human.

## GOVERNANCE

- Preserve the root AGENTS.md and CLAUDE.md rules.
- No commit, push, merge, deploy, or migration apply.
- Do not silently fall back to Claude, DeepSeek, or another agent.
- The adapter uses workspace-write and the safest approval capability exposed by this Codex CLI. If ``codex exec`` does not expose interactive ``on-request`` approval, no auto-approval flag is used; these boundaries are enforced by this handoff and the task scope.
- Run relevant verification and write the implementation result to .ai/IMPLEMENTATION_REPORT.md.
- Human approval remains required before any release action.
"@

    Set-Content -Path $path -Value $content -Encoding utf8
    return $path
}

function Invoke-CodexImplementation {
    param([string]$HandoffPath)

    if (-not (Test-CodexImplementationAvailable)) {
        Write-Host ""
        Write-Host "Codex CLI not detected."
        Write-Host "The task remains in its current state; no alternate agent will be invoked."
        Write-Host ""
        return $false
    }

    $capabilities = Get-CodexExecCapabilities
    if (-not $capabilities.Supported) {
        Write-Host "Codex CLI capability check failed: $($capabilities.Reason)"
        Write-Host "No alternate agent was invoked."
        return $false
    }

    Write-Host ""
    Write-Host "Codex CLI detected. Launching with the controlled handoff at:"
    Write-Host "  $HandoffPath"
    Write-Host "Approval capability: $($capabilities.ApprovalMode)"
    Write-Host ""
    if ($capabilities.ApprovalMode -eq "HANDOFF_BOUNDARY_ONLY") {
        Write-Host "This codex exec version has no interactive on-request approval flag; no auto-approval flag will be used."
    }
    Write-Host ""

    $prompt = Get-Content -Path $HandoffPath -Raw
    $execArguments = @($capabilities.Arguments)
    $previousErrorActionPreference = $ErrorActionPreference
    Push-Location $RepoRoot
    try {
        # Codex may emit non-fatal startup diagnostics on stderr. The
        # orchestrator normally treats native stderr as terminating; keep
        # those diagnostics in the captured output and use LASTEXITCODE for
        # the actual CLI result instead.
        $ErrorActionPreference = "Continue"
        $output = $prompt | & codex exec @execArguments - 2>&1
        $exitCode = $LASTEXITCODE
        if ($output) { $output | Out-Host }
        if ($exitCode -ne 0) {
            $rendered = ($output | Out-String)
            if ($rendered -match '(?i)auth|login|credential|token|unauthor') {
                Write-Host "Codex CLI is unavailable because authentication is required or invalid."
            } else {
                Write-Host "Codex CLI exited with code $exitCode. Review its output before continuing."
            }
            Write-Host "No alternate agent was invoked."
            return $false
        }
        return $true
    } catch {
        Write-Host "Codex CLI invocation failed: $($_.Exception.Message)"
        Write-Host "No alternate agent was invoked."
        return $false
    } finally {
        $ErrorActionPreference = $previousErrorActionPreference
        Pop-Location
    }
}

# ---------------------------------------------------------------------------
# Git change tracking - distinguishes pre-existing working-tree changes from
# changes this task's implementation step produced. Never resets, cleans, or
# restores anything; read-only `git status --short` snapshots only.
# ---------------------------------------------------------------------------

function Get-GitStatusSnapshot {
    Push-Location $RepoRoot
    try {
        $status = @(git status --short)
        $snapshot = @()
        foreach ($line in $status) {
            $path = Get-StatusPath -StatusLine $line
            if ($path) {
                $fullPath = Join-Path $RepoRoot ($path -replace '/', '\\')
                try {
                    if (Test-Path -LiteralPath $fullPath -PathType Leaf) {
                        $fingerprint = (Get-FileHash -LiteralPath $fullPath -Algorithm SHA256).Hash
                        $line = "$line|CONTENT_HASH=$fingerprint"
                    }
                } catch {
                    # Keep the ordinary status line if a path cannot be probed;
                    # malformed names and permission failures must not stop
                    # read-only tracking.
                }
            }
            $snapshot += $line
        }
        return $snapshot
    } finally {
        Pop-Location
    }
}

function Get-StatusPath {
    param([string]$StatusLine)
    # `git status --short` lines are "XY path" (or "XY orig -> new" for renames) - path starts at column 4.
    if ($StatusLine.Length -le 3) { return $null }
    $rest = $StatusLine.Substring(3)
    $rest = $rest -replace '\|CONTENT_HASH=.*$', ''
    if ($rest -match '^(.*) -> (.*)$') { return $Matches[2] }
    return $rest
}

function Get-ChangedFilesDelta {
    param([string[]]$Before, [string[]]$After)

    $beforeMap = @{}
    foreach ($line in $Before) {
        $p = Get-StatusPath -StatusLine $line
        if ($p) { $beforeMap[$p] = $line }
    }

    $preExisting = @()
    $taskGenerated = @()
    foreach ($line in $After) {
        $p = Get-StatusPath -StatusLine $line
        if (-not $p) { continue }
        if ($beforeMap.ContainsKey($p) -and $beforeMap[$p] -eq $line) {
            $preExisting += $p
        } else {
            $taskGenerated += $p
        }
    }

    return [pscustomobject]@{
        PreExisting   = $preExisting
        TaskGenerated = $taskGenerated
    }
}

# Allowed Files entries are treated as path-prefix matches (a directory or an
# exact file), which is enough to catch an unrelated file without requiring
# glob syntax in CURRENT_TASK.md. Comparison is literal/ordinal/case-
# insensitive via the shared helpers in agent-router.ps1 - never -like -
# because Next.js dynamic route segments ([scheduleId], [id], [token])
# contain PowerShell wildcard metacharacters that -like would interpret.
function Test-ScopeViolation {
    param([string[]]$TaskGeneratedFiles, [string[]]$AllowedFiles)

    if (@($AllowedFiles).Count -eq 0) {
        return [pscustomobject]@{ Status = "NOT_CONFIGURED"; Unauthorized = @() }
    }

    $unauthorized = @()
    foreach ($file in $TaskGeneratedFiles) {
        $normalizedFile = Get-NormalizedRepoRelativePath -Path $file
        $isAllowed = $false
        foreach ($allowed in $AllowedFiles) {
            $normalizedAllowed = (Get-NormalizedRepoRelativePath -Path $allowed).TrimEnd('/')
            if ((Test-RepoRelativePathsEqual -A $normalizedFile -B $normalizedAllowed) -or
                $normalizedFile.StartsWith("$normalizedAllowed/", [System.StringComparison]::OrdinalIgnoreCase)) {
                $isAllowed = $true
                break
            }
        }
        if (-not $isAllowed) { $unauthorized += $file }
    }

    if ($unauthorized.Count -gt 0) {
        return [pscustomobject]@{ Status = "FAIL"; Unauthorized = $unauthorized }
    }
    return [pscustomobject]@{ Status = "PASS"; Unauthorized = @() }
}
