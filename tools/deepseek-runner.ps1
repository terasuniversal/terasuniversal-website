<#
    deepseek-runner.ps1 - DeepSeek handoff/detection and the
    ESCALATE_TO_CLAUDE handoff for the TERAS AI Engineering Orchestrator.
    Dot-sourced by teras-agent.ps1, which must set $RepoRoot, $AiDir before
    sourcing this file. Depends on Format-FileList (agent-router.ps1) and
    New-ClaudeHandoff (agent-runner.ps1) also being sourced first.

    Hard safety invariants enforced in this file, not just documented:
    - never installs a DeepSeek CLI or any other tool
    - never asks for, stores, or reads an API key from a repository file
    - DeepSeek is never launched for a task this orchestrator did not
      already classify as DeepSeek-eligible (see agent-router.ps1's
      Get-TaskClassification - blocked areas can never reach here)
    - escalation runs Claude exactly once per escalation, never a loop
#>

$script:DeepSeekEmptyReportMarker = "No DeepSeek implementation currently pending."

function Test-DeepSeekRunnerAvailable {
    if ($null -ne (Get-Command "deepseek" -ErrorAction SilentlyContinue)) { return $true }

    # Detect an existing, user-configured execution mechanism only - see
    # .ai/AGENT_CONFIG.example.json. This script never writes the real
    # (non-example) config file and never installs anything.
    $configPath = Join-Path $AiDir "AGENT_CONFIG.json"
    if (Test-Path $configPath) {
        try {
            $config = Get-Content -Path $configPath -Raw | ConvertFrom-Json
            if ($config.deepseek -and $config.deepseek.enabled -and $config.deepseek.command) {
                return ($null -ne (Get-Command $config.deepseek.command -ErrorAction SilentlyContinue))
            }
        } catch {
            return $false
        }
    }
    return $false
}

function Get-DeepSeekCommand {
    if ($null -ne (Get-Command "deepseek" -ErrorAction SilentlyContinue)) { return "deepseek" }
    $configPath = Join-Path $AiDir "AGENT_CONFIG.json"
    if (Test-Path $configPath) {
        try {
            $config = Get-Content -Path $configPath -Raw | ConvertFrom-Json
            if ($config.deepseek.command) { return $config.deepseek.command }
        } catch {}
    }
    return "deepseek"
}

function New-DeepSeekHandoff {
    param($State)

    $path = Join-Path $AiDir "DEEPSEEK_HANDOFF.md"
    $allowedText = if (@($State.AllowedFiles).Count -gt 0) { (@($State.AllowedFiles) | ForEach-Object { "- $_" }) -join "`n" } else { "- (not yet specified - confirm scope with the human before editing anything)" }
    $blockedText = if (@($State.BlockedFiles).Count -gt 0) { (@($State.BlockedFiles) | ForEach-Object { "- $_" }) -join "`n" } else { "- (none specified)" }

    $content = @"
# DEEPSEEK_HANDOFF.md

> Generated per task by ``tools/deepseek-runner.ps1``. This is the controlled context DeepSeek receives - not the full repository.

## ROLE

You are the Fast/Lightweight Implementer for this task, per ``.ai/AGENTS.md``. You were selected because this task matched DeepSeek's routine-work profile (CSS/spacing/responsive/small components/CRUD/search/filter/labels/copy/cleanup) with no security, database, or certificate-trust surface. You are bound by every rule in the repository's root ``CLAUDE.md``.

## TASK

Task ID: $($State.TaskId)
Description: $($State.Description)

## CATEGORY

$($State.Category)

## RISK

$($State.Risk)

## APPROVED SCOPE

Only the files listed under ALLOWED FILES below may be created or modified.

## ALLOWED FILES

$allowedText

## BLOCKED FILES

$blockedText

## EXPECTED RESULT

A small, bounded fix or addition that matches the task description exactly - no unrelated refactoring, no scope expansion.

## REQUIRED VERIFICATION

- Inspect the relevant file(s) before changing anything
- Implement the change within Approved Scope only
- Manually verify the specific behavior changed

## PROHIBITED ACTIONS

DO NOT:
- scan unrelated modules
- refactor outside scope
- modify database architecture
- modify RLS/auth
- modify certificate issuance or verification logic
- commit
- push
- deploy

If the fix would require touching any of the above, or the scope turns out to be larger than expected (more files/modules than anticipated, unclear root cause, an architecture change), STOP and set Escalation Required: YES in your report instead of continuing.

## REPORT FORMAT

Write your result to ``.ai/DEEPSEEK_IMPLEMENTATION_REPORT.md`` using the template already in that file: Task, Root Cause, Changes Made, Exact Files Changed, Verification Performed, Known Risks, Escalation Required (and Reason, if YES).
"@

    Set-Content -Path $path -Value $content -Encoding utf8
    return $path
}

function Invoke-DeepSeekImplementation {
    param([string]$HandoffPath, $State)

    # Phase 9A: prefer the controlled API adapter when DEEPSEEK_API_KEY is
    # configured. Falls through to the local CLI runner, then to manual
    # execution, exactly as Phase 6 already did.
    if (Test-DeepSeekApiKeyConfigured) {
        return (Invoke-DeepSeekApiImplementation -HandoffPath $HandoffPath -State $State)
    }

    if (-not (Test-DeepSeekRunnerAvailable)) {
        Write-Host ""
        Write-Host "DEEPSEEK API CONFIGURATION MISSING"
        Write-Host ""
        Write-Host "DEEPSEEK_HANDOFF.md has been generated."
        Write-Host "No fallback agent was automatically invoked."
        Write-Host ""
        Write-Host "Task routed to DeepSeek logically."
        Write-Host "Complete the task with DeepSeek yourself, then fill in .ai/DEEPSEEK_IMPLEMENTATION_REPORT.md"
        Write-Host "(including Escalation Required: YES/NO) and run 'teras-agent -Resume'."
        Write-Host ""
        return $false
    }

    Write-Host ""
    Write-Host "DeepSeek runner detected. Launching with the controlled handoff at:"
    Write-Host "  $HandoffPath"
    Write-Host ""

    $prompt = Get-Content -Path $HandoffPath -Raw
    $command = Get-DeepSeekCommand
    Push-Location $RepoRoot
    try {
        $prompt | & $command
        if ($LASTEXITCODE -ne 0) {
            Write-Host "DeepSeek runner exited with code $LASTEXITCODE. Review its output above before continuing."
            return $false
        }
        return $true
    } catch {
        Write-Host "DeepSeek runner invocation failed: $($_.Exception.Message)"
        Write-Host "DEEPSEEK_HANDOFF.md was generated - run the task manually with DeepSeek."
        return $false
    } finally {
        Pop-Location
    }
}

function Test-DeepSeekReportFilled {
    $path = Join-Path $AiDir "DEEPSEEK_IMPLEMENTATION_REPORT.md"
    if (-not (Test-Path $path)) { return $false }
    $content = Get-Content -Path $path -Raw
    return (-not ($content -match [regex]::Escape($script:DeepSeekEmptyReportMarker)))
}

