<#
    preview-runner.ps1 - Vercel Preview deployment and non-destructive
    preview verification for the TERAS AI Engineering Orchestrator.
    Dot-sourced by teras-agent.ps1, which must set $RepoRoot, $AiDir before
    sourcing this file.

    Hard safety invariants enforced in this file, not just documented:
    - never passes --prod / -prod to the Vercel CLI, anywhere
    - never installs the Vercel CLI
    - never writes an auth token, or more than a short error excerpt from a
      CLI invocation, into PREVIEW_REPORT.md
    - never guesses credentials for an authenticated route; reports
      PARTIAL VERIFICATION instead
    - Codex is never invoked automatically from this file - see
      .ai/USAGE_POLICY.md and section 13/22 of this phase's own spec
#>

function Test-VercelAvailable {
    return $null -ne (Get-Command "vercel" -ErrorAction SilentlyContinue)
}

function Test-VercelProjectLinked {
    $vercelDir = Join-Path $RepoRoot ".vercel"
    $projectJson = Join-Path $vercelDir "project.json"
    $vercelJson = Join-Path $RepoRoot "vercel.json"
    return (Test-Path $projectJson) -or (Test-Path $vercelDir) -or (Test-Path $vercelJson)
}

# Best-effort: prefers an existing deployment the Vercel Git integration
# already created for the pushed branch over triggering a second one, per
# this phase's spec section 9. `vercel ls` output format is not a stable
# contract across CLI versions, so this is a text match, not a JSON parse.
function Get-ExistingPreviewDeployment {
    param([string]$Branch)

    if ([string]::IsNullOrWhiteSpace($Branch)) { return $null }

    Push-Location $RepoRoot
    try {
        $output = vercel ls 2>&1
    } finally {
        Pop-Location
    }
    if ($LASTEXITCODE -ne 0) { return $null }

    $match = $output | Where-Object { $_ -match [regex]::Escape($Branch) } | Select-Object -First 1
    if (-not $match) { return $null }
    if ($match -match '(https://\S+)') { return $Matches[1] }
    return $null
}

function Invoke-PreviewDeploy {
    param($State)

    if (-not (Test-VercelAvailable)) {
        Write-Host ""
        Write-Host "Vercel CLI not detected."
        Write-Host ""
        Write-Host "Branch push completed if approved."
        Write-Host "Preview deployment must be created through existing Vercel Git integration or manually."
        Write-Host ""
        $State.PreviewStatus = "MANUAL_REQUIRED"
        Save-TaskState -State $State
        return $State
    }

    if (-not (Test-VercelProjectLinked)) {
        Write-Host ""
        Write-Host "Vercel CLI detected, but this repository does not appear linked (no .vercel/ or vercel.json)."
        Write-Host "Run 'vercel link' yourself first, or rely on the existing Git integration for a preview."
        Write-Host ""
        $State.PreviewStatus = "MANUAL_REQUIRED"
        Save-TaskState -State $State
        return $State
    }

    $State.State = "PREVIEW_DEPLOYING"
    $State.PreviewStatus = "DEPLOYING"
    Save-TaskState -State $State

    Write-Host ""
    Write-Host "Checking for an existing preview deployment for branch $($State.Branch) (Vercel Git integration)..."
    $existingUrl = Get-ExistingPreviewDeployment -Branch $State.Branch
    if ($existingUrl) {
        Write-Host "Found existing preview: $existingUrl"
        Write-Host ""
        $State.PreviewUrl = $existingUrl
        $State.PreviewDeploymentId = $existingUrl
        $State.PreviewBuildStatus = "PASS"
        Save-TaskState -State $State
        return $State
    }

    Write-Host "No existing deployment found. Triggering a preview build (never --prod)..."
    Write-Host ""
    Push-Location $RepoRoot
    try {
        $output = vercel 2>&1
        $exitCode = $LASTEXITCODE
    } finally {
        Pop-Location
    }

    $urlLine = $output | Where-Object { $_ -match 'https://\S+\.vercel\.app\S*' } | Select-Object -Last 1
    if ($exitCode -eq 0 -and $urlLine -match '(https://\S+\.vercel\.app\S*)') {
        $State.PreviewUrl = $Matches[1]
        $State.PreviewDeploymentId = $Matches[1]
        $State.PreviewBuildStatus = "PASS"
        Save-TaskState -State $State
        Write-Host "Preview deployed: $($State.PreviewUrl)"
        Write-Host ""
    } else {
        $State.PreviewBuildStatus = "FAIL"
        $State.PreviewStatus = "FAIL"
        $State.State = "PREVIEW_BLOCKED"
        # Only a short excerpt is ever kept - never the full CLI output, which
        # could in principle echo project metadata that doesn't belong in a
        # committed-adjacent report file.
        $errorSummary = ((@($output) | Select-Object -Last 8) -join " | ")
        $State.PreviewBlockingIssues = @("Preview build failed: $errorSummary")
        Save-TaskState -State $State
        Write-Host ""
        Write-Host "PREVIEW_BLOCKED - build failed."
        Write-Host $errorSummary
        Write-Host ""
    }
    return $State
}

