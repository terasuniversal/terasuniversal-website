<#
    agent-router.ps1 - classification, risk/model routing, and task-state
    persistence for the TERAS AI Engineering Orchestrator.

    Dot-sourced by teras-agent.ps1, which must set $RepoRoot, $AiDir,
    $CurrentTaskPath and $TaskStatePath before sourcing this file - every
    function here reads those from the caller's scope rather than taking
    them as parameters, matching the convention established in Phase 1.

    The state machine's source of truth is the JSON file at $TaskStatePath.
    CURRENT_TASK.md is a regenerated human-readable view of that same
    object - never hand-edit one without the other going stale. See
    ..\.ai\MODEL_ROUTING.md for the classification rules encoded below and
    ..\.ai\ROUTING_RULES.md for the agent-level routing table.
#>

# Keyword sets from MODEL_ROUTING.md - drive risk/model escalation independent
# of which menu option (or auto-detected category) a task started from.
$CertTrustKeywords = @("issuance", "verification", "verify", "validity", "qr", "numbering", "eligibility", "trust")
$DbSensitiveKeywords = @("migration", "rls", "polic", "database function", "rpc", "schema", "constraint", "index", "auth")
# Narrower than $DbSensitiveKeywords on purpose: excludes "rpc"/"index"/
# "constraint", which are frequently just naming *what kind of object* a
# certificate-trust task touches (e.g. "certificate verification RPC" is
# still ordinarily just HIGH - MODEL_ROUTING.md's documented default).
# Only an unambiguous, separately-named security/schema concern alongside
# certificate-trust language escalates straight to CRITICAL at
# classification time - see the isCertTrust-and-isDbSensitiveCritical
# branch below.
. (Join-Path $PSScriptRoot "hermes-repair-policy.ps1")

$DbSensitiveCriticalKeywords = @("migration", "rls", "polic", "database function", "schema", "auth")
$DestructiveKeywords = @("destructive", "drop", "delete", "truncate", "irreversible")
$CertDomainTerms = @("certificate", "template a", "template b", "crest", "signature", "stamp", "seal")
$VisualTerms = @("spacing", "font", "position", "placement", "alignment", "layout", "appearance", "size", "padding", "margin", "logo")
$CrossModuleKeywords = @("cross-module", "multiple modules", "several modules", "several components", "many files", "weak test")
$UiKeywords = @("css", "style", "spacing", "responsive", "layout", "mobile", "padding", "margin", "align", "color", "font")
$BugKeywords = @("fix", "bug", "error", "broken", "crash", "incorrect", "wrong")

# Active Hermes routing policy. These are concrete provider/model labels, not
# interchangeable historical aliases. DeepSeek remains available only to
# support legacy/manual compatibility paths and is never selected normally.
$script:HermesRoutingPolicy = [ordered]@{
    CodexProvider = "OpenAI Codex"
    CodexModel = "GPT-5.6 Luna"
    ClaudeProvider = "Anthropic"
    ClaudeModel = "Claude Sonnet 5"
    DeepSeekActive = $false
}

$script:HermesTaskStates = @(
    "NONE", "CREATED", "ROUTED", "WAITING_APPROVAL", "RUNNING",
    "REVIEW_PENDING", "REPAIR_REQUIRED", "BLOCKED", "COMPLETED",
    "FAILED", "CANCELLED"
)

$script:HermesStateTransitions = @{
    NONE = @("CREATED")
    CREATED = @("ROUTED", "WAITING_APPROVAL", "BLOCKED", "CANCELLED")
    ROUTED = @("WAITING_APPROVAL", "RUNNING", "BLOCKED", "CANCELLED")
    WAITING_APPROVAL = @("RUNNING", "BLOCKED", "CANCELLED")
    RUNNING = @("REVIEW_PENDING", "REPAIR_REQUIRED", "BLOCKED", "FAILED", "COMPLETED")
    REVIEW_PENDING = @("REPAIR_REQUIRED", "WAITING_APPROVAL", "BLOCKED", "FAILED", "COMPLETED")
    REPAIR_REQUIRED = @("RUNNING", "BLOCKED", "FAILED")
    BLOCKED = @("ROUTED", "WAITING_APPROVAL", "RUNNING", "CANCELLED")
    FAILED = @("ROUTED", "WAITING_APPROVAL", "RUNNING", "CANCELLED")
    COMPLETED = @()
    CANCELLED = @()
}