function Get-DeepSeekEscalation {
    $path = Join-Path $AiDir "DEEPSEEK_IMPLEMENTATION_REPORT.md"
    if (-not (Test-DeepSeekReportFilled)) {
        return [pscustomobject]@{ Filled = $false; Required = $false; EscalationStatus = $null; Reason = $null; ProviderStatus = $null; HttpStatus = $null; ErrorCategory = $null; ProviderMessage = $null; ProviderParam = $null; SourceContext = $null; PatchApplication = $null; ScopeStatus = $null; ClaudeFallback = $null; OrchestratorReason = $null; ReportTaskId = $null; ReportSourceContextFingerprint = $null; IsAdapterAuthored = $false }
    }

    $content = Get-Content -Path $path -Raw
    # Real defect fix: "was this written by the automated adapter" must be
    # detected from a signal stable across every report-format version
    # this file has ever written, not from a field added partway through
    # this session (Provider Status). The header line has been present
    # since the very first API-adapter report (Phase 9A) - a real leftover
    # report from before the Provider Status field existed still matches
    # this, correctly identifying it as adapter-authored (and therefore
    # subject to attempt-binding staleness checks) rather than a manual fill.
    $isAdapterAuthored = [bool]($content -match "(?i)Written automatically by the DeepSeek API adapter")
    # "NOT RUN" is a valid value alongside YES/NO (Phase 9B: the API was
    # never reached because the source-context preflight failed) - only an
    # exact YES counts as Required=true.
    $escalationStatus = $null
    if ($content -match "(?m)^Escalation Required:\s*\r?\n?\s*(.+)$") {
        $escalationStatus = $Matches[1].Trim()
    }
    $required = ($content -match "(?m)^Escalation Required:\s*YES\b")
    $reason = $null
    if ($content -match "(?ms)^Reason:\s*\r?\n(.+?)(\r?\n\r?\n|\z)") {
        $reason = $Matches[1].Trim()
    }

    # Additive, backward-compatible: only present in reports written by the
    # API adapter (Write-DeepSeekReportFromApi) - a manually-filled report
    # from the local-CLI/manual path won't have these lines, and that's
    # fine, they were never conflated with Escalation Required/Reason there.
    $providerStatus = $null
    if ($content -match "(?m)^Provider Status:\s*\r?\n?\s*(.+)$") {
        $providerStatus = $Matches[1].Trim()
    }
    $sourceContext = $null
    if ($content -match "(?m)^Source Context:\s*\r?\n?\s*(.+)$") {
        $sourceContext = $Matches[1].Trim()
    }
    $patchApplication = $null
    if ($content -match "(?m)^Patch Application:\s*\r?\n?\s*(.+)$") {
        $patchApplication = $Matches[1].Trim()
    }
    $scopeStatus = $null
    if ($content -match "(?m)^Scope Status:\s*\r?\n?\s*(.+)$") {
        $scopeStatus = $Matches[1].Trim()
    }
    $httpStatus = $null
    if ($content -match "(?m)^HTTP Status:\s*\r?\n?\s*(.+)$") {
        $httpStatus = $Matches[1].Trim()
    }
    $errorCategory = $null
    if ($content -match "(?m)^Error Category:\s*\r?\n?\s*(.+)$") {
        $errorCategory = $Matches[1].Trim()
    }
    $providerMessage = $null
    if ($content -match "(?m)^Provider Message:\s*\r?\n?\s*(.+)$") {
        $providerMessage = $Matches[1].Trim()
    }
    $providerParam = $null
    if ($content -match "(?m)^Provider Parameter:\s*\r?\n?\s*(.+)$") {
        $providerParam = $Matches[1].Trim()
    }
    $claudeFallback = $null
    if ($content -match "(?m)^Claude Fallback:\s*\r?\n?\s*(.+)$") {
        $claudeFallback = $Matches[1].Trim()
    }
    $orchestratorReason = $null
    if ($content -match "(?ms)^Orchestrator Reason:\s*\r?\n(.+?)(\r?\n\r?\n|\z)") {
        $orchestratorReason = $Matches[1].Trim()
    }

    # Attempt-binding fields (real defect fix: a stale report was reused as
    # if it were the current attempt's outcome). Additive/backward-
    # compatible - absent on any report written before this fix, or on a
    # manually-filled report, which is exactly why staleness must be
    # inferred as "unknown/assume stale" rather than "assume current" when
    # these are missing (see Test-DeepSeekReportStale).
    $reportTaskId = $null
    if ($content -match "(?m)^Report Task ID:\s*\r?\n?\s*(.+)$") {
        $reportTaskId = $Matches[1].Trim()
    }
    $reportFingerprint = $null
    if ($content -match "(?m)^Source Context Fingerprint:\s*\r?\n?\s*(.+)$") {
        $reportFingerprint = $Matches[1].Trim()
    }

    return [pscustomobject]@{
        Filled = $true; Required = $required; EscalationStatus = $escalationStatus; Reason = $reason
        ProviderStatus = $providerStatus; HttpStatus = $httpStatus; ErrorCategory = $errorCategory
        ProviderMessage = $providerMessage; ProviderParam = $providerParam
        SourceContext = $sourceContext; PatchApplication = $patchApplication; ScopeStatus = $scopeStatus
        ClaudeFallback = $claudeFallback; OrchestratorReason = $orchestratorReason
        ReportTaskId = $reportTaskId; ReportSourceContextFingerprint = $reportFingerprint
        IsAdapterAuthored = $isAdapterAuthored
    }
}

# ---------------------------------------------------------------------------
# Real defect fix: attempt-binding + staleness detection. A DeepSeek
# escalation/report must be bound to the attempt that created it - at
# minimum Task ID and a fingerprint of what the adapter believed about the
# approved source files at attempt time. A live pilot reused an escalation
# ("the specified files do not exist") that was written before the literal
# dynamic-route source-loading fix, on a task whose files DO exist right
# now - the report was correctly bound to the same Task ID, but the WORLD
# had changed since it was written. Re-deriving the same fingerprint fresh
# and comparing is a precise, verifiable staleness signal that doesn't
# require tracking adapter code versions.
# ---------------------------------------------------------------------------

function Get-DeepSeekSourceContextFingerprint {
    param([string[]]$AllowedFiles)

    $parts = @()
    foreach ($f in (@($AllowedFiles) | Sort-Object)) {
        if ([string]::IsNullOrWhiteSpace($f)) { continue }
        $normalized = Get-NormalizedRepoRelativePath -Path $f
        $exists = Test-ExplicitPathExists -RelativePath $normalized
        $parts += "$normalized=$exists"
    }
    $joined = $parts -join "|"
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
        $hashBytes = $sha256.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($joined))
    } finally {
        $sha256.Dispose()
    }
    return ([System.BitConverter]::ToString($hashBytes).Replace("-", "").Substring(0, 16))
}

function Test-DeepSeekReportStale {
    param($State, $Escalation)

    if (-not $Escalation.Filled) { return $false }

    # Only API-adapter-authored reports (Write-DeepSeekReportFromApi, any
    # version) carry binding metadata at all - the static manual-fill
    # template has no such header. A manually-filled report represents a
    # human's direct, current decision (they just wrote it in response to
    # the current handoff) and is never treated as stale here; only
    # DeepSeek's own automated attempts need re-verifying.
    if (-not $Escalation.IsAdapterAuthored) { return $false }

    # An adapter-authored report missing its binding metadata (written
    # before this fix) cannot be verified as belonging to the current
    # attempt - treated as stale rather than silently trusted.
    if ([string]::IsNullOrWhiteSpace($Escalation.ReportTaskId) -or [string]::IsNullOrWhiteSpace($Escalation.ReportSourceContextFingerprint)) {
        return $true
    }

    if ($Escalation.ReportTaskId -ne $State.TaskId) { return $true }

    # The exact real bug: re-derive the same source-existence fingerprint
    # fresh and compare - if the adapter's belief about which approved
    # files exist has changed since the report was written (e.g. a
    # literal-path fix landed, or the files were added), the report's
    # findings no longer reflect reality.
    $currentFingerprint = Get-DeepSeekSourceContextFingerprint -AllowedFiles @($State.AllowedFiles)
    if ($Escalation.ReportSourceContextFingerprint -ne $currentFingerprint) { return $true }

    return $false
}

# ---------------------------------------------------------------------------
# Stable-operational-mode change: AGENT ESCALATION (DeepSeek itself decided
# the task is too complex/out of scope and asked for Claude) and PROVIDER/
# ADAPTER FAILURE (an API error, adapter bug, patch-writer rejection, local
# tooling error, timeout, or provider outage) must never be conflated - the
# first means the ENGINEERING TASK is complex; the second means DEEPSEEK
# ITSELF is unavailable and says nothing about the task. Only the first
# should be treated as an engineering-complexity signal; the second must
# always fall back to Claude FAST without inflating risk or waiting on a
# human to notice.
# ---------------------------------------------------------------------------

function Test-DeepSeekAgentEscalation {
    param($Escalation)
    return [bool]($Escalation.Filled -and $Escalation.Required -and $Escalation.EscalationStatus -eq "YES")
}

function Test-DeepSeekProviderOrAdapterFailure {
    param($Escalation)
    if (-not $Escalation.Filled) { return $false }
    if (Test-DeepSeekAgentEscalation -Escalation $Escalation) { return $false }
    return [bool]($Escalation.ProviderStatus -eq "FAILED" -or $Escalation.SourceContext -eq "FAIL" -or $Escalation.PatchApplication -eq "REJECTED")
}