# Non-destructive only: GET requests with no write payload, no login
# attempts, no credential guessing. Detects an auth wall and reports it as
# PARTIAL rather than trying to get past it. Shared by preview verification
# (preview-runner.ps1) and production verification (release-runner.ps1) so
# the two never diverge in what "reachable and healthy" means.
function Test-UrlHealth {
    param([string]$Url, [string]$UnreachableLabel = "URL")

    if ([string]::IsNullOrWhiteSpace($Url)) {
        return [pscustomobject]@{ Status = "FAIL"; Notes = @("No $UnreachableLabel available to verify.") }
    }

    $notes = @()
    $status = "PASS"

    try {
        $response = Invoke-WebRequest -Uri $Url -Method Get -MaximumRedirection 5 -UseBasicParsing -TimeoutSec 20 -ErrorAction Stop
        $code = [int]$response.StatusCode

        if ($code -ge 500) {
            $status = "FAIL"
            $notes += "$UnreachableLabel returned server error status $code."
        } elseif ($code -ge 400) {
            $status = "FAIL"
            $notes += "$UnreachableLabel returned client error status $code."
        } else {
            $notes += "$UnreachableLabel reachable, HTTP $code."
        }

        if ($response.Content -match '(?i)(internal server error|application error|unhandled exception|500 -)') {
            $status = "FAIL"
            $notes += "Response body contains an error-page signature."
        }
        if ($response.BaseResponse -and $response.BaseResponse.ResponseUri -and $response.BaseResponse.ResponseUri.AbsolutePath -match '(?i)login') {
            $status = "PARTIAL"
            $notes += "Request was redirected to a login-looking path - this route requires authentication."
        }
    } catch {
        $we = $_.Exception
        $webResponse = $null
        if ($we -is [System.Net.WebException]) { $webResponse = $we.Response }
        if ($webResponse -and $webResponse.StatusCode) {
            $code = [int]$webResponse.StatusCode
            $isAuthWall = ($code -eq 401 -or $code -eq 403) -or
                          ($webResponse.ResponseUri -and $webResponse.ResponseUri.AbsolutePath -match '(?i)login')
            if ($isAuthWall) {
                $status = "PARTIAL"
                $notes += "Route appears to require authentication (HTTP $code)."
            } else {
                $status = "FAIL"
                $notes += "Request failed with HTTP $code."
            }
        } else {
            $status = "FAIL"
            $notes += "$UnreachableLabel unreachable: $($we.Message)"
        }
    }

    return [pscustomobject]@{ Status = $status; Notes = $notes }
}

function Invoke-PreviewVerification {
    param($State)
    return Test-UrlHealth -Url $State.PreviewUrl -UnreachableLabel "Preview"
}

