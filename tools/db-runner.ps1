<#
    db-runner.ps1 - dedicated database migration safety system for the
    TERAS AI Engineering Orchestrator. Dot-sourced by teras-agent.ps1,
    which must set $RepoRoot, $AiDir before sourcing this file. Depends on
    agent-router.ps1 (Format-FileList, Test-AnyKeyword, $DbSensitiveKeywords),
    agent-runner.ps1 (Test-ClaudeAvailable, Invoke-ClaudeImplementation),
    review-runner.ps1 (Test-CodexAvailable, Invoke-CodexReview), and
    approval-runner.ps1 (Save-ApprovalRecord) also being sourced first.

    This is a SEPARATE approval track from the application release track
    (approval-runner.ps1 / release-runner.ps1) - see section on
    "Db* fields are independent of the app State/Risk" below. A task can be
    RELEASE_READY on the application side and still DB_AWAITING_APPROVAL on
    the database side; -Release never implies -ApproveMigration or vice
    versa, and neither implies -ApplyMigration.

    Hard safety invariants enforced in this file, not just documented:
    - never runs `supabase db reset`, `DROP DATABASE`, or any destructive
      command against any environment, ever
    - PRODUCTION apply NEVER actually executes, even after full approval
      and the strengthened confirmation phrase - this script builds the
      complete gated workflow up to that point and then hands off to
      manual execution, the same boundary held for commit/push/merge/
      deploy throughout this orchestrator. See Invoke-ApplyMigration.
    - LOCAL apply only ever runs if a local Supabase stack is actually
      detected running (`supabase status`) - never assumed
    - STAGING apply never fabricates a staging environment that isn't
      actually configured
    - migration approval is bound to a SHA-256 hash of the migration file
      plus the git commit SHA; any drift invalidates the approval and
      requires a fresh Codex review and a fresh human approval
    - Codex is never invoked a second time for the same migration content
      (same hash) - see Test-DbReviewStale
    - no connection string, service-role key, or credential is ever
      written into a report file - see Get-RedactedText

    --- Control-plane hardening: independent bounded-local-DB runtime gate ---

    Invoke-BoundedLocalDatabaseValidation is the SOLE entry point that may
    ever authorize a local disposable database validation iteration. It
    independently re-verifies everything end to end from CURRENT live
    state - it never trusts a cached "verified" flag, a mutable
    .ai/task-state.json boolean alone, or the mere presence of an
    AuthorityProof object:
      1. Strict authority schema (Test-AuthorityProofSchema) - missing,
         unknown, malformed, or unsupported proof fields fail closed.
      2. HMAC-SHA256 re-verification (Test-ApprovalProofValid) - recomputes
         the canonical tuple from the proof's bound values plus the
         CURRENT task-state permission/allowlist/files, and independently
         re-derives the signature from the external DPAPI trust-root key.
      3. Exact worktree/branch/HEAD guard (Test-ExactWorktreeAuthorized) -
         the actual current repository location, branch, and HEAD must
         equal exactly what the proof bound; the canonical (non-worktree)
         checkout and any other worktree are rejected, not just "other
         repos."
      4. Exact migration allowlist (Test-ExactMigrationAllowlist) - every
         migration path this iteration would touch must be a literal,
         case-sensitive member of the proof-bound allowlist; no wildcard,
         directory-prefix, or inferred match is ever accepted.
      5. Local disposable DB restriction checks (Test-LocalDbRestrictions)
         - localhost/disposable only, network isolation, no published
         ports, no persistent volume, synthetic data only.
      6. Consumption ledger: the one iteration is CONSUMED (via
         Consume-ConsumptionLedgerEntry in approval-runner.ps1) only after
         every check above has already passed, and strictly before any
         runtime/apply step is allowed to begin. ANY failure in this
         function - at any step - permanently latches the ledger entry
         (Set-ConsumptionLedgerLatch) so a retried or replayed call can
         never succeed afterward, even if the underlying defect is later
         fixed; a fresh task/approval cycle is required.

    Per AGENTS.md/this task's instructions, this orchestrator never
    actually starts Postgres or Docker - Invoke-BoundedLocalDatabaseValidation
    stops at "all preconditions satisfied; runtime execution out of scope
    here" and never shells out to `docker run`/`supabase start` itself.
#>

$script:MigrationFilenamePattern = '^\d{14}_[a-z0-9_]+\.sql$'

$script:SqlDangerPatterns = [ordered]@{
    "DROP TABLE"                     = '(?im)\bDROP\s+TABLE\b'
    "DROP SCHEMA"                    = '(?im)\bDROP\s+SCHEMA\b'
    "DROP COLUMN"                    = '(?im)\bDROP\s+COLUMN\b'
    "TRUNCATE"                       = '(?im)\bTRUNCATE\b'
    "DELETE FROM"                    = '(?im)\bDELETE\s+FROM\b'
    "ALTER TABLE ... DROP"           = '(?im)\bALTER\s+TABLE\s+\S+\s+DROP\b'
    "CASCADE"                        = '(?im)\bCASCADE\b'
    "DISABLE ROW LEVEL SECURITY"     = '(?im)\bDISABLE\s+ROW\s+LEVEL\s+SECURITY\b'
    "GRANT ALL"                      = '(?im)\bGRANT\s+ALL\b'
    "SECURITY DEFINER"               = '(?im)\bSECURITY\s+DEFINER\b'
}

$script:CertificateDbTokens = @(
    "certificate_number", "verification_token", "verification_url", "status",
    "verification_enabled", "deleted_at", "eligibility", "verify_and_log",
    "certificate"
)

$script:ObjectPatterns = @(
    @{ Label = "table"; Regex = '(?im)^\s*CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([\w\.]+)"?' }
    @{ Label = "table (altered)"; Regex = '(?im)^\s*ALTER\s+TABLE\s+"?([\w\.]+)"?' }
    @{ Label = "policy"; Regex = "(?im)^\s*CREATE\s+POLICY\s+[`"']?([\w ]+?)[`"']?\s+ON\s+([\w\.]+)" }
    @{ Label = "function"; Regex = '(?im)^\s*CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+"?([\w\.]+)"?' }
    @{ Label = "trigger"; Regex = '(?im)^\s*CREATE\s+(?:OR\s+REPLACE\s+)?TRIGGER\s+"?([\w\.]+)"?' }
    @{ Label = "index"; Regex = '(?im)^\s*CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([\w\.]+)"?' }
    @{ Label = "constraint"; Regex = '(?im)\bADD\s+CONSTRAINT\s+"?([\w\.]+)"?' }
)

$script:CriticalKeywords = @(
    "drop table", "drop column", "delete", "truncate", "cascade",
    "auth", "service_role", "security definer", "widen", "expand access"
)

# ---------------------------------------------------------------------------
# Control-plane hardening: independent bounded-local-DB runtime gate.
# See the file header for the full chain. Every function below is a pure
# verification step with no side effect other than Invoke-
# BoundedLocalDatabaseValidation's own ledger consumption/latch calls -
# none of them ever starts Postgres, Docker, or any other runtime.
# ---------------------------------------------------------------------------

# Exactly these 8 fields are authoritative on an AuthorityProof object -
# matches the AuthorityProof shape in agent-router.ps1's New-EmptyTaskState
# and the Proof shape returned by approval-runner.ps1's New-ApprovalProof.
# Any missing, unknown, or malformed (null/wrong-type) field fails closed,
# per "strict authority schema" (section 5 of the hardening task).
$script:AuthorityProofFieldSchema = @("SchemaVersion", "Nonce", "ApprovedAtUtc", "WorktreePath", "Branch", "BaseHeadSha", "Hmac", "ConsumptionLedgerPath")

function Test-AuthorityProofSchema {
    param($Proof)

    if ($null -eq $Proof) {
        return [pscustomobject]@{ Valid = $false; Reason = "AUTHORITY_PROOF_MISSING" }
    }

    $actualNames = @($Proof.PSObject.Properties.Name)
    $missing = @($script:AuthorityProofFieldSchema | Where-Object { $_ -notin $actualNames })
    $unknown = @($actualNames | Where-Object { $_ -notin $script:AuthorityProofFieldSchema })
    if ($missing.Count -gt 0) {
        return [pscustomobject]@{ Valid = $false; Reason = "AUTHORITY_PROOF_SCHEMA_MISSING_FIELDS: $($missing -join ', ')" }
    }
    if ($unknown.Count -gt 0) {
        return [pscustomobject]@{ Valid = $false; Reason = "AUTHORITY_PROOF_SCHEMA_UNKNOWN_FIELDS: $($unknown -join ', ')" }
    }
    foreach ($field in $script:AuthorityProofFieldSchema) {
        $value = $Proof.$field
        if ([string]::IsNullOrWhiteSpace([string]$value)) {
            return [pscustomobject]@{ Valid = $false; Reason = "AUTHORITY_PROOF_SCHEMA_EMPTY_FIELD: $field" }
        }
    }
    if ($Proof.SchemaVersion -ne $script:ApprovalProofSchemaVersion) {
        return [pscustomobject]@{ Valid = $false; Reason = "AUTHORITY_PROOF_SCHEMA_VERSION_UNSUPPORTED: $($Proof.SchemaVersion)" }
    }
    if ($Proof.BaseHeadSha -notmatch '^[0-9a-f]{40}$') {
        return [pscustomobject]@{ Valid = $false; Reason = "AUTHORITY_PROOF_SCHEMA_MALFORMED_HEAD_SHA" }
    }
    if ($Proof.Hmac -notmatch '^[0-9a-f]{64}$') {
        return [pscustomobject]@{ Valid = $false; Reason = "AUTHORITY_PROOF_SCHEMA_MALFORMED_HMAC" }
    }
    # HIGH-2 repair: strict nonce format is part of the strict schema -
    # exact fixed-length lowercase hex, matching New-ApprovalProof's own
    # generator (see $script:NonceFormatPattern / Test-NonceFormat in
    # approval-runner.ps1). This check runs BEFORE any filesystem path is
    # ever built from the Nonce field, anywhere in the chain below.
    if (-not (Test-NonceFormat ([string]$Proof.Nonce))) {
        return [pscustomobject]@{ Valid = $false; Reason = "AUTHORITY_PROOF_SCHEMA_MALFORMED_NONCE" }
    }
    return [pscustomobject]@{ Valid = $true; Reason = "OK" }
}