function New-ClaudeEscalationHandoff {
    param($State, $Escalation, [string]$ReasonOverride = $null)

    $path = Join-Path $AiDir "CLAUDE_ESCALATION_HANDOFF.md"
    $deepseekReportPath = Join-Path $AiDir "DEEPSEEK_IMPLEMENTATION_REPORT.md"
    $deepseekContent = if (Test-Path $deepseekReportPath) { Get-Content -Path $deepseekReportPath -Raw } else { "(DEEPSEEK_IMPLEMENTATION_REPORT.md not found)" }
    $allowedText = if (@($State.AllowedFiles).Count -gt 0) { (@($State.AllowedFiles) | ForEach-Object { "- $_" }) -join "`n" } else { "- (not yet specified)" }
    # ReasonOverride is used for a PROVIDER_OR_ADAPTER-triggered fallback
    # (Invoke-DeepSeekImplementerFallback, teras-agent.ps1) - the agent's
    # own Reason field is correctly "N/A" there (this was never the agent's
    # decision), so the real, useful reason (provider error/adapter defect)
    # must be supplied explicitly instead of falling through to "not
    # specified."
    $reasonText = if ($ReasonOverride) { $ReasonOverride } elseif ($Escalation.Reason) { $Escalation.Reason } else { "(not specified in DEEPSEEK_IMPLEMENTATION_REPORT.md - re-read that file before proceeding)" }

    $content = @"
# CLAUDE_ESCALATION_HANDOFF.md

> Generated by ``tools/deepseek-runner.ps1`` when DeepSeek returns ESCALATE_TO_CLAUDE, or by ``tools/teras-agent.ps1``'s IMPLEMENTER_FALLBACK path when DeepSeek fails for a provider/adapter reason unrelated to the engineering task. Claude should not have to rediscover everything from scratch - read this before touching code.

## ORIGINAL TASK

Task ID: $($State.TaskId)
Description: $($State.Description)
Category: $($State.Category)

## DEEPSEEK FINDINGS (full report)

$deepseekContent

## REASON FOR ESCALATION

$reasonText

## APPROVED SCOPE

Allowed Files (as recorded in .ai/CURRENT_TASK.md - re-confirm with the human before expanding):
$allowedText

## NEXT STEPS FOR CLAUDE

Continue from where DeepSeek stopped rather than re-investigating from scratch. Do not silently expand scope beyond what the escalation reason justifies. If the root cause turns out to require touching a blocked area (RLS/auth/migration/schema/certificate issuance or verification), this task is now HIGH risk and requires Codex review before it can be approved - see the updated Risk/Reviewer fields in .ai/CURRENT_TASK.md. If this handoff was triggered by a PROVIDER_OR_ADAPTER failure (not an agent escalation), the task itself was never judged complex - proceed with the original Approved Scope as normal, routine work.
"@

    Set-Content -Path $path -Value $content -Encoding utf8
    return $path
}

# ===========================================================================
# Phase 9A - DeepSeek API Adapter
#
# Adds a controlled API execution path alongside the local-CLI/manual paths
# above. Invoke-DeepSeekImplementation (above) now prefers this path when
# DEEPSEEK_API_KEY is configured, falls back to the local CLI runner, and
# falls back to manual execution last - unchanged from Phase 6 in that case.
#
# Hard safety invariants enforced in this section, not just documented:
# - the API key is read from $env:DEEPSEEK_API_KEY only, on every call, and
#   is never written to a file, never logged, never returned from any
#   function here (not the value, not a prefix/suffix, not its length)
# - model output is NEVER executed as a command - no Invoke-Expression, no
#   piping model text to a shell, no dynamic & $modelOutput - only fixed
#   local file-write operations, each independently scope-validated first
# - a proposed patch is applied all-or-nothing: if any file in the response
#   fails path/scope validation, none of the files are written
# - supabase/migrations/**, .git/**, .env* are always rejected for a
#   DeepSeek-authored patch, regardless of the task's Allowed Files (DeepSeek
#   never owns database paths - see agent-router.ps1's blocked-area list)
# - one provider/network retry maximum (Get-DeepSeekApiConfig's MaxRetries)
# - -DeepSeekStatus never makes a live API call - it reports the last
#   -TestDeepSeek result, so checking status never itself costs a request
# ===========================================================================

# Phase 9B fix: "deepseek-chat" (the historical default) is no longer
# listed as a valid model on DeepSeek's own current API docs
# (api-docs.deepseek.com/api/create-chat-completion and
# .../quick_start/pricing both list only deepseek-v4-flash/deepseek-v4-pro
# as of this fix - verified live via two independent doc pages, not
# assumed). deepseek-v4-flash is the fast/lightweight tier, matching this
# orchestrator's existing DEEPSEEK_FAST logical alias exactly - only the
# underlying provider model string changes here, the logical alias and
# routing architecture are untouched and remain configurable via
# .ai/AGENT_CONFIG.json's deepseek.api.model.
$script:DeepSeekDefaultBaseUrl = "https://api.deepseek.com"
$script:DeepSeekDefaultModel = "deepseek-v4-flash"
$script:DeepSeekDefaultTimeoutSeconds = 60
$script:DeepSeekDefaultMaxRetries = 1
$script:DeepSeekDefaultMaxOutputChars = 20000
$script:DeepSeekStatusPath = Join-Path $AiDir "deepseek-status.json"
$script:DeepSeekUsageLogPath = Join-Path $AiDir "DEEPSEEK_USAGE_LOG.md"

function Get-DeepSeekApiConfig {
    # Non-secret settings only (base URL / model alias / timeout / retries /
    # max output size). Defaults apply whenever .ai/AGENT_CONFIG.json is
    # absent or doesn't define a deepseek.api block - never an error.
    $config = [ordered]@{
        BaseUrl        = $script:DeepSeekDefaultBaseUrl
        Model          = $script:DeepSeekDefaultModel
        TimeoutSeconds = $script:DeepSeekDefaultTimeoutSeconds
        MaxRetries     = $script:DeepSeekDefaultMaxRetries
        MaxOutputChars = $script:DeepSeekDefaultMaxOutputChars
    }

    $configPath = Join-Path $AiDir "AGENT_CONFIG.json"
    if (Test-Path $configPath) {
        try {
            $raw = Get-Content -Path $configPath -Raw -Encoding utf8 | ConvertFrom-Json
            if ($raw.deepseek -and $raw.deepseek.api) {
                $api = $raw.deepseek.api
                if ($api.baseUrl) { $config.BaseUrl = $api.baseUrl }
                if ($api.model) { $config.Model = $api.model }
                if ($api.timeoutSeconds) { $config.TimeoutSeconds = [int]$api.timeoutSeconds }
                if ($api.maxRetries) { $config.MaxRetries = [int]$api.maxRetries }
                if ($api.maxOutputChars) { $config.MaxOutputChars = [int]$api.maxOutputChars }
            }
        } catch {
            # Malformed config is treated as "not configured" - fall back to
            # defaults rather than failing the whole adapter.
        }
    }

    # Named exactly as the spec calls them (DEEPSEEK_MAX_RETRIES /
    # DEEPSEEK_TIMEOUT_SECONDS) so an operator can override without editing
    # AGENT_CONFIG.json. Neither is a secret; both are optional.
    if ($env:DEEPSEEK_TIMEOUT_SECONDS) { try { $config.TimeoutSeconds = [int]$env:DEEPSEEK_TIMEOUT_SECONDS } catch {} }
    if ($env:DEEPSEEK_MAX_RETRIES) { try { $config.MaxRetries = [int]$env:DEEPSEEK_MAX_RETRIES } catch {} }

    return [pscustomobject]$config
}

function Test-DeepSeekApiKeyConfigured {
    # Boolean only - see the hard invariants above. Never returns, prints,
    # or logs the key value, a prefix/suffix, or its length.
    $value = [System.Environment]::GetEnvironmentVariable("DEEPSEEK_API_KEY", "Process")
    if (-not $value) { $value = [System.Environment]::GetEnvironmentVariable("DEEPSEEK_API_KEY", "User") }
    if (-not $value) { $value = [System.Environment]::GetEnvironmentVariable("DEEPSEEK_API_KEY", "Machine") }
    return (-not [string]::IsNullOrWhiteSpace($value))
}