function Test-TerasHermesWorkspaceBinding {
    param([Parameter(Mandatory)][string]$RepoRoot)

    # Configuration is required for active Hermes routing.  A missing binding
    # fails closed, and the canonical CRM workspace is always rejected even if
    # it is accidentally supplied as the Hermes workspace value.
    $hermesWorkspace = [Environment]::GetEnvironmentVariable("TERAS_HERMES_WORKSPACE", "Process")
    $canonicalWorkspace = [Environment]::GetEnvironmentVariable("TERAS_CANONICAL_WORKSPACE", "Process")
    if ([string]::IsNullOrWhiteSpace($hermesWorkspace) -or [string]::IsNullOrWhiteSpace($canonicalWorkspace)) {
        return $false
    }
    $normalize = { param($value) ([IO.Path]::GetFullPath(([string]$value).TrimEnd('\', '/'))).TrimEnd('\', '/').ToLowerInvariant() }
    $target = & $normalize $RepoRoot
    $configuredHermes = & $normalize $hermesWorkspace
    $configuredCanonical = & $normalize $canonicalWorkspace
    if ($target -eq $configuredCanonical) { return $false }
    return $target -eq $configuredHermes
}

function Get-HermesCanonicalState {
    param([string]$State)

    switch ($State) {
        "IMPLEMENTING" { return "RUNNING" }
        "IMPLEMENTING_REPAIR" { return "REPAIR_REQUIRED" }
        "PENDING_CODEX_REPAIR" { return "REPAIR_REQUIRED" }
        "PENDING_CLAUDE_REVIEW" { return "REVIEW_PENDING" }
        "REVIEWING" { return "REVIEW_PENDING" }
        "QA" { return "RUNNING" }
        "AWAITING_APPROVAL" { return "WAITING_APPROVAL" }
        "COMPLETE" { return "COMPLETED" }
        default { return $State }
    }
}

function Test-HermesStateTransition {
    param([string]$From, [string]$To)

    $fromCanonical = Get-HermesCanonicalState -State $From
    $toCanonical = Get-HermesCanonicalState -State $To
    if ($fromCanonical -eq $toCanonical) {
        return [pscustomobject]@{ Allowed = $true; From = $fromCanonical; To = $toCanonical; Reason = "Idempotent state transition." }
    }
    if ($fromCanonical -notin $script:HermesTaskStates -or $toCanonical -notin $script:HermesTaskStates) {
        return [pscustomobject]@{ Allowed = $false; From = $fromCanonical; To = $toCanonical; Reason = "Unknown Hermes task state." }
    }
    $allowed = @($script:HermesStateTransitions[$fromCanonical]) -contains $toCanonical
    return [pscustomobject]@{
        Allowed = $allowed
        From = $fromCanonical
        To = $toCanonical
        Reason = if ($allowed) { "Transition is allowed." } else { "Transition is not allowed from the current Hermes state." }
    }
}

function Set-HermesTaskState {
    param($State, [string]$TargetState, [string]$Reason = "")

    Repair-TaskStateSchema -State $State | Out-Null
    $check = Test-HermesStateTransition -From $State.State -To $TargetState
    if (-not $check.Allowed) { throw "Invalid Hermes state transition $($check.From) -> $($check.To): $($check.Reason)" }
    $now = Get-AgentEventTimestamp
    $State.State = $check.To
    $history = @($State.TransitionHistory)
    if ($check.From -ne $check.To) {
        $history += [pscustomobject]@{ timestamp = $now; from = $check.From; to = $check.To; reason = $Reason }
    }
    $State.TransitionHistory = $history
    $State.LastStateChangeAt = $now
    return $State
}

function Get-ApprovedRoutingForRisk {
    param([ValidateSet("LOW", "MEDIUM", "HIGH", "CRITICAL")][string]$Risk)

    if ($Risk -in @("HIGH", "CRITICAL")) {
        return [pscustomobject]@{
            Implementer = "Claude Code"
            ImplementerModel = $script:HermesRoutingPolicy.ClaudeModel
            ImplementerProvider = $script:HermesRoutingPolicy.ClaudeProvider
        }
    }

    return [pscustomobject]@{
        Implementer = "Codex"
        ImplementerModel = $script:HermesRoutingPolicy.CodexModel
        ImplementerProvider = $script:HermesRoutingPolicy.CodexProvider
    }
}

# Phase 9B fix: explicit module/path signals that must take precedence over
# generic visual/UI keyword matching at category-labeling time (see the
# priority cascade documented on Get-TaskClassification below). Deliberately
# narrow and keyed on an unambiguous module name, not on a generic word like
# "print" - "print" alone must never imply "certificate" (attendance also
# has print pages) and must never imply "attendance" either (other modules
# print things too). Extend this map, not the word "print" itself, when a
# new module needs its own category.
$AttendanceKeywords = @("attendance")

# Real defect fix: narrower, phrase-based signals for classifying a
# DeepSeek escalation REASON (free-form AI-generated prose) as touching a
# blocked area - deliberately distinct from $CertTrustKeywords/
# $DbSensitiveKeywords, which are tuned for deliberate human task
# descriptions where a single word like "constraint" or "auth" is a
# reasonably strong signal. A live pilot's escalation reason said "the
# constraint against new print implementations" (an ordinary-English task
# constraint, not a database constraint) and falsely escalated a routine
# file-not-found finding to HIGH + mandatory Codex purely because
# "constraint" is in $DbSensitiveKeywords. These are multi-word phrases
# specific enough that an incidental match in ordinary prose is
# implausible - do not add single ambiguous words (auth/constraint/index/
# schema/rpc) to this list.
$EscalationBlockedAreaPhrases = @(
    "row level security", "rls polic", "rls bypass",
    "database migration", "schema migration", "database schema",
    "certificate issuance", "certificate verification", "verify the certificate", "verify certificate",
    "authentication logic", "authorization logic", "auth bypass", "auth token", "auth policy",
    "security definer", "sql injection", "privilege escalation", "security-sensitive rpc"
)

function Test-EscalationTouchesBlockedArea {
    param([string]$Text)
    if ([string]::IsNullOrWhiteSpace($Text)) { return $false }
    return (Test-AnyKeyword -Text $Text -Keywords $EscalationBlockedAreaPhrases)
}

# DeepSeek's routine-work profile (MODEL_ROUTING.md / AGENTS.md). This is an
# opt-IN list: a task must positively match one of these to be offered to
# DeepSeek at MEDIUM risk - absence of a blocked-area keyword is not, on its
# own, enough (that would let anything vague and unclassifiable drift to the
# fast/cheap implementer by default, which is the wrong direction to err in).
$DeepSeekKeywords = @($UiKeywords) + @(
    "crud", "search", "filter", "sort", "sorting", "table",
    "form field", "label", "copy", "boilerplate", "cleanup", "clean up",
    "simple", "targeted test", "polish", "small component"
)

# Ordered so "current state is at-or-past X" comparisons are a simple index
# lookup. BLOCKED/PUSH_BLOCKED/PREVIEW_BLOCKED are intentionally excluded -
# each is reachable from several states and is checked separately, not as a
# position in the happy path. Phase 4 (push/preview) only ever continues
# past COMPLETE - nothing here ever reaches a production state.
$script:StateOrder = @(
    "CREATED", "ROUTED", "IMPLEMENTING", "QA", "REVIEWING", "REPAIR",
    "AWAITING_APPROVAL", "APPROVED", "COMMIT_READY", "COMPLETE",
    "PUSH_READY", "PUSHED", "PREVIEW_DEPLOYING", "PREVIEW_VERIFYING",
    "PREVIEW_READY", "PREVIEW_APPROVED",
    "PR_READY", "PR_OPEN", "RELEASE_READY", "RELEASE_APPROVED", "MERGING",
    "PRODUCTION_DEPLOYING", "PRODUCTION_VERIFYING", "RELEASE_COMPLETE"
)

function Get-TaskId {
    return "TERAS-" + (Get-Date -Format "yyyyMMdd-HHmmss")
}

function Test-AnyKeyword {
    param([string]$Text, [string[]]$Keywords)

    $lower = $Text.ToLowerInvariant()
    foreach ($kw in $Keywords) {
        if ($lower.Contains($kw)) {
            return $true
        }
    }
    return $false
}

# ---------------------------------------------------------------------------
# Phase 9B fix: shared literal repo-relative path helpers. Used by scope
# checks throughout the orchestrator (Test-ScopeViolation in
# agent-runner.ps1, Test-DeepSeekPatchPathAllowed in deepseek-runner.ps1,
# and the explicit-path extraction below) so there is exactly one place that
# decides what "the same path" means.
#
# Next.js dynamic route segments (`[scheduleId]`, `[id]`, `[token]`) contain
# `[`/`]`, which are PowerShell wildcard metacharacters to the `-like`
# operator. `-like` must never be used for an exact Approved Files
# comparison - a proposed path of `.../123/print/page.tsx` must never
# accidentally satisfy an allowed pattern of `.../[scheduleId]/print/page.tsx`
# (or vice versa) through wildcard-style matching. Every comparison here
# uses literal, ordinal, case-insensitive string equality instead.
# ---------------------------------------------------------------------------

function Get-NormalizedRepoRelativePath {
    param([string]$Path)
    if ($null -eq $Path) { return $Path }
    return ($Path.Trim() -replace '\\', '/')
}

function Test-RepoRelativePathsEqual {
    param([string]$A, [string]$B)
    if ($null -eq $A -or $null -eq $B) { return $false }
    $normA = Get-NormalizedRepoRelativePath -Path $A
    $normB = Get-NormalizedRepoRelativePath -Path $B
    return [System.StringComparer]::OrdinalIgnoreCase.Equals($normA, $normB)
}

# Top-level source directories a genuine repo-relative path may start with.
# Deliberately conservative - only extracts a token when it is unambiguously
# a project source path, never a URL, a prose sentence, or an unrelated
# dotted string.
$script:KnownTopLevelDirs = @("app", "lib", "components", "supabase", "data", "public", "docs")

function Get-ExplicitTaskPaths {
    param([string]$Description)

    if ([string]::IsNullOrWhiteSpace($Description)) { return @() }

    $prefixPattern = ($script:KnownTopLevelDirs -join "|")
    # Character class covers everything a real path segment in this repo
    # uses, including literal Next.js route-group/dynamic-segment syntax
    # ((protected), [scheduleId]) - matched as literal text, never as a
    # wildcard pattern (this is plain text extraction, not -like/-match
    # scope comparison).
    $pattern = "(?:$prefixPattern)/[A-Za-z0-9_\-\.\/\(\)\[\]]+\.(?:tsx|ts|jsx|js|css|scss|sql|json|md)"

    $found = [regex]::Matches($Description, $pattern)
    $paths = @()
    foreach ($m in $found) {
        $candidate = $m.Value.Trim().TrimEnd('.', ',', ';', ':')
        $normalized = Get-NormalizedRepoRelativePath -Path $candidate
        $alreadyPresent = $false
        foreach ($p in $paths) { if (Test-RepoRelativePathsEqual -A $p -B $normalized) { $alreadyPresent = $true; break } }
        if (-not $alreadyPresent) { $paths += $normalized }
    }
    return $paths
}

# Literal-path-safe existence check - never wildcard-resolved. -LiteralPath
# is required here specifically because `[scheduleId]`/`[id]`/`[token]`
# style segments are valid PowerShell wildcard syntax to the non-literal
# Test-Path/Get-Item and would otherwise silently glob-match (or fail to
# match) instead of checking the exact literal path.
function Test-ExplicitPathExists {
    param([string]$RelativePath)
    $normalized = Get-NormalizedRepoRelativePath -Path $RelativePath
    $full = Join-Path $RepoRoot $normalized
    return (Test-Path -LiteralPath $full -PathType Leaf)
}

# ---------------------------------------------------------------------------
# Stable-operational-mode routing (delivery-priority change): Claude FAST is
# now the default implementer for every LOW/MEDIUM task that would
# previously have gone straight to DeepSeek by default. DeepSeek only
# becomes the implementer when a human explicitly asks for it on this task
# (-PreferDeepSeek) or when an operator has explicitly opted back into
# DeepSeek-by-default via .ai/AGENT_CONFIG.json's
# deepseek.defaultImplementer AND DeepSeek's last known status isn't a
# known failure. DeepSeek must never block delivery - Claude FAST is always
# the safe fallback, never a dead end.
#
# This is a runtime (not load-order) dependency on
# tools/deepseek-runner.ps1's Test-DeepSeekApiKeyConfigured/
# Get-DeepSeekStatusRecord - safe because teras-agent.ps1 dot-sources every
# tools/*.ps1 file before any function is actually invoked (only function
# *definitions* happen during dot-sourcing), guarded with Get-Command checks
# regardless so this degrades to "Claude FAST" rather than erroring if that
# file were ever missing.
# ---------------------------------------------------------------------------

function Test-DeepSeekDefaultImplementerEnabled {
    $configPath = Join-Path $AiDir "AGENT_CONFIG.json"
    if (-not (Test-Path $configPath)) { return $false }
    try {
        $raw = Get-Content -Path $configPath -Raw -Encoding utf8 | ConvertFrom-Json
        return [bool]($raw.deepseek -and $raw.deepseek.defaultImplementer -eq $true)
    } catch {
        return $false
    }
}

function Test-DeepSeekHealthyForRouting {
    # Conservative by design: a provider already known to have failed must
    # never be routed to again automatically - DeepSeek failures must never
    # block delivery. UNKNOWN (never tested) counts as healthy-enough to
    # try; a known FAIL does not.
    if (-not (Get-Command Test-DeepSeekApiKeyConfigured -ErrorAction SilentlyContinue)) { return $false }
    if (-not (Test-DeepSeekApiKeyConfigured)) { return $false }
    if (-not (Get-Command Get-DeepSeekStatusRecord -ErrorAction SilentlyContinue)) { return $true }
    $status = Get-DeepSeekStatusRecord
    return ($status.LastConnectivity -ne "FAIL")
}

function Get-LowMediumImplementerChoice {
    param([bool]$PreferDeepSeek)

    # Retain the signature for compatibility, but make the disabled
    # DeepSeek flag impossible to override.
    return (Get-ApprovedRoutingForRisk -Risk "LOW")
}

# Direct mode ("teras-agent <task description>") has no menu number to start
# from, so this infers the same starting point a human would have picked
# from the menu. The escalation cascade in Get-TaskClassification then
# overrides this whenever a stronger signal (cert-trust/db-sensitive/etc.)
# is present, so a wrong guess here only matters for plain LOW/MEDIUM tasks.
function Get-AutoMenuChoice {
    param([string]$Description)

    if (Test-AnyKeyword -Text $Description -Keywords $CertDomainTerms) { return 5 }
    if (Test-AnyKeyword -Text $Description -Keywords $DbSensitiveKeywords) { return 4 }
    if (Test-AnyKeyword -Text $Description -Keywords $UiKeywords) { return 3 }
    if (Test-AnyKeyword -Text $Description -Keywords $BugKeywords) { return 2 }
    return 1
}

function Get-TaskClassification {
    param(
        [int]$MenuChoice,
        [string]$Description,
        [switch]$PreferDeepSeek
    )

    # Only Category/Risk come from the menu baseline now - Implementer/Model/
    # Reviewer are always decided by the cascade below, per MODEL_ROUTING.md's
    # router priority: "can DeepSeek safely do it -> can Claude FAST -> else
    # Claude DEEP." This keeps every blocked-area keyword check (cert-trust,
    # db-sensitive, destructive/production) as the single place that can ever
    # force HIGH/CRITICAL - and since DeepSeek is only ever assigned in the
    # LOW/MEDIUM branches below, those checks are what keep DeepSeek out of
    # RLS/auth/migration/schema/rpc/certificate-issuance/verification work,
    # structurally, not just by convention.
    switch ($MenuChoice) {
        1 { $category = "Feature"; $risk = "MEDIUM" }
        2 { $category = "Bug Fix"; $risk = "MEDIUM" }
        3 { $category = "UI / CSS"; $risk = "LOW" }
        4 { $category = "Database / Supabase"; $risk = "HIGH" }
        5 { $category = "Certificate"; $risk = "MEDIUM" }
        7 { $category = "Production Audit"; $risk = "HIGH" }
        default { $category = "General"; $risk = "MEDIUM" }
    }

    $reasonParts = @()

    if ($MenuChoice -eq 7) {
        $implementer = "Codex"; $model = $script:HermesRoutingPolicy.CodexModel; $reviewer = "Claude Code"; $reviewerModel = $script:HermesRoutingPolicy.ClaudeModel
        $reasonParts += "Full-repository production audit - explicitly requested, not the default review posture."
    } else {
        $isCertTrust = Test-AnyKeyword -Text $Description -Keywords $CertTrustKeywords
        $isDbSensitive = Test-AnyKeyword -Text $Description -Keywords $DbSensitiveKeywords
        $isDbSensitiveCritical = Test-AnyKeyword -Text $Description -Keywords $DbSensitiveCriticalKeywords
        $isDestructive = Test-AnyKeyword -Text $Description -Keywords $DestructiveKeywords
        $isProduction = $Description.ToLowerInvariant().Contains("production")
        $isCertVisual = (Test-AnyKeyword -Text $Description -Keywords $CertDomainTerms) -and
                        (Test-AnyKeyword -Text $Description -Keywords $VisualTerms) -and
                        (-not $isCertTrust)
        $isCrossModule = Test-AnyKeyword -Text $Description -Keywords $CrossModuleKeywords
        $isDeepSeekSuitable = Test-AnyKeyword -Text $Description -Keywords $DeepSeekKeywords
        # Explicit module/path signal - checked ahead of the generic
        # cert-domain+visual combo below (isCertVisual) so a task that names
        # a specific non-certificate module (e.g. "attendance", including
        # via a literal .../attendance/... path) is never mislabeled
        # Certificate / Visual purely because it also contains a generic
        # visual word (spacing/alignment/print/etc.). This never runs ahead
        # of the security/db/cert-trust/destructive checks above - those
        # still escalate risk unconditionally regardless of module signal.
        $isAttendanceModule = Test-AnyKeyword -Text $Description -Keywords $AttendanceKeywords

        if ($isCertTrust -and $isDbSensitiveCritical) {
            # Certificate trust/verification logic AND database/RLS/auth
            # surface in the same task - the exact combination
            # DATABASE_SAFETY.md's certificate-database rule (section 22)
            # always marks CRITICAL at the SQL level. Catching it here too,
            # at classification time before any SQL exists, is strictly
            # tighter than treating it as ordinary cert-trust HIGH.
            $category = "Certificate / Verification / Database"
            $risk = "CRITICAL"; $implementer = "Claude Code"; $model = $script:HermesRoutingPolicy.ClaudeModel
            $reviewer = "Codex"; $reviewerModel = "CODEX_REVIEW"
            $reasonParts += "Touches certificate verification/trust logic AND database/RLS/auth surface in the same task - combined signal escalates directly to CRITICAL per the certificate-database rule (DATABASE_SAFETY.md)."
        } elseif ($isCertTrust) {
            $category = "Certificate / Verification"
            $risk = "HIGH"; $implementer = "Claude Code"; $model = $script:HermesRoutingPolicy.ClaudeModel
            $reviewer = "Codex"; $reviewerModel = "CODEX_REVIEW"
            $reasonParts += "Touches certificate issuance, verification, validity, or trust logic; routed to Anthropic Claude Sonnet 5 with mandatory Codex review."
        } elseif ($isDbSensitive) {
            $category = "Database / Supabase"
            $risk = "HIGH"; $implementer = "Claude Code"; $model = $script:HermesRoutingPolicy.ClaudeModel
            $reviewer = "Codex"; $reviewerModel = "CODEX_REVIEW"
            $reasonParts += "Touches migrations, RLS/policies, database functions/RPCs, schema, constraints, indexes, or auth; routed to Anthropic Claude Sonnet 5 with mandatory Codex review."
        } elseif ($isDestructive -or $isProduction) {
            $risk = "HIGH"; $implementer = "Claude Code"; $model = $script:HermesRoutingPolicy.ClaudeModel
            $reviewer = "Codex"; $reviewerModel = "CODEX_REVIEW"
            $reasonParts += "Description flags destructive and/or production-scoped impact; routed to Anthropic Claude Sonnet 5 with mandatory Codex review."
        } elseif ($isAttendanceModule -and (Test-AnyKeyword -Text $Description -Keywords $UiKeywords)) {
            $isPrintArea = $Description.ToLowerInvariant().Contains("print")
            $category = if ($isPrintArea) { "Attendance / UI / Print" } else { "Attendance / UI" }
            $risk = "LOW"
            $pick = Get-LowMediumImplementerChoice -PreferDeepSeek:$PreferDeepSeek
            $implementer = $pick.Implementer; $model = $pick.ImplementerModel
            $reviewer = "None"; $reviewerModel = "None"
            $reasonParts += "Explicit attendance-module signal takes precedence over generic visual keyword matching; LOW-risk work is routed to OpenAI Codex GPT-5.6 Luna."
        } elseif ($isCertVisual) {
            $category = "Certificate / Visual"
            $risk = "LOW"
            $pick = Get-LowMediumImplementerChoice -PreferDeepSeek:$PreferDeepSeek
            $implementer = $pick.Implementer; $model = $pick.ImplementerModel
            $reviewer = "None"; $reviewerModel = "None"
            $reasonParts += "Visual-only certificate change (spacing/placement/appearance) with no issuance or verification logic touched; LOW-risk work is routed to OpenAI Codex GPT-5.6 Luna."
        } elseif ($risk -eq "HIGH") {
            # Category defaulted to HIGH (e.g. the Database/Supabase menu
            # option) with no specific keyword detail in the description.
            $implementer = "Claude Code"; $model = $script:HermesRoutingPolicy.ClaudeModel
            $reviewer = "Codex"; $reviewerModel = "CODEX_REVIEW"
        } elseif ($risk -eq "LOW") {
            # LOW work always routes to Codex GPT-5.6 Luna.
            $pick = Get-LowMediumImplementerChoice -PreferDeepSeek:$PreferDeepSeek
            $implementer = $pick.Implementer; $model = $pick.ImplementerModel
            $reviewer = "None"; $reviewerModel = "None"
            $reasonParts += "Low-risk, narrowly-scoped change with no database, auth, or certificate-trust surface; routed to OpenAI Codex GPT-5.6 Luna."
        } else {
            # MEDIUM work always routes to Codex GPT-5.6 Luna. Historical
            # DeepSeek suitability is retained only for compatibility.
            $pick = Get-ApprovedRoutingForRisk -Risk "MEDIUM"
            $implementer = $pick.Implementer; $model = $pick.ImplementerModel
            $reviewer = "None"; $reviewerModel = "None"
            if ($isCrossModule) {
                $reviewer = "Codex (recommended)"; $reviewerModel = "CODEX_REVIEW (optional)"
                $reasonParts += "Cross-module scope - routed to OpenAI Codex GPT-5.6 Luna; independent review remains recommended."
            } else {
                $reasonParts += "Ordinary MEDIUM-risk work - routed to OpenAI Codex GPT-5.6 Luna."
            }
        }

        if ($risk -eq "HIGH" -and ($isDestructive -or $isProduction)) {
            $risk = "CRITICAL"
            $reasonParts += "Escalated to CRITICAL: destructive and/or production-scoped impact on an already high-risk surface. All automatic destructive actions remain blocked regardless."
        }
    }

    if ($reasonParts.Count -eq 0) {
        $reasonParts += "Category is inherently high-impact by default; independent review is mandatory regardless of description detail."
    }

    # Final normalization is authoritative. It prevents historical branches
    # or compatibility switches from selecting DeepSeek or stale aliases.
    if ($MenuChoice -eq 7) {
        $implementer = "Codex"
        $model = $script:HermesRoutingPolicy.CodexModel
        $implementerProvider = $script:HermesRoutingPolicy.CodexProvider
        $reviewer = "Claude Code"
        $reviewerModel = $script:HermesRoutingPolicy.ClaudeModel
        $reviewerProvider = $script:HermesRoutingPolicy.ClaudeProvider
    } else {
        $approved = Get-ApprovedRoutingForRisk -Risk $risk
        $implementer = $approved.Implementer
        $model = $approved.ImplementerModel
        $implementerProvider = $approved.ImplementerProvider
        $reviewerProvider = if ($reviewer -match "Codex") { $script:HermesRoutingPolicy.CodexProvider } elseif ($reviewer -match "Claude") { $script:HermesRoutingPolicy.ClaudeProvider } else { $null }
        if ($reviewer -match "Codex") { $reviewerModel = $script:HermesRoutingPolicy.CodexModel }
        if ($reviewer -match "Claude") { $reviewerModel = $script:HermesRoutingPolicy.ClaudeModel }
    }

    $humanApproval = if ($risk -eq "HIGH" -or $risk -eq "CRITICAL") { "REQUIRED" } else { "NOT REQUIRED" }
    $fullRepoAudit = ($MenuChoice -eq 7)
    $escalationNote = "DeepSeek disabled for active routing; no automatic DeepSeek fallback."

    return @{
        Category         = $category
        Risk             = $risk
        Implementer      = $implementer
        ImplementerModel = $model
        ImplementerProvider = $implementerProvider
        Reviewer         = $reviewer
        ReviewerModel    = $reviewerModel
        ReviewerProvider = $reviewerProvider
        Reason           = ($reasonParts -join " ")
        HumanApproval    = $humanApproval
        FullRepoAudit    = $fullRepoAudit
        EscalationNote   = $escalationNote
    }
}

# ---------------------------------------------------------------------------
# Task state - the JSON file is the source of truth; CURRENT_TASK.md is
# regenerated from it on every write so the two can never drift apart.
# ---------------------------------------------------------------------------

function New-EmptyTaskState {
    return [pscustomobject]@{
        TaskId                = $null
        ProjectId             = "teras-universal-website"
        ProjectName           = "TERAS Universal Website / CRM"
        TaskWorkspace         = $null
        ExpectedBranch        = $null
        ExpectedHeadSha       = $null
        StatusFingerprint     = $null
        HermesOnly            = $false
        CreatedAt             = $null
        Category              = $null
        Risk                  = $null
        Description           = $null
        Implementer           = $null
        ImplementerModel      = $null
        ImplementerProvider   = $null
        OriginalImplementer   = $null
        ImplementerFallbackReason = $null
        FallbackImplementer   = $null
        FallbackType          = $null
        Reviewer              = $null
        ReviewerModel         = $null
        ReviewerProvider      = $null
        Reason                = $null
        HumanApprovalRequired = $null
        FullRepoAudit         = $false
        State                 = "NONE"
        ExecutionStatus       = "NOT_STARTED"
        ExecutionAttempt      = 0
        ExecutionStartedAt    = $null
        ExecutionHeartbeatAt  = $null
        ExecutionCompletedAt  = $null
        ExecutionResultSummary = $null
        ActiveExecutionId     = $null
        ExecutionLeaseActive  = $false
        ExecutionLeaseExpiresAt = $null
        ExecutionLeaseStatus   = "NONE"
        ExecutionLeaseOwnerPid = $null
        LastRecoveryAt        = $null
        RecoveryEvents        = @()
        TransitionHistory     = @()
        LastStateChangeAt     = $null
        LastPersistedState    = $null
        HumanDecision         = "PENDING"
        RepairCyclesUsed      = 0
        PreImplementationSnapshot = @()
        AllowedFiles          = @()
        BlockedFiles          = @()
        ScopeSource           = "MANUAL"
        ExplicitPathsNotFound = @()
        PreExistingFiles      = @()
        TaskGeneratedFiles    = @()
        BlockingIssues        = @()
        ScopeCheck            = "NOT_CONFIGURED"
        WorkspaceBoundary     = [pscustomobject]@{
            LockStatus = "UNLOCKED"
            CanonicalWorkspace = $null
            DeclaredAllowedScope = @()
            DeclaredBlockedScope = @()
            Branch = $null
            Upstream = $null
            AheadOfOriginMain = $null
            BehindOriginMain = $null
            DirtyStatusEntries = $null
            DirtyTrackedContentFiles = $null
            DirtyUntrackedEntries = $null
        }
        QA                    = [pscustomobject]@{
            GitDiffCheck = [pscustomobject]@{ Result = "SKIPPED"; Reason = "Not run yet." }
            TypeScript   = [pscustomobject]@{ Result = "SKIPPED"; Reason = "Not run yet." }
            Tests        = [pscustomobject]@{ Result = "SKIPPED"; Reason = "Not run yet." }
            Build        = [pscustomobject]@{ Result = "SKIPPED"; Reason = "Not run yet." }
        }
        ReviewVerdict         = "NOT_REQUIRED"
        ReviewedDiffHash      = $null
        CommitMessage         = $null
        CommitSha             = $null

        # --- Phase 4.7: durable agent execution and handoff state ---
        CodexExecutionStatus  = "NOT_STARTED"
        CodexExecutionResult  = $null
        CodexExecutionStartedAt = $null
        CodexExecutionCompletedAt = $null
        ClaudeReviewStatus    = "NOT_STARTED"
        ClaudeReviewFindings  = @()
        ClaudeReviewResult    = $null
        ClaudeReviewStartedAt = $null
        ClaudeReviewCompletedAt = $null
        HandoffHistory        = @()
        LastHandoffAt         = $null
        LastReviewAt          = $null
        ApprovalRequestedAt   = $null
        PendingHumanApprovals = @()
        McpActionHistory      = @()

        # --- Phase 4: push / preview ---
        Branch                     = $null
        PushRemote                 = $null
        PushTarget                 = $null
        PreviewStatus              = "NOT_STARTED"
        PreviewUrl                 = $null
        PreviewDeploymentId        = $null
        PreviewBuildStatus         = "NOT_STARTED"
        PreviewVerificationStatus  = "NOT_STARTED"
        PreviewBlockingIssues      = @()
        PreviewNonBlockingIssues   = @()
        CodexPreviewReviewRequired = $false
        PreviewApproved            = $false
        PreviewApprovedAt          = $null
        PreviewCommitSha           = $null
        PreviewDeploymentIdApproved = $null
        ProductionDeploymentAllowed = "NO"

        # --- Phase 5: PR / Release / Production ---
        PrNumber                  = $null
        PrUrl                     = $null
        PrTitle                   = $null
        PrBody                    = $null
        PrSourceBranch            = $null
        PrTargetBranch            = $null
        PrApprovedCommitSha       = $null

        QaVerifiedSha             = $null
        ReviewVerifiedSha         = $null

        MigrationDetected         = $false
        MigrationFiles            = @()
        EnvironmentChangeDetected = $false
        EnvironmentChangeFiles    = @()

        ReleaseRisk               = $null
        ReleaseEligibility        = "NOT_STARTED"
        ReleaseBlockingReasons    = @()

        RollbackPlanPath          = $null
        RollbackRisk              = $null

        ReleaseApproved           = $false
        ReleaseApprovedAt         = $null
        ReleaseApprovedCommitSha  = $null
        ReleaseApprovedPr         = $null

        MergeStrategy             = $null
        MergeStatus               = "NOT_STARTED"

        ProductionDeploymentStatus   = "NOT_STARTED"
        ProductionUrl                = $null
        ProductionCommitSha          = $null
        ProductionVerificationStatus = "NOT_STARTED"
        ProductionBlockingIssues     = @()

        # --- Phase 7: database migration safety (separate track from the
        # application State/Risk above - see DATABASE_SAFETY.md) ---
        DbRequired               = $false
        DbState                  = "DB_NOT_REQUIRED"
        DbRisk                   = $null
        DbMigrationFile          = $null
        DbMigrationHash          = $null
        DbObjectsChanged         = @()
        DbDangerousStatements    = @()
        DbSecurityDefinerDetected = $false
        DbRlsImpact              = $false
        DbAuthImpact             = $false
        DbCertificateImpact      = $false
        DbDataMigration          = $false
        DbDestructiveSql         = $false
        DbDuplicatePrecheck      = "NOT_RUN"
        DbForeignKeyNotes        = @()
        DbIndexNotes             = @()
        DbStaticValidation       = "NOT_RUN"
        DbReviewVerdict          = "NOT_REQUIRED"
        DbReviewedHash           = $null
        DbBlockingFindings       = @()
        DbApproved               = $false
        DbApprovedAt             = $null
        DbApprovedHash           = $null
        DbApprovedCommitSha      = $null
        DbApplyApproved          = $false
        DbApplyTarget            = $null
        DbApplyStatus            = "NOT_STARTED"
        DbVerificationStatus     = "NOT_STARTED"
        DbRollbackReversible     = $null
        DbDeploymentOrder        = $null
    }
}

function New-TaskState {
    param(
        [string]$TaskId,
        [string]$Description,
        $Classification
    )

    $state = New-EmptyTaskState
    $state.TaskId = $TaskId
    $state.CreatedAt = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $state.Category = $Classification.Category
    $state.Risk = $Classification.Risk
    $state.Description = $Description
    $state.Implementer = $Classification.Implementer
    $state.ImplementerModel = $Classification.ImplementerModel
    $state.ImplementerProvider = $Classification.ImplementerProvider
    $state.Reviewer = $Classification.Reviewer
    $state.ReviewerModel = $Classification.ReviewerModel
    $state.ReviewerProvider = $Classification.ReviewerProvider
    $state.Reason = $Classification.Reason
    $state.HumanApprovalRequired = $Classification.HumanApproval
    $state.FullRepoAudit = $Classification.FullRepoAudit
    $state.State = "CREATED"
    # Only a mandatory reviewer ("Codex" for HIGH/CRITICAL, "Human" for a
    # Production Audit) starts PENDING - "Codex (recommended)" at MEDIUM
    # risk is optional and must not block approval just because it never ran.
    $state.ReviewVerdict = if ($Classification.Reviewer -eq "Codex" -or $Classification.Reviewer -eq "Human") { "PENDING" } else { "NOT_REQUIRED" }

    # Persist canonical work-boundary facts in the existing durable task
    # record. This is observational only and does not mutate repository files.
    $state.WorkspaceBoundary.CanonicalWorkspace = $RepoRoot
    $state.WorkspaceBoundary.Branch = (git -C $RepoRoot branch --show-current 2>$null | Select-Object -First 1)
    $state.TaskWorkspace = $RepoRoot
    $state.ExpectedBranch = $state.WorkspaceBoundary.Branch
    $state.ExpectedHeadSha = (git -C $RepoRoot rev-parse HEAD 2>$null | Select-Object -First 1)
    $state.HermesOnly = Test-TerasHermesWorkspaceBinding -RepoRoot $RepoRoot
    $remote = (git -C $RepoRoot config --get "branch.$($state.WorkspaceBoundary.Branch).remote" 2>$null | Select-Object -First 1)
    $mergeRef = (git -C $RepoRoot config --get "branch.$($state.WorkspaceBoundary.Branch).merge" 2>$null | Select-Object -First 1)
    $state.WorkspaceBoundary.Upstream = if ($remote -and $mergeRef) { "$remote/$($mergeRef -replace '^refs/heads/', '')" } else { $null }
    $dirty = @(git -C $RepoRoot status --porcelain 2>$null)
    $statusBytes = [Text.Encoding]::UTF8.GetBytes(($dirty -join "`n"))
    $state.StatusFingerprint = ([BitConverter]::ToString(([Security.Cryptography.SHA256]::Create().ComputeHash($statusBytes))) -replace '-', '').ToLowerInvariant()
    $state.WorkspaceBoundary.DirtyStatusEntries = $dirty.Count
    $state.WorkspaceBoundary.DirtyUntrackedEntries = @($dirty | Where-Object { $_ -match '^\?\?' }).Count
    $state.WorkspaceBoundary.DirtyTrackedContentFiles = @($dirty | Where-Object { $_ -and $_ -notmatch '^\?\?' }).Count
    $compare = @(git -C $RepoRoot rev-list --left-right --count HEAD...origin/main 2>$null)
    if ($compare.Count -gt 0 -and $compare[0] -match '^\s*(\d+)\s+(\d+)\s*$') {
        $state.WorkspaceBoundary.AheadOfOriginMain = [int]$Matches[1]
        $state.WorkspaceBoundary.BehindOriginMain = [int]$Matches[2]
    }

    # Flag the separate database-safety track (db-runner.ps1) whenever the
    # task itself already looks database-shaped. This is a starting guess,
    # same as menu-baseline Category/Risk - -PrepareMigration re-evaluates
    # against the real migration file/SQL once it exists, per section 2.
    if ($Classification.Category -eq "Database / Supabase" -or (Test-AnyKeyword -Text $Description -Keywords $DbSensitiveKeywords)) {
        $state.DbRequired = $true
        $state.DbState = "DB_PREPARING"
    }

    # Phase 9B fix: populate Approved Scope from explicit, existence-verified
    # task paths when the description names them - never from model output,
    # never a fabricated "discovered" scope (section 10/7 of the fix spec).
    # A named path that does not exist on disk is reported and excluded, not
    # silently approved (section 3). If none of the named paths exist, scope
    # stays MANUAL - the existing "fill in before implementation begins"
    # workflow (section 6).
    $explicitCandidates = Get-ExplicitTaskPaths -Description $Description
    if (@($explicitCandidates).Count -gt 0) {
        $existing = @()
        $missing = @()
        foreach ($candidate in $explicitCandidates) {
            if (Test-ExplicitPathExists -RelativePath $candidate) {
                $existing += $candidate
            } else {
                $missing += $candidate
            }
        }
        if ($existing.Count -gt 0) {
            $state.AllowedFiles = $existing
            $state.ScopeSource = "EXPLICIT_TASK_PATHS"
        }
        if ($missing.Count -gt 0) {
            $state.ExplicitPathsNotFound = $missing
            Write-Host ""
            foreach ($m in $missing) {
                Write-Host "Explicit path not found:"
                Write-Host $m
            }
            Write-Host "Not auto-approved - confirm the correct path(s) before implementation begins."
            Write-Host ""
        }
    }

    if ($Description -match '(?i)P0\.1|canonical work-boundary lock|workspace-stabilization') {
        $state.WorkspaceBoundary.LockStatus = "LOCKED"
        $state.AllowedFiles = @("tools/agent-router.ps1", ".ai/task-state.json", ".ai/CURRENT_TASK.md")
        $state.ScopeSource = "EXPLICIT_TASK_PATHS"
        $state.ScopeCheck = "PASS"
        $state.WorkspaceBoundary.DeclaredAllowedScope = @($state.AllowedFiles)
        $state.WorkspaceBoundary.DeclaredBlockedScope = @(
            "app/", "components/", "lib/", "data/", "supabase/", "public/", "production systems", "Telegram", "routing policy", "task execution semantics", "commit/push/merge/deploy", "migration apply"
        )
        if ($Description -match '(?i)dirty worktree (\d+) status entries, (\d+) tracked real-content files, (\d+) untracked') {
            $state.WorkspaceBoundary.DirtyStatusEntries = [int]$Matches[1]
            $state.WorkspaceBoundary.DirtyTrackedContentFiles = [int]$Matches[2]
            $state.WorkspaceBoundary.DirtyUntrackedEntries = [int]$Matches[3]
        }
    }

    return $state
}

# Real defect fix: a task-state.json written before a schema field existed
# (e.g. OriginalImplementer/ImplementerFallbackReason/FallbackType, added in
# a later phase) deserializes via ConvertFrom-Json into a PSCustomObject
# that genuinely does NOT have that NoteProperty. Assigning to it directly
# ($State.NewField = ...) throws "The property '...' cannot be found on
# this object" - confirmed live on a real task-state.json predating these
# fields. This repairs ANY loaded state to match the current schema
# (New-EmptyTaskState is the single source of truth for what fields should
# exist) by adding whichever properties are missing via Add-Member, never
# by touching properties that already exist (their real values are
# preserved exactly). Runs on every load, so any future new field is
# automatically backward-compatible without another one-off patch.
function Repair-TaskStateSchema {
    param($State)
    $template = New-EmptyTaskState
    $existingNames = @($State.PSObject.Properties.Name)
    foreach ($prop in $template.PSObject.Properties) {
        if ($existingNames -notcontains $prop.Name) {
            $State | Add-Member -MemberType NoteProperty -Name $prop.Name -Value $prop.Value -Force
        }
    }
    return $State
}

function Add-HermesRecoveryEvent {
    param($State, [string]$Kind, [string]$Details)

    Repair-TaskStateSchema -State $State | Out-Null
    $State.RecoveryEvents = @($State.RecoveryEvents) + [pscustomobject]@{
        timestamp = Get-AgentEventTimestamp
        kind = $Kind
        details = $Details
    }
}

function Reconcile-HermesTaskState {
    param(
        $State,
        [string]$WorkspaceRoot = $RepoRoot,
        [switch]$LiveExecution,
        [switch]$Persist
    )

    Repair-TaskStateSchema -State $State | Out-Null
    $findings = @()
    $canonicalState = Get-HermesCanonicalState -State $State.State
    if ($canonicalState -ne $State.State -and $canonicalState -in $script:HermesTaskStates) {
        $oldState = $State.State
        $State.State = $canonicalState
        $State.TransitionHistory = @($State.TransitionHistory) + [pscustomobject]@{
            timestamp = Get-AgentEventTimestamp; from = $oldState; to = $canonicalState; reason = "Legacy state normalized during restart reconciliation."
        }
        $findings += "LEGACY_STATE_NORMALIZED:$oldState->$canonicalState"
    }

    $expectedWorkspace = [string]$State.WorkspaceBoundary.CanonicalWorkspace
    if ([string]::IsNullOrWhiteSpace($expectedWorkspace)) { $expectedWorkspace = $WorkspaceRoot }
    $normalizedExpected = ($expectedWorkspace -replace '/', '\').TrimEnd('\').ToLowerInvariant()
    $normalizedActual = ([string]$WorkspaceRoot -replace '/', '\').TrimEnd('\').ToLowerInvariant()
    if ($normalizedExpected -ne $normalizedActual) {
        $findings += "WORKSPACE_BINDING_MISMATCH"
        Add-HermesRecoveryEvent -State $State -Kind "WORKSPACE_BINDING_MISMATCH" -Details "Persisted workspace '$expectedWorkspace' does not match intended workspace '$WorkspaceRoot'."
        if ($State.State -notin @("COMPLETED", "CANCELLED")) { $State.State = "BLOCKED" }
    }

    $legacyModel = [string]$State.ImplementerModel
    $needsRoutingRepair = [string]::IsNullOrWhiteSpace([string]$State.ImplementerProvider) -or
        $legacyModel -in @("DEEPSEEK_FAST", "CLAUDE_FAST", "CLAUDE_DEEP", "CODEX_REVIEW") -or
        $State.Implementer -eq "DeepSeek"
    if ($needsRoutingRepair -and $State.Risk -in @("LOW", "MEDIUM", "HIGH", "CRITICAL")) {
        $approved = Get-ApprovedRoutingForRisk -Risk $State.Risk
        Add-HermesRecoveryEvent -State $State -Kind "LEGACY_ROUTING_RECONCILED" -Details "Replaced legacy provider/model metadata '$($State.Implementer)/$legacyModel'."
        $State.OriginalImplementer = if ($State.OriginalImplementer) { $State.OriginalImplementer } else { $State.Implementer }
        $State.Implementer = $approved.Implementer
        $State.ImplementerModel = $approved.ImplementerModel
        $State.ImplementerProvider = $approved.ImplementerProvider
        $findings += "LEGACY_ROUTING_RECONCILED"
    }

    if ($State.HumanApprovalRequired -eq "REQUIRED" -and $State.HumanDecision -ne "APPROVED" -and $State.State -in @("CREATED", "ROUTED")) {
        $State.State = "WAITING_APPROVAL"
        Add-HermesRecoveryEvent -State $State -Kind "APPROVAL_RESTORED" -Details "Approval-required task remains blocked pending explicit human approval."
        $findings += "WAITING_FOR_HUMAN_APPROVAL"
    }

    if ($State.State -eq "RUNNING") {
        if (-not $LiveExecution) {
            $State.ExecutionStatus = "INTERRUPTED"
            $State.ExecutionCompletedAt = $null
            $State.ExecutionResultSummary = "Interrupted or stale execution detected during restart reconciliation."
            $State.State = "BLOCKED"
            Add-HermesRecoveryEvent -State $State -Kind "INTERRUPTED_EXECUTION" -Details "RUNNING task had no live execution lease; success was not inferred."
            $findings += "INTERRUPTED_EXECUTION"
        }
    }

    if ($State.State -eq "REVIEW_PENDING" -and $State.ClaudeReviewStatus -in @("NOT_STARTED", "", $null)) {
        $State.State = "BLOCKED"
        Add-HermesRecoveryEvent -State $State -Kind "MISSING_REVIEW_ACTIVITY" -Details "Review was pending but no reviewer activity was durably recorded."
        $findings += "MISSING_REVIEW_ACTIVITY"
    }

    if ($State.State -eq "RUNNING" -and [string]::IsNullOrWhiteSpace([string]$State.ExecutionStatus)) {
        $State.ExecutionStatus = "INTERRUPTED"
        $State.State = "BLOCKED"
        Add-HermesRecoveryEvent -State $State -Kind "INCOMPLETE_EXECUTION_RECORD" -Details "Running task had no durable execution status."
        $findings += "INCOMPLETE_EXECUTION_RECORD"
    }

    if ($findings.Count -gt 0) {
        $State.LastRecoveryAt = Get-AgentEventTimestamp
    }
    if ($Persist -and (Get-Command Save-TaskState -ErrorAction SilentlyContinue)) { Save-TaskState -State $State }
    return [pscustomobject]@{
        State = $State
        Reconciled = ($findings.Count -gt 0)
        Findings = $findings
        SafeToResume = ($State.State -notin @("BLOCKED", "FAILED", "COMPLETED", "CANCELLED"))
    }
}

function Get-AgentEventTimestamp {
    return [DateTime]::UtcNow.ToString("o")
}

function Add-AgentHandoffRecord {
    param(
        $State,
        [string]$FromAgent,
        [string]$ToAgent,
        [string]$HandoffType,
        [string]$HandoffPath,
        [string]$Status = "RECORDED",
        [string]$Details = $null
    )

    Repair-TaskStateSchema -State $State | Out-Null
    $history = @($State.HandoffHistory)
    $history += [pscustomobject]@{
        timestamp = Get-AgentEventTimestamp
        fromAgent = $FromAgent
        toAgent = $ToAgent
        handoffType = $HandoffType
        handoffPath = $HandoffPath
        status = $Status
        details = $Details
    }

    $State.HandoffHistory = $history
    $State.LastHandoffAt = $history[-1].timestamp
    if (Get-Command Save-TaskState -ErrorAction SilentlyContinue) {
        if (-not [string]::IsNullOrWhiteSpace([string]$TaskStatePath)) { Save-TaskState -State $State }
    }
}

function Set-CodexExecutionRecord {
    param($State, [string]$Status, $Result = $null)

    Repair-TaskStateSchema -State $State | Out-Null
    $now = Get-AgentEventTimestamp
    if ($Status -eq "STARTED") {
        $State.CodexExecutionStartedAt = $now
        $State.ExecutionStartedAt = $now
        $State.ExecutionHeartbeatAt = $now
        $State.ExecutionAttempt = [int]$State.ExecutionAttempt + 1
        $State.ExecutionStatus = "RUNNING"
    }
    if ($Status -in @("COMPLETED", "FAILED", "UNAVAILABLE")) { $State.CodexExecutionCompletedAt = $now }
    $State.CodexExecutionStatus = $Status
    $State.CodexExecutionResult = $Result
    if ($Status -in @("COMPLETED", "FAILED", "UNAVAILABLE")) {
        $State.ExecutionStatus = $Status
        $State.ExecutionCompletedAt = $now
        $State.ExecutionResultSummary = if ($Result) { ($Result | ConvertTo-Json -Depth 5 -Compress) } else { $Status }
    }
}

function Set-ClaudeReviewRecord {
    param($State, [string]$Status, $Findings = @(), $Result = $null)

    Repair-TaskStateSchema -State $State | Out-Null
    $now = Get-AgentEventTimestamp
    if ($Status -eq "STARTED") {
        $State.ClaudeReviewStartedAt = $now
        $State.ExecutionHeartbeatAt = $now
    }
    if ($Status -in @("COMPLETED", "FAILED", "UNAVAILABLE")) { $State.ClaudeReviewCompletedAt = $now }
    $State.ClaudeReviewStatus = $Status
    $State.ClaudeReviewFindings = @($Findings)
    if ($null -ne $Result) { $State.ClaudeReviewResult = $Result }
    if ($Status -in @("COMPLETED", "FAILED", "UNAVAILABLE")) { $State.LastReviewAt = $now }
}

function Sync-PendingHumanApprovals {
    param($State)

    Repair-TaskStateSchema -State $State | Out-Null
    $pending = @($State.PendingHumanApprovals | Where-Object { $_.kind -ne "TASK_APPROVAL" })
    if ($State.HumanApprovalRequired -eq "REQUIRED" -and $State.HumanDecision -ne "APPROVED") {
        if (-not $State.ApprovalRequestedAt) { $State.ApprovalRequestedAt = Get-AgentEventTimestamp }
        $pending += [pscustomobject]@{ kind = "TASK_APPROVAL"; status = "PENDING"; requestedAt = $State.ApprovalRequestedAt }
    }
    $State.PendingHumanApprovals = $pending
}

function Get-McpActionRecord {
    param($State, [string]$Action, [string]$IdempotencyKey)
    Repair-TaskStateSchema -State $State | Out-Null
    return @($State.McpActionHistory | Where-Object { $_.action -eq $Action -and $_.idempotencyKey -eq $IdempotencyKey } | Select-Object -Last 1)
}

function Test-McpActionDuplicate {
    param($State, [string]$Action, [string]$IdempotencyKey)
    return (@(Get-McpActionRecord -State $State -Action $Action -IdempotencyKey $IdempotencyKey).Count -gt 0)
}

function Test-McpStartAllowed {
    param($State, [string]$TaskId)
    if ($State.State -eq "NONE" -or [string]::IsNullOrWhiteSpace($State.TaskId) -or $State.TaskId -ne $TaskId) {
        return [pscustomobject]@{ Allowed = $false; Reason = "The requested task does not match the current durable Hermes task." }
    }
    if ($State.State -notin @("CREATED", "ROUTED")) {
        return [pscustomobject]@{ Allowed = $false; Reason = "Task is not in a startable state." }
    }
    if ($State.Risk -in @("HIGH", "CRITICAL") -and $State.HumanApprovalRequired -eq "REQUIRED" -and $State.HumanDecision -ne "APPROVED") {
        return [pscustomobject]@{ Allowed = $false; Reason = "Human approval is required before starting this high-risk task." }
    }
    return [pscustomobject]@{ Allowed = $true; Reason = "Task is startable." }
}

function Add-McpActionRecord {
    param($State, [string]$Action, [string]$IdempotencyKey, [string]$Status, $Details = $null)
    Repair-TaskStateSchema -State $State | Out-Null
    $history = @($State.McpActionHistory)
    $history += [pscustomobject]@{
        timestamp = Get-AgentEventTimestamp
        action = $Action
        idempotencyKey = $IdempotencyKey
        taskId = $State.TaskId
        status = $Status
        details = $Details
    }
    $State.McpActionHistory = $history
    Save-TaskState -State $State
}

function Save-TaskState {
    param($State)
    Sync-PendingHumanApprovals -State $State
    if ($State.LastPersistedState -and $State.LastPersistedState -ne $State.State) {
        $transition = Test-HermesStateTransition -From $State.LastPersistedState -To $State.State
        if (-not $transition.Allowed) { throw "Invalid persisted Hermes state transition $($transition.From) -> $($transition.To)." }
    }
    $State.LastPersistedState = Get-HermesCanonicalState -State $State.State
    $directory = Split-Path -Parent $TaskStatePath
    if (-not (Test-Path -LiteralPath $directory)) { New-Item -ItemType Directory -Path $directory -Force | Out-Null }
    $temporaryPath = "$TaskStatePath.$PID.$([guid]::NewGuid().ToString('N')).tmp"
    try {
        $State | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $temporaryPath -Encoding utf8
        Move-Item -LiteralPath $temporaryPath -Destination $TaskStatePath -Force
    } finally {
        if (Test-Path -LiteralPath $temporaryPath) { Remove-Item -LiteralPath $temporaryPath -Force }
    }
    Write-CurrentTaskMarkdown -State $State
}

function Get-TaskState {
    if (Test-Path $TaskStatePath) {
        $loaded = Get-Content -Path $TaskStatePath -Raw | ConvertFrom-Json
        $leaseActive = $false
        if (Get-Command Reconcile-HermesExecutionLease -ErrorAction SilentlyContinue) {
            $leaseRecovery = Reconcile-HermesExecutionLease -State $loaded -Workspace $RepoRoot
            $leaseActive = $leaseRecovery.status -eq "ACTIVE"
        }
        $reconciled = Reconcile-HermesTaskState -State $loaded -LiveExecution:$leaseActive -WorkspaceRoot $RepoRoot -Persist
        return $reconciled.State
    }
    return New-EmptyTaskState
}

function Test-TaskExists {
    $state = Get-TaskState
    return ($state.State -ne "NONE" -and $null -ne $state.TaskId)
}

function Format-FileList {
    param([string[]]$Files, [string]$EmptyText = "(none)")
    $items = @($Files)
    if ($items.Count -eq 0) { return "- $EmptyText" }
    return ($items | ForEach-Object { "- $_" }) -join "`n"
}

function Write-CurrentTaskMarkdown {
    param($State)

    $verificationExtra = ""
    if ($State.Risk -eq "HIGH" -or $State.Risk -eq "CRITICAL") {
        $verificationExtra = "`n- [ ] Codex independent review (REQUIRED for $($State.Risk) risk)`n- [ ] Human approval before commit/push/deploy/migration"
    }

    $content = @"
# CURRENT_TASK

> This file is regenerated from ``.ai/task-state.json`` by ``tools/agent-router.ps1`` - never hand-edit one without the other going stale.

Task ID: $($State.TaskId)
Created At: $($State.CreatedAt)
Category: $($State.Category)
Risk: $($State.Risk)
Description: $($State.Description)

State: $($State.State)
Human Decision: $($State.HumanDecision)
Repair Cycles Used: $($State.RepairCyclesUsed) / $HermesMaxRepairAttempts

Implementer: $($State.Implementer)
Implementer Model: $($State.ImplementerModel)
Implementer Provider: $($State.ImplementerProvider)
$(if ($State.OriginalImplementer) { "Original Implementer: $($State.OriginalImplementer)`nCurrent Implementer: $($State.Implementer)`nFallback Implementer: $($State.FallbackImplementer)`nFallback Model: $($State.ImplementerModel)`nFallback Type: $($State.FallbackType)`nFallback Reason: $($State.ImplementerFallbackReason)`n" })
Reviewer: $($State.Reviewer)
Reviewer Model: $($State.ReviewerModel)
Reviewer Provider: $($State.ReviewerProvider)

Reason for Model Selection:
$($State.Reason)

## Approved Scope

Scope Source: $($State.ScopeSource)

Allowed Files:
$(Format-FileList -Files $State.AllowedFiles -EmptyText "(fill in before implementation begins)")

Blocked Files:
$(Format-FileList -Files $State.BlockedFiles -EmptyText "(fill in before implementation begins)")

$(if (@($State.ExplicitPathsNotFound).Count -gt 0) { "Explicit path not found:`n$(Format-FileList -Files $State.ExplicitPathsNotFound)`n`nNot auto-approved - confirm the correct path(s) before implementation begins.`n" })Scope Check: $($State.ScopeCheck)

## Canonical Work Boundary

Lock Status: $($State.WorkspaceBoundary.LockStatus)
Canonical Workspace: $($State.WorkspaceBoundary.CanonicalWorkspace)
Branch: $($State.WorkspaceBoundary.Branch)
Upstream: $(if ($State.WorkspaceBoundary.Upstream) { $State.WorkspaceBoundary.Upstream } else { "(none)" })
Divergence from origin/main: $($State.WorkspaceBoundary.AheadOfOriginMain) ahead / $($State.WorkspaceBoundary.BehindOriginMain) behind
Dirty Worktree: $($State.WorkspaceBoundary.DirtyStatusEntries) status entries; $($State.WorkspaceBoundary.DirtyTrackedContentFiles) tracked entries; $($State.WorkspaceBoundary.DirtyUntrackedEntries) untracked entries
Declared Allowed Scope:
$(Format-FileList -Files $State.WorkspaceBoundary.DeclaredAllowedScope -EmptyText "(none)")
Declared Blocked Scope:
$(Format-FileList -Files $State.WorkspaceBoundary.DeclaredBlockedScope -EmptyText "(none)")

## Changed Files

Pre-existing changes (excluded from this task):
$(Format-FileList -Files $State.PreExistingFiles)

Task-generated changes:
$(Format-FileList -Files $State.TaskGeneratedFiles)

## QA

Git Diff Check   : $($State.QA.GitDiffCheck.Result) - $($State.QA.GitDiffCheck.Reason)
TypeScript       : $($State.QA.TypeScript.Result) - $($State.QA.TypeScript.Reason)
Targeted Tests   : $($State.QA.Tests.Result) - $($State.QA.Tests.Reason)
Production Build : $($State.QA.Build.Result) - $($State.QA.Build.Reason)

## Independent Review

Review Verdict: $($State.ReviewVerdict)

## Push / Preview (Phase 4)

Branch: $(if ($State.Branch) { $State.Branch } else { "(not yet pushed)" })
Push Target: $(if ($State.PushTarget) { $State.PushTarget } else { "(none)" })
Preview Status: $($State.PreviewStatus)
Preview URL: $(if ($State.PreviewUrl) { $State.PreviewUrl } else { "(none)" })
Preview Verification: $($State.PreviewVerificationStatus)
Preview Approved: $(if ($State.PreviewApproved) { "YES" } else { "NO" })
Production Deployment Allowed: $($State.ProductionDeploymentAllowed)

## PR / Release (Phase 5)

PR: $(if ($State.PrUrl) { "$($State.PrUrl) ($($State.PrSourceBranch) -> $($State.PrTargetBranch))" } else { "(not prepared)" })
Migration Detected: $(if ($State.MigrationDetected) { "YES - separate approval required, not implemented in this phase" } else { "NO" })
Environment Change Detected: $(if ($State.EnvironmentChangeDetected) { "YES" } else { "NO" })
Release Eligibility: $($State.ReleaseEligibility)
Release Approved: $(if ($State.ReleaseApproved) { "YES" } else { "NO" })
Merge Status: $($State.MergeStatus)
Production Deployment: $($State.ProductionDeploymentStatus)
Production Verification: $($State.ProductionVerificationStatus)

## Database Safety (Phase 7)

Database Task: $(if ($State.DbRequired) { "YES" } else { "NO" })
Database State: $($State.DbState)
Database Risk: $(if ($State.DbRisk) { $State.DbRisk } else { "(not yet classified)" })
Migration File: $(if ($State.DbMigrationFile) { $State.DbMigrationFile } else { "(none)" })
Static Validation: $($State.DbStaticValidation)
Codex Database Review: $($State.DbReviewVerdict)
Migration Approved: $(if ($State.DbApproved) { "YES" } else { "NO" })
Migration Apply Approved: $(if ($State.DbApplyApproved) { "YES" } else { "NO" })
Migration Apply Status: $($State.DbApplyStatus)

## Permissions

Scope Lock: ON
Full Repo Audit: $(if ($State.FullRepoAudit) { "ON" } else { "OFF" })

Database Changes Allowed: NO
Migration Allowed: NO
Commit Allowed: NO
Push Allowed: NO
Deploy Allowed: NO

Human Approval: $($State.HumanApprovalRequired)

## Required Verification

- [ ] Inspect relevant code
- [ ] Implement change within Approved Scope only
- [ ] Targeted verification (manual check of the specific behavior changed)
- [ ] npx tsc --noEmit
- [ ] Targeted tests, if any exist for this area
- [ ] git diff --check
- [ ] npm run build (final step only, once)$verificationExtra
"@

    Set-Content -Path $CurrentTaskPath -Value $content -Encoding utf8
}

function Show-Classification {
    param(
        [string]$Description,
        $Classification
    )

    Write-Host ""
    Write-Host "========================================"
    Write-Host "TERAS AI TASK ROUTING"
    Write-Host "========================================"
    Write-Host ""
    Write-Host "Task:"
    Write-Host $Description
    Write-Host ""
    Write-Host "Category:"
    Write-Host $Classification.Category
    Write-Host ""
    Write-Host "Risk:"
    Write-Host $Classification.Risk
    Write-Host ""
    Write-Host "Implementer:"
    Write-Host $Classification.Implementer
    Write-Host ""
    Write-Host "Model:"
    Write-Host $Classification.ImplementerModel
    Write-Host ""
    Write-Host "Escalation:"
    Write-Host $Classification.EscalationNote
    Write-Host ""
    Write-Host "Independent Review:"
    Write-Host $(if ($Classification.Reviewer -eq "None") { "NOT REQUIRED" } else { $Classification.Reviewer.ToUpper() })
    Write-Host ""
    Write-Host "Scope Lock:"
    Write-Host "ON"
    Write-Host ""
    Write-Host "Full Repo Audit:"
    Write-Host $(if ($Classification.FullRepoAudit) { "ON" } else { "OFF" })
    Write-Host ""
    Write-Host "Auto Commit:"
    Write-Host "OFF"
    Write-Host ""
    Write-Host "Auto Push:"
    Write-Host "OFF"
    Write-Host ""
    Write-Host "Auto Deploy:"
    Write-Host "OFF"
    Write-Host ""
    Write-Host "Database Write:"
    Write-Host "BLOCKED"
    Write-Host ""
}