# Independently recomputes the canonical tuple and HMAC from the proof's
# bound identity fields plus the CURRENT task-state permission/allowlist/
# files, then re-derives the signature from the external trust root. This
# is the actual cryptographic re-verification step - a tampered
# permission, allowlist entry, allowed-file list, task id, or any proof
# identity field changes the recomputed tuple bytes and therefore fails
# the comparison; a tampered Hmac field fails it directly.
#
# MEDIUM-1 repair: ConsumptionLedgerPath is now (a) part of the signed
# tuple itself (see New-ApprovalCanonicalTuple) and (b) independently
# cross-checked here against the path actually DERIVED from the proof's
# own (schema-validated, fixed-format) Nonce via the single canonical
# Get-ConsumptionLedgerPathForNonce helper - never trusted as a free-form
# string. A proof whose claimed ConsumptionLedgerPath does not match the
# nonce-derived path fails closed here, independently of the HMAC check.
function Test-ApprovalProofValid {
    param($State)

    $schemaCheck = Test-AuthorityProofSchema -Proof $State.AuthorityProof
    if (-not $schemaCheck.Valid) {
        return [pscustomobject]@{ Valid = $false; Reason = $schemaCheck.Reason }
    }

    $proof = $State.AuthorityProof

    # Nonce format is already schema-validated above - safe to derive a
    # path from it now, strictly for the cross-check comparison below.
    # This NEVER mutates the filesystem (Get-ConsumptionLedgerPathForNonce
    # only computes a candidate path; it is read-only).
    $derivedLedgerPath = Get-ConsumptionLedgerPathForNonce -Nonce ([string]$proof.Nonce)
    if ($null -eq $derivedLedgerPath) {
        return [pscustomobject]@{ Valid = $false; Reason = "AUTHORITY_PROOF_NONCE_PATH_DERIVATION_FAILED" }
    }
    $claimedLedgerPath = [IO.Path]::GetFullPath([string]$proof.ConsumptionLedgerPath)
    if (-not [string]::Equals($claimedLedgerPath, $derivedLedgerPath, [StringComparison]::OrdinalIgnoreCase)) {
        return [pscustomobject]@{ Valid = $false; Reason = "AUTHORITY_PROOF_CONSUMPTION_LEDGER_PATH_MISMATCH" }
    }

    $keyBytes = Get-ApprovalTrustKeyBytes -Path (Get-ApprovalTrustKeyPath)
    if ($null -eq $keyBytes) {
        return [pscustomobject]@{ Valid = $false; Reason = "TRUST_ROOT_KEY_MISSING_OR_UNREADABLE" }
    }

    $tuple = New-ApprovalCanonicalTuple -State $State -WorktreePath $proof.WorktreePath -Branch $proof.Branch -BaseHeadSha $proof.BaseHeadSha -Nonce $proof.Nonce -ApprovedAtUtc $proof.ApprovedAtUtc -ConsumptionLedgerPath $claimedLedgerPath
    $canonicalJson = Get-ApprovalCanonicalTupleJson -Tuple $tuple
    $expectedHmac = Get-HmacSha256Hex -KeyBytes $keyBytes -Message $canonicalJson

    if (-not (Test-ConstantTimeStringEqual -A $expectedHmac -B ([string]$proof.Hmac))) {
        return [pscustomobject]@{ Valid = $false; Reason = "AUTHORITY_PROOF_HMAC_MISMATCH_TAMPER_DETECTED" }
    }
    return [pscustomobject]@{ Valid = $true; Reason = "OK" }
}