function Get-DeepSeekErrorCategory {
    param($StatusCode, [string]$ErrorText, [bool]$IsTimeout, [bool]$IsNetwork)

    # Real defect fixed here: an actual HTTP status code, when present,
    # ALWAYS takes priority over IsTimeout/IsNetwork. Those two flags must
    # only ever be true when NO HTTP response was received at all - see
    # Invoke-DeepSeekApiCall's catch block, which now forces both to $false
    # whenever a status code was successfully extracted. Windows PowerShell
    # 5.1's Invoke-RestMethod throws the SAME System.Net.WebException type
    # for a real HTTP 400/401/429/500 response as it does for a genuine
    # transport-level failure (DNS/connection refused) - a naive `$ex -is
    # [System.Net.WebException]` check alone previously misclassified every
    # HTTP error response (including a real 400 Bad Request) as NETWORK,
    # hiding the true provider-reported category and message.
    if ($null -ne $StatusCode) {
        if ($StatusCode -eq 400) { return "INVALID_REQUEST" }
        if ($StatusCode -eq 401 -or $StatusCode -eq 403) { return "AUTHENTICATION" }
        if ($StatusCode -eq 402) { return "USAGE_LIMIT" }
        if ($StatusCode -eq 422) { return "INVALID_PARAMETERS" }
        if ($StatusCode -eq 429) { return "RATE_LIMIT" }
        if ($ErrorText -match "(?i)quota|insufficient balance|billing|usage limit") { return "USAGE_LIMIT" }
        if ($StatusCode -ge 500) { return "PROVIDER_ERROR" }
        if ($StatusCode -ge 400) { return "PROVIDER_ERROR" }
    }
    if ($IsTimeout) { return "TIMEOUT" }
    if ($IsNetwork) { return "NETWORK" }
    if ($ErrorText -match "(?i)invalid|malformed|unexpected") { return "INVALID_RESPONSE" }
    return "UNKNOWN"
}

function Get-DeepSeekUsageStatusFromError {
    param([string]$ErrorCategory)
    # Never infer EXHAUSTED from a vague/temporary failure - only an
    # explicit USAGE_LIMIT signal earns that label; RATE_LIMIT is LIMITED
    # (temporary); everything else (TIMEOUT/NETWORK/etc.) stays UNKNOWN.
    if ($ErrorCategory -eq "USAGE_LIMIT") { return "EXHAUSTED" }
    if ($ErrorCategory -eq "RATE_LIMIT") { return "LIMITED" }
    return "UNKNOWN"
}

function Save-DeepSeekStatus {
    param([string]$Connectivity, [string]$UsageStatus, [string]$ErrorCategory)
    # Non-secret operational status only - never the API key, never a
    # request/response body. Safe to keep under .ai/ as a small record.
    $record = [ordered]@{
        LastTestedAt      = (Get-Date).ToString("o")
        LastConnectivity  = $Connectivity
        UsageStatus       = $UsageStatus
        LastErrorCategory = $ErrorCategory
    }
    ($record | ConvertTo-Json) | Set-Content -Path $script:DeepSeekStatusPath -Encoding utf8
}

function Get-DeepSeekStatusRecord {
    if (-not (Test-Path $script:DeepSeekStatusPath)) {
        return [pscustomobject]@{ LastTestedAt = $null; LastConnectivity = "UNKNOWN"; UsageStatus = "UNKNOWN"; LastErrorCategory = $null }
    }
    try {
        return (Get-Content -Path $script:DeepSeekStatusPath -Raw -Encoding utf8 | ConvertFrom-Json)
    } catch {
        return [pscustomobject]@{ LastTestedAt = $null; LastConnectivity = "UNKNOWN"; UsageStatus = "UNKNOWN"; LastErrorCategory = $null }
    }
}

function Write-DeepSeekUsageLog {
    param($State, [string]$Result, [int]$RetryCount = 0, [string]$ContextBudget = "SMALL", $ProviderUsage = $null)

    # Safe metadata only - Task ID/timestamp/model/risk/context budget/
    # result/retry count/provider-usage-if-returned. Never the key, never an
    # auth header, never a raw request or response body.
    $taskId = if ($State -and $State.TaskId) { $State.TaskId } else { "N/A" }
    $risk = if ($State -and $State.Risk) { $State.Risk } else { "N/A" }
    $usageText = if ($ProviderUsage) { $ProviderUsage } else { "not reported" }
    $line = "| $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') | $taskId | DEEPSEEK_FAST | $risk | $ContextBudget | $Result | $RetryCount | $usageText |"

    if (-not (Test-Path $script:DeepSeekUsageLogPath)) {
        $header = "# DEEPSEEK_USAGE_LOG.md`n`n> Appended by tools/deepseek-runner.ps1 after each DeepSeek API invocation. Never contains the API key, auth headers, or raw request/response bodies - only safe metadata.`n`n| Timestamp | Task ID | Model | Risk | Context Budget | Result | Retry Count | Provider Usage |`n|---|---|---|---|---|---|---|---|`n"
        Set-Content -Path $script:DeepSeekUsageLogPath -Value $header -Encoding utf8
    }
    Add-Content -Path $script:DeepSeekUsageLogPath -Value $line -Encoding utf8
}

# Safe, best-effort extraction of the provider's JSON error body from the
# HTTP RESPONSE stream only - this can never contain the Authorization
# header or API key (those belong to the REQUEST, never the response).
# DeepSeek's error shape is OpenAI-compatible: {"error": {"message": ...,
# "type": ..., "param": ..., "code": ...}}.
function Get-DeepSeekErrorResponseBody {
    param($Exception)
    try {
        if (-not $Exception.Response) { return $null }
        $stream = $Exception.Response.GetResponseStream()
        if (-not $stream) { return $null }
        $reader = New-Object System.IO.StreamReader($stream)
        $bodyText = $reader.ReadToEnd()
        $reader.Close()
        if ([string]::IsNullOrWhiteSpace($bodyText)) { return $null }
        try {
            $parsedBody = $bodyText | ConvertFrom-Json
            $msg = if ($parsedBody.error -and $parsedBody.error.message) { $parsedBody.error.message } elseif ($parsedBody.message) { $parsedBody.message } else { $null }
            $type = if ($parsedBody.error -and $parsedBody.error.type) { $parsedBody.error.type } else { $null }
            $param = if ($parsedBody.error -and $parsedBody.error.param) { $parsedBody.error.param } else { $null }
            return [pscustomobject]@{ Message = $msg; Type = $type; Param = $param }
        } catch {
            # Not JSON (e.g. an HTML error page from an intermediary proxy)
            # - surface a short, sanitized snippet only, never the full body.
            $snippet = if ($bodyText.Length -gt 300) { $bodyText.Substring(0, 300) + "...(truncated)" } else { $bodyText }
            return [pscustomobject]@{ Message = $snippet; Type = $null; Param = $null }
        }
    } catch {
        return $null
    }
}

# Local, pure validation of the request shape BEFORE any network call -
# section: LOCAL PAYLOAD VALIDATION. Also the single place the actual
# request JSON is built, so -TestDeepSeek and the real implementation path
# share exactly the same request-construction logic (never two divergent
# body-building code paths that could pass/fail independently).
function Test-DeepSeekRequestPayloadValid {
    param([string]$SystemPrompt, [string]$UserPrompt, $Config)

    $validationErrors = @()
    if ([string]::IsNullOrWhiteSpace($Config.Model)) { $validationErrors += "model is empty" }
    if ([string]::IsNullOrWhiteSpace($SystemPrompt)) { $validationErrors += "system message content is empty" }
    if ([string]::IsNullOrWhiteSpace($UserPrompt)) { $validationErrors += "user message content is empty" }

    # Deliberately minimal - no response_format/tools/tool_choice/
    # max_tokens/temperature fields. The TERAS adapter does not need
    # provider-side tool calling or JSON mode to apply patches (its own
    # prompt-level STATUS/SUMMARY/FILES delimited format is sufficient and
    # provider-agnostic) - every optional field left out is one fewer way
    # to trigger a 400 from an unsupported/incompatible combination.
    #
    # thinking is the one exception, and it is REQUIRED, not optional:
    # deepseek-v4-flash has thinking/reasoning mode enabled by default
    # (verified via DeepSeek's own docs) - the final answer only lands in
    # choices[0].message.content once thinking is done, and with no
    # max_tokens cap the reasoning phase can consume the whole response,
    # leaving content empty (reproduced live: HTTP 200, empty content).
    # DEEPSEEK_FAST is the routine/lightweight implementer tier and never
    # needs reasoning overhead for STATUS/SUMMARY/FILES-format output -
    # explicitly disabling it is the correct, minimal, verified fix.
    $bodyObject = [ordered]@{
        model    = $Config.Model
        messages = @(
            @{ role = "system"; content = $SystemPrompt }
            @{ role = "user"; content = $UserPrompt }
        )
        stream   = $false
        thinking = @{ type = "disabled" }
    }

    $json = $null
    try {
        $json = $bodyObject | ConvertTo-Json -Depth 6
    } catch {
        $validationErrors += "JSON serialization failed: $($_.Exception.Message)"
    }

    return [pscustomobject]@{ Valid = ($validationErrors.Count -eq 0); Errors = $validationErrors; Json = $json }
}