function Write-PreviewReport {
    param($State, $Verification)

    $path = Join-Path $AiDir "PREVIEW_REPORT.md"
    $blocking = if (@($State.PreviewBlockingIssues).Count -gt 0) { (@($State.PreviewBlockingIssues) | ForEach-Object { "- $_" }) -join "`n" } else { "- None." }
    $verificationNotes = if ($Verification -and @($Verification.Notes).Count -gt 0) { (@($Verification.Notes) | ForEach-Object { "- $_" }) -join "`n" } else { "- (not run)" }
    $nonBlocking = if ($State.PreviewVerificationStatus -eq "PASS" -and $Verification) { $verificationNotes } elseif (@($State.PreviewNonBlockingIssues).Count -gt 0) { (@($State.PreviewNonBlockingIssues) | ForEach-Object { "- $_" }) -join "`n" } else { "- None." }

    $recommendation =
        if ($State.PreviewVerificationStatus -eq "PASS") {
            "Preview looks healthy. This is not a production-readiness sign-off - a human still makes that call separately, and Phase 4 has no path to production deployment regardless."
        } elseif ($State.PreviewVerificationStatus -eq "PARTIAL") {
            "Automated verification was PARTIAL (likely an authenticated route). A human should manually verify the authenticated path using an existing, already-configured session - never by supplying credentials to this script."
        } else {
            "Not ready - see Blocking Issues above. File a new task (teras-agent `"<description of the fix>`") to address it; no automatic repair loop was started."
        }

    $content = @"
# PREVIEW_REPORT.md

> Regenerated by ``tools/preview-runner.ps1`` each time -Preview or -VerifyPreview runs. Never contains auth tokens or credentials.

Task ID:
$($State.TaskId)

Branch:
$($State.Branch)

Commit SHA:
$($State.CommitSha)

Preview Deployment Status:
$($State.PreviewStatus)

Preview URL:
$(if ($State.PreviewUrl) { $State.PreviewUrl } else { "(none)" })

Build Status:
$($State.PreviewBuildStatus)

Verification Status:
$($State.PreviewVerificationStatus)

Verification Notes:
$verificationNotes

Blocking Issues:
$blocking

Non-blocking Issues:
$nonBlocking

Codex Preview Review Required:
$(if ($State.CodexPreviewReviewRequired) { "YES (not auto-invoked - run 'teras-agent -Review' manually if wanted)" } else { "NO" })

Production Ready Recommendation:
$recommendation
"@

    Set-Content -Path $path -Value $content -Encoding utf8
}

function Get-PullRequestPreview {
    param($State)

    Write-Host "Suggested PR content (NOT opened automatically - see section 20):"
    Write-Host ""
    Write-Host "Title: $($State.CommitMessage)"
    Write-Host ""
    Write-Host "Summary:"
    Write-Host $State.Description
    Write-Host ""
    Write-Host "Changes:"
    foreach ($f in @($State.TaskGeneratedFiles)) { Write-Host "- $f" }
    Write-Host ""
    Write-Host "QA: $(if (Test-QaHasBlockingFailure -QaResults $State.QA) { 'FAIL' } else { 'PASS' })"
    Write-Host "Codex Review: $($State.ReviewVerdict)"
    Write-Host "Preview Status: $($State.PreviewVerificationStatus) ($(if ($State.PreviewUrl) { $State.PreviewUrl } else { 'no URL' }))"
    Write-Host "Risk: $($State.Risk)"
    Write-Host "Known Issues: $(if (@($State.PreviewBlockingIssues).Count -gt 0) { ($State.PreviewBlockingIssues -join '; ') } else { 'None' })"
    Write-Host ""
    Write-Host "(No PR was created. Opening one requires explicit human confirmation in a later phase.)"
    Write-Host ""
}

function Show-PreviewGate {
    param($State)

    Write-Host ""
    Write-Host "========================================"
    Write-Host "TERAS PREVIEW REVIEW"
    Write-Host "========================================"
    Write-Host ""
    Write-Host "Task:"
    Write-Host $State.Description
    Write-Host ""
    Write-Host "Branch:"
    Write-Host $State.Branch
    Write-Host ""
    Write-Host "Commit:"
    Write-Host $State.CommitSha
    Write-Host ""
    Write-Host "Preview:"
    Write-Host $State.PreviewVerificationStatus
    Write-Host ""
    Write-Host "Preview URL:"
    Write-Host $(if ($State.PreviewUrl) { $State.PreviewUrl } else { "(none)" })
    Write-Host ""
    Write-Host "QA:"
    Write-Host $(if (Test-QaHasBlockingFailure -QaResults $State.QA) { "FAIL" } else { "PASS" })
    Write-Host ""
    Write-Host "Codex:"
    Write-Host $State.ReviewVerdict
    Write-Host ""
    Write-Host "Production Deployment:"
    Write-Host "BLOCKED"
    Write-Host ""
    Write-Host "Available actions:"
    Write-Host ""
    Write-Host "1. Open Preview          -> $(if ($State.PreviewUrl) { $State.PreviewUrl } else { '(no URL available)' })"
    Write-Host "2. Show Preview Report   -> .ai/PREVIEW_REPORT.md"
    Write-Host "3. Prepare Repair        -> file a new task describing the issue: teras-agent `"...`""
    Write-Host "4. Mark Preview Approved -> teras-agent -Approve"
    Write-Host "5. Exit"
    Write-Host ""

    Get-PullRequestPreview -State $State
}

function Invoke-Preview {
    $state = Get-TaskState
    if ($state.State -eq "NONE") {
        Write-Host ""
        Write-Host "No current task found."
        Write-Host ""
        return
    }

    if ($state.State -notin @("PUSHED", "PREVIEW_DEPLOYING", "PREVIEW_VERIFYING", "PREVIEW_BLOCKED")) {
        Write-Host ""
        Write-Host "PREVIEW BLOCKED"
        Write-Host ""
        Write-Host "Reason:"
        Write-Host "Task must be PUSHED first (current state: $($state.State))."
        Write-Host ""
        return
    }

    $state = Invoke-PreviewDeploy -State $state

    if ($state.State -eq "PREVIEW_BLOCKED") {
        $verification = [pscustomobject]@{ Status = "FAIL"; Notes = @("Deployment did not complete.") }
        $state.PreviewVerificationStatus = "FAIL"
        Save-TaskState -State $state
        Write-PreviewReport -State $state -Verification $verification
        Write-Host "PREVIEW_BLOCKED. No automatic Claude/Codex repair loop was started."
        Write-Host "See .ai/PREVIEW_REPORT.md, then file a new task to fix the specific issue if needed."
        Write-Host ""
        return
    }

    if ($state.PreviewStatus -eq "MANUAL_REQUIRED") {
        $verification = [pscustomobject]@{ Status = "NOT_STARTED"; Notes = @("Automated verification skipped - no preview URL available (Vercel CLI not detected, or the project is not linked).") }
        $state.PreviewVerificationStatus = "NOT_STARTED"
        Save-TaskState -State $state
        Write-PreviewReport -State $state -Verification $verification
        return
    }

    $state.State = "PREVIEW_VERIFYING"
    Save-TaskState -State $state

    $verification = Invoke-PreviewVerification -State $state
    $state.PreviewVerificationStatus = $verification.Status

    if ($verification.Status -eq "FAIL") {
        $state.PreviewBlockingIssues = @($verification.Notes)
        $state.PreviewStatus = "FAIL"
        $state.State = "PREVIEW_BLOCKED"
    } else {
        $state.PreviewStatus = "PASS"
        $state.State = "PREVIEW_READY"
        $certTrustHit = Test-AnyKeyword -Text $state.Description -Keywords $CertTrustKeywords
        $authHit = Test-AnyKeyword -Text $state.Description -Keywords @("auth")
        # Required only per section 13 - never auto-invoked. See .ai/USAGE_POLICY.md.
        $state.CodexPreviewReviewRequired = (($state.Risk -eq "HIGH" -or $state.Risk -eq "CRITICAL") -and ($certTrustHit -or $authHit -or $state.Category -like "Certificate*"))
    }
    Save-TaskState -State $state

    Write-PreviewReport -State $state -Verification $verification

    if ($state.State -eq "PREVIEW_BLOCKED") {
        Write-Host "PREVIEW_BLOCKED. No automatic Claude/Codex repair loop was started."
        Write-Host "See .ai/PREVIEW_REPORT.md, then file a new task to fix the specific issue if needed."
        Write-Host ""
        return
    }

    Show-PreviewGate -State $state
}

function Invoke-PreviewStatus {
    $state = Get-TaskState
    Write-Host ""
    Write-Host "========================================"
    Write-Host "TERAS PREVIEW STATUS"
    Write-Host "========================================"
    Write-Host ""
    if ($state.State -eq "NONE") {
        Write-Host "No current task."
        Write-Host ""
        return
    }
    Write-Host "Task ID: $($state.TaskId)"
    Write-Host "State: $($state.State)"
    Write-Host "Branch: $(if ($state.Branch) { $state.Branch } else { '(not pushed)' })"
    Write-Host "Preview Status: $($state.PreviewStatus)"
    Write-Host "Preview URL: $(if ($state.PreviewUrl) { $state.PreviewUrl } else { '(none)' })"
    Write-Host "Build Status: $($state.PreviewBuildStatus)"
    Write-Host "Verification Status: $($state.PreviewVerificationStatus)"
    Write-Host "Preview Approved: $(if ($state.PreviewApproved) { 'YES' } else { 'NO' })"
    Write-Host "Production Deployment Allowed: NO"
    Write-Host ""
}

function Invoke-VerifyPreview {
    $state = Get-TaskState
    if ([string]::IsNullOrWhiteSpace($state.PreviewUrl)) {
        Write-Host ""
        Write-Host "No preview URL recorded. Run -Preview first."
        Write-Host ""
        return
    }

    $state.State = "PREVIEW_VERIFYING"
    Save-TaskState -State $state

    $verification = Invoke-PreviewVerification -State $state
    $state.PreviewVerificationStatus = $verification.Status
    if ($verification.Status -eq "FAIL") {
        $state.PreviewBlockingIssues = @($verification.Notes)
        $state.PreviewStatus = "FAIL"
        $state.State = "PREVIEW_BLOCKED"
    } else {
        $state.PreviewStatus = "PASS"
        $state.State = "PREVIEW_READY"
    }
    Save-TaskState -State $state

    Write-PreviewReport -State $state -Verification $verification
    if ($state.State -ne "PREVIEW_BLOCKED") {
        Show-PreviewGate -State $state
    } else {
        Write-Host "PREVIEW_BLOCKED. See .ai/PREVIEW_REPORT.md."
        Write-Host ""
    }
}

function Invoke-ApprovePreview {
    param($State)

    if ($State.PreviewVerificationStatus -notin @("PASS", "PARTIAL")) {
        Write-Host ""
        Write-Host "APPROVAL BLOCKED"
        Write-Host ""
        Write-Host "Reason:"
        Write-Host "Preview verification is $($State.PreviewVerificationStatus), not PASS or PARTIAL."
        Write-Host ""
        return
    }

    $State.PreviewApproved = $true
    $State.PreviewApprovedAt = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $State.PreviewCommitSha = $State.CommitSha
    $State.PreviewDeploymentIdApproved = $State.PreviewDeploymentId
    $State.ProductionDeploymentAllowed = "NO"
    $State.State = "PREVIEW_APPROVED"
    Save-TaskState -State $State
    Save-ApprovalRecord -State $State -Decision "PREVIEW_APPROVED"

    Write-Host ""
    Write-Host "Preview APPROVED."
    Write-Host "This records human approval of the PREVIEW only."
    Write-Host "Production Deployment Allowed: NO (unchanged - production deployment is not implemented in this phase)."
    Write-Host ""
}

function Invoke-DryRunPreview {
    $state = Get-TaskState
    Write-Host ""
    Write-Host "DRY RUN PREVIEW - nothing will be executed."
    Write-Host ""
    Write-Host "Branch: $(if ($state.Branch) { $state.Branch } else { '(not pushed yet)' })"
    Write-Host "Commit: $(if ($state.CommitSha) { $state.CommitSha } else { '(none)' })"
    Write-Host ""
    if (Test-VercelAvailable) {
        Write-Host "Vercel CLI: detected"
        if (Test-VercelProjectLinked) {
            Write-Host "Project linked: yes (.vercel/ or vercel.json found)"
        } else {
            Write-Host "Project linked: NO - 'vercel link' would be required first"
        }
        Write-Host "Preview method: check for an existing Git-integration deployment for this branch first ('vercel ls'); if none found, run 'vercel' (never --prod) to trigger one."
    } else {
        Write-Host "Vercel CLI: NOT detected"
        Write-Host "Preview method: none available automatically - existing Vercel Git integration or a manual 'vercel' run is required. This script never installs the Vercel CLI."
    }
    Write-Host ""
    Write-Host "Verification plan (non-destructive):"
    Write-Host "- GET the preview URL, confirm it is reachable"
    Write-Host "- Confirm HTTP status is not >= 400 and the body has no obvious error-page signature"
    Write-Host "- Detect authentication redirects/401/403 and report PARTIAL rather than guessing credentials"
    Write-Host ""
}