# Rejects the canonical (non-worktree) checkout and any worktree other
# than the exact one the proof was bound to - comparing the live,
# resolved current repository path, branch, and HEAD against the proof's
# bound values. A worktree sharing git history with the canonical
# checkout (as all linked worktrees do) is still rejected unless its path
# is the literal one named in the proof.
function Test-ExactWorktreeAuthorized {
    param($State, [string]$RepoRoot)

    $schemaCheck = Test-AuthorityProofSchema -Proof $State.AuthorityProof
    if (-not $schemaCheck.Valid) {
        return [pscustomobject]@{ Authorized = $false; Reason = $schemaCheck.Reason }
    }
    $proof = $State.AuthorityProof

    if (-not (Test-Path -LiteralPath $RepoRoot)) {
        return [pscustomobject]@{ Authorized = $false; Reason = "REPO_ROOT_NOT_FOUND" }
    }
    $currentWorktree = (Resolve-Path -LiteralPath $RepoRoot).Path.TrimEnd('\', '/')
    $boundWorktree = [string]$proof.WorktreePath
    if ($boundWorktree) { $boundWorktree = $boundWorktree.TrimEnd('\', '/') }
    if (-not [string]::Equals($currentWorktree, $boundWorktree, [StringComparison]::OrdinalIgnoreCase)) {
        return [pscustomobject]@{ Authorized = $false; Reason = "WORKTREE_MISMATCH: current='$currentWorktree' authorized='$boundWorktree' (canonical checkouts and other/undeclared worktrees are always rejected)" }
    }

    Push-Location $RepoRoot
    try {
        $currentBranch = (git rev-parse --abbrev-ref HEAD 2>$null | Out-String).Trim()
        $currentHead = (git rev-parse HEAD 2>$null | Out-String).Trim()
    } catch {
        return [pscustomobject]@{ Authorized = $false; Reason = "GIT_METADATA_UNAVAILABLE" }
    } finally {
        Pop-Location
    }

    if (-not [string]::Equals($currentBranch, [string]$proof.Branch, [StringComparison]::Ordinal)) {
        return [pscustomobject]@{ Authorized = $false; Reason = "BRANCH_MISMATCH: current='$currentBranch' authorized='$($proof.Branch)'" }
    }
    if (-not [string]::Equals($currentHead, [string]$proof.BaseHeadSha, [StringComparison]::Ordinal)) {
        return [pscustomobject]@{ Authorized = $false; Reason = "HEAD_MISMATCH: current='$currentHead' authorized='$($proof.BaseHeadSha)'" }
    }
    return [pscustomobject]@{ Authorized = $true; Reason = "OK" }
}

# Exact set equality after ordinal deterministic normalization. No subset,
# prefix, wildcard, duplicate, or malformed entry can authorize execution.
function Test-ExactMigrationAllowlist {
    param([string[]]$RequestedMigrations, [string[]]$Allowlist)

    $pattern = '^supabase/migrations/\d{14}_[a-z0-9_]+\.sql$'
    $requested = @($RequestedMigrations | ForEach-Object { [string]$_ })
    $allowed = @($Allowlist | ForEach-Object { [string]$_ })
    if (@($requested | Where-Object { $_ -notmatch $pattern }).Count -gt 0 -or
        @($allowed | Where-Object { $_ -notmatch $pattern }).Count -gt 0) {
        return [pscustomobject]@{ Authorized = $false; Reason = "MIGRATION_SET_MALFORMED"; Unauthorized = @() }
    }
    if (@($requested | Select-Object -Unique).Count -ne $requested.Count -or
        @($allowed | Select-Object -Unique).Count -ne $allowed.Count) {
        return [pscustomobject]@{ Authorized = $false; Reason = "MIGRATION_SET_DUPLICATE"; Unauthorized = @() }
    }
    [string[]]$requestedCanonical = @($requested)
    [string[]]$allowedCanonical = @($allowed)
    [Array]::Sort($requestedCanonical, [StringComparer]::Ordinal)
    [Array]::Sort($allowedCanonical, [StringComparer]::Ordinal)
    if (($requestedCanonical -join "`n") -cne ($allowedCanonical -join "`n")) {
        return [pscustomobject]@{ Authorized = $false; Reason = "PENDING_MIGRATION_SET_MISMATCH"; Unauthorized = @($requestedCanonical) }
    }
    return [pscustomobject]@{ Authorized = $true; Reason = "OK"; Unauthorized = @() }
}

# Control-plane hardening (Task 1 - exact pending migration set): the SOLE
# place that shells out to the Supabase CLI's dry-run preflight. Factored
# out exactly like Invoke-LocalSupabaseDbPushExecution so it can be
# deterministically overridden in tests (function redefinition after
# dot-sourcing) without ever touching the real CLI/local stack during
# regression testing. Fixed, non-caller-controlled argv only - no caller
# anywhere can inject --linked/--db-url/a target in place of --local.
function Invoke-LocalSupabaseDbPushDryRunExecution {
    $dryRunArgs = @("db", "push", "--local", "--dry-run")
    try {
        $output = @(& supabase @dryRunArgs 2>&1 | ForEach-Object { [string]$_ })
        return [pscustomobject]@{ Output = $output; ExitCode = $LASTEXITCODE }
    } catch {
        return [pscustomobject]@{ Output = @(); ExitCode = 1 }
    }
}

# Supabase documents db push --dry-run as printing the migrations that would
# be applied. Accept only the known line-oriented CLI contract; any extra,
# changed, ambiguous, duplicate, or malformed output fails closed. Both
# preflight and execution have fixed local-only argv and accept no target.
function Get-LocalPendingMigrationSet {
    Push-Location $RepoRoot
    try {
        $dryRun = Invoke-LocalSupabaseDbPushDryRunExecution
        $output = @($dryRun.Output)
        $exitCode = $dryRun.ExitCode
    } catch {
        return [pscustomobject]@{ Success = $false; Migrations = @(); Reason = "LOCAL_DRY_RUN_FAILED" }
    } finally {
        Pop-Location
    }
    if ($exitCode -ne 0) { return [pscustomobject]@{ Success = $false; Migrations = @(); Reason = "LOCAL_DRY_RUN_FAILED" } }

    $foundBanner = $false
    $foundFinished = $false
    $migrations = @()
    foreach ($line in $output) {
        if ([string]::IsNullOrWhiteSpace($line)) { continue }
        if ($line -ceq "DRY RUN: migrations will *not* be pushed to the database.") {
            if ($foundBanner) { return [pscustomobject]@{ Success = $false; Migrations = @(); Reason = "LOCAL_DRY_RUN_AMBIGUOUS" } }
            $foundBanner = $true
            continue
        }
        if ($line -ceq "Finished supabase db push.") {
            if ($foundFinished) { return [pscustomobject]@{ Success = $false; Migrations = @(); Reason = "LOCAL_DRY_RUN_AMBIGUOUS" } }
            $foundFinished = $true
            continue
        }
        if ($line -match '^Would push migration ([^\s]+)\.\.\.$') {
            $name = $Matches[1]
            if ($name -notmatch '^\d{14}_[a-z0-9_]+\.sql$') { return [pscustomobject]@{ Success = $false; Migrations = @(); Reason = "LOCAL_DRY_RUN_MALFORMED_MIGRATION" } }
            $migrations += "supabase/migrations/$name"
            continue
        }
        return [pscustomobject]@{ Success = $false; Migrations = @(); Reason = "LOCAL_DRY_RUN_UNKNOWN_OUTPUT" }
    }
    if (-not $foundBanner -or -not $foundFinished -or $migrations.Count -eq 0) {
        return [pscustomobject]@{ Success = $false; Migrations = @(); Reason = "LOCAL_DRY_RUN_INCOMPLETE_OR_EMPTY" }
    }
    if (@($migrations | Select-Object -Unique).Count -ne $migrations.Count) {
        return [pscustomobject]@{ Success = $false; Migrations = @(); Reason = "LOCAL_DRY_RUN_DUPLICATE_MIGRATION" }
    }
    [string[]]$canonical = @($migrations)
    [Array]::Sort($canonical, [StringComparer]::Ordinal)
    return [pscustomobject]@{ Success = $true; Migrations = $canonical; Reason = "OK" }
}

# Local disposable DB restrictions (section 11) - checked against the
# live CURRENT task-state permission fields, never a cached/legacy value.
# Any single violation fails closed.
function Test-LocalDbRestrictions {
    param($State)

    $violations = @()
    if (-not $State.LocalDisposableDatabaseAllowed) { $violations += "LocalDisposableDatabaseAllowed is not granted" }
    if (-not $State.LocalMigrationValidationAllowed) { $violations += "LocalMigrationValidationAllowed is not granted" }
    if ([int]$State.DockerIterationsAllowed -ne 1) { $violations += "DockerIterationsAllowed must be exactly 1 (got $($State.DockerIterationsAllowed))" }
    if (-not $State.StopOnFirstFailure) { $violations += "StopOnFirstFailure is not enabled" }
    if (-not $State.SyntheticDataOnly) { $violations += "SyntheticDataOnly is not enabled" }
    if ($State.RemoteDbAllowed) { $violations += "RemoteDbAllowed must remain denied" }
    if ($State.StagingAllowed) { $violations += "StagingAllowed must remain denied" }
    if ($State.ProductionAllowed) { $violations += "ProductionAllowed must remain denied" }
    if ($State.PublishedPortsAllowed) { $violations += "PublishedPortsAllowed must remain denied (no published ports)" }
    if ($State.PersistentDbVolumeAllowed) { $violations += "PersistentDbVolumeAllowed must remain denied (no persistent volume)" }
    if ($State.SourceEditAllowedDuringRuntime) { $violations += "SourceEditAllowedDuringRuntime must remain denied (no source edit during runtime)" }
    if ($State.PushAllowed -or $State.MergeAllowed -or $State.DeployAllowed) { $violations += "Push/Merge/Deploy must remain denied during a bounded local DB iteration" }
    if (@($State.LocalMigrationAllowlist).Count -eq 0) { $violations += "LocalMigrationAllowlist must name at least one exact migration path" }

    if ($violations.Count -gt 0) {
        return [pscustomobject]@{ Compliant = $false; Reason = ($violations -join "; ") }
    }
    return [pscustomobject]@{ Compliant = $true; Reason = "OK" }
}

# The sole entry point that may ever authorize a bounded local disposable
# database validation iteration. See the file header for the full chain.
#
# CRITICAL TRUST ORDER (HIGH-2 repair): the first-failure latch is a
# filesystem mutation keyed by Nonce. It may ONLY ever be applied to a
# nonce whose identity has already been cryptographically authenticated -
# i.e. strictly AFTER Test-ApprovalProofValid has returned Valid = $true.
# A PROOF_VERIFICATION failure (bad schema, malformed/traversal-shaped
# nonce, tampered tuple field, or HMAC mismatch) means the caller-supplied
# AuthorityProof has NOT been established as authentic, so this function
# denies WITHOUT touching the consumption ledger at all - never latching,
# never creating, never reading past the point needed to return Invalid.
# Every stage AFTER proof verification operates on an already-authenticated
# nonce, so latching on those later failures remains safe and required
# (a retried/replayed call can never silently succeed afterward, even if
# the underlying defect is later fixed - a fresh task/approval cycle is
# required).
function Invoke-BoundedLocalDatabaseValidation {
    param($State, [string]$RepoRoot, [string[]]$RequestedMigrations = @())

    $proofCheck = Test-ApprovalProofValid -State $State
    if (-not $proofCheck.Valid) {
        # No ledger mutation here - the nonce is not yet authenticated.
        return [pscustomobject]@{ Authorized = $false; Stage = "PROOF_VERIFICATION"; Reason = $proofCheck.Reason }
    }

    # From this point on, $State.AuthorityProof.Nonce is authenticated
    # (its HMAC over the full canonical tuple, including this exact
    # nonce, has been independently re-verified) - safe to use as a
    # latch/consumption key for every remaining stage.
    $worktreeCheck = Test-ExactWorktreeAuthorized -State $State -RepoRoot $RepoRoot
    if (-not $worktreeCheck.Authorized) {
        Set-ConsumptionLedgerLatch -Nonce $State.AuthorityProof.Nonce -Reason "WORKTREE_GUARD_FAILED: $($worktreeCheck.Reason)" | Out-Null
        return [pscustomobject]@{ Authorized = $false; Stage = "WORKTREE_GUARD"; Reason = $worktreeCheck.Reason }
    }

    $restrictionsCheck = Test-LocalDbRestrictions -State $State
    if (-not $restrictionsCheck.Compliant) {
        Set-ConsumptionLedgerLatch -Nonce $State.AuthorityProof.Nonce -Reason "LOCAL_DB_RESTRICTIONS_FAILED: $($restrictionsCheck.Reason)" | Out-Null
        return [pscustomobject]@{ Authorized = $false; Stage = "LOCAL_DB_RESTRICTIONS"; Reason = $restrictionsCheck.Reason }
    }

    $pending = Get-LocalPendingMigrationSet
    if (-not $pending.Success) {
        Set-ConsumptionLedgerLatch -Nonce $State.AuthorityProof.Nonce -Reason "LOCAL_PENDING_SET_PREFLIGHT_FAILED: $($pending.Reason)" | Out-Null
        return [pscustomobject]@{ Authorized = $false; Stage = "PENDING_SET_PREFLIGHT"; Reason = $pending.Reason }
    }
    $allowlistCheck = Test-ExactMigrationAllowlist -RequestedMigrations $pending.Migrations -Allowlist $State.LocalMigrationAllowlist
    if (-not $allowlistCheck.Authorized) {
        Set-ConsumptionLedgerLatch -Nonce $State.AuthorityProof.Nonce -Reason "PENDING_MIGRATION_SET_FAILED: $($allowlistCheck.Reason)" | Out-Null
        return [pscustomobject]@{ Authorized = $false; Stage = "PENDING_MIGRATION_SET"; Reason = $allowlistCheck.Reason }
    }
    $requestedCheck = Test-ExactMigrationAllowlist -RequestedMigrations $RequestedMigrations -Allowlist $State.LocalMigrationAllowlist
    if (-not $requestedCheck.Authorized) {
        Set-ConsumptionLedgerLatch -Nonce $State.AuthorityProof.Nonce -Reason "REQUESTED_MIGRATION_SET_FAILED: $($requestedCheck.Reason)" | Out-Null
        return [pscustomobject]@{ Authorized = $false; Stage = "MIGRATION_ALLOWLIST"; Reason = $requestedCheck.Reason }
    }

    # Consume strictly before any runtime/apply step is allowed to begin -
    # never after. A consumption failure (budget exhausted, replay,
    # already latched, lock contention) fails closed and also latches.
    $consumeResult = Consume-ConsumptionLedgerEntry -Nonce $State.AuthorityProof.Nonce
    if (-not $consumeResult.Success) {
        Set-ConsumptionLedgerLatch -Nonce $State.AuthorityProof.Nonce -Reason "CONSUMPTION_FAILED: $($consumeResult.Reason)" | Out-Null
        return [pscustomobject]@{ Authorized = $false; Stage = "CONSUMPTION_LEDGER"; Reason = $consumeResult.Reason }
    }

    return [pscustomobject]@{ Authorized = $true; Stage = "COMPLETE"; Reason = "All preconditions satisfied and the one authorized iteration has been consumed. Runtime execution (Postgres/Docker) is out of scope for this orchestrator and is never started automatically." }
}

# ---------------------------------------------------------------------------
# Detection / static analysis - all pure text operations, no live DB query.
# ---------------------------------------------------------------------------

function Test-MigrationFilenameConvention {
    param([string]$Path)
    $name = Split-Path -Leaf $Path
    return ($name -match $script:MigrationFilenamePattern)
}

# A migration file is only "new" if it did not exist at HEAD before this
# task's changes - historical migrations are immutable (section 5).
function Test-MigrationIsNew {
    param([string]$Path)
    Push-Location $RepoRoot
    try {
        # A nonexistent path is the expected/common case (a brand-new
        # migration), not a real error - `git cat-file -e`'s non-zero exit
        # throws under this script's $ErrorActionPreference = "Stop" even
        # with stderr redirected, so this must be a try/catch, not a
        # $LASTEXITCODE check.
        git cat-file -e "HEAD:$Path" 2>$null
        return $false
    } catch {
        return $true
    } finally {
        Pop-Location
    }
}

function Get-MigrationHash {
    param([string]$Path)
    $fullPath = Join-Path $RepoRoot $Path
    if (-not (Test-Path $fullPath)) { return $null }
    return (Get-FileHash -Path $fullPath -Algorithm SHA256).Hash
}

function Get-SqlDangerScan {
    param([string]$Sql)

    $flags = @()
    foreach ($label in $script:SqlDangerPatterns.Keys) {
        if ($Sql -match $script:SqlDangerPatterns[$label]) { $flags += $label }
    }

    foreach ($stmt in ($Sql -split ';')) {
        if ($stmt -match '(?im)^\s*UPDATE\s+\S+\s+SET' -and $stmt -notmatch '(?im)\bWHERE\b') {
            $flags += "UPDATE without WHERE"
            break
        }
    }

    return @($flags | Select-Object -Unique)
}

function Get-SqlObjectsChanged {
    param([string]$Sql)

    $objects = @()
    foreach ($p in $script:ObjectPatterns) {
        foreach ($m in [regex]::Matches($Sql, $p.Regex)) {
            $objects += "$($p.Label): $($m.Groups[1].Value.Trim())"
        }
    }
    return @($objects | Select-Object -Unique)
}

function Test-CertificateDbImpact {
    param([string]$Sql)
    foreach ($token in $script:CertificateDbTokens) {
        if ($Sql -match "(?im)\b$([regex]::Escape($token))\b") { return $true }
    }
    return $false
}

function Test-DataMigration {
    param([string]$Sql)
    return ($Sql -match '(?im)^\s*(UPDATE|DELETE|INSERT\s+INTO\s+\S+\s+SELECT)\b')
}

function Get-ForeignKeyNotes {
    param([string]$Sql)
    $notes = @()
    if ($Sql -match '(?im)\bREFERENCES\b') {
        if ($Sql -match '(?im)ON\s+DELETE\s+CASCADE') { $notes += "ON DELETE CASCADE present - confirm cascade is intentional, not assumed safe." }
        if ($Sql -notmatch '(?im)ON\s+DELETE\b') { $notes += "Foreign key with no explicit ON DELETE behavior - confirm the default (NO ACTION/RESTRICT) is intended." }
        $notes += "New foreign key detected - verify no orphaned records exist for the referencing column before this can be applied."
    }
    return @($notes)
}

function Get-IndexNotes {
    param([string]$Sql)
    $notes = @()
    if ($Sql -match '(?im)\bCREATE\s+(UNIQUE\s+)?INDEX\b') {
        $notes += "Index creation detected - confirm this has an explicit query/constraint purpose, not speculative, and that build-time locking impact on a live table has been considered."
    }
    return @($notes)
}

function Get-DatabaseRisk {
    param([string]$Sql, [string]$Description)

    $danger = Get-SqlDangerScan -Sql $Sql
    $destructive = @($danger | Where-Object { $_ -in @("DROP TABLE", "DROP SCHEMA", "DROP COLUMN", "TRUNCATE", "DELETE FROM", "ALTER TABLE ... DROP") }).Count -gt 0
    $securityDefiner = ($danger -contains "SECURITY DEFINER")
    # RLS/auth access expansion (section 3's CRITICAL list) is not just
    # DISABLE RLS / GRANT ALL - a brand-new policy granting anon/public
    # access with an unconditional USING (true) is the far more common way
    # a migration actually widens access, and is just as CRITICAL.
    $rlsExpansion = ($Sql -match '(?im)\bDISABLE\s+ROW\s+LEVEL\s+SECURITY\b') -or
                     ($Sql -match '(?im)\bGRANT\s+ALL\b') -or
                     (($Sql -match '(?ims)\bCREATE\s+POLICY\b.*?\bTO\s+(anon|public)\b') -and ($Sql -match '(?im)USING\s*\(\s*true\s*\)'))
    $certImpact = Test-CertificateDbImpact -Sql $Sql
    $dataMigration = Test-DataMigration -Sql $Sql
    $hasUnique = ($Sql -match '(?im)\bUNIQUE\b')

    $isCritical = $destructive -or $securityDefiner -or $rlsExpansion -or $certImpact -or $dataMigration -or
                  (Test-AnyKeyword -Text $Description -Keywords $script:CriticalKeywords)

    return [pscustomobject]@{
        Risk               = if ($isCritical) { "CRITICAL" } else { "HIGH" }
        DangerousStatements = $danger
        Destructive        = $destructive
        SecurityDefiner    = $securityDefiner
        RlsImpact          = ($Sql -match '(?im)\b(POLICY|ROW\s+LEVEL\s+SECURITY)\b')
        AuthImpact         = ($Sql -match '(?im)\bauth\.')
        CertificateImpact  = $certImpact
        DataMigration      = $dataMigration
        HasUniqueConstraint = $hasUnique
        ObjectsChanged     = Get-SqlObjectsChanged -Sql $Sql
        ForeignKeyNotes    = Get-ForeignKeyNotes -Sql $Sql
        IndexNotes         = Get-IndexNotes -Sql $Sql
    }
}

# Never let a connection string or key leak into a generated report, even
# accidentally pasted into a description or found in surrounding SQL comments.
function Get-RedactedText {
    param([string]$Text)
    if ([string]::IsNullOrEmpty($Text)) { return $Text }
    $redacted = $Text -replace '(?i)(postgres(?:ql)?:\/\/)[^@\s]+@', '$1***REDACTED***@'
    $redacted = $redacted -replace '(?i)(service_role|SUPABASE_SERVICE_ROLE_KEY)\s*[:=]\s*\S+', '$1=***REDACTED***'
    $redacted = $redacted -replace 'eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\S*', '***REDACTED_JWT***'
    return $redacted
}

# ---------------------------------------------------------------------------
# -PrepareMigration
# ---------------------------------------------------------------------------

function Find-MigrationFile {
    param($State)
    $candidates = @(@($State.TaskGeneratedFiles) | Where-Object { $_ -match '(^|/)supabase/migrations/.*\.sql$' })
    if ($candidates.Count -gt 0) { return $candidates[0] }
    return $null
}

# Read-only admission: preparation does not consume a local DB iteration.
# Both the index blob and the normalized working-file blob must match HEAD.
function Assert-ExistingTrackedMigrationForReview {
    param($State, [string]$MigrationFile)

    if ($State.State -eq 'NONE' -or [string]::IsNullOrWhiteSpace([string]$State.TaskId)) {
        throw 'TRACKED_MIGRATION_REJECTED: no current task'
    }
    if ($MigrationFile -cnotmatch '^supabase/migrations/\d{14}_[a-z0-9_]+\.sql$') {
        throw 'TRACKED_MIGRATION_REJECTED: path must be an exact repo-relative migration SQL path'
    }
    $proof = Test-ApprovalProofValid -State $State
    if (-not $proof.Valid) { throw "TRACKED_MIGRATION_REJECTED: signed authorization invalid ($($proof.Reason))" }
    $identity = Test-ExactWorktreeAuthorized -State $State -RepoRoot $RepoRoot
    if (-not $identity.Authorized) { throw "TRACKED_MIGRATION_REJECTED: worktree/branch/HEAD mismatch ($($identity.Reason))" }
    $restrictions = Test-LocalDbRestrictions -State $State
    if (-not $restrictions.Compliant) { throw "TRACKED_MIGRATION_REJECTED: local authorization restricted ($($restrictions.Reason))" }
    $allowed = @($State.LocalMigrationAllowlist | Where-Object { [string]::Equals([string]$_, $MigrationFile, [StringComparison]::Ordinal) })
    if ($allowed.Count -ne 1) { throw 'TRACKED_MIGRATION_REJECTED: file is not an exact member of the signed migration allowlist' }
    if (-not (Test-ExplicitPathExists -RelativePath $MigrationFile)) {
        throw 'TRACKED_MIGRATION_REJECTED: missing file or reparse-point path component'
    }

    $tree = Invoke-GitRepositoryProbe -RepoRoot $RepoRoot -GitArguments @('ls-tree', '-r', '--name-only', 'HEAD', '--', 'supabase/migrations/')
    if (-not $tree.Success) { throw 'TRACKED_MIGRATION_REJECTED: HEAD migration tree unavailable' }
    $version = $MigrationFile.Substring('supabase/migrations/'.Length, 14)
    $sameVersion = @($tree.Output | Where-Object { [string]$_ -cmatch "^supabase/migrations/${version}_" })
    if ($sameVersion.Count -ne 1 -or [string]$sameVersion[0] -cne $MigrationFile) {
        throw 'TRACKED_MIGRATION_REJECTED: migration version/path absent or ambiguous in HEAD'
    }
    $localVersion = @(Get-ChildItem -LiteralPath (Join-Path $RepoRoot 'supabase/migrations') -File -Force |
        Where-Object { $_.Name -cmatch "^${version}_" })
    if ($localVersion.Count -ne 1 -or $localVersion[0].Name -cne (Split-Path -Leaf $MigrationFile)) {
        throw 'TRACKED_MIGRATION_REJECTED: migration version/path ambiguous in working tree'
    }
    $headEntry = Invoke-GitRepositoryProbe -RepoRoot $RepoRoot -GitArguments @('ls-tree', 'HEAD', '--', $MigrationFile)
    if (-not $headEntry.Success -or @($headEntry.Output).Count -ne 1 -or
        [string]$headEntry.Output[0] -cnotmatch '^100(?:644|755) blob ([0-9a-f]{40})\t') {
        throw 'TRACKED_MIGRATION_REJECTED: path is not a tracked HEAD blob'
    }
    $headBlob = $Matches[1]
    $index = Invoke-GitRepositoryProbe -RepoRoot $RepoRoot -GitArguments @('ls-files', '--stage', '--', $MigrationFile)
    if (-not $index.Success -or @($index.Output).Count -ne 1 -or
        [string]$index.Output[0] -cnotmatch '^100(?:644|755) ([0-9a-f]{40}) 0\t') {
        throw 'TRACKED_MIGRATION_REJECTED: index entry missing or conflicted'
    }
    if ($Matches[1] -cne $headBlob) { throw 'TRACKED_MIGRATION_REJECTED: staged migration differs from HEAD' }
    $status = Invoke-GitRepositoryProbe -RepoRoot $RepoRoot -GitArguments @('status', '--porcelain', '--untracked-files=all', '--', $MigrationFile)
    if (-not $status.Success -or @($status.Output).Count -ne 0) {
        throw 'TRACKED_MIGRATION_REJECTED: migration has staged or unstaged changes'
    }
    $normalized = Invoke-GitRepositoryProbe -RepoRoot $RepoRoot -GitArguments @('hash-object', "--path=$MigrationFile", '--', $MigrationFile)
    if (-not $normalized.Success -or @($normalized.Output).Count -ne 1 -or [string]$normalized.Output[0] -cne $headBlob) {
        throw 'TRACKED_MIGRATION_REJECTED: normalized working content differs from HEAD'
    }
    return $MigrationFile
}

# A provenance label alone cannot downgrade a migration already in HEAD.
function Assert-MigrationReviewProvenance {
    param($State)
    if ($State.DbMigrationProvenance -eq 'EXISTING_TRACKED_HEAD') {
        Assert-ExistingTrackedMigrationForReview -State $State -MigrationFile $State.DbMigrationFile | Out-Null
        return
    }
    $entry = Invoke-GitRepositoryProbe -RepoRoot $RepoRoot -GitArguments @('ls-tree', 'HEAD', '--', $State.DbMigrationFile)
    if (-not $entry.Success -or @($entry.Output).Count -ne 0) {
        throw 'TRACKED_MIGRATION_REJECTED: a HEAD-tracked file requires signed tracked-HEAD provenance'
    }
}

function New-DatabaseHandoff {
    param($State)

    $path = Join-Path $AiDir "DATABASE_HANDOFF.md"
    $allowedText = if (@($State.AllowedFiles).Count -gt 0) { (@($State.AllowedFiles) | ForEach-Object { "- $_" }) -join "`n" } elseif ($State.DbMigrationProvenance -eq 'EXISTING_TRACKED_HEAD') { '- supabase/migrations/ (selected existing tracked migration only - see MIGRATION FILE RULE below)' } else { '- supabase/migrations/ (new file only - see MIGRATION FILE RULE below)' }
    $migrationRule = if ($State.DbMigrationProvenance -eq 'EXISTING_TRACKED_HEAD') {
        "The selected existing SQL is an exact tracked blob at the task's signed HEAD, unchanged in index and working tree. This is review preparation only; never edit a historical migration."
    } else {
        "A single new file under supabase/migrations/ named YYYYMMDDHHMMSS_description.sql (project convention). Historical migrations are IMMUTABLE - write a NEW correcting migration, never edit an old one."
    }

    $content = @"
# DATABASE_HANDOFF.md

> Generated per task by ``tools/db-runner.ps1``. This is a controlled, separate track from the ordinary Claude handoff - database changes get an additional dedicated review/approval/apply pipeline on top of everything in CLAUDE_HANDOFF.md.

## TASK

Task ID: $($State.TaskId)
Description: $($State.Description)

## BUSINESS PURPOSE

$($State.Description)

## RISK

$($State.Risk) (final database-specific risk is reassessed from the actual SQL once written - see MODEL_ROUTING.md/DATABASE_SAFETY.md)

## CURRENT DATABASE ASSUMPTIONS

Do not assume the live schema matches any historical migration file's intent. Verify against the connected Supabase project (list_tables / list_migrations) before writing SQL that alters or references an existing object - per the root CLAUDE.md section 11 rule 1.

## APPROVED TABLES / FUNCTIONS / POLICIES

$allowedText

Only touch database objects directly required by the task description above. Do not modify unrelated tables, functions, or policies "while you're in there."

## ALLOWED MIGRATION FILE

$migrationRule

## BLOCKED DATABASE OBJECTS

Anything not named in APPROVED TABLES / FUNCTIONS / POLICIES above, and anything touching certificate issuance/verification/eligibility/numbering logic unless that is explicitly this task's purpose.

## DATA LOSS RISK

State explicitly in your implementation report whether this migration can destroy data (DROP, TRUNCATE, DELETE, a column type change that truncates values, etc). Assume "yes, treat as destructive" if uncertain.

## ROLLBACK REQUIREMENT

Describe how this migration would be reversed - a NEW migration undoing it - and whether that reversal is fully safe (e.g. dropping a column you just added is safe; recovering data you just deleted is not).

## VERIFICATION REQUIREMENTS

Describe, in your implementation report, how a human would confirm this migration did what it claims (which table/column/policy/function to check, and what a correct result looks like).

## EXPLICIT INSTRUCTIONS

Prepare SQL only.

Do NOT apply the migration.
Do NOT execute production writes.
Do NOT reset the database.
Do NOT modify unrelated schema.
Do NOT bypass RLS.
"@

    Set-Content -Path $path -Value $content -Encoding utf8
    return $path
}

function Invoke-PrepareMigration {
    param([string]$MigrationFile)
    $state = Get-TaskState
    if ($state.State -eq "NONE") {
        Write-Host ""
        Write-Host "No current task found."
        Write-Host ""
        return
    }

    $adopting = $PSBoundParameters.ContainsKey('MigrationFile')
    if ($adopting) {
        if ([string]::IsNullOrWhiteSpace($MigrationFile)) {
            throw 'TRACKED_MIGRATION_REJECTED: explicit migration path is empty'
        }
        $MigrationFile = Assert-ExistingTrackedMigrationForReview -State $state -MigrationFile $MigrationFile
        $state.DbMigrationProvenance = 'EXISTING_TRACKED_HEAD'
        $state.DbReviewedHash = $null
        $state.DbReviewVerdict = 'PENDING'
        $state.DbApproved = $false
        $state.DbApprovedAt = $null
        $state.DbApprovedHash = $null
        $state.DbApprovedCommitSha = $null
        $state.DbApplyApproved = $false
    } else {
        if ($state.DbMigrationProvenance -eq 'EXISTING_TRACKED_HEAD') {
            throw 'TRACKED_MIGRATION_REJECTED: re-preparing an adopted migration requires its explicit -MigrationFile path'
        }
        $MigrationFile = Find-MigrationFile -State $state
        $state.DbMigrationProvenance = if ($MigrationFile) { 'TASK_GENERATED_NEW' } else { $null }
    }

    if (-not $state.DbRequired) {
        $state.DbRequired = $true
    }
    $state.DbState = "DB_PREPARING"
    Save-TaskState -State $state

    $handoffPath = New-DatabaseHandoff -State $state
    Write-Host ""
    Write-Host "Database handoff generated: $handoffPath"

    $migrationFile = $MigrationFile
    if (-not $migrationFile) {
        Write-Host ""
        Write-Host "No migration file found yet under supabase/migrations/ among this task's changed files."
        Write-Host "Use .ai/DATABASE_HANDOFF.md when running Claude for this task (CLAUDE_DEEP is already selected for DB-sensitive tasks)."
        Write-Host "Re-run -PrepareMigration once the migration file exists to run static validation."
        Write-Host ""
        return
    }

    $staticOk = $true
    if (-not (Test-MigrationFilenameConvention -Path $migrationFile)) {
        $staticOk = $false
        Write-Host ""
        Write-Host "MIGRATION FILENAME CONVENTION VIOLATION"
        Write-Host ""
        Write-Host "$migrationFile does not match supabase/migrations/YYYYMMDDHHMMSS_description.sql"
        Write-Host ""
    }
    if (-not $adopting -and -not (Test-MigrationIsNew -Path $migrationFile)) {
        $staticOk = $false
        Write-Host ""
        Write-Host "HISTORICAL MIGRATION MODIFIED"
        Write-Host ""
        Write-Host "$migrationFile already existed before this task - historical migrations are immutable."
        Write-Host "Write a NEW correcting migration instead, unless this edit was explicitly, separately approved."
        Write-Host ""
    }

    $sqlPath = Join-Path $RepoRoot $migrationFile
    $sql = if (Test-Path $sqlPath) { Get-Content -Path $sqlPath -Raw } else { "" }
    $analysis = Get-DatabaseRisk -Sql $sql -Description $state.Description

    $state.DbMigrationFile = $migrationFile
    $state.DbMigrationHash = Get-MigrationHash -Path $migrationFile

    $state.DbObjectsChanged = $analysis.ObjectsChanged
    $state.DbDangerousStatements = $analysis.DangerousStatements
    $state.DbSecurityDefinerDetected = $analysis.SecurityDefiner
    $state.DbRlsImpact = $analysis.RlsImpact
    $state.DbAuthImpact = $analysis.AuthImpact
    $state.DbCertificateImpact = $analysis.CertificateImpact
    $state.DbDataMigration = $analysis.DataMigration
    $state.DbDestructiveSql = $analysis.Destructive
    $state.DbForeignKeyNotes = $analysis.ForeignKeyNotes
    $state.DbIndexNotes = $analysis.IndexNotes
    $state.DbDuplicatePrecheck = if ($analysis.HasUniqueConstraint) { "NOT_RUN" } else { "N/A" }
    $state.DbRisk = $analysis.Risk
    $state.DbStaticValidation = if ($staticOk) { "PASS" } else { "FAIL" }
    $state.DbState = if ($staticOk) { "DB_REVIEWING" } else { "DB_REVIEW_BLOCKED" }

    # Certificate-affecting or SECURITY DEFINER DB work always escalates the
    # whole task, not just the migration - sections 7/22.
    if ($analysis.CertificateImpact -or $analysis.SecurityDefiner) {
        $state.Risk = "CRITICAL"
        $state.ImplementerModel = "CLAUDE_DEEP"
        $state.Reviewer = "Codex"; $state.ReviewerModel = "CODEX_REVIEW"
        $state.HumanApprovalRequired = "REQUIRED"
    }

    Save-TaskState -State $state
    Write-DatabaseReport -State $state

    Write-Host ""
    Write-Host "DANGEROUS SQL DETECTED: $(if (@($analysis.DangerousStatements).Count -gt 0) { $analysis.DangerousStatements -join ', ' } else { 'None' })"
    Write-Host "Database Risk: $($state.DbRisk)"
    Write-Host "Objects Changed: $(if (@($analysis.ObjectsChanged).Count -gt 0) { $analysis.ObjectsChanged -join '; ' } else { '(none detected)' })"
    Write-Host ""
    Write-Host "See .ai/DATABASE_REPORT.md. Next: teras-agent -ReviewMigration"
    Write-Host ""
}

# ---------------------------------------------------------------------------
# DATABASE_REPORT.md - the mechanical fields are always regenerated from
# state; the "Codex Review:" line and findings section are written by Codex
# (or a human on its behalf) via CODEX_DATABASE_REVIEW_HANDOFF.md, then
# re-parsed back into state by Get-DbReviewVerdict before the next rewrite.
# ---------------------------------------------------------------------------

function Write-DatabaseReport {
    param($State)

    $path = Join-Path $AiDir "DATABASE_REPORT.md"
    $objectsText = if (@($State.DbObjectsChanged).Count -gt 0) { (@($State.DbObjectsChanged) | ForEach-Object { "- $_" }) -join "`n" } else { "- (none detected)" }
    $dangerText = if (@($State.DbDangerousStatements).Count -gt 0) { ($State.DbDangerousStatements -join ", ") } else { "None" }
    $fkNotes = @($State.DbForeignKeyNotes | Where-Object { $_ })
    $fkText = if ($fkNotes.Count -gt 0) { ($fkNotes | ForEach-Object { "- $_" }) -join "`n" } else { "- N/A" }
    $idxNotes = @($State.DbIndexNotes | Where-Object { $_ })
    $idxText = if ($idxNotes.Count -gt 0) { ($idxNotes | ForEach-Object { "- $_" }) -join "`n" } else { "- N/A" }
    $dataImpact = if ($State.DbDestructiveSql -or $State.DbDataMigration) { "HIGH" } elseif (@($State.DbObjectsChanged).Count -gt 0) { "MEDIUM" } else { "LOW" }
    $rollback = if ($State.DbDestructiveSql -or $State.DbDataMigration) { "NOT SAFE - see .ai/ROLLBACK_PLAN.md" } else { "AVAILABLE" }

    $content = @"
# DATABASE_REPORT.md

TERAS DATABASE REVIEW

Task ID:
$($State.TaskId)

Migration:
$(if ($State.DbMigrationFile) { $State.DbMigrationFile } else { "(none)" })

Provenance:
$(if ($State.DbMigrationProvenance) { $State.DbMigrationProvenance } else { "(none)" })

Migration Hash:
$(if ($State.DbMigrationHash) { $State.DbMigrationHash } else { "(none)" })

Risk:
$(if ($State.DbRisk) { $State.DbRisk } else { "(not yet classified)" })

Objects Changed:
$objectsText

Data Impact:
$dataImpact

Destructive SQL:
$(if ($State.DbDestructiveSql) { "YES - $dangerText" } else { "NO" })

RLS Impact:
$(if ($State.DbRlsImpact) { "YES" } else { "NO" })

Auth Impact:
$(if ($State.DbAuthImpact) { "YES" } else { "NO" })

Certificate Impact:
$(if ($State.DbCertificateImpact) { "YES" } else { "NO" })

SECURITY DEFINER Detected:
$(if ($State.DbSecurityDefinerDetected) { "YES - mandatory security review (search_path, authorization checks, caller identity, RLS bypass, input validation, privilege escalation)" } else { "NO" })

Duplicate Precheck (UNIQUE constraints):
$($State.DbDuplicatePrecheck)

Foreign Key Notes:
$fkText

Index Notes:
$idxText

Rollback:
$rollback

Static Validation:
$($State.DbStaticValidation)

Codex Review:
$($State.DbReviewVerdict)

Migration Apply:
NOT APPROVED

---

## Codex Database Review Findings

_(Filled in by Codex - or a human reviewing on its behalf - via .ai/CODEX_DATABASE_REVIEW_HANDOFF.md. The "Codex Review:" line above is parsed programmatically and must be exactly PASS, PASS_WITH_NOTES, or BLOCKED on the line right after it.)_

Correctness:
Data Integrity:
RLS:
Authorization:
Security:
Backward Compatibility:
Deployment Ordering:
Rollback:
Certificate/Verification Impact:
Blocking Findings:
"@

    Set-Content -Path $path -Value (Get-RedactedText -Text $content) -Encoding utf8
}

function New-CodexDatabaseReviewHandoff {
    param($State)

    $path = Join-Path $AiDir "CODEX_DATABASE_REVIEW_HANDOFF.md"
    $sqlPath = Join-Path $RepoRoot $State.DbMigrationFile
    $sql = if (Test-Path $sqlPath) { Get-Content -Path $sqlPath -Raw } else { "(migration file not found)" }
    $sql = Get-RedactedText -Text $sql

    $diffText = ""
    if ($State.DbMigrationFile) {
        Push-Location $RepoRoot
        try { $diffText = (git diff -- $State.DbMigrationFile | Out-String) } finally { Pop-Location }
    }
    if ([string]::IsNullOrWhiteSpace($diffText)) { $diffText = "(no diff captured - file may be untracked)" }

    $content = @"
# CODEX_DATABASE_REVIEW_HANDOFF.md

> Generated by ``tools/db-runner.ps1``. READ ONLY REVIEW - do not modify SQL during this pass. Do not scan the full repository - you receive only what is listed below.

## WHAT YOU RECEIVE

- .ai/CURRENT_TASK.md
- .ai/DATABASE_HANDOFF.md
- The migration SQL (below)
- git diff for the migration file (below)
- Relevant current schema references, only if you explicitly ask for them - do not assume

## MIGRATION SQL ($($State.DbMigrationFile))

``````sql
$sql
``````

## GIT DIFF

``````diff
$diffText
``````

## STATIC SCAN RESULTS (already run - verify, do not just trust)

Dangerous statements flagged: $(if (@($State.DbDangerousStatements).Count -gt 0) { $State.DbDangerousStatements -join ", " } else { "None" })
SECURITY DEFINER detected: $(if ($State.DbSecurityDefinerDetected) { "YES" } else { "NO" })
Certificate-related objects touched: $(if ($State.DbCertificateImpact) { "YES" } else { "NO" })

## YOUR TASK

Perform an independent, read-only review. Write your findings into ``.ai/DATABASE_REPORT.md``'s "Codex Database Review Findings" section, covering exactly: Correctness, Data Integrity, RLS, Authorization, Security, Backward Compatibility, Deployment Ordering, Rollback, Certificate/Verification Impact, Blocking Findings.

For RLS specifically, report whether the policy widens access, narrows access, changes tenant isolation, affects public access, or affects certificate verification.

For SECURITY DEFINER specifically, check: search_path, authorization checks, caller identity assumptions, RLS bypass implications, input validation, privilege escalation risk.

Then set the ``Codex Review:`` line near the top of that same file to exactly one of:

Codex Review:
PASS

Codex Review:
PASS_WITH_NOTES

Codex Review:
BLOCKED
"@

    Set-Content -Path $path -Value $content -Encoding utf8
    return $path
}

function Get-DbReviewVerdict {
    $path = Join-Path $AiDir "DATABASE_REPORT.md"
    if (-not (Test-Path $path)) { return "PENDING" }
    $content = Get-Content -Path $path -Raw
    if ($content -match "(?m)^Codex Review:\s*\r?\n\s*(PASS_WITH_NOTES|PASS|BLOCKED)\b") { return $Matches[1] }
    if ($content -match "(?m)^Codex Review:\s*(PASS_WITH_NOTES|PASS|BLOCKED)\b") { return $Matches[1] }
    return "PENDING"
}

function Get-DbReviewBlockingFindings {
    $path = Join-Path $AiDir "DATABASE_REPORT.md"
    if (-not (Test-Path $path)) { return @() }
    $content = Get-Content -Path $path
    $capture = $false
    $findings = @()
    foreach ($line in $content) {
        if ($line -match "^Blocking Findings:") { $capture = $true; continue }
        if ($capture -and $line.Trim().Length -eq 0) { break }
        if ($capture -and $line.Trim().Length -gt 0) { $findings += $line.Trim() }
    }
    return @($findings)
}

# Never call Codex a second time for identical migration content - section 33.
function Test-DbReviewStale {
    param($State)
    if (-not $State.DbMigrationFile) { return $false }
    $currentHash = Get-MigrationHash -Path $State.DbMigrationFile
    return ($currentHash -ne $State.DbReviewedHash)
}

function Invoke-ReviewMigration {
    $state = Get-TaskState
    if (-not $state.DbMigrationFile) {
        Write-Host ""
        Write-Host "No migration file recorded. Run -PrepareMigration first."
        Write-Host ""
        return
    }
    Assert-MigrationReviewProvenance -State $state

    if ($state.DbStaticValidation -eq "FAIL") {
        Write-Host ""
        Write-Host "REVIEW BLOCKED"
        Write-Host ""
        Write-Host "Static validation failed (filename convention or historical-migration immutability). Fix before requesting review."
        Write-Host ""
        return
    }

    $currentHash = Get-MigrationHash -Path $state.DbMigrationFile
    if (-not (Test-DbReviewStale -State $state) -and $state.DbReviewVerdict -in @("PASS", "PASS_WITH_NOTES", "BLOCKED")) {
        Write-Host ""
        Write-Host "Migration content unchanged since the last review (hash match) - reusing existing verdict: $($state.DbReviewVerdict)."
        Write-Host "Change the SQL to force a fresh review; Codex is not re-invoked for identical content."
        Write-Host ""
        return
    }

    $state.DbState = "DB_REVIEWING"
    Save-TaskState -State $state

    $handoffPath = New-CodexDatabaseReviewHandoff -State $state
    $ran = Invoke-CodexReview -HandoffPath $handoffPath
    $verdict = if ($ran) { Get-DbReviewVerdict } else { "PENDING" }

    $state.DbReviewVerdict = $verdict
    $state.DbReviewedHash = $currentHash
    $state.DbBlockingFindings = if ($verdict -eq "BLOCKED") { Get-DbReviewBlockingFindings } else { @() }
    $state.DbState = switch ($verdict) {
        "PASS" { "DB_AWAITING_APPROVAL" }
        "PASS_WITH_NOTES" { "DB_AWAITING_APPROVAL" }
        "BLOCKED" { "DB_REVIEW_BLOCKED" }
        default { "DB_REVIEWING" }
    }
    Save-TaskState -State $state
    Write-DatabaseReport -State $state

    Write-Host ""
    Write-Host "Codex Database Review verdict: $verdict"
    if ($verdict -eq "BLOCKED") {
        Write-Host "Blocking findings:"
        foreach ($f in $state.DbBlockingFindings) { Write-Host "- $f" }
    }
    Write-Host "See .ai/DATABASE_REPORT.md."
    Write-Host ""
}

# ---------------------------------------------------------------------------
# -ApproveMigration - a separate human gate from -Approve/-ApproveRelease.
# ---------------------------------------------------------------------------

function Invoke-ApproveMigration {
    $state = Get-TaskState
    if ($state.State -eq "NONE") {
        Write-Host ""; Write-Host "No current task found."; Write-Host ""
        return
    }
    if (-not $state.DbMigrationFile) {
        Write-Host ""; Write-Host "No migration file recorded. Run -PrepareMigration first."; Write-Host ""
        return
    }
    Assert-MigrationReviewProvenance -State $state
    if ($state.DbState -ne "DB_AWAITING_APPROVAL") {
        Write-Host ""
        Write-Host "MIGRATION APPROVAL BLOCKED"
        Write-Host ""
        Write-Host "Reason:"
        Write-Host "Database state is $($state.DbState), not DB_AWAITING_APPROVAL (Codex Database Review must PASS or PASS_WITH_NOTES first)."
        Write-Host ""
        return
    }
    if (Test-DbReviewStale -State $state) {
        $state.DbState = "DB_REVIEW_BLOCKED"
        Save-TaskState -State $state
        Write-Host ""
        Write-Host "MIGRATION APPROVAL INVALIDATED"
        Write-Host ""
        Write-Host "The migration SQL has changed since the last Codex review. Re-run -ReviewMigration."
        Write-Host ""
        return
    }
    if ($state.DbReviewVerdict -notin @("PASS", "PASS_WITH_NOTES")) {
        Write-Host ""
        Write-Host "MIGRATION APPROVAL BLOCKED"
        Write-Host ""
        Write-Host "Reason:"
        Write-Host "Codex Database Review verdict is $($state.DbReviewVerdict)."
        Write-Host ""
        return
    }

    Push-Location $RepoRoot
    try { $headSha = (git rev-parse HEAD).Trim() } finally { Pop-Location }

    Write-Host ""
    Write-Host "========================================"
    Write-Host "TERAS DATABASE MIGRATION APPROVAL"
    Write-Host "========================================"
    Write-Host ""
    Write-Host "Task:"
    Write-Host $state.Description
    Write-Host ""
    Write-Host "Migration:"
    Write-Host $state.DbMigrationFile
    Write-Host ""
    Write-Host "Risk:"
    Write-Host $state.DbRisk
    Write-Host ""
    Write-Host "Codex:"
    Write-Host $state.DbReviewVerdict
    if ($state.DbReviewVerdict -eq "PASS_WITH_NOTES") {
        Write-Host "(PASS_WITH_NOTES - see .ai/DATABASE_REPORT.md; typing the approval phrase below is explicit acceptance of those notes.)"
    }
    Write-Host ""
    Write-Host "Destructive SQL:"
    Write-Host $(if ($state.DbDestructiveSql) { "YES - $($state.DbDangerousStatements -join ', ')" } else { "NO" })
    Write-Host ""
    Write-Host "RLS Impact:"
    Write-Host $(if ($state.DbRlsImpact) { "YES" } else { "NO" })
    Write-Host ""
    Write-Host "Production Data Impact:"
    Write-Host $(if ($state.DbDestructiveSql -or $state.DbDataMigration) { "HIGH" } elseif (@($state.DbObjectsChanged).Count -gt 0) { "MEDIUM" } else { "LOW" })
    Write-Host ""
    Write-Host "Duplicate Precheck:"
    Write-Host $state.DbDuplicatePrecheck
    if ($state.DbDuplicatePrecheck -eq "NOT_RUN") {
        Write-Host "(A UNIQUE constraint was detected and no automated duplicate check was run - this tool cannot query the live database. Confirm manually that no duplicate data exists before approving.)"
    }
    Write-Host ""
    Write-Host "Rollback:"
    Write-Host $(if ($state.DbDestructiveSql -or $state.DbDataMigration) { "NOT SAFE - see .ai/ROLLBACK_PLAN.md" } else { "AVAILABLE" })
    Write-Host ""
    Write-Host "Application Release Approval:"
    Write-Host $(if ($state.ReleaseApproved) { "YES" } else { "NO" })
    Write-Host ""
    Write-Host "Migration Apply Approval:"
    Write-Host "NO"
    Write-Host ""

    $confirm = Read-Host "Type APPROVE DATABASE MIGRATION to continue"
    if ($confirm -cne "APPROVE DATABASE MIGRATION") {
        Write-Host ""
        Write-Host "Migration approval cancelled."
        Write-Host ""
        return
    }

    $state.DbApproved = $true
    $state.DbApprovedAt = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $state.DbApprovedHash = $state.DbMigrationHash
    $state.DbApprovedCommitSha = $headSha
    $state.DbState = "DB_APPROVED"
    Save-TaskState -State $state
    Save-ApprovalRecord -State $state -Decision "DATABASE_MIGRATION_APPROVED"
    Write-DatabaseReport -State $state

    Write-Host ""
    Write-Host "Migration APPROVED (safety/correctness sign-off)."
    Write-Host "This does NOT grant Migration Apply Approval - that is a separate step: teras-agent -ApplyMigration"
    Write-Host ""
}

# ---------------------------------------------------------------------------
# -ApplyMigration - environment-gated. See file header for why PRODUCTION
# never actually executes here, even after full approval.
# ---------------------------------------------------------------------------

function Test-SupabaseCliAvailable {
    return $null -ne (Get-Command "supabase" -ErrorAction SilentlyContinue)
}

function Test-LocalSupabaseRunning {
    if (-not (Test-SupabaseCliAvailable)) { return $false }
    Push-Location $RepoRoot
    try {
        # Not-running is the expected/common failure case, not a real error
        # - see Test-GitHubCliAvailable's comment for why this is a
        # try/catch rather than a $LASTEXITCODE check.
        supabase status *> $null
        return $true
    } catch {
        return $false
    } finally {
        Pop-Location
    }
}

# Control-plane hardening repair (HIGH-1, repaired again for the explicit
# LOCAL-target blocker): the ONLY place in this file that actually shells
# out to the Supabase CLI's `db push`. Factored out so it can be
# deterministically overridden (function redefinition after dot-sourcing,
# the same mocking pattern already used by this orchestrator's own test
# harnesses - see agent-repair-loop.tests.ps1) in regression tests that
# must prove `supabase db push` is never invoked when the bounded-
# authorization gate denies, and IS invoked only after it authorizes.
# Invoke-ApplyMigration's LOCAL branch is the only caller.
#
# Bare `supabase db push` targets whatever remote project is currently
# `supabase link`-ed in this working directory by CLI default - it does
# NOT target the local stack just because a local stack happens to be
# running, and a linked remote project makes a bare push go straight to
# that remote regardless of developer intent or `supabase status`. This
# function takes NO parameters and builds its argument list from a fixed
# literal array only, so no caller anywhere in this file - now or in any
# future edit - can inject `--linked`, `--db-url`, or any other
# target-overriding flag in place of `--local`. The explicit `--local`
# flag is what makes a notionally-linked remote project irrelevant to
# this specific invocation.
function Invoke-LocalSupabaseDbPushExecution {
    # Fixed, non-caller-controlled argv. Do not parameterize this list.
    $supabaseDbPushLocalArgs = @("db", "push", "--local")
    try {
        # try/catch, not just 2>&1 - a native command's stderr output
        # becomes a terminating error under this script's
        # $ErrorActionPreference = "Stop" otherwise (same pattern as
        # Invoke-ClaudeImplementation/Invoke-CodexReview).
        & supabase @supabaseDbPushLocalArgs 2>&1 | Out-Host
        return $LASTEXITCODE
    } catch {
        Write-Host "supabase db push --local failed: $($_.Exception.Message)"
        return 1
    }
}

function Invoke-ApplyMigration {
    param([string]$Target)

    $state = Get-TaskState
    if (-not $state.DbApproved) {
        Write-Host ""
        Write-Host "APPLY BLOCKED"
        Write-Host ""
        Write-Host "Reason:"
        Write-Host "Migration has not been approved (teras-agent -ApproveMigration first)."
        Write-Host ""
        return
    }

    Assert-MigrationReviewProvenance -State $state

    if ((Get-MigrationHash -Path $state.DbMigrationFile) -ne $state.DbApprovedHash) {
        $state.DbApproved = $false
        $state.DbState = "DB_REVIEW_BLOCKED"
        Save-TaskState -State $state
        Write-Host ""
        Write-Host "MIGRATION APPROVAL INVALIDATED"
        Write-Host ""
        Write-Host "The migration SQL has changed since approval. Re-run -ReviewMigration then -ApproveMigration."
        Write-Host ""
        return
    }

    if ([string]::IsNullOrWhiteSpace($Target)) {
        Write-Host ""
        Write-Host "APPLY BLOCKED"
        Write-Host ""
        Write-Host "An explicit target is required: teras-agent -ApplyMigration -Target LOCAL|STAGING|PRODUCTION"
        Write-Host "Environment is never inferred from environment variables alone."
        Write-Host ""
        return
    }
    $target = $Target.ToUpperInvariant()
    if ($target -notin @("LOCAL", "STAGING", "PRODUCTION")) {
        Write-Host ""
        Write-Host "APPLY BLOCKED"
        Write-Host ""
        Write-Host "Unknown target '$Target'. Must be LOCAL, STAGING, or PRODUCTION."
        Write-Host ""
        return
    }

    $state.DbApplyTarget = $target
    Save-TaskState -State $state

    if ($target -eq "STAGING") {
        Write-Host ""
        Write-Host "STAGING DATABASE NOT CONFIGURED"
        Write-Host ""
        Write-Host "No staging Supabase project is configured for this repository."
        Write-Host "This tool will not fabricate one. Apply to LOCAL for validation, or proceed to PRODUCTION only after full review."
        Write-Host ""
        return
    }

    if ($target -eq "LOCAL") {
        if (-not (Test-LocalSupabaseRunning)) {
            Write-Host ""
            Write-Host "LOCAL SUPABASE NOT DETECTED"
            Write-Host ""
            Write-Host "No running local Supabase stack was detected ('supabase status' failed, or the CLI is not installed)."
            Write-Host "Run 'supabase start' yourself first if you want a local apply target. Nothing was executed."
            Write-Host ""
            return
        }

        Write-Host ""
        Write-Host "This will apply $($state.DbMigrationFile) to your LOCAL Supabase instance only."
        Write-Host ""
        $confirm = Read-Host "Type YES to apply locally"
        if ($confirm -cne "YES") {
            Write-Host ""
            Write-Host "Apply cancelled."
            Write-Host ""
            return
        }

        # Control-plane hardening repair (HIGH-1): this is now the SOLE
        # live route to a LOCAL `supabase db push`. The legacy
        # DbApproved/hash checks above remain (they are a separate,
        # content-correctness gate), but they no longer suffice on their
        # own to reach execution - Invoke-BoundedLocalDatabaseValidation's
        # full fail-closed chain (strict schema -> HMAC proof ->
        # worktree/branch/HEAD -> exact migration allowlist -> local
        # runtime restrictions -> consumption-ledger authorization) MUST
        # also return Authorized = $true before Invoke-
        # LocalSupabaseDbPushExecution is ever called. There is no other
        # call site for that execution function anywhere in this file.
        $boundedAuth = Invoke-BoundedLocalDatabaseValidation -State $state -RepoRoot $RepoRoot -RequestedMigrations @($state.DbMigrationFile)
        if (-not $boundedAuth.Authorized) {
            $state.DbApplyStatus = "BLOCKED"
            $state.DbState = "DB_ATTENTION_REQUIRED"
            Save-TaskState -State $state
            Write-Host ""
            Write-Host "LOCAL APPLY BLOCKED BY BOUNDED-AUTHORIZATION GATE"
            Write-Host ""
            Write-Host "Stage:"
            Write-Host $boundedAuth.Stage
            Write-Host ""
            Write-Host "Reason:"
            Write-Host $boundedAuth.Reason
            Write-Host ""
            Write-Host "supabase db push was never invoked."
            Write-Host ""
            return
        }

        $state.DbState = "DB_APPLYING"
        Save-TaskState -State $state
        Push-Location $RepoRoot
        try {
            $exitCode = Invoke-LocalSupabaseDbPushExecution
        } finally {
            Pop-Location
        }

        if ($exitCode -eq 0) {
            $state.DbApplyStatus = "APPLIED"
            $state.DbState = "DB_VERIFYING"
            Write-Host ""
            Write-Host "Applied to LOCAL. Next: teras-agent -VerifyDatabase"
        } else {
            # Control-plane hardening repair (Part D): an ACTUAL `supabase db
            # push --local` failure must permanently latch the just-consumed
            # ledger entry so the same authorization/nonce can never be
            # replayed into a second push attempt. Consumption already
            # happened (inside Invoke-BoundedLocalDatabaseValidation, before
            # this execution call) - a failed push must not leave that
            # consumption "refundable" or retryable. This mirrors the
            # existing preflight-failure latch calls above, extended to the
            # one stage that previously had none: the real execution result.
            $latched = Set-ConsumptionLedgerLatch -Nonce $state.AuthorityProof.Nonce -Reason "LOCAL_DB_PUSH_EXECUTION_FAILED: exit=$exitCode"
            $state.DbApplyStatus = "BLOCKED"
            $state.DbState = "DB_ATTENTION_REQUIRED"
            Write-Host ""
            Write-Host "LOCAL apply failed - see output above."
            if (-not $latched) {
                # Fail closed even harder: if we cannot prove the ledger is
                # latched, do not imply any path to retry exists. The
                # consumed iteration is already spent either way (consumption
                # budget was decremented before execution), so this is a
                # reporting/audit gap, not a re-authorization risk - but it
                # must never be silently swallowed.
                Write-Host ""
                Write-Host "WARNING: failure latch could not be written for this authorization. Treat this nonce as permanently unusable regardless."
            }
        }
        Save-TaskState -State $state
        Write-Host ""
        return
    }

    # PRODUCTION - full gate, but this script never actually executes the
    # apply, even after the strengthened confirmation. See file header.
    Write-Host ""
    Write-Host "========================================"
    Write-Host "PRODUCTION DATABASE CHANGE"
    Write-Host "========================================"
    Write-Host ""
    Write-Host "Environment:"
    Write-Host "PRODUCTION"
    Write-Host ""
    Write-Host "Migration:"
    Write-Host $state.DbMigrationFile
    Write-Host ""
    Write-Host "Risk:"
    Write-Host $state.DbRisk
    Write-Host ""
    Write-Host "Affected Objects:"
    foreach ($o in @($state.DbObjectsChanged)) { Write-Host "- $o" }
    Write-Host ""
    Write-Host "Potential Data Loss:"
    Write-Host $(if ($state.DbDestructiveSql) { "YES - $($state.DbDangerousStatements -join ', ')" } else { "NO" })
    Write-Host ""
    Write-Host "RLS Change:"
    Write-Host $(if ($state.DbRlsImpact) { "YES" } else { "NO" })
    Write-Host ""
    Write-Host "Codex Review:"
    Write-Host $state.DbReviewVerdict
    Write-Host ""
    Write-Host "Rollback:"
    Write-Host $(if ($state.DbDestructiveSql -or $state.DbDataMigration) { "NOT FULLY REVERSIBLE" } else { "PARTIAL" })
    Write-Host ""

    if ($state.DbRisk -eq "CRITICAL" -and $state.DbDestructiveSql) {
        Write-Host "Backup Required: YES"
        Write-Host "Backup verification is not available from this tool - it cannot confirm a Supabase backup/PITR checkpoint exists."
        Write-Host ""
        Write-Host "PRODUCTION MIGRATION BLOCKED"
        Write-Host "A human must independently verify a backup/restore point exists before this destructive CRITICAL migration can proceed."
        Write-Host ""
        return
    }

    Write-Host "This action may change live database behavior."
    Write-Host ""

    $confirm = Read-Host "Type APPLY APPROVED PRODUCTION MIGRATION to continue"
    if ($confirm -cne "APPLY APPROVED PRODUCTION MIGRATION") {
        Write-Host ""
        Write-Host "Production apply cancelled. No production database change was made."
        Write-Host ""
        return
    }

    $state.DbApplyApproved = $true
    Save-TaskState -State $state
    Save-ApprovalRecord -State $state -Decision "DATABASE_MIGRATION_APPROVED"

    Write-Host ""
    Write-Host "Confirmed. This orchestrator does not execute production database writes automatically,"
    Write-Host "even after full approval - the connected Supabase project holds real production data, and"
    Write-Host "destructive database operations always require an explicit, in-the-moment human action"
    Write-Host "(root CLAUDE.md's own rule on this)."
    Write-Host ""
    Write-Host "Apply this migration yourself now, using whichever of the following you already have configured:"
    Write-Host "  - the Supabase MCP tools (apply_migration), or"
    Write-Host "  - supabase db push, run directly in your own terminal against the linked project, or"
    Write-Host "  - the Supabase dashboard SQL editor"
    Write-Host ""
    Write-Host "Then run 'teras-agent -VerifyDatabase' to record verification."
    Write-Host ""
}

# ---------------------------------------------------------------------------
# -VerifyDatabase / -DatabaseStatus / -DryRunMigration
# ---------------------------------------------------------------------------

function Invoke-VerifyDatabase {
    $state = Get-TaskState
    if ($state.DbApplyStatus -ne "APPLIED") {
        Write-Host ""
        Write-Host "No applied migration recorded for this task yet (Apply Status: $($state.DbApplyStatus))."
        Write-Host ""
        return
    }

    $state.DbState = "DB_VERIFYING"
    Save-TaskState -State $state

    Write-Host ""
    Write-Host "Verification checklist (non-destructive, read-only):"
    foreach ($o in @($state.DbObjectsChanged)) { Write-Host "- expected object present: $o" }
    Write-Host ""

    if (Test-SupabaseCliAvailable) {
        Push-Location $RepoRoot
        try {
            $list = supabase migration list 2>&1
            $exitCode = $LASTEXITCODE
        } catch {
            $list = @()
            $exitCode = 1
        } finally {
            Pop-Location
        }
        $migrationId = if ($state.DbMigrationFile) { (Split-Path -Leaf $state.DbMigrationFile) -replace '_.*$', '' } else { $null }
        $found = ($exitCode -eq 0) -and $migrationId -and (($list -join "`n") -match [regex]::Escape($migrationId))
        if ($found) {
            $state.DbVerificationStatus = "PASS"
            $state.DbState = "DB_COMPLETE"
            Write-Host "Migration ID $migrationId found in 'supabase migration list' output."
        } else {
            $state.DbVerificationStatus = "PENDING"
            Write-Host "Could not confirm the migration via 'supabase migration list' - verify the objects above manually."
        }
    } else {
        $state.DbVerificationStatus = "PENDING"
        Write-Host "supabase CLI not available - verify the objects above manually."
    }

    Save-TaskState -State $state
    Write-Host ""
    Write-Host "Database Verification: $($state.DbVerificationStatus)"
    Write-Host ""
}

function Invoke-DatabaseStatus {
    $state = Get-TaskState
    Write-Host ""
    Write-Host "========================================"
    Write-Host "TERAS DATABASE STATUS"
    Write-Host "========================================"
    Write-Host ""
    if ($state.State -eq "NONE" -or -not $state.DbRequired) {
        Write-Host "No database-relevant task currently active."
        Write-Host ""
        return
    }
    Write-Host "Task ID: $($state.TaskId)"
    Write-Host "Database State: $($state.DbState)"
    Write-Host "Database Risk: $(if ($state.DbRisk) { $state.DbRisk } else { '(not yet classified)' })"
    Write-Host "Migration File: $(if ($state.DbMigrationFile) { $state.DbMigrationFile } else { '(none)' })"
    Write-Host "Static Validation: $($state.DbStaticValidation)"
    Write-Host "Codex Database Review: $($state.DbReviewVerdict)"
    Write-Host "Migration Approved: $(if ($state.DbApproved) { 'YES' } else { 'NO' })"
    Write-Host "Migration Apply Approved: $(if ($state.DbApplyApproved) { 'YES' } else { 'NO' })"
    Write-Host "Apply Target: $(if ($state.DbApplyTarget) { $state.DbApplyTarget } else { '(none)' })"
    Write-Host "Apply Status: $($state.DbApplyStatus)"
    Write-Host "Database Verification: $($state.DbVerificationStatus)"
    Write-Host ""
    Write-Host "Application State: $($state.State)  (a separate track - see BUSINESS_RULES.md)"
    Write-Host ""
}

# Section 26/27: never guess when compatibility is uncertain - flag it
# instead. Called from release-runner.ps1's Write-ReleaseReport.
function Get-DeploymentOrder {
    param($State)

    if (-not $State.DbRequired -or -not $State.DbMigrationFile) {
        return "N/A - no database change in this release."
    }

    if ($State.DbDestructiveSql -or $State.DbDataMigration -or $State.DbSecurityDefinerDetected) {
        return @"
UNCERTAIN - Codex should confirm before release. This migration includes destructive/data-modifying/SECURITY DEFINER SQL, so application code and schema may not be safely deployable in either order. Do not assume atomicity - a coordinated maintenance-style deployment (or an expand/contract split into two migrations) is likely required. See section 27 of the database-safety workflow and .ai/DATABASE_REPORT.md.
"@.Trim()
    }

    if ($State.DbRlsImpact -or $State.DbAuthImpact) {
        return "DB FIRST, then verify, then deploy application - RLS/auth changes should be live before application code that depends on the new access rules ships, to avoid a window where the app assumes permissions the database doesn't grant yet (or vice versa)."
    }

    return @"
1. Apply the additive migration ($($State.DbMigrationFile))
2. Verify schema (teras-agent -VerifyDatabase)
3. Deploy application
This is the EXPAND pattern: the migration only adds objects (per static scan), so it is backward-compatible with the application code currently in production.
"@.Trim()
}

function Invoke-DryRunMigration {
    $state = Get-TaskState
    Write-Host ""
    Write-Host "DRY RUN MIGRATION - nothing will be executed."
    Write-Host ""
    if (-not $state.DbRequired) {
        Write-Host "This task is not currently flagged as database-relevant."
        Write-Host ""
        return
    }
    Write-Host "Migration: $(if ($state.DbMigrationFile) { $state.DbMigrationFile } else { '(not written yet)' })"
    Write-Host "Database Risk: $(if ($state.DbRisk) { $state.DbRisk } else { '(not yet classified)' })"
    Write-Host ""
    if ($state.DbMigrationFile) {
        $sqlPath = Join-Path $RepoRoot $state.DbMigrationFile
        $sql = if (Test-Path $sqlPath) { Get-Content -Path $sqlPath -Raw } else { "" }
        $danger = Get-SqlDangerScan -Sql $sql
        Write-Host "Dangerous statement scan: $(if (@($danger).Count -gt 0) { $danger -join ', ' } else { 'None detected' })"
    } else {
        Write-Host "Dangerous statement scan: (not run - no migration file yet)"
    }
    Write-Host ""
    Write-Host "Required Codex review: $(if ($state.DbReviewVerdict -in @('PASS', 'PASS_WITH_NOTES')) { 'already satisfied' } else { 'CODEX_REVIEW required before approval' })"
    Write-Host "Required approvals: -ApproveMigration (exact phrase APPROVE DATABASE MIGRATION), then -ApplyMigration -Target <LOCAL|STAGING|PRODUCTION>"
    Write-Host "  PRODUCTION additionally requires the exact phrase APPLY APPROVED PRODUCTION MIGRATION, and is never executed automatically even then - see -ApplyMigration."
    Write-Host ""
    Write-Host "Intended Supabase command: 'supabase db push --local' (LOCAL only, only if a local stack is detected running)"
    Write-Host "Verification plan: 'supabase migration list' (read-only) plus manual confirmation of expected objects: $(if (@($state.DbObjectsChanged).Count -gt 0) { $state.DbObjectsChanged -join '; ' } else { '(none detected yet)' })"
    Write-Host ""
}