# Safe request-shape diagnostic - METADATA only (endpoint/model/message
# count/char counts/stream flag/which optional fields were sent). Never
# includes source content, the Authorization header, or the API key.
function Get-DeepSeekRequestShapeDiagnostic {
    param([string]$SystemPrompt, [string]$UserPrompt, $Config)

    return [pscustomobject]@{
        Endpoint           = "$($Config.BaseUrl.TrimEnd('/'))/chat/completions"
        Model              = $Config.Model
        MessageCount       = 2
        SystemMessageChars = $SystemPrompt.Length
        UserMessageChars   = $UserPrompt.Length
        Stream             = $false
        OptionalFieldsSent = @("thinking: disabled")
    }
}

function Show-DeepSeekRequestShapeDiagnostic {
    param($Diagnostic)
    Write-Host "Endpoint:"
    Write-Host $Diagnostic.Endpoint
    Write-Host ""
    Write-Host "Model:"
    Write-Host $Diagnostic.Model
    Write-Host ""
    Write-Host "Messages:"
    Write-Host $Diagnostic.MessageCount
    Write-Host ""
    Write-Host "System message chars:"
    Write-Host $Diagnostic.SystemMessageChars
    Write-Host ""
    Write-Host "User message chars:"
    Write-Host $Diagnostic.UserMessageChars
    Write-Host ""
    Write-Host "Stream:"
    Write-Host $(if ($Diagnostic.Stream) { "true" } else { "false" })
    Write-Host ""
    Write-Host "Optional fields:"
    Write-Host $(if (@($Diagnostic.OptionalFieldsSent).Count -gt 0) { $Diagnostic.OptionalFieldsSent -join ", " } else { "(none)" })
    Write-Host ""
}

function Invoke-DeepSeekApiCall {
    param([string]$SystemPrompt, [string]$UserPrompt)

    # Returns Success/Content/ErrorCategory/ErrorMessage/HttpStatus/
    # ProviderMessage/ProviderType/ProviderParam only - never the request
    # headers, the key, or a raw HttpWebResponse/exception object.
    if (-not (Test-DeepSeekApiKeyConfigured)) {
        return [pscustomobject]@{ Success = $false; Content = $null; ErrorCategory = "AUTHENTICATION"; ErrorMessage = "DEEPSEEK_API_KEY not configured"; HttpStatus = $null; ProviderMessage = $null; ProviderType = $null; ProviderParam = $null }
    }

    $config = Get-DeepSeekApiConfig

    # Local payload validation BEFORE any network call (section: LOCAL
    # PAYLOAD VALIDATION / USAGE PROTECTION) - a locally-detectable defect
    # never spends a live request.
    $validation = Test-DeepSeekRequestPayloadValid -SystemPrompt $SystemPrompt -UserPrompt $UserPrompt -Config $config
    if (-not $validation.Valid) {
        return [pscustomobject]@{ Success = $false; Content = $null; ErrorCategory = "INVALID_REQUEST"; ErrorMessage = "Local payload validation failed: $($validation.Errors -join '; ')"; HttpStatus = $null; ProviderMessage = $null; ProviderType = $null; ProviderParam = $null }
    }

    $apiKey = [System.Environment]::GetEnvironmentVariable("DEEPSEEK_API_KEY", "Process")
    if (-not $apiKey) { $apiKey = [System.Environment]::GetEnvironmentVariable("DEEPSEEK_API_KEY", "User") }
    if (-not $apiKey) { $apiKey = [System.Environment]::GetEnvironmentVariable("DEEPSEEK_API_KEY", "Machine") }

    $uri = "$($config.BaseUrl.TrimEnd('/'))/chat/completions"
    $bodyJson = $validation.Json
    # Real defect fixed here: Windows PowerShell 5.1's Invoke-RestMethod
    # encodes a [string] -Body using [System.Text.Encoding]::Default (the
    # system ANSI codepage, e.g. Windows-1252 - confirmed in this
    # environment), NOT UTF-8, unless given raw bytes. Any non-ASCII byte
    # in the payload corrupts on the way out before the request even
    # leaves the machine, and DeepSeek's JSON parser then rejects the
    # malformed body as a 400 Bad Request. Real approved source files in
    # this repo contain an em-dash and an emoji, which is why the tiny
    # pure-ASCII -TestDeepSeek prompt passed while every real
    # implementation request (embedding actual source content) failed -
    # both now go through this same UTF8-byte-safe path.
    $bodyBytes = [System.Text.Encoding]::UTF8.GetBytes($bodyJson)
    $headers = @{ Authorization = "Bearer $apiKey" }

    $maxAttempts = [Math]::Max(1, $config.MaxRetries + 1)
    $attempt = 0
    $lastError = $null

    while ($attempt -lt $maxAttempts) {
        $attempt++
        try {
            $response = Invoke-RestMethod -Uri $uri -Method Post -Headers $headers -Body $bodyBytes -ContentType "application/json; charset=utf-8" -TimeoutSec $config.TimeoutSeconds
            $apiKey = $null
            $text = $response.choices[0].message.content
            if ([string]::IsNullOrWhiteSpace($text)) {
                # Defense-in-depth fallback: thinking is explicitly disabled
                # above, but if a future model/provider revision doesn't
                # honor that and still routes the answer through
                # reasoning_content instead of content, use it rather than
                # failing outright.
                $reasoningText = $response.choices[0].message.reasoning_content
                if (-not [string]::IsNullOrWhiteSpace($reasoningText)) {
                    $text = $reasoningText
                } else {
                    return [pscustomobject]@{ Success = $false; Content = $null; ErrorCategory = "INVALID_RESPONSE"; ErrorMessage = "Empty response body from provider (content and reasoning_content both empty)"; HttpStatus = 200; ProviderMessage = $null; ProviderType = $null; ProviderParam = $null }
                }
            }
            if ($text.Length -gt $config.MaxOutputChars) { $text = $text.Substring(0, $config.MaxOutputChars) }
            return [pscustomobject]@{ Success = $true; Content = $text; ErrorCategory = $null; ErrorMessage = $null; HttpStatus = 200; ProviderMessage = $null; ProviderType = $null; ProviderParam = $null }
        } catch {
            $apiKey = $null
            $ex = $_.Exception
            $statusCode = $null
            if ($ex.Response -and $ex.Response.StatusCode) {
                try { $statusCode = [int]$ex.Response.StatusCode } catch {}
            }
            # IsTimeout/IsNetwork must only ever be true when NO HTTP status
            # code was received at all - see Get-DeepSeekErrorCategory's
            # comment for why this matters.
            $hasHttpResponse = ($null -ne $statusCode)
            $isTimeout = (-not $hasHttpResponse) -and (($ex -is [System.Threading.Tasks.TaskCanceledException]) -or ($ex.Message -match "(?i)timed out|timeout"))
            $isNetwork = (-not $hasHttpResponse) -and (($ex -is [System.Net.WebException]) -or ($ex.Message -match "(?i)could not be resolved|no such host|connection"))
            $category = Get-DeepSeekErrorCategory -StatusCode $statusCode -ErrorText $ex.Message -IsTimeout $isTimeout -IsNetwork $isNetwork
            $providerBody = Get-DeepSeekErrorResponseBody -Exception $ex
            $lastError = [pscustomobject]@{
                Success = $false; Content = $null; ErrorCategory = $category; ErrorMessage = $ex.Message
                HttpStatus = $statusCode
                ProviderMessage = if ($providerBody) { $providerBody.Message } else { $null }
                ProviderType = if ($providerBody) { $providerBody.Type } else { $null }
                ProviderParam = if ($providerBody) { $providerBody.Param } else { $null }
            }

            # Only retry a genuinely transient failure - never an auth
            # failure, a malformed/invalid request, a usage-limit signal, or
            # a rate limit (retrying an unchanged bad request only ever
            # reproduces the same failure and burns usage for nothing).
            if ($category -notin @("TIMEOUT", "NETWORK", "PROVIDER_ERROR")) { break }
            if ($attempt -ge $maxAttempts) { break }
        }
    }
    return $lastError
}

function Invoke-DeepSeekConnectivityTest {
    # -TestDeepSeek: minimal, deterministic, no repo content, no business
    # data, never modifies a file, never invokes Claude or Codex.
    Write-Host ""
    Write-Host "Testing DeepSeek API connectivity..."
    Write-Host ""

    $result = Invoke-DeepSeekApiCall -SystemPrompt "You are a connectivity test endpoint. Respond with exactly the requested text and nothing else." -UserPrompt "Return exactly: TERAS_DEEPSEEK_OK"
    $responsePass = $result.Success -and ($result.Content.Trim() -eq "TERAS_DEEPSEEK_OK")
    $available = $result.Success -and $responsePass
    $authPass = ($result.ErrorCategory -ne "AUTHENTICATION")

    Write-Host "DeepSeek API:"
    Write-Host $(if ($available) { "AVAILABLE" } else { "UNAVAILABLE" })
    Write-Host ""
    Write-Host "Authentication:"
    Write-Host $(if ($authPass) { "PASS" } else { "FAIL" })
    Write-Host ""
    Write-Host "Response Validation:"
    Write-Host $(if ($responsePass) { "PASS" } else { "FAIL" })
    Write-Host ""
    Write-Host "Repository Changes:"
    Write-Host "NONE"
    Write-Host ""

    if (-not $result.Success) {
        Write-Host "HTTP status: $(if ($result.HttpStatus) { $result.HttpStatus } else { 'N/A' })"
        Write-Host "Error category: $($result.ErrorCategory)"
        Write-Host "Error detail: $($result.ErrorMessage)"
        if ($result.ProviderMessage) { Write-Host "Provider message: $($result.ProviderMessage)" }
        Write-Host ""
        if (-not (Test-DeepSeekApiKeyConfigured)) {
            Write-Host "(DEEPSEEK_API_KEY is not configured in this environment.)"
            Write-Host ""
        }
    }

    $usageStatus = if ($result.Success) { "NORMAL" } else { Get-DeepSeekUsageStatusFromError -ErrorCategory $result.ErrorCategory }
    Save-DeepSeekStatus -Connectivity $(if ($available) { "PASS" } else { "FAIL" }) -UsageStatus $usageStatus -ErrorCategory $result.ErrorCategory
}

function Invoke-DeepSeekStatus {
    # -DeepSeekStatus never makes a live call - it reports configuration
    # state plus the last -TestDeepSeek result, so a status check never
    # itself costs an API request.
    $keyConfigured = Test-DeepSeekApiKeyConfigured
    $record = Get-DeepSeekStatusRecord

    Write-Host ""
    Write-Host "========================================"
    Write-Host "TERAS DEEPSEEK STATUS"
    Write-Host "========================================"
    Write-Host ""
    Write-Host "Provider:"
    Write-Host "API"
    Write-Host ""
    Write-Host "Configuration:"
    Write-Host $(if ($keyConfigured) { "READY" } else { "NOT READY" })
    Write-Host ""
    Write-Host "API Key:"
    Write-Host $(if ($keyConfigured) { "CONFIGURED" } else { "NOT CONFIGURED" })
    Write-Host ""
    Write-Host "Connectivity:"
    Write-Host $(if ($keyConfigured) { $record.LastConnectivity } else { "UNKNOWN" })
    Write-Host ""
    Write-Host "Logical Model:"
    Write-Host "DEEPSEEK_FAST"
    Write-Host ""
    Write-Host "Usage Status:"
    Write-Host $(if ($keyConfigured) { $record.UsageStatus } else { "UNKNOWN" })
    Write-Host ""
    Write-Host "Repository Access:"
    Write-Host "CONTROLLED"
    Write-Host ""
    Write-Host "Auto Fallback:"
    Write-Host "OFF"
    Write-Host ""

    if (-not $keyConfigured) {
        Write-Host "(DEEPSEEK_API_KEY is not set in this environment. Configure it, then run 'teras-agent -TestDeepSeek'.)"
        Write-Host ""
    } elseif ($record.LastConnectivity -eq "UNKNOWN") {
        Write-Host "(Connectivity not yet tested - run 'teras-agent -TestDeepSeek'.)"
        Write-Host ""
    }
}

function New-DeepSeekApiSystemPrompt {
    param($State)
    # Reuses New-DeepSeekHandoff's file (ROLE/TASK/SCOPE/PROHIBITED ACTIONS)
    # as the system-level context, plus the strict response-format
    # instructions ConvertFrom-DeepSeekApiResponse depends on below.
    $handoffPath = Join-Path $AiDir "DEEPSEEK_HANDOFF.md"
    $handoffContent = if (Test-Path $handoffPath) { Get-Content -Path $handoffPath -Raw -Encoding utf8 } else { "" }

    return @"
$handoffContent

## EXPECTED RESPONSE FORMAT

Respond using EXACTLY this structure, with no extra commentary before or after it:

STATUS: SUCCESS or ESCALATE or ERROR
SUMMARY: <one paragraph, plain text, single line>
ESCALATION_REQUIRED: YES or NO
ESCALATION_REASON: <text, or NONE>
FILES_CHANGED: <comma-separated relative paths, or NONE>

For each changed file, add a block like this (repeat as needed):
---BEGIN PATCH relative/path/to/file---
<the full new content of the file>
---END PATCH---

If STATUS is ESCALATE, do not include any PATCH blocks - findings only.
Only patch files listed under ALLOWED FILES above. Never propose a shell/SQL/PowerShell command to run - only file content.
"@
}

# Phase 9B fix (real defect): a real pilot's approved dynamic-route files
# ([scheduleId]) were reported as "does not exist" purely because the
# original version of this function used non-literal Test-Path/Get-Content
# -Path - PowerShell parses "[scheduleId]" as a wildcard character class
# there, not literal text, so it looked for a single-character path segment
# and never found the real directory. DeepSeek then received a system
# prompt telling it the approved files don't exist, and correctly (but
# uselessly) escalated - the provider never had real source to work from.
# Every existence/read check below uses -LiteralPath specifically to fix
# this; see also Test-ExplicitPathExists (agent-router.ps1), which already
# used -LiteralPath and is why scope population itself was already correct.
function Get-DeepSeekSourceLoadResult {
    param([string[]]$AllowedFiles, [string]$ScopeSource = "MANUAL")

    $maxCharsPerFile = 8000
    $blocks = @()
    $failedPaths = @()
    $anyRealPath = $false

    foreach ($rel in @($AllowedFiles)) {
        if ([string]::IsNullOrWhiteSpace($rel)) { continue }
        $anyRealPath = $true
        $normalizedRel = Get-NormalizedRepoRelativePath -Path $rel
        $full = Join-Path $RepoRoot $normalizedRel
        $exists = Test-Path -LiteralPath $full -PathType Leaf

        if ($exists) {
            try {
                $content = Get-Content -LiteralPath $full -Raw -Encoding utf8
                if ($content.Length -gt $maxCharsPerFile) { $content = $content.Substring(0, $maxCharsPerFile) + "`n...(truncated)" }
                $blocks += "----- FILE: $rel -----`n$content"
            } catch {
                # Exists but could not be read (permissions/lock/etc.) - an
                # unexpected orchestrator-side failure regardless of scope
                # source; a file we can literally see but cannot open is
                # never a legitimate "new file" case.
                $failedPaths += $rel
            }
        } elseif ($ScopeSource -eq "EXPLICIT_TASK_PATHS") {
            # This exact path was already confirmed to exist, literally, at
            # task-creation time (Test-ExplicitPathExists in
            # agent-router.ps1's New-TaskState). Failing to read it now is a
            # regression or race condition, not a legitimate new-file case -
            # abort rather than silently telling DeepSeek the file is new.
            $failedPaths += $rel
        } else {
            # Manually-scoped tasks may legitimately name a new file that
            # doesn't exist yet - unchanged, benign behavior from Phase 9A.
            $blocks += "----- FILE: $rel ----- (does not exist yet - this would be a new file)"
        }
    }

    if (-not $anyRealPath) {
        return [pscustomobject]@{ Success = $true; ContentText = "(no approved source files attached - task scope did not name a specific file)"; FailedPaths = @() }
    }
    if ($failedPaths.Count -gt 0) {
        return [pscustomobject]@{ Success = $false; ContentText = $null; FailedPaths = $failedPaths }
    }
    return [pscustomobject]@{ Success = $true; ContentText = ($blocks -join "`n`n"); FailedPaths = @() }
}

function ConvertFrom-DeepSeekApiResponse {
    param([string]$Text)

    $status = if ($Text -match "(?im)^STATUS:\s*(\S+)") { $Matches[1].ToUpper() } else { "ERROR" }
    $summary = if ($Text -match "(?im)^SUMMARY:\s*(.+)$") { $Matches[1].Trim() } else { "" }
    $escalationRequired = [bool]($Text -match "(?im)^ESCALATION_REQUIRED:\s*YES\b")
    $escalationReason = if ($Text -match "(?im)^ESCALATION_REASON:\s*(.+)$") { $Matches[1].Trim() } else { "" }
    if ($escalationReason -eq "NONE") { $escalationReason = "" }

    $files = @()
    $patchMatches = [regex]::Matches($Text, "(?ms)^---BEGIN PATCH (.+?)---\r?\n(.*?)\r?\n---END PATCH---")
    foreach ($m in $patchMatches) {
        $files += [pscustomobject]@{ Path = $m.Groups[1].Value.Trim(); Content = $m.Groups[2].Value }
    }

    return [pscustomobject]@{
        Status = $status; Summary = $summary
        EscalationRequired = $escalationRequired; EscalationReason = $escalationReason
        Files = $files
    }
}

function Test-DeepSeekPatchPathAllowed {
    param([string]$Path, [string[]]$AllowedFiles)

    if ([string]::IsNullOrWhiteSpace($Path)) { return $false }
    $normalized = Get-NormalizedRepoRelativePath -Path $Path

    if ($normalized -match "\.\./") { return $false }
    if ($normalized -match "^[A-Za-z]:") { return $false }
    if ($normalized.StartsWith("/")) { return $false }
    if ($normalized -match "(^|/)\.git/") { return $false }
    if ($normalized -match "(^|/)\.env") { return $false }
    if ($normalized -match "^supabase/migrations/") { return $false }

    # Literal/ordinal/case-insensitive equality only (Test-RepoRelativePathsEqual,
    # agent-router.ps1) - never -like/-contains-as-wildcard. A dynamic route
    # segment like [scheduleId] must compare as literal text: a proposed
    # .../123/print/page.tsx must never satisfy an allowed
    # .../[scheduleId]/print/page.tsx entry, or vice versa.
    foreach ($allowed in @($AllowedFiles)) {
        if (Test-RepoRelativePathsEqual -A $normalized -B $allowed) { return $true }
    }
    return $false
}

function Invoke-DeepSeekApplyPatch {
    param($ParsedResponse, $State)

    # All-or-nothing: validate every proposed file before writing any of
    # them. Never partially apply, never guess an unmatched path.
    $allowed = @($State.AllowedFiles)
    $applied = @()
    $rejected = @()

    foreach ($f in @($ParsedResponse.Files)) {
        if (Test-DeepSeekPatchPathAllowed -Path $f.Path -AllowedFiles $allowed) {
            $applied += $f
        } else {
            $rejected += $f.Path
        }
    }

    if ($rejected.Count -gt 0) {
        Write-Host ""
        Write-Host "DEEPSEEK PATCH REJECTED"
        Write-Host ""
        Write-Host "The following proposed file(s) are outside the approved scope and nothing was written:"
        foreach ($r in $rejected) { Write-Host "  - $r" }
        Write-Host ""
        return [pscustomobject]@{ Applied = @(); Rejected = $rejected; AnyRejected = $true }
    }

    foreach ($f in $applied) {
        $full = Join-Path $RepoRoot $f.Path
        $dir = Split-Path -Parent $full
        if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
        Set-Content -Path $full -Value $f.Content -Encoding utf8 -NoNewline
    }

    return [pscustomobject]@{ Applied = @($applied | ForEach-Object { $_.Path }); Rejected = @(); AnyRejected = $false }
}

function Write-DeepSeekReportFromApi {
    param(
        $State, $Parsed, [string[]]$Applied, [string[]]$Rejected,
        [string]$ProviderStatus = "CALLED",
        [string]$SourceContextStatus = "OK",
        [string[]]$SourceContextFailedPaths = @(),
        [string]$AgentEscalationOverride = $null,
        [string]$HttpStatusValue = $null,
        [string]$ProviderErrorCategory = $null,
        [string]$ProviderMessageValue = $null,
        [string]$ProviderParamValue = $null,
        [string]$ClaudeFallback = "NOT RUN"
    )

    # Phase 9B fix: distinct facts, never conflated into one another - Agent
    # Escalation (DeepSeek's own decision - "Escalation Required:" is kept
    # as the existing field label Get-DeepSeekEscalation/-Resume and the
    # manual-fill template already parse; NOT RUN is a new, additional
    # value alongside the existing YES/NO, not a rename), Provider Status
    # (CALLED/FAILED/NOT CALLED), HTTP Status/Error Category/Provider
    # Message (the real provider-reported failure detail, never masked as
    # NETWORK), Source Context (did every approved file load literally
    # before any request was sent), Patch Application (was a file actually
    # written), Scope Status (did proposed changes pass scope validation),
    # and Claude Fallback (explicitly NOT RUN for an adapter/request-format
    # defect - see Invoke-DeepSeekApiImplementation's ADAPTER_ATTENTION_
    # REQUIRED path). None of these may ever be presented as DeepSeek's own
    # Reason.
    $path = Join-Path $AiDir "DEEPSEEK_IMPLEMENTATION_REPORT.md"
    $escalationLine = if ($AgentEscalationOverride) { $AgentEscalationOverride } elseif ($Parsed.Status -eq "ESCALATE" -or $Parsed.EscalationRequired) { "YES" } else { "NO" }
    $reasonText = if ($Parsed.EscalationReason) { $Parsed.EscalationReason } else { "N/A" }
    $filesText = if ($Applied.Count -gt 0) { ($Applied | ForEach-Object { "- $_" }) -join "`n" } else { "- (none)" }
    $providerFailed = ($ProviderStatus -eq "FAILED")
    $patchApplicationStatus = if ($SourceContextStatus -eq "FAIL" -or $providerFailed) { "NOT ATTEMPTED" } elseif ($Rejected.Count -gt 0) { "REJECTED" } elseif ($Applied.Count -gt 0) { "APPLIED" } else { "NONE" }
    $scopeStatus = if ($SourceContextStatus -eq "FAIL" -or $providerFailed) { "N/A" } elseif ($Rejected.Count -gt 0) { "FAIL" } elseif ($Applied.Count -gt 0) { "PASS" } else { "N/A" }
    $orchestratorReasonText = if ($SourceContextStatus -eq "FAIL") {
        "SOURCE_CONTEXT_ERROR - approved file(s) could not be read literally before any API call: $($SourceContextFailedPaths -join ', ')"
    } elseif ($providerFailed -and $ProviderErrorCategory -in @("INVALID_REQUEST", "INVALID_PARAMETERS")) {
        "ADAPTER_ATTENTION_REQUIRED - $ProviderErrorCategory$(if ($ProviderMessageValue) { ": $ProviderMessageValue" })"
    } elseif ($providerFailed) {
        "PROVIDER_FAILURE - $ProviderErrorCategory$(if ($ProviderMessageValue) { ": $ProviderMessageValue" })"
    } elseif ($Rejected.Count -gt 0) {
        "SCOPE_VALIDATION_FAILURE - proposed file(s) outside approved scope: $($Rejected -join ', ')"
    } else {
        "N/A"
    }

    # Attempt-binding fields (real defect fix): every report this function
    # writes is stamped with the exact Task ID and a fingerprint of which
    # approved files existed at attempt time, so a future -Resume can tell
    # whether this report still reflects reality before trusting it - see
    # Test-DeepSeekReportStale.
    $sourceContextFingerprint = Get-DeepSeekSourceContextFingerprint -AllowedFiles @($State.AllowedFiles)

    $content = @"
# DEEPSEEK_IMPLEMENTATION_REPORT.md

> Written automatically by the DeepSeek API adapter (tools/deepseek-runner.ps1). Get-DeepSeekEscalation parses the Escalation Required line below - keep it exactly YES, NO, or NOT RUN. Escalation Required/Reason are the agent's own decision (NOT RUN means the API was never reached, or failed before it could decide anything); every other field below is the orchestrator's own, separate fact - never merge any of these into each other or into DeepSeek's own Reason.

Task:
$($State.Description)

Root Cause:
N/A (see Summary)

Changes Made:
$($Parsed.Summary)

Exact Files Changed:
$filesText

Verification Performed:
Patch(es) validated against the task's Approved Scope before being written. No automated build/test run by DeepSeek itself - QA runs separately in the orchestrator pipeline.

Known Risks:
Response was produced by an external API and was not human-reviewed before being written to disk; scope-restricted to Approved Files only.

Escalation Required:
$escalationLine

Reason:
$reasonText

Provider Status:
$ProviderStatus

HTTP Status:
$(if ($HttpStatusValue) { $HttpStatusValue } else { "N/A" })

Error Category:
$(if ($ProviderErrorCategory) { $ProviderErrorCategory } else { "N/A" })

Provider Message:
$(if ($ProviderMessageValue) { $ProviderMessageValue } else { "N/A" })

Provider Parameter:
$(if ($ProviderParamValue) { $ProviderParamValue } else { "N/A" })

Source Context:
$SourceContextStatus

Patch Application:
$patchApplicationStatus

Scope Status:
$scopeStatus

Claude Fallback:
$ClaudeFallback

Orchestrator Reason:
$orchestratorReasonText

Report Task ID:
$($State.TaskId)

Source Context Fingerprint:
$sourceContextFingerprint
"@

    Set-Content -Path $path -Value $content -Encoding utf8
    return $path
}

function Invoke-DeepSeekApiImplementation {
    param([string]$HandoffPath, $State)

    Write-Host ""
    Write-Host "DeepSeek API configured. Checking approved source files before sending any request..."
    Write-Host ""

    # Usage-protection preflight (Phase 9B fix): every approved file must
    # load literally BEFORE a single DeepSeek API call is made. This is the
    # actual fix for the real defect - the old code sent a request that told
    # DeepSeek its approved [scheduleId] files "don't exist" (a non-literal
    # Test-Path/Get-Content false negative), and DeepSeek correctly, but
    # uselessly, escalated on bad information. A source-read failure is
    # always caught here, before any network call, and is reported as an
    # orchestrator-side SOURCE_CONTEXT_ERROR - never as an agent escalation,
    # since the provider never received enough context to decide anything.
    $sourceLoad = Get-DeepSeekSourceLoadResult -AllowedFiles @($State.AllowedFiles) -ScopeSource $State.ScopeSource
    if (-not $sourceLoad.Success) {
        Write-Host "SOURCE_CONTEXT_ERROR"
        Write-Host ""
        Write-Host "The following approved file(s) could not be read literally, even though scope validation approved them:"
        foreach ($p in $sourceLoad.FailedPaths) { Write-Host "  - $p" }
        Write-Host ""
        Write-Host "DeepSeek API Calls: 0 - the request was never sent."
        Write-Host ""
        $syntheticParsed = [pscustomobject]@{ Status = "ERROR"; Summary = "Preflight source-context check failed for: $($sourceLoad.FailedPaths -join ', '). DeepSeek API was not called."; EscalationRequired = $false; EscalationReason = "" }
        Write-DeepSeekReportFromApi -State $State -Parsed $syntheticParsed -Applied @() -Rejected @() -ProviderStatus "NOT CALLED" -SourceContextStatus "FAIL" -SourceContextFailedPaths $sourceLoad.FailedPaths -AgentEscalationOverride "NOT RUN" | Out-Null
        Write-DeepSeekUsageLog -State $State -Result "SOURCE_CONTEXT_ERROR"
        return $false
    }

    Write-Host "Source context OK. Sending controlled request (context: handoff + approved files only)..."
    Write-Host ""

    $systemPrompt = New-DeepSeekApiSystemPrompt -State $State
    $userPrompt = "## RELEVANT CONTEXT`n`nTask: $($State.Description)`n`n## SOURCE CONTENT`n`n$($sourceLoad.ContentText)"

    $result = Invoke-DeepSeekApiCall -SystemPrompt $systemPrompt -UserPrompt $userPrompt

    if (-not $result.Success) {
        # Real defect fix: distinguish an adapter/request-format defect
        # (INVALID_REQUEST/INVALID_PARAMETERS - the request itself was
        # malformed, a bug in this adapter, not in the engineering task)
        # from a genuinely operational failure (auth/network/timeout/rate-
        # limit/provider-side). Only the latter gets the "falling back"
        # message; the former must never imply a safe automatic fallback,
        # since silently falling back would hide an integration defect.
        $isAdapterDefect = $result.ErrorCategory -in @("INVALID_REQUEST", "INVALID_PARAMETERS")

        Write-Host "DeepSeek API failed"
        Write-Host ""
        Write-Host "HTTP:"
        Write-Host $(if ($result.HttpStatus) { $result.HttpStatus } else { "N/A" })
        Write-Host ""
        Write-Host "Category:"
        Write-Host $result.ErrorCategory
        Write-Host ""
        Write-Host "Provider Message:"
        Write-Host $(if ($result.ProviderMessage) { $result.ProviderMessage } else { "(not provided)" })
        if ($result.ProviderParam) {
            Write-Host ""
            Write-Host "Provider Parameter:"
            Write-Host $result.ProviderParam
        }
        Write-Host ""
        Show-DeepSeekRequestShapeDiagnostic -Diagnostic (Get-DeepSeekRequestShapeDiagnostic -SystemPrompt $systemPrompt -UserPrompt $userPrompt -Config (Get-DeepSeekApiConfig))

        $usageStatus = Get-DeepSeekUsageStatusFromError -ErrorCategory $result.ErrorCategory
        Save-DeepSeekStatus -Connectivity "FAIL" -UsageStatus $usageStatus -ErrorCategory $result.ErrorCategory
        Write-DeepSeekUsageLog -State $State -Result "FAIL:$($result.ErrorCategory)"

        $syntheticParsed = [pscustomobject]@{
            Status = "ERROR"
            Summary = "DeepSeek API call failed: $($result.ErrorCategory)$(if ($result.ProviderMessage) { " - $($result.ProviderMessage)" }). $(if ($isAdapterDefect) { "This is an adapter/request-format defect, not an engineering-task failure." } else { "Provider/operational-level failure." })"
            EscalationRequired = $false; EscalationReason = ""
        }
        Write-DeepSeekReportFromApi -State $State -Parsed $syntheticParsed -Applied @() -Rejected @() `
            -ProviderStatus "FAILED" -SourceContextStatus "OK" -AgentEscalationOverride "NOT RUN" `
            -HttpStatusValue $(if ($result.HttpStatus) { "$($result.HttpStatus)" } else { $null }) `
            -ProviderErrorCategory $result.ErrorCategory -ProviderMessageValue $result.ProviderMessage -ProviderParamValue $result.ProviderParam `
            -ClaudeFallback "NOT RUN" | Out-Null

        if ($isAdapterDefect) {
            Write-Host "ADAPTER_ATTENTION_REQUIRED"
            Write-Host ""
            Write-Host "This is a request-format/provider-compatibility defect in the DeepSeek adapter itself, not a failure of the engineering task."
            Write-Host "Do NOT fall back to local/manual/Claude implementation automatically - fix the adapter, then retry."
            Write-Host ""
        } else {
            Write-Host "Falling back to local runner / manual execution path."
            Write-Host ""
        }
        return $false
    }

    Save-DeepSeekStatus -Connectivity "PASS" -UsageStatus "NORMAL" -ErrorCategory $null
    $parsed = ConvertFrom-DeepSeekApiResponse -Text $result.Content

    if ($parsed.Status -eq "ESCALATE" -or $parsed.EscalationRequired) {
        Write-DeepSeekReportFromApi -State $State -Parsed $parsed -Applied @() -Rejected @() | Out-Null
        Write-DeepSeekUsageLog -State $State -Result "ESCALATE"
        Write-Host "DeepSeek returned ESCALATE_TO_CLAUDE. Findings recorded in .ai/DEEPSEEK_IMPLEMENTATION_REPORT.md."
        Write-Host "Run 'teras-agent -Resume' to hand off to Claude (not launched automatically from here)."
        Write-Host ""
        return $false
    }

    if (@($parsed.Files).Count -eq 0) {
        Write-Host "DeepSeek response contained no file changes and did not request escalation - treating as inconclusive. No files were modified."
        Write-Host ""
        Write-DeepSeekReportFromApi -State $State -Parsed $parsed -Applied @() -Rejected @() | Out-Null
        Write-DeepSeekUsageLog -State $State -Result "NO_CHANGES"
        return $false
    }

    $applyResult = Invoke-DeepSeekApplyPatch -ParsedResponse $parsed -State $State
    if ($applyResult.AnyRejected) {
        Write-DeepSeekReportFromApi -State $State -Parsed $parsed -Applied $applyResult.Applied -Rejected $applyResult.Rejected | Out-Null
        Write-DeepSeekUsageLog -State $State -Result "PATCH_REJECTED"
        return $false
    }

    Write-DeepSeekReportFromApi -State $State -Parsed $parsed -Applied $applyResult.Applied -Rejected @() | Out-Null
    Write-DeepSeekUsageLog -State $State -Result "SUCCESS"
    Write-Host "DeepSeek API implementation applied to approved file(s): $($applyResult.Applied -join ', ')"
    Write-Host ""
    return $true
}
