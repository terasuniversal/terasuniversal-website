$ErrorActionPreference = "Stop"

function Assert-True {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { throw "ASSERTION FAILED: $Message" }
}

function Assert-Equal {
    param($Actual, $Expected, [string]$Message)
    if ($Actual -cne $Expected) {
        throw "ASSERTION FAILED: $Message`nExpected: $Expected`nActual: $Actual"
    }
}

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
. (Join-Path $PSScriptRoot "agent-router.ps1")
. (Join-Path $PSScriptRoot "approval-runner.ps1")
. (Join-Path $PSScriptRoot "db-runner.ps1")

# Captured immediately after dot-sourcing, before any later test section in
# this file redefines Invoke-LocalSupabaseDbPushExecution as a no-op mock -
# this is the REAL implementation under test for the explicit --local
# target repair, restorable on demand regardless of what other sections do
# to the function afterward.
$script:RealInvokeLocalSupabaseDbPushExecutionBody = ${function:Invoke-LocalSupabaseDbPushExecution}

# Task 1 (exact pending migration set): Invoke-LocalSupabaseDbPushDryRunExecution
# is the SOLE place db-runner.ps1 shells out to the Supabase CLI's dry-run
# preflight. It is mocked for the ENTIRE remainder of this file via this one
# definition, driven by $script:MockPendingMigrationPaths/$script:MockDryRunExitCode/
# $script:MockDryRunRawOutput - this file never invokes the real Supabase CLI
# for the dry-run preflight (per Task 1's explicit instruction), and every
# test controls the "pending set" independently of the signed allowlist.
$script:MockPendingMigrationPaths = @()
$script:MockDryRunExitCode = 0
$script:MockDryRunRawOutput = $null
function Invoke-LocalSupabaseDbPushDryRunExecution {
    if ($null -ne $script:MockDryRunRawOutput) {
        return [pscustomobject]@{ Output = $script:MockDryRunRawOutput; ExitCode = $script:MockDryRunExitCode }
    }
    $lines = @("DRY RUN: migrations will *not* be pushed to the database.")
    foreach ($p in @($script:MockPendingMigrationPaths)) {
        $lines += "Would push migration $(Split-Path -Leaf $p)..."
    }
    $lines += "Finished supabase db push."
    return [pscustomobject]@{ Output = $lines; ExitCode = $script:MockDryRunExitCode }
}

$expectedTools = @("tools/teras-agent.ps1", "tools/agent-router.ps1", "tools/db-runner.ps1")
$description = "Authorize " + ($expectedTools -join " ")
$extractedTools = @(Get-ExplicitTaskPaths -Description $description)
Assert-Equal ($extractedTools -join "`n") ($expectedTools -join "`n") "All required PowerShell tool paths must be extracted in order."
foreach ($path in $expectedTools) {
    Assert-True (Test-ExplicitPathExists -RelativePath $path) "Existing in-repository tool path must be accepted: $path"
}

$legacyRootPaths = @(
    "app/layout.js",
    "lib/admin-nav.ts",
    "components/Analytics.js",
    "supabase/certificates.sql",
    "data/certificates.js",
    "public/manifest.md",
    "docs/bulk-pdf-import.md",
    "tools/agent-router.ps1"
)
foreach ($path in $legacyRootPaths) {
    Assert-True (@(Get-ExplicitTaskPaths -Description "src/$path").Contains($path)) "Existing root path must remain extractable inside larger relative text: $path"
    if ($path -ne "public/manifest.md") {
        Assert-True (Test-ExplicitPathExists -RelativePath $path) "Existing root path must resolve literally: $path"
    }
}
Assert-True (@(Get-ExplicitTaskPaths -Description "src/app/layout.js").Contains("app/layout.js")) "A known root embedded in a larger relative path must remain extractable."
$routeLiteral = "app/admin/(protected)/sales/leads/[id]/page.tsx"
Assert-True (@(Get-ExplicitTaskPaths -Description $routeLiteral).Contains($routeLiteral)) "Next.js route-group and bracket segments must be extracted literally."
Assert-True (Test-ExplicitPathExists -RelativePath $routeLiteral) "Next.js route-group and bracket segments must resolve literally."
foreach ($root in @("app", "lib", "components", "supabase", "data", "public", "docs")) {
    Assert-Equal @(Get-ExplicitTaskPaths -Description "$root/should-not-enable.ps1").Count 0 "PowerShell paths under $root must remain outside the tools-only extension scope."
    Assert-Equal @(Get-ExplicitTaskPaths -Description "$root/should-not-enable.webmanifest").Count 0 "Webmanifest paths under $root must retain their pre-bootstrap behavior."
    Assert-Equal @(Get-ExplicitTaskPaths -Description "$root/should-not-enable.txt").Count 0 "Text paths under $root must retain their pre-bootstrap behavior."
}
Assert-True (Test-ExplicitPathComponentSafe -Item ([pscustomobject]@{ Attributes = [IO.FileAttributes]::Directory })) "Ordinary path components must pass the reparse-point guard."
Assert-True (-not (Test-ExplicitPathComponentSafe -Item ([pscustomobject]@{ Attributes = [IO.FileAttributes]::Directory -bor [IO.FileAttributes]::ReparsePoint }))) "Reparse-point path components must fail closed."

$missingPath = "tools/does-not-exist.ps1"
Assert-True (@(Get-ExplicitTaskPaths -Description $missingPath) -contains $missingPath) "A syntactically valid missing path must be extracted for validation."
Assert-True (-not (Test-ExplicitPathExists -RelativePath $missingPath)) "A missing path must not be accepted."

$outsideAbsolute = "D:/outside-repo/tools/db-runner.ps1"
Assert-Equal @(Get-ExplicitTaskPaths -Description $outsideAbsolute).Count 0 "An absolute outside-repository path must not be extracted."
Assert-True (-not (Test-ExplicitPathExists -RelativePath $outsideAbsolute)) "An absolute outside-repository path must not be accepted."
Assert-True (-not (Test-ExplicitPathExists -RelativePath (Join-Path $RepoRoot "tools/agent-router.ps1"))) "An absolute in-repository path must not be accepted as relative scope."
Assert-True (@(Get-ExplicitTaskPaths -Description "Reference D:/outside-repo/tools/db-runner.ps1 and then tools/agent-router.ps1").Contains("tools/agent-router.ps1")) "An earlier unrelated absolute token must not suppress a later legitimate repo-relative path."

$driveRelative = "C:tools/db-runner.ps1"
Assert-Equal @(Get-ExplicitTaskPaths -Description $driveRelative).Count 0 "A drive-relative path must not yield an in-repository scope path."
Assert-True (@(Get-ExplicitTaskPaths -Description "app/script.ps1").Count -eq 0) "PowerShell paths under unrelated top-level directories must not be newly enabled."

$outsideTraversal = "tools/../../outside-repo/db-runner.ps1"
Assert-Equal @(Get-ExplicitTaskPaths -Description $outsideTraversal).Count 0 "A traversal path must not be extracted."
Assert-True (-not (Test-ExplicitPathExists -RelativePath $outsideTraversal)) "A traversal path must not be accepted."

# ---------------------------------------------------------------------------
# Path-safety junction/reparse-point containment test
#
# The escape target is a small, isolated, test-owned scratch directory -
# NEVER the real repository parent or any shared/sibling worktree directory.
# A junction that points into a large, real directory tree turns any future
# cleanup defect into a runaway MAX_PATH traversal across unrelated
# worktrees (this happened once); bounding the target to a disposable
# scratch directory keeps that blast radius to nothing. Cleanup always
# targets the reparse point itself via a guarded, non-recursive deletion
# that verifies the resolved path and the ReparsePoint attribute before
# deleting - it never calls Remove-Item recursively on a reparse point and
# never traverses into the link's target.
# ---------------------------------------------------------------------------

function Remove-JunctionFixtureSafely {
    param([string]$ExpectedFixturePath)

    # Idempotent: a fixture that is already absent is not an error.
    if (-not (Test-Path -LiteralPath $ExpectedFixturePath)) { return }

    $expectedResolved = [IO.Path]::GetFullPath($ExpectedFixturePath).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
    $fixtureItem = Get-Item -LiteralPath $ExpectedFixturePath -Force
    $actualResolved = [IO.Path]::GetFullPath($fixtureItem.FullName).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
    if (-not $actualResolved.Equals($expectedResolved, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to delete: resolved fixture path does not match the expected path exactly ($actualResolved vs $expectedResolved)."
    }

    $isReparsePoint = ($fixtureItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0
    if (-not $isReparsePoint) {
        throw "Refusing to delete: expected fixture path is not a reparse point - recursive deletion of a real directory would be unsafe."
    }

    # recursive=$false unlinks only the reparse point entry itself; it never
    # traverses into or deletes the junction target's contents.
    [IO.Directory]::Delete($actualResolved, $false)
}

$linkFixture = Join-Path $PSScriptRoot "__path_safety_junction_fixture"
$reparseEscapeStatus = "NOT_TESTED"
$reparseFixtureMethod = "Windows directory Junction (isolated scratch target)"
$reparseFixtureReason = $null

$scratchBase = $env:TMPDIR
if ([string]::IsNullOrWhiteSpace($scratchBase)) {
    if (-not [string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) { $scratchBase = Join-Path $env:LOCALAPPDATA "hermes/cache/scratch" }
    else { $scratchBase = [IO.Path]::GetTempPath() }
}
if (-not (Test-Path -LiteralPath $scratchBase)) { New-Item -ItemType Directory -Path $scratchBase -Force | Out-Null }
$isolatedEscapeTarget = Join-Path $scratchBase ("teras-junction-fixture-" + [Guid]::NewGuid().ToString("N"))
$markerRelativePath = "marker-subdir/marker.txt"
$markerFullPath = Join-Path $isolatedEscapeTarget ($markerRelativePath -replace '/', [IO.Path]::DirectorySeparatorChar)
New-Item -ItemType Directory -Path (Split-Path -Parent $markerFullPath) -Force | Out-Null
$markerOriginalContent = "sentinel-" + [Guid]::NewGuid().ToString("N")
Set-Content -LiteralPath $markerFullPath -Value $markerOriginalContent -NoNewline -Encoding utf8
$escapedExistingPath = "tools/__path_safety_junction_fixture/$markerRelativePath"

try {
    try {
        New-Item -ItemType Junction -Path $linkFixture -Target $isolatedEscapeTarget -ErrorAction Stop | Out-Null

        # --- A: junction fixture is created successfully ---
        Assert-True (Test-Path -LiteralPath $linkFixture) "Junction fixture must exist immediately after creation."
        $fixtureItem = Get-Item -LiteralPath $linkFixture -Force
        Assert-True (($fixtureItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) "Junction fixture must be a reparse point."

        # --- B: containment/reparse test still catches the unsafe path ---
        $reparseEscapeStatus = if (-not (Test-ExplicitPathExists -RelativePath $escapedExistingPath)) { "PASS" } else { "FAIL" }
    }
    finally {
        Remove-JunctionFixtureSafely -ExpectedFixturePath $linkFixture
    }

    # --- C: fixture is removed after a successful test run ---
    Assert-True (-not (Test-Path -LiteralPath $linkFixture)) "Junction fixture must be removed after a successful test run."
}
catch {
    $reparseEscapeStatus = "NOT_TESTED"
    $reparseFixtureReason = $_.Exception.Message
    # Defense in depth: a failure anywhere between creation and the primary
    # finally above must still never leave the fixture behind.
    Remove-JunctionFixtureSafely -ExpectedFixturePath $linkFixture
}

if ($reparseEscapeStatus -eq "FAIL") { throw "ASSERTION FAILED: A reparse-point path resolving outside the repository was accepted." }

# --- D: fixture is removed after an intentionally-triggered failure ---
# Only exercised when junction creation is actually supported on this host
# (established by A/B above succeeding) - mirrors the original NOT_TESTED
# tolerance rather than hard-failing on a host without junction privileges.
$reparseFailureCleanupStatus = "NOT_TESTED"
if ($reparseEscapeStatus -ne "NOT_TESTED") {
    try {
        New-Item -ItemType Junction -Path $linkFixture -Target $isolatedEscapeTarget -ErrorAction Stop | Out-Null
        try {
            throw "intentional-test-failure"
        }
        finally {
            Remove-JunctionFixtureSafely -ExpectedFixturePath $linkFixture
        }
    }
    catch {
        if ($_.Exception.Message -eq "intentional-test-failure") {
            $reparseFailureCleanupStatus = if (-not (Test-Path -LiteralPath $linkFixture)) { "PASS" } else { "FAIL" }
        } else {
            $reparseFailureCleanupStatus = "FAIL"
        }
    }
    if ($reparseFailureCleanupStatus -eq "FAIL") { throw "ASSERTION FAILED: Junction fixture must be removed even when the test body fails after creation." }
}

# --- E: target directory remains untouched ---
Assert-True (Test-Path -LiteralPath $markerFullPath) "The isolated escape target's marker file must still exist after the test."
$markerContentAfter = Get-Content -LiteralPath $markerFullPath -Raw
Assert-Equal $markerContentAfter $markerOriginalContent "The isolated escape target's marker content must be unmodified by the junction test."

# --- F: no recursive path remains after test completion ---
Assert-True (-not (Test-Path -LiteralPath $linkFixture)) "No junction/reparse point may remain under tools/ after the test completes."
Assert-Equal @(Get-ChildItem -LiteralPath $PSScriptRoot -Force | Where-Object { $_.Name -eq "__path_safety_junction_fixture" }).Count 0 "No residual junction-fixture directory entry may remain in tools/."

# The isolated scratch target is a real, test-owned directory (never a
# reparse point), so ordinary recursive removal is safe here.
if (Test-Path -LiteralPath $isolatedEscapeTarget) { Remove-Item -LiteralPath $isolatedEscapeTarget -Recurse -Force -ErrorAction SilentlyContinue }

Write-Output "REPARSE_ESCAPE_REJECTION=$reparseEscapeStatus"
Write-Output "REPARSE_FIXTURE_METHOD=$reparseFixtureMethod"
Write-Output "REPARSE_FAILURE_CLEANUP=$reparseFailureCleanupStatus"
if ($reparseEscapeStatus -eq "NOT_TESTED") { Write-Output "REPARSE_FIXTURE_REASON=$reparseFixtureReason" }

<#
    Control-plane hardening: tamper/static regression tests for the
    DPAPI trust-root, canonical approval tuple, HMAC proof, strict
    authority schema, exact worktree/branch/HEAD guard, exact migration
    allowlist, external consumption ledger, one-iteration budget, and
    stop-on-first-failure latch (sections 1-13 of the hardening task).

    Fully isolated from the real production trust root: every test below
    sets $env:TERAS_APPROVAL_TRUST_DIR_OVERRIDE to a disposable scratch
    directory before touching Get-ApprovalTrustDir, and uses
    New-DisposableApprovalTrustKey (never the production DPAPI path) to
    create test-only key material. Never touches .ai/ state, never starts
    Postgres/Docker, never commits/pushes/merges/deploys.
#>

$script:TamperTestScratchBase = $env:TMPDIR
if ([string]::IsNullOrWhiteSpace($script:TamperTestScratchBase)) {
    if (-not [string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) { $script:TamperTestScratchBase = Join-Path $env:LOCALAPPDATA "hermes/cache/scratch" }
    else { $script:TamperTestScratchBase = [IO.Path]::GetTempPath() }
}
if (-not (Test-Path -LiteralPath $script:TamperTestScratchBase)) { New-Item -ItemType Directory -Path $script:TamperTestScratchBase -Force | Out-Null }

function New-TamperTestFixture {
    # A throwaway git repository standing in for an "authorized worktree" -
    # never the real repository, never written to .ai/ state.
    $root = Join-Path $script:TamperTestScratchBase ("teras-tamper-" + [Guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory -Path $root -Force | Out-Null
    Push-Location $root
    try {
        git init --quiet .
        git config user.email "tamper-test@example.invalid"
        git config user.name "Tamper Test"
        git checkout -b "feat/tamper-test-fixture" --quiet 2>$null
        Set-Content -Path (Join-Path $root "fixture.txt") -Value "synthetic fixture, never executed" -Encoding utf8
        git add -- fixture.txt
        git commit -m "fixture" --quiet
    } finally {
        Pop-Location
    }

    $trustDir = Join-Path $script:TamperTestScratchBase ("teras-tamper-trust-" + [Guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory -Path $trustDir -Force | Out-Null

    return [pscustomobject]@{ RepoRoot = $root; TrustDir = $trustDir }
}

function Add-TrackedFixtureMigrations {
    param($Fixture, [string[]]$Paths)
    foreach ($path in $Paths) {
        $full = Join-Path $Fixture.RepoRoot $path
        if (-not (Test-Path -LiteralPath $full)) {
            New-Item -ItemType Directory -Path (Split-Path -Parent $full) -Force | Out-Null
            Set-Content -LiteralPath $full -Value '-- synthetic migration, never applied' -Encoding utf8
        }
    }
    Push-Location $Fixture.RepoRoot
    try {
        git add -- @Paths
        git diff --cached --quiet
        if ($LASTEXITCODE -eq 1) { git commit -m 'tracked fixture migrations' --quiet }
        elseif ($LASTEXITCODE -ne 0) { throw 'Fixture Git index probe failed' }
    } finally { Pop-Location }
}

function New-TamperTestState {
    param([string]$MigrationPath = "supabase/migrations/20261004999999_tamper_fixture.sql")
    $state = New-EmptyTaskState
    $state.TaskId = "TERAS-TAMPER-" + [Guid]::NewGuid().ToString("N").Substring(0, 8)
    $state.State = 'CREATED'
    $state.AllowedFiles = @("tools/db-runner.ps1")
    $state.LocalDisposableDatabaseAllowed = $true
    $state.LocalMigrationValidationAllowed = $true
    $state.DockerIterationsAllowed = 1
    $state.StopOnFirstFailure = $true
    $state.SyntheticDataOnly = $true
    $state.LocalMigrationAllowlist = @($MigrationPath)
    $state.DbMigrationFile = $MigrationPath
    # The runtime gate attests the signed HEAD, not merely the mocked CLI.
    # $fixture is the current disposable repository for every caller here.
    Add-TrackedFixtureMigrations -Fixture $fixture -Paths @($MigrationPath)
    # Task 1: by default the mocked local dry-run preflight reports exactly
    # this allowlist as "pending" - tests that need to prove mismatch
    # behavior override $script:MockPendingMigrationPaths explicitly after
    # calling this constructor.
    $script:MockPendingMigrationPaths = @($MigrationPath)
    $script:MockDryRunExitCode = 0
    $script:MockDryRunRawOutput = $null
    return $state
}

function Remove-TamperTestFixture {
    param($Fixture)
    if ($Fixture -and (Test-Path -LiteralPath $Fixture.RepoRoot)) { Remove-Item -LiteralPath $Fixture.RepoRoot -Recurse -Force -ErrorAction SilentlyContinue }
    if ($Fixture -and (Test-Path -LiteralPath $Fixture.TrustDir)) { Remove-Item -LiteralPath $Fixture.TrustDir -Recurse -Force -ErrorAction SilentlyContinue }
}

$script:SavedTrustDirOverride = $env:TERAS_APPROVAL_TRUST_DIR_OVERRIDE
$fixture = New-TamperTestFixture
try {
    $env:TERAS_APPROVAL_TRUST_DIR_OVERRIDE = $fixture.TrustDir
    New-DisposableApprovalTrustKey -Path (Get-ApprovalTrustKeyPath)

    # --- DPAPI trust-root round trip ---
    $keyBytes = Get-ApprovalTrustKeyBytes -Path (Get-ApprovalTrustKeyPath)
    Assert-True ($null -ne $keyBytes -and $keyBytes.Length -eq 32) "DPAPI-protected trust-root key must round-trip to 32 raw bytes."

    # New-DisposableApprovalTrustKey must structurally refuse the real
    # production path even when explicitly handed it.
    $refused = $false
    try { New-DisposableApprovalTrustKey -Path (Join-Path $env:LOCALAPPDATA "TERAS-Hermes-Control\approval-trust\hmac.key.dpapi") }
    catch { $refused = $true }
    Assert-True $refused "New-DisposableApprovalTrustKey must refuse to write the real production trust-root path."

    # --- Happy path: a valid proof authorizes exactly one iteration ---
    $state = New-TamperTestState
    $proofResult = New-ApprovalProof -State $state -RepoRoot $fixture.RepoRoot
    Assert-True $proofResult.Success "A compliant state with a valid trust root must produce a signed approval proof."
    $state.AuthorityProof = $proofResult.Proof

    $authResult = Invoke-BoundedLocalDatabaseValidation -State $state -RepoRoot $fixture.RepoRoot -RequestedMigrations @($state.LocalMigrationAllowlist[0])
    Assert-True $authResult.Authorized "A valid, untampered, in-budget proof must be authorized."

    # --- Nonce replay / consumption budget exhaustion must fail closed ---
    $replayResult = Invoke-BoundedLocalDatabaseValidation -State $state -RepoRoot $fixture.RepoRoot -RequestedMigrations @($state.LocalMigrationAllowlist[0])
    Assert-True (-not $replayResult.Authorized) "Replaying an already-consumed nonce must be rejected."
    Assert-Equal $replayResult.Stage "CONSUMPTION_LEDGER" "Replay must be rejected at the consumption-ledger stage."

    # --- First-failure latch: once latched (by the replay above), even a
    # structurally fresh re-attempt against the same nonce must stay
    # permanently denied - not just "budget exhausted" but LATCHED. ---
    $latchedResult = Invoke-BoundedLocalDatabaseValidation -State $state -RepoRoot $fixture.RepoRoot -RequestedMigrations @($state.LocalMigrationAllowlist[0])
    Assert-True (-not $latchedResult.Authorized) "A latched authorization must remain permanently denied."
    $ledgerCheck = Test-ConsumptionLedgerIntegrity -Path (Join-Path (Get-ApprovalConsumptionDir) "$($state.AuthorityProof.Nonce).json") -KeyBytes $keyBytes
    Assert-True $ledgerCheck.Valid "Ledger integrity must remain intact across repeated failed attempts."
    Assert-True ([bool]$ledgerCheck.Entry.Latched) "Ledger entry must show Latched=true after the first failure."

    Write-Output "Tamper tests (happy path / replay / exhaustion / latch): PASS"
} finally {
    Remove-TamperTestFixture -Fixture $fixture
}

# --- Proof tamper: flipping the signed Hmac must be detected ---
$fixture = New-TamperTestFixture
try {
    $env:TERAS_APPROVAL_TRUST_DIR_OVERRIDE = $fixture.TrustDir
    New-DisposableApprovalTrustKey -Path (Get-ApprovalTrustKeyPath)
    $state = New-TamperTestState
    $proofResult = New-ApprovalProof -State $state -RepoRoot $fixture.RepoRoot
    $state.AuthorityProof = $proofResult.Proof
    $state.AuthorityProof.Hmac = ("0" * 64)

    $result = Invoke-BoundedLocalDatabaseValidation -State $state -RepoRoot $fixture.RepoRoot -RequestedMigrations @($state.LocalMigrationAllowlist[0])
    Assert-True (-not $result.Authorized) "A tampered Hmac must be rejected."
    Assert-Equal $result.Stage "PROOF_VERIFICATION" "Hmac tamper must be caught at proof verification."
    Assert-True ($result.Reason -match "HMAC_MISMATCH") "Hmac tamper reason must identify the mismatch."
    Write-Output "Tamper test (proof/Hmac tamper): PASS"
} finally {
    Remove-TamperTestFixture -Fixture $fixture
}

# --- Task-id tamper: changing TaskId after signing must invalidate the
# proof, because the canonical tuple binds TaskId. ---
$fixture = New-TamperTestFixture
try {
    $env:TERAS_APPROVAL_TRUST_DIR_OVERRIDE = $fixture.TrustDir
    New-DisposableApprovalTrustKey -Path (Get-ApprovalTrustKeyPath)
    $state = New-TamperTestState
    $proofResult = New-ApprovalProof -State $state -RepoRoot $fixture.RepoRoot
    $state.AuthorityProof = $proofResult.Proof
    $state.TaskId = $state.TaskId + "-TAMPERED"

    $result = Invoke-BoundedLocalDatabaseValidation -State $state -RepoRoot $fixture.RepoRoot -RequestedMigrations @($state.LocalMigrationAllowlist[0])
    Assert-True (-not $result.Authorized) "A tampered TaskId must invalidate the proof."
    Assert-Equal $result.Stage "PROOF_VERIFICATION" "TaskId tamper must be caught at proof verification (tuple recompute mismatch)."
    Write-Output "Tamper test (task-id tamper): PASS"
} finally {
    Remove-TamperTestFixture -Fixture $fixture
}

# --- Worktree/branch/HEAD tamper: rewriting the proof's bound identity
# fields must invalidate the signature (the tuple includes them). ---
$fixture = New-TamperTestFixture
try {
    $env:TERAS_APPROVAL_TRUST_DIR_OVERRIDE = $fixture.TrustDir
    New-DisposableApprovalTrustKey -Path (Get-ApprovalTrustKeyPath)
    $state = New-TamperTestState
    $proofResult = New-ApprovalProof -State $state -RepoRoot $fixture.RepoRoot
    $state.AuthorityProof = $proofResult.Proof
    $state.AuthorityProof.BaseHeadSha = ("f" * 40)

    $result = Invoke-BoundedLocalDatabaseValidation -State $state -RepoRoot $fixture.RepoRoot -RequestedMigrations @($state.LocalMigrationAllowlist[0])
    Assert-True (-not $result.Authorized) "A tampered bound HEAD must invalidate the proof."
    Assert-Equal $result.Stage "PROOF_VERIFICATION" "HEAD tamper must be caught at proof verification."
    Write-Output "Tamper test (worktree/branch/HEAD tamper): PASS"
} finally {
    Remove-TamperTestFixture -Fixture $fixture
}

# --- Permission tamper: widening a denied permission after signing must
# invalidate the proof (the tuple includes every permission field). ---
$fixture = New-TamperTestFixture
try {
    $env:TERAS_APPROVAL_TRUST_DIR_OVERRIDE = $fixture.TrustDir
    New-DisposableApprovalTrustKey -Path (Get-ApprovalTrustKeyPath)
    $state = New-TamperTestState
    $proofResult = New-ApprovalProof -State $state -RepoRoot $fixture.RepoRoot
    $state.AuthorityProof = $proofResult.Proof
    $state.ProductionAllowed = $true

    $result = Invoke-BoundedLocalDatabaseValidation -State $state -RepoRoot $fixture.RepoRoot -RequestedMigrations @($state.LocalMigrationAllowlist[0])
    Assert-True (-not $result.Authorized) "Widening a denied permission after signing must invalidate the proof."
    Assert-Equal $result.Stage "PROOF_VERIFICATION" "Permission tamper must be caught at proof verification (tuple recompute mismatch)."
    Write-Output "Tamper test (permission tamper): PASS"
} finally {
    Remove-TamperTestFixture -Fixture $fixture
}

# --- Allowlist tamper: adding an unsigned migration path after signing
# must invalidate the proof. ---
$fixture = New-TamperTestFixture
try {
    $env:TERAS_APPROVAL_TRUST_DIR_OVERRIDE = $fixture.TrustDir
    New-DisposableApprovalTrustKey -Path (Get-ApprovalTrustKeyPath)
    $state = New-TamperTestState
    $proofResult = New-ApprovalProof -State $state -RepoRoot $fixture.RepoRoot
    $state.AuthorityProof = $proofResult.Proof
    $state.LocalMigrationAllowlist = @($state.LocalMigrationAllowlist[0], "supabase/migrations/20269999999999_injected.sql")

    $result = Invoke-BoundedLocalDatabaseValidation -State $state -RepoRoot $fixture.RepoRoot -RequestedMigrations @($state.LocalMigrationAllowlist[0])
    Assert-True (-not $result.Authorized) "Widening the migration allowlist after signing must invalidate the proof."
    Assert-Equal $result.Stage "PROOF_VERIFICATION" "Allowlist tamper must be caught at proof verification (tuple recompute mismatch)."
    Write-Output "Tamper test (allowlist tamper): PASS"
} finally {
    Remove-TamperTestFixture -Fixture $fixture
}

# --- Exact migration allowlist: no wildcard/prefix/inferred match, even
# with an otherwise-valid, untampered proof. ---
$fixture = New-TamperTestFixture
try {
    $env:TERAS_APPROVAL_TRUST_DIR_OVERRIDE = $fixture.TrustDir
    New-DisposableApprovalTrustKey -Path (Get-ApprovalTrustKeyPath)
    $state = New-TamperTestState -MigrationPath "supabase/migrations/20261004999999_exact_only.sql"
    $proofResult = New-ApprovalProof -State $state -RepoRoot $fixture.RepoRoot
    $state.AuthorityProof = $proofResult.Proof

    $wildcardResult = Invoke-BoundedLocalDatabaseValidation -State $state -RepoRoot $fixture.RepoRoot -RequestedMigrations @("supabase/migrations/20261004999999_exact_only_v2.sql")
    Assert-True (-not $wildcardResult.Authorized) "A migration not byte-for-byte in the allowlist must be rejected, not fuzzy/prefix-matched."
    Assert-Equal $wildcardResult.Stage "MIGRATION_ALLOWLIST" "Non-exact migration match must be caught at the allowlist stage."

    $dirResult = Invoke-BoundedLocalDatabaseValidation -State $state -RepoRoot $fixture.RepoRoot -RequestedMigrations @("supabase/migrations/")
    Assert-True (-not $dirResult.Authorized) "A directory-wide migration request must be rejected."
    Write-Output "Tamper test (exact migration allowlist, no wildcard): PASS"
} finally {
    Remove-TamperTestFixture -Fixture $fixture
}

# --- Malformed/unknown authority-schema fields must fail closed ---
$fixture = New-TamperTestFixture
try {
    $env:TERAS_APPROVAL_TRUST_DIR_OVERRIDE = $fixture.TrustDir
    New-DisposableApprovalTrustKey -Path (Get-ApprovalTrustKeyPath)
    $state = New-TamperTestState
    $proofResult = New-ApprovalProof -State $state -RepoRoot $fixture.RepoRoot
    $state.AuthorityProof = $proofResult.Proof

    $missingFieldState = New-TamperTestState
    $missingFieldState.AuthorityProof = [pscustomobject]@{} # every field missing
    $missingCheck = Test-AuthorityProofSchema -Proof $missingFieldState.AuthorityProof
    Assert-True (-not $missingCheck.Valid) "A proof missing every field must fail the strict authority schema."
    Assert-True ($missingCheck.Reason -match "MISSING_FIELDS") "Missing-field reason must be explicit."

    $unknownFieldProof = $proofResult.Proof | Select-Object *
    $unknownFieldProof | Add-Member -MemberType NoteProperty -Name "UnexpectedField" -Value "injected"
    $unknownCheck = Test-AuthorityProofSchema -Proof $unknownFieldProof
    Assert-True (-not $unknownCheck.Valid) "A proof with an unknown field must fail the strict authority schema."
    Assert-True ($unknownCheck.Reason -match "UNKNOWN_FIELDS") "Unknown-field reason must be explicit."

    $malformedHeadProof = $proofResult.Proof | Select-Object *
    $malformedHeadProof.BaseHeadSha = "not-a-sha"
    $malformedCheck = Test-AuthorityProofSchema -Proof $malformedHeadProof
    Assert-True (-not $malformedCheck.Valid) "A malformed (non-SHA) bound HEAD must fail the strict authority schema."

    $unsupportedVersionProof = $proofResult.Proof | Select-Object *
    $unsupportedVersionProof.SchemaVersion = "999"
    $versionCheck = Test-AuthorityProofSchema -Proof $unsupportedVersionProof
    Assert-True (-not $versionCheck.Valid) "An unsupported schema version must fail closed."

    Write-Output "Tamper test (malformed/unknown schema fields): PASS"
} finally {
    Remove-TamperTestFixture -Fixture $fixture
}

# --- Canonical checkout rejection / undeclared worktree rejection ---
$fixture = New-TamperTestFixture
$otherWorktree = $null
try {
    $env:TERAS_APPROVAL_TRUST_DIR_OVERRIDE = $fixture.TrustDir
    New-DisposableApprovalTrustKey -Path (Get-ApprovalTrustKeyPath)
    $state = New-TamperTestState
    $proofResult = New-ApprovalProof -State $state -RepoRoot $fixture.RepoRoot
    $state.AuthorityProof = $proofResult.Proof

    # Canonical checkout rejection: the proof is bound to $fixture.RepoRoot;
    # presenting the repository's PARENT directory (standing in for "the
    # canonical, non-worktree checkout") must be rejected even though the
    # HMAC/tuple themselves are untampered.
    $canonicalStandIn = Split-Path -Parent $fixture.RepoRoot
    $canonicalResult = Invoke-BoundedLocalDatabaseValidation -State $state -RepoRoot $canonicalStandIn -RequestedMigrations @($state.LocalMigrationAllowlist[0])
    Assert-True (-not $canonicalResult.Authorized) "The canonical (non-worktree) checkout path must be rejected."
    Assert-Equal $canonicalResult.Stage "WORKTREE_GUARD" "Canonical checkout rejection must be caught at the worktree guard."

    # Undeclared worktree rejection: a second, independent git checkout
    # (not the one named in the proof) must also be rejected.
    $otherWorktree = Join-Path $script:TamperTestScratchBase ("teras-tamper-other-" + [Guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory -Path $otherWorktree -Force | Out-Null
    Push-Location $otherWorktree
    try {
        git init --quiet .
        git config user.email "tamper-test@example.invalid"
        git config user.name "Tamper Test"
        git checkout -b "feat/tamper-test-fixture" --quiet 2>$null
        Set-Content -Path (Join-Path $otherWorktree "fixture.txt") -Value "synthetic fixture, never executed" -Encoding utf8
        git add -- fixture.txt
        git commit -m "fixture" --quiet
    } finally {
        Pop-Location
    }
    $otherResult = Invoke-BoundedLocalDatabaseValidation -State $state -RepoRoot $otherWorktree -RequestedMigrations @($state.LocalMigrationAllowlist[0])
    Assert-True (-not $otherResult.Authorized) "An undeclared/other worktree must be rejected even with valid permissions."
    Assert-Equal $otherResult.Stage "WORKTREE_GUARD" "Undeclared worktree rejection must be caught at the worktree guard."

    Write-Output "Tamper test (canonical checkout / undeclared worktree rejection): PASS"
} finally {
    Remove-TamperTestFixture -Fixture $fixture
    if ($otherWorktree -and (Test-Path -LiteralPath $otherWorktree)) { Remove-Item -LiteralPath $otherWorktree -Recurse -Force -ErrorAction SilentlyContinue }
}

# --- Local disposable DB restriction enforcement (independent of the
# proof signature - a denied-by-current-state permission must block even
# with a validly signed proof for an otherwise-compliant original state) ---
$fixture = New-TamperTestFixture
try {
    $env:TERAS_APPROVAL_TRUST_DIR_OVERRIDE = $fixture.TrustDir
    New-DisposableApprovalTrustKey -Path (Get-ApprovalTrustKeyPath)
    $state = New-TamperTestState
    $state.PublishedPortsAllowed = $true
    $proofResult = New-ApprovalProof -State $state -RepoRoot $fixture.RepoRoot
    Assert-True $proofResult.Success "Proof generation itself does not enforce local-DB restrictions (db-runner does, independently)."
    $state.AuthorityProof = $proofResult.Proof

    $result = Invoke-BoundedLocalDatabaseValidation -State $state -RepoRoot $fixture.RepoRoot -RequestedMigrations @($state.LocalMigrationAllowlist[0])
    Assert-True (-not $result.Authorized) "PublishedPortsAllowed=true must be rejected by the local disposable DB restriction gate."
    Assert-Equal $result.Stage "LOCAL_DB_RESTRICTIONS" "Published-ports violation must be caught at the local-DB-restrictions stage."
    Write-Output "Tamper test (local disposable DB restriction enforcement): PASS"
} finally {
    Remove-TamperTestFixture -Fixture $fixture
}

$env:TERAS_APPROVAL_TRUST_DIR_OVERRIDE = $script:SavedTrustDirOverride

<#
    Control-plane hardening REPAIR round regression tests (HIGH-1,
    HIGH-2, MEDIUM-1, MEDIUM-2). Same isolation discipline as above:
    every test sets $env:TERAS_APPROVAL_TRUST_DIR_OVERRIDE to a
    disposable scratch directory and restores it afterward; never
    touches .ai/ state, never starts Postgres/Docker, never
    commits/pushes/merges/deploys, never uses the real production
    DPAPI key.
#>

# ---------------------------------------------------------------------------
# HIGH-1: the live LOCAL apply path must be gated, and `supabase db push`
# must never be invoked without a successful bounded authorization.
#
# Mocking strategy: Invoke-ApplyMigration (db-runner.ps1) is dot-sourced
# into THIS script's scope above, so redefining Get-TaskState,
# Save-TaskState, Test-LocalSupabaseRunning, Read-Host, and
# Invoke-LocalSupabaseDbPushExecution here shadows the real
# implementations for every call made from this point on in this
# process - the same mocking pattern already used by this
# orchestrator's own agent-repair-loop.tests.ps1 (Save-TaskState,
# Get-GitStatusSnapshot, etc. redefined as plain functions after
# dot-sourcing). This proves CALL ORDERING, not just return values:
# $script:DbPushInvocationLog records exactly when the mocked execution
# point was reached, if ever.
# ---------------------------------------------------------------------------

$script:DbPushInvocationLog = @()
$script:MockTaskState = $null

# The tracked-migration adoption suite covers this separate preparation
# gate. Here failed proofs must reach the bounded runtime gate itself.
function Assert-MigrationReviewProvenance { param($State) }
function Get-TaskState { return $script:MockTaskState }
function Save-TaskState { param($State) $script:MockTaskState = $State }
function Test-LocalSupabaseRunning { return $true }
function Read-Host { param($Prompt) return "YES" }
function Invoke-LocalSupabaseDbPushExecution {
    $script:DbPushInvocationLog += "DB_PUSH_INVOKED_AT_$([DateTime]::UtcNow.Ticks)"
    return 0
}

function New-BoundedApplyFixtureState {
    param([string]$MigrationFile = "supabase/migrations/20261004999999_repair_fixture.sql", $Fixture)
    $s = New-TamperTestState -MigrationPath $MigrationFile
    $s.DbApproved = $true
    $s.DbMigrationFile = $MigrationFile
    $s.DbMigrationProvenance = 'EXISTING_TRACKED_HEAD'
    $sqlFullPath = Join-Path $Fixture.RepoRoot $MigrationFile
    Assert-True (Test-Path -LiteralPath $sqlFullPath) 'Bounded apply fixture migration must already exist at HEAD.'
    $s.DbApprovedHash = Get-MigrationHash -Path $MigrationFile
    # New-TamperTestState already pointed the mocked dry-run preflight at
    # this exact migration file - kept here as an explicit re-assertion
    # since this is the fixture constructor every Invoke-ApplyMigration
    # repair test in this file depends on for pending-set equality.
    $script:MockPendingMigrationPaths = @($MigrationFile)
    $script:MockDryRunExitCode = 0
    $script:MockDryRunRawOutput = $null
    return $s
}

# --- 1. Failed proof (bad HMAC) => db push never invoked ---
$fixture = New-TamperTestFixture
try {
    $env:TERAS_APPROVAL_TRUST_DIR_OVERRIDE = $fixture.TrustDir
    New-DisposableApprovalTrustKey -Path (Get-ApprovalTrustKeyPath)
    $RepoRoot = $fixture.RepoRoot
    $script:DbPushInvocationLog = @()
    $state = New-BoundedApplyFixtureState -Fixture $fixture
    $proofResult = New-ApprovalProof -State $state -RepoRoot $fixture.RepoRoot
    $state.AuthorityProof = $proofResult.Proof
    $state.AuthorityProof.Hmac = ("0" * 64)
    $script:MockTaskState = $state

    Invoke-ApplyMigration -Target "LOCAL"
    Assert-Equal @($script:DbPushInvocationLog).Count 0 "Bad HMAC: supabase db push must never be invoked."
    Assert-Equal $script:MockTaskState.DbApplyStatus "BLOCKED" "Bad HMAC: apply status must be BLOCKED."
    Write-Output "Repair test (HIGH-1 disconnected-gate / bad proof): PASS"
} finally {
    Remove-TamperTestFixture -Fixture $fixture
}

# --- 2. Failed schema (missing fields) => db push never invoked ---
$fixture = New-TamperTestFixture
try {
    $env:TERAS_APPROVAL_TRUST_DIR_OVERRIDE = $fixture.TrustDir
    New-DisposableApprovalTrustKey -Path (Get-ApprovalTrustKeyPath)
    $RepoRoot = $fixture.RepoRoot
    $script:DbPushInvocationLog = @()
    $state = New-BoundedApplyFixtureState -Fixture $fixture
    $state.AuthorityProof = [pscustomobject]@{} # every field missing
    $script:MockTaskState = $state

    Invoke-ApplyMigration -Target "LOCAL"
    Assert-Equal @($script:DbPushInvocationLog).Count 0 "Missing schema: supabase db push must never be invoked."
    Write-Output "Repair test (HIGH-1 disconnected-gate / missing schema): PASS"
} finally {
    Remove-TamperTestFixture -Fixture $fixture
}

# --- 3. Wrong worktree/branch/HEAD => db push never invoked ---
$fixture = New-TamperTestFixture
try {
    $env:TERAS_APPROVAL_TRUST_DIR_OVERRIDE = $fixture.TrustDir
    New-DisposableApprovalTrustKey -Path (Get-ApprovalTrustKeyPath)
    $RepoRoot = $fixture.RepoRoot
    $script:DbPushInvocationLog = @()
    $state = New-BoundedApplyFixtureState -Fixture $fixture
    $proofResult = New-ApprovalProof -State $state -RepoRoot $fixture.RepoRoot
    $state.AuthorityProof = $proofResult.Proof
    $state.AuthorityProof.BaseHeadSha = ("f" * 40)
    $script:MockTaskState = $state

    Invoke-ApplyMigration -Target "LOCAL"
    Assert-Equal @($script:DbPushInvocationLog).Count 0 "Wrong HEAD: supabase db push must never be invoked."
    Write-Output "Repair test (HIGH-1 disconnected-gate / wrong HEAD): PASS"
} finally {
    Remove-TamperTestFixture -Fixture $fixture
}

# --- 4. Migration not in exact allowlist => db push never invoked ---
$fixture = New-TamperTestFixture
try {
    $env:TERAS_APPROVAL_TRUST_DIR_OVERRIDE = $fixture.TrustDir
    New-DisposableApprovalTrustKey -Path (Get-ApprovalTrustKeyPath)
    $RepoRoot = $fixture.RepoRoot
    $script:DbPushInvocationLog = @()
    $state = New-BoundedApplyFixtureState -Fixture $fixture -MigrationFile "supabase/migrations/20261004999999_allowed.sql"
    $proofResult = New-ApprovalProof -State $state -RepoRoot $fixture.RepoRoot
    $state.AuthorityProof = $proofResult.Proof
    # Change the ACTUAL file the apply would touch to one NOT in the
    # signed allowlist, without re-signing - the bounded gate must still
    # check the single reviewed target independently of the full push set.
    $otherFile = "supabase/migrations/20261004999999_not_allowed.sql"
    $otherFullPath = Join-Path $fixture.RepoRoot $otherFile
    Set-Content -Path $otherFullPath -Value "-- synthetic migration, never applied" -Encoding utf8
    $state.DbMigrationFile = $otherFile
    $state.DbMigrationProvenance = 'TASK_GENERATED_NEW'
    $state.DbApprovedHash = Get-MigrationHash -Path $otherFile
    $script:MockTaskState = $state

    Invoke-ApplyMigration -Target "LOCAL"
    Assert-Equal @($script:DbPushInvocationLog).Count 0 "Non-allowlisted migration: supabase db push must never be invoked."
    $targetLedger = Test-ConsumptionLedgerIntegrity -Path $state.AuthorityProof.ConsumptionLedgerPath -KeyBytes (Get-ApprovalTrustKeyBytes -Path (Get-ApprovalTrustKeyPath))
    Assert-True ($targetLedger.Valid -and $targetLedger.Entry.Latched -and [int]$targetLedger.Entry.ConsumedIterations -eq 0) "Non-allowlisted review target must latch before consumption."
    Assert-True ([string]$targetLedger.Entry.LatchReason -match 'REQUESTED_MIGRATION_SET_FAILED') "Non-allowlisted review target must retain the requested-set failure reason."
    Write-Output "Repair test (HIGH-1 disconnected-gate / non-allowlisted migration): PASS"
} finally {
    Remove-TamperTestFixture -Fixture $fixture
}

# --- 5. Exhausted/replayed ledger => db push never invoked a second time ---
$fixture = New-TamperTestFixture
try {
    $env:TERAS_APPROVAL_TRUST_DIR_OVERRIDE = $fixture.TrustDir
    New-DisposableApprovalTrustKey -Path (Get-ApprovalTrustKeyPath)
    $RepoRoot = $fixture.RepoRoot
    $script:DbPushInvocationLog = @()
    $state = New-BoundedApplyFixtureState -Fixture $fixture
    $proofResult = New-ApprovalProof -State $state -RepoRoot $fixture.RepoRoot
    $state.AuthorityProof = $proofResult.Proof
    $script:MockTaskState = $state

    Invoke-ApplyMigration -Target "LOCAL"
    Assert-Equal @($script:DbPushInvocationLog).Count 1 "Valid synthetic authorization: supabase db push must be invoked exactly once."
    Assert-Equal $script:MockTaskState.DbApplyStatus "APPLIED" "Valid synthetic authorization: apply status must be APPLIED."

    # Replay the SAME (already-consumed) proof a second time.
    $script:MockTaskState.DbState = "DB_VERIFYING"
    Invoke-ApplyMigration -Target "LOCAL"
    Assert-Equal @($script:DbPushInvocationLog).Count 1 "Replay: supabase db push must NOT be invoked a second time for an already-consumed nonce."
    Write-Output "Repair test (HIGH-1 disconnected-gate / replay after consumption): PASS"
} finally {
    Remove-TamperTestFixture -Fixture $fixture
}

# --- 6. Fully valid synthetic authorization reaches the mocked execution
# point ONLY AFTER ledger consumption succeeds - ordering, not just the
# return value. Instrumented by wrapping Consume-ConsumptionLedgerEntry
# and Invoke-LocalSupabaseDbPushExecution to append to one shared,
# timestamped order log. ---
$fixture = New-TamperTestFixture
try {
    $env:TERAS_APPROVAL_TRUST_DIR_OVERRIDE = $fixture.TrustDir
    New-DisposableApprovalTrustKey -Path (Get-ApprovalTrustKeyPath)
    $RepoRoot = $fixture.RepoRoot
    $script:OrderLog = @()
    $script:OriginalConsumeConsumptionLedgerEntryBody = ${function:Consume-ConsumptionLedgerEntry}
    function Consume-ConsumptionLedgerEntry {
        param([string]$Nonce)
        $script:OrderLog += "LEDGER_CONSUMED"
        return (& $script:OriginalConsumeConsumptionLedgerEntryBody $Nonce)
    }
    function Invoke-LocalSupabaseDbPushExecution {
        $script:OrderLog += "DB_PUSH_INVOKED"
        return 0
    }

    $state = New-BoundedApplyFixtureState -Fixture $fixture -MigrationFile "supabase/migrations/20261004999999_ordering_fixture.sql"
    $proofResult = New-ApprovalProof -State $state -RepoRoot $fixture.RepoRoot
    $state.AuthorityProof = $proofResult.Proof
    $script:MockTaskState = $state

    Invoke-ApplyMigration -Target "LOCAL"
    Assert-Equal ($script:OrderLog -join ",") "LEDGER_CONSUMED,DB_PUSH_INVOKED" "Ledger consumption must complete strictly BEFORE the mocked database execution point is ever reached."
    Write-Output "Repair test (HIGH-1 success-path ordering: proof -> identity -> allowlist/restrictions -> ledger -> db push): PASS"
} finally {
    # Restore the ORIGINAL Consume-ConsumptionLedgerEntry body - removing
    # the function entirely (rather than restoring it) would break every
    # later test in this file that calls it (directly or via
    # Invoke-BoundedLocalDatabaseValidation).
    if ($script:OriginalConsumeConsumptionLedgerEntryBody) {
        Set-Item -Path Function:\Consume-ConsumptionLedgerEntry -Value $script:OriginalConsumeConsumptionLedgerEntryBody
    }
    function Invoke-LocalSupabaseDbPushExecution {
        $script:DbPushInvocationLog += "DB_PUSH_INVOKED_AT_$([DateTime]::UtcNow.Ticks)"
        return 0
    }
    Remove-TamperTestFixture -Fixture $fixture
}

Remove-Item Function:\Get-TaskState -ErrorAction SilentlyContinue
Remove-Item Function:\Save-TaskState -ErrorAction SilentlyContinue
Remove-Item Function:\Test-LocalSupabaseRunning -ErrorAction SilentlyContinue
Remove-Item Function:\Read-Host -ErrorAction SilentlyContinue
Remove-Item Function:\Invoke-LocalSupabaseDbPushExecution -ErrorAction SilentlyContinue

# ---------------------------------------------------------------------------
# HIGH-1 LOCAL-TARGET REPAIR: the REAL Invoke-LocalSupabaseDbPushExecution
# (not the no-op mock used by the sections above) must shell out to the
# Supabase CLI with an explicit `--local` flag, never a bare `db push`,
# never `--linked`, never `--db-url` - and a notionally-linked remote
# project must not change that. The native `supabase` command itself is
# mocked here (a `function supabase {...}` in this scope takes precedence
# over any external `supabase` executable under normal PowerShell command
# resolution), so this exercises the real argv the orchestrator would send
# to the CLI without ever invoking the CLI itself.
# ---------------------------------------------------------------------------
Set-Item -Path Function:\Invoke-LocalSupabaseDbPushExecution -Value $script:RealInvokeLocalSupabaseDbPushExecutionBody

$script:SupabaseArgsLog = @()
function supabase {
    $script:SupabaseArgsLog += ,@($args)
    $global:LASTEXITCODE = 0
}

function Get-TaskState { return $script:MockTaskState }
function Save-TaskState { param($State) $script:MockTaskState = $State }
function Test-LocalSupabaseRunning { return $true }
function Read-Host { param($Prompt) return "YES" }

# --- a/b/c. Successful authorized synthetic path: mocked CLI invoked with
# db, push, --local; never bare `db push`; never --linked; never --db-url. ---
$fixture = New-TamperTestFixture
try {
    $env:TERAS_APPROVAL_TRUST_DIR_OVERRIDE = $fixture.TrustDir
    New-DisposableApprovalTrustKey -Path (Get-ApprovalTrustKeyPath)
    $RepoRoot = $fixture.RepoRoot
    $script:SupabaseArgsLog = @()
    $state = New-BoundedApplyFixtureState -Fixture $fixture -MigrationFile "supabase/migrations/20261004999999_local_target_fixture.sql"
    $proofResult = New-ApprovalProof -State $state -RepoRoot $fixture.RepoRoot
    $state.AuthorityProof = $proofResult.Proof
    $script:MockTaskState = $state

    Invoke-ApplyMigration -Target "LOCAL"
    Assert-Equal @($script:SupabaseArgsLog).Count 1 "Successful authorized apply must invoke the mocked Supabase CLI exactly once."
    $invokedArgs = @($script:SupabaseArgsLog[0])
    Assert-True ($invokedArgs.Count -ge 3) "Invocation must carry at least db, push, --local."
    Assert-Equal $invokedArgs[0] "db" "First argv token must be 'db'."
    Assert-Equal $invokedArgs[1] "push" "Second argv token must be 'push'."
    Assert-True ($invokedArgs -contains "--local") "(a) Mocked invocation must contain --local."
    Assert-True (-not ($invokedArgs.Count -eq 2)) "(b) LOCAL path must never invoke bare 'db push' with no target flag."
    Assert-True (-not ($invokedArgs -contains "--linked")) "(c) --linked must never be present."
    Assert-True (-not ($invokedArgs -contains "--db-url")) "(d) --db-url must never be present."
    Write-Output "Repair test (local-target-repair a/b/c/d: explicit --local, never bare, never --linked, never --db-url): PASS"
} finally {
    Remove-TamperTestFixture -Fixture $fixture
}

# --- e. A repository notionally "linked" to a remote project (simulated by
# a supabase/config.toml with a project_id, the on-disk artifact `supabase
# link` produces) must not change the invocation target: --local must still
# be present and nothing else changes. ---
$fixture = New-TamperTestFixture
try {
    $env:TERAS_APPROVAL_TRUST_DIR_OVERRIDE = $fixture.TrustDir
    New-DisposableApprovalTrustKey -Path (Get-ApprovalTrustKeyPath)
    $RepoRoot = $fixture.RepoRoot
    $supabaseConfigDir = Join-Path $fixture.RepoRoot "supabase"
    New-Item -ItemType Directory -Path $supabaseConfigDir -Force | Out-Null
    Set-Content -Path (Join-Path $supabaseConfigDir "config.toml") -Value "project_id = `"simulated-linked-remote-project`"" -Encoding utf8
    $script:SupabaseArgsLog = @()
    $state = New-BoundedApplyFixtureState -Fixture $fixture -MigrationFile "supabase/migrations/20261004999999_linked_repo_fixture.sql"
    $proofResult = New-ApprovalProof -State $state -RepoRoot $fixture.RepoRoot
    $state.AuthorityProof = $proofResult.Proof
    $script:MockTaskState = $state

    Invoke-ApplyMigration -Target "LOCAL"
    Assert-Equal @($script:SupabaseArgsLog).Count 1 "Notionally-linked repo: apply must still reach the mocked CLI exactly once."
    $invokedArgs = @($script:SupabaseArgsLog[0])
    Assert-True ($invokedArgs -contains "--local") "(e) A notionally-linked remote project must not change the invocation target: --local must still be present."
    Assert-True (-not ($invokedArgs -contains "--linked")) "(e) A notionally-linked remote project must not introduce --linked."
    Write-Output "Repair test (local-target-repair e: remote link irrelevant to invocation target): PASS"
} finally {
    Remove-TamperTestFixture -Fixture $fixture
}

# --- f. All existing gate-failure cases still produce zero mocked CLI
# invocations against the REAL execution function (not just the no-op mock
# used earlier in this file). ---
$fixture = New-TamperTestFixture
try {
    $env:TERAS_APPROVAL_TRUST_DIR_OVERRIDE = $fixture.TrustDir
    New-DisposableApprovalTrustKey -Path (Get-ApprovalTrustKeyPath)
    $RepoRoot = $fixture.RepoRoot
    $script:SupabaseArgsLog = @()
    $state = New-BoundedApplyFixtureState -Fixture $fixture -MigrationFile "supabase/migrations/20261004999999_local_target_badproof.sql"
    $proofResult = New-ApprovalProof -State $state -RepoRoot $fixture.RepoRoot
    $state.AuthorityProof = $proofResult.Proof
    $state.AuthorityProof.Hmac = ("0" * 64)
    $script:MockTaskState = $state

    Invoke-ApplyMigration -Target "LOCAL"
    Assert-Equal @($script:SupabaseArgsLog).Count 0 "(f) Bad HMAC against the REAL execution function must produce zero CLI invocations."
    Write-Output "Repair test (local-target-repair f: gate failure still zero real-CLI invocations): PASS"
} finally {
    Remove-TamperTestFixture -Fixture $fixture
}

# --- g. Ordering still proves LEDGER_CONSUMED before DB_PUSH_INVOKED with
# the REAL CLI-invoking function wired in (not the earlier no-op mock). ---
$fixture = New-TamperTestFixture
try {
    $env:TERAS_APPROVAL_TRUST_DIR_OVERRIDE = $fixture.TrustDir
    New-DisposableApprovalTrustKey -Path (Get-ApprovalTrustKeyPath)
    $RepoRoot = $fixture.RepoRoot
    $script:OrderLog = @()
    $script:OriginalConsumeConsumptionLedgerEntryBody2 = ${function:Consume-ConsumptionLedgerEntry}
    function Consume-ConsumptionLedgerEntry {
        param([string]$Nonce)
        $script:OrderLog += "LEDGER_CONSUMED"
        return (& $script:OriginalConsumeConsumptionLedgerEntryBody2 $Nonce)
    }
    function supabase {
        $script:OrderLog += "DB_PUSH_INVOKED"
        $script:SupabaseArgsLog += ,@($args)
        $global:LASTEXITCODE = 0
    }

    $state = New-BoundedApplyFixtureState -Fixture $fixture -MigrationFile "supabase/migrations/20261004999999_local_target_ordering.sql"
    $proofResult = New-ApprovalProof -State $state -RepoRoot $fixture.RepoRoot
    $state.AuthorityProof = $proofResult.Proof
    $script:MockTaskState = $state
    $script:SupabaseArgsLog = @()

    Invoke-ApplyMigration -Target "LOCAL"
    Assert-Equal ($script:OrderLog -join ",") "LEDGER_CONSUMED,DB_PUSH_INVOKED" "(g) Ledger consumption must complete strictly BEFORE the REAL CLI-invoking function is ever reached."
    Assert-True (@($script:SupabaseArgsLog[0]) -contains "--local") "(g) The real ordering path must still pass --local to the mocked CLI."
    Write-Output "Repair test (local-target-repair g: ordering preserved with real CLI-invoking function): PASS"
} finally {
    if ($script:OriginalConsumeConsumptionLedgerEntryBody2) {
        Set-Item -Path Function:\Consume-ConsumptionLedgerEntry -Value $script:OriginalConsumeConsumptionLedgerEntryBody2
    }
    Remove-TamperTestFixture -Fixture $fixture
}

Remove-Item Function:\supabase -ErrorAction SilentlyContinue
Remove-Item Function:\Get-TaskState -ErrorAction SilentlyContinue
Remove-Item Function:\Save-TaskState -ErrorAction SilentlyContinue
Remove-Item Function:\Test-LocalSupabaseRunning -ErrorAction SilentlyContinue
Remove-Item Function:\Read-Host -ErrorAction SilentlyContinue
Remove-Item Function:\Invoke-LocalSupabaseDbPushExecution -ErrorAction SilentlyContinue

# ---------------------------------------------------------------------------
# HIGH-2: nonce format + path containment. None of these attack strings
# may ever create or modify a file outside the disposable consumption
# directory, and none may create/update a ledger entry (format
# validation must occur before ANY Join-Path/File.Open/ledger mutation).
# ---------------------------------------------------------------------------
$fixture = New-TamperTestFixture
try {
    $env:TERAS_APPROVAL_TRUST_DIR_OVERRIDE = $fixture.TrustDir
    New-DisposableApprovalTrustKey -Path (Get-ApprovalTrustKeyPath)
    $keyBytes = Get-ApprovalTrustKeyBytes -Path (Get-ApprovalTrustKeyPath)

    $validNonce = -join ((1..32) | ForEach-Object { "a" })
    $attackNonces = @(
        "..\evil", "..\..\evil", "../evil", "..\..\..\somefile",
        "C:\evil", "\\server\share", "a/b", "a\b", ".", "..",
        "", "   ", "not-hex-zzzzzzzzzzzzzzzzzzzzzzzzzzzzzz",
        ("a" * 31), ("a" * 33),
        ($validNonce.Substring(0, 16) + "\" + $validNonce.Substring(16)),
        ($validNonce + "/evil")
    )

    $consumptionDirBefore = Get-ApprovalConsumptionDir
    $parentOfConsumptionDir = Split-Path -Parent $consumptionDirBefore
    $filesOutsideBefore = @()
    if (Test-Path -LiteralPath $parentOfConsumptionDir) {
        $filesOutsideBefore = @(Get-ChildItem -LiteralPath $parentOfConsumptionDir -Recurse -File -ErrorAction SilentlyContinue |
            Where-Object { $_.FullName -notlike "$consumptionDirBefore*" } | Select-Object -ExpandProperty FullName)
    }

    foreach ($attack in $attackNonces) {
        $formatResult = Test-NonceFormat $attack
        Assert-True (-not $formatResult) "Attack nonce must fail Test-NonceFormat: '$attack'"

        $pathResult = Get-ConsumptionLedgerPathForNonce -Nonce $attack
        Assert-True ($null -eq $pathResult) "Attack nonce must not derive any ledger path: '$attack'"

        $createResult = New-ConsumptionLedgerEntry -Nonce $attack -TaskId "ATTACK-TASK" -KeyBytes $keyBytes
        Assert-True (-not $createResult.Success) "Attack nonce must not create a ledger entry: '$attack'"
        Assert-Equal $createResult.Reason "NONCE_FORMAT_INVALID_OR_PATH_ESCAPE" "Attack nonce ledger-create must fail at format/containment: '$attack'"

        $consumeResult = Consume-ConsumptionLedgerEntry -Nonce $attack
        Assert-True (-not $consumeResult.Success) "Attack nonce must not be consumable: '$attack'"

        $latchResult = Set-ConsumptionLedgerLatch -Nonce $attack -Reason "attack probe"
        Assert-True (-not [bool]$latchResult) "Attack nonce must not be latchable: '$attack'"
    }

    $filesOutsideAfter = @()
    if (Test-Path -LiteralPath $parentOfConsumptionDir) {
        $filesOutsideAfter = @(Get-ChildItem -LiteralPath $parentOfConsumptionDir -Recurse -File -ErrorAction SilentlyContinue |
            Where-Object { $_.FullName -notlike "$consumptionDirBefore*" } | Select-Object -ExpandProperty FullName)
    }
    Assert-Equal (@($filesOutsideAfter) | Sort-Object | Out-String) (@($filesOutsideBefore) | Sort-Object | Out-String) "No attack nonce may create or modify any file outside the disposable consumption directory."

    Write-Output "Repair test (HIGH-2 nonce path-traversal attack matrix / containment): PASS"
} finally {
    Remove-TamperTestFixture -Fixture $fixture
}

# --- HIGH-2 critical trust order: an invalid/untrusted nonce on a FAILED
# proof must never trigger a latch write before the nonce identity has
# been authenticated. Also: valid-FORMAT nonce + bad HMAC must not create
# any unauthenticated ledger file via the bounded validation entry point. ---
$fixture = New-TamperTestFixture
try {
    $env:TERAS_APPROVAL_TRUST_DIR_OVERRIDE = $fixture.TrustDir
    New-DisposableApprovalTrustKey -Path (Get-ApprovalTrustKeyPath)
    $state = New-TamperTestState
    $state.AuthorityProof = [pscustomobject]@{
        SchemaVersion = $script:ApprovalProofSchemaVersion
        Nonce = "..\..\..\evil-traversal"
        ApprovedAtUtc = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
        WorktreePath = $fixture.RepoRoot
        Branch = "feat/tamper-test-fixture"
        BaseHeadSha = ("a" * 40)
        Hmac = ("b" * 64)
        ConsumptionLedgerPath = "irrelevant"
    }

    $consumptionDir = Get-ApprovalConsumptionDir
    $filesBefore = @()
    if (Test-Path -LiteralPath (Split-Path -Parent $consumptionDir)) {
        $filesBefore = @(Get-ChildItem -LiteralPath (Split-Path -Parent $consumptionDir) -Recurse -File -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName)
    }

    $result = Invoke-BoundedLocalDatabaseValidation -State $state -RepoRoot $fixture.RepoRoot -RequestedMigrations @($state.LocalMigrationAllowlist[0])
    Assert-True (-not $result.Authorized) "A malformed/traversal nonce must never be authorized."
    Assert-Equal $result.Stage "PROOF_VERIFICATION" "A malformed/traversal nonce must be rejected at proof verification, before any identity is trusted."

    $filesAfter = @()
    if (Test-Path -LiteralPath (Split-Path -Parent $consumptionDir)) {
        $filesAfter = @(Get-ChildItem -LiteralPath (Split-Path -Parent $consumptionDir) -Recurse -File -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName)
    }
    Assert-Equal (@($filesAfter) | Sort-Object | Out-String) (@($filesBefore) | Sort-Object | Out-String) "An unauthenticated/tampered nonce must never create or modify ANY ledger or latch file."

    # Valid-FORMAT nonce + bad HMAC: must also create no unauthenticated
    # ledger file (no New-ConsumptionLedgerEntry/latch call for a proof
    # that has not been cryptographically authenticated).
    $state2 = New-TamperTestState
    $proofResult2 = New-ApprovalProof -State $state2 -RepoRoot $fixture.RepoRoot
    $state2.AuthorityProof = $proofResult2.Proof
    $state2.AuthorityProof.Hmac = ("0" * 64)
    # Remove the ledger entry New-ApprovalProof itself created (that one
    # IS a legitimate, authenticated-at-creation-time entry) so this
    # check only observes what Invoke-BoundedLocalDatabaseValidation
    # itself does with the now-tampered proof.
    $legitLedgerPath = Join-Path $consumptionDir "$($proofResult2.Proof.Nonce).json"
    $ledgerExistedBefore = Test-Path -LiteralPath $legitLedgerPath
    $ledgerContentBefore = if ($ledgerExistedBefore) { Get-Content -LiteralPath $legitLedgerPath -Raw } else { $null }

    $result2 = Invoke-BoundedLocalDatabaseValidation -State $state2 -RepoRoot $fixture.RepoRoot -RequestedMigrations @($state2.LocalMigrationAllowlist[0])
    Assert-True (-not $result2.Authorized) "Valid-format nonce + bad HMAC must never be authorized."
    Assert-Equal $result2.Stage "PROOF_VERIFICATION" "Valid-format nonce + bad HMAC must be rejected at proof verification."

    $ledgerContentAfter = if (Test-Path -LiteralPath $legitLedgerPath) { Get-Content -LiteralPath $legitLedgerPath -Raw } else { $null }
    Assert-Equal $ledgerContentAfter $ledgerContentBefore "A bad-HMAC proof must not mutate (e.g. latch) the ledger entry - its nonce identity was never authenticated by this call."

    Write-Output "Repair test (HIGH-2 critical trust order: no latch/ledger write before proof authentication): PASS"
} finally {
    Remove-TamperTestFixture -Fixture $fixture
}

# ---------------------------------------------------------------------------
# MEDIUM-1: ConsumptionLedgerPath tamper must invalidate the proof (now
# HMAC-bound) or fail the derived-path cross-check.
# ---------------------------------------------------------------------------
$fixture = New-TamperTestFixture
try {
    $env:TERAS_APPROVAL_TRUST_DIR_OVERRIDE = $fixture.TrustDir
    New-DisposableApprovalTrustKey -Path (Get-ApprovalTrustKeyPath)
    $state = New-TamperTestState
    $proofResult = New-ApprovalProof -State $state -RepoRoot $fixture.RepoRoot
    $state.AuthorityProof = $proofResult.Proof
    $state.AuthorityProof.ConsumptionLedgerPath = Join-Path (Get-ApprovalConsumptionDir) "attacker-controlled.json"

    $result = Invoke-BoundedLocalDatabaseValidation -State $state -RepoRoot $fixture.RepoRoot -RequestedMigrations @($state.LocalMigrationAllowlist[0])
    Assert-True (-not $result.Authorized) "A tampered ConsumptionLedgerPath must invalidate the proof."
    Assert-Equal $result.Stage "PROOF_VERIFICATION" "ConsumptionLedgerPath tamper must be caught at proof verification."
    Write-Output "Repair test (MEDIUM-1 ConsumptionLedgerPath tamper): PASS"
} finally {
    Remove-TamperTestFixture -Fixture $fixture
}

# ---------------------------------------------------------------------------
# MEDIUM-2: local runtime restrictions remain enforced on the LIVE apply
# path, not only via the standalone Invoke-BoundedLocalDatabaseValidation
# helper - no published ports / persistent volume / remote / staging /
# production authority can reach the mocked LOCAL execution point.
# ---------------------------------------------------------------------------
function Get-TaskState { return $script:MockTaskState }
function Save-TaskState { param($State) $script:MockTaskState = $State }
function Test-LocalSupabaseRunning { return $true }
function Read-Host { param($Prompt) return "YES" }
function Invoke-LocalSupabaseDbPushExecution {
    $script:DbPushInvocationLog += "DB_PUSH_INVOKED_AT_$([DateTime]::UtcNow.Ticks)"
    return 0
}

foreach ($violation in @(
    @{ Field = "PublishedPortsAllowed"; Value = $true },
    @{ Field = "PersistentDbVolumeAllowed"; Value = $true },
    @{ Field = "RemoteDbAllowed"; Value = $true },
    @{ Field = "StagingAllowed"; Value = $true },
    @{ Field = "ProductionAllowed"; Value = $true },
    @{ Field = "SyntheticDataOnly"; Value = $false }
)) {
    $fixture = New-TamperTestFixture
    try {
        $env:TERAS_APPROVAL_TRUST_DIR_OVERRIDE = $fixture.TrustDir
        New-DisposableApprovalTrustKey -Path (Get-ApprovalTrustKeyPath)
        $RepoRoot = $fixture.RepoRoot
        $script:DbPushInvocationLog = @()
        $state = New-BoundedApplyFixtureState -Fixture $fixture
        $state.($violation.Field) = $violation.Value
        $proofResult = New-ApprovalProof -State $state -RepoRoot $fixture.RepoRoot
        Assert-True $proofResult.Success "Proof signing itself does not enforce local-DB restrictions: $($violation.Field)"
        $state.AuthorityProof = $proofResult.Proof
        $script:MockTaskState = $state

        Invoke-ApplyMigration -Target "LOCAL"
        Assert-Equal @($script:DbPushInvocationLog).Count 0 "LIVE apply path: $($violation.Field)=$($violation.Value) must block supabase db push, not only the standalone helper."
    } finally {
        Remove-TamperTestFixture -Fixture $fixture
    }
}
Write-Output "Repair test (MEDIUM-2 local runtime restrictions enforced on the live apply path): PASS"

Remove-Item Function:\Get-TaskState -ErrorAction SilentlyContinue
Remove-Item Function:\Save-TaskState -ErrorAction SilentlyContinue
Remove-Item Function:\Test-LocalSupabaseRunning -ErrorAction SilentlyContinue
Remove-Item Function:\Read-Host -ErrorAction SilentlyContinue
Remove-Item Function:\Invoke-LocalSupabaseDbPushExecution -ErrorAction SilentlyContinue

$env:TERAS_APPROVAL_TRUST_DIR_OVERRIDE = $script:SavedTrustDirOverride

<#
    TASK 1: EXACT PENDING MIGRATION SET HARDENING - regression tests A-H.
    Invoke-LocalSupabaseDbPushDryRunExecution (the sole CLI shell-out for
    the dry-run preflight) is mocked file-wide via the definition near the
    top of this file; the real Supabase CLI is never invoked for the
    dry-run preflight anywhere in this file.
#>
$script:SavedTrustDirOverride2 = $env:TERAS_APPROVAL_TRUST_DIR_OVERRIDE

# [A] allowlist A / pending A => PASS
$fixture = New-TamperTestFixture
try {
    $env:TERAS_APPROVAL_TRUST_DIR_OVERRIDE = $fixture.TrustDir
    New-DisposableApprovalTrustKey -Path (Get-ApprovalTrustKeyPath)
    $state = New-TamperTestState -MigrationPath "supabase/migrations/20261004999999_pending_a.sql"
    $script:MockPendingMigrationPaths = @("supabase/migrations/20261004999999_pending_a.sql")
    $proofResult = New-ApprovalProof -State $state -RepoRoot $fixture.RepoRoot
    $state.AuthorityProof = $proofResult.Proof

    $result = Invoke-BoundedLocalDatabaseValidation -State $state -RepoRoot $fixture.RepoRoot -RequestedMigrations @($state.LocalMigrationAllowlist[0])
    Assert-True $result.Authorized "[A] allowlist A / pending A must PASS."
    Write-Output "Task 1 test [A] allowlist A / pending A => PASS: PASS"
} finally {
    Remove-TamperTestFixture -Fixture $fixture
}

# [B] allowlist A / pending A+B => BLOCK (superset pending vs allowlist)
$fixture = New-TamperTestFixture
try {
    $env:TERAS_APPROVAL_TRUST_DIR_OVERRIDE = $fixture.TrustDir
    New-DisposableApprovalTrustKey -Path (Get-ApprovalTrustKeyPath)
    $state = New-TamperTestState -MigrationPath "supabase/migrations/20261004999999_pending_a.sql"
    $script:MockPendingMigrationPaths = @("supabase/migrations/20261004999999_pending_a.sql")
    $proofResult = New-ApprovalProof -State $state -RepoRoot $fixture.RepoRoot
    $state.AuthorityProof = $proofResult.Proof
    # After signing, the LIVE pending set grows to A+B - never re-signed.
    $script:MockPendingMigrationPaths = @("supabase/migrations/20261004999999_pending_a.sql", "supabase/migrations/20261004999999_pending_b.sql")

    $result = Invoke-BoundedLocalDatabaseValidation -State $state -RepoRoot $fixture.RepoRoot -RequestedMigrations @($state.LocalMigrationAllowlist[0])
    Assert-True (-not $result.Authorized) "[B] allowlist A / pending A+B must BLOCK (superset pending)."
    Assert-Equal $result.Stage "PENDING_MIGRATION_SET" "[B] must be caught at the pending-set-vs-allowlist stage."
    Write-Output "Task 1 test [B] allowlist A / pending A+B => BLOCK: PASS"
} finally {
    Remove-TamperTestFixture -Fixture $fixture
}

# [C] allowlist A+B / pending A => BLOCK (subset pending vs allowlist)
$fixture = New-TamperTestFixture
try {
    $env:TERAS_APPROVAL_TRUST_DIR_OVERRIDE = $fixture.TrustDir
    New-DisposableApprovalTrustKey -Path (Get-ApprovalTrustKeyPath)
    $state = New-TamperTestState -MigrationPath "supabase/migrations/20261004999999_pending_a.sql"
    $state.LocalMigrationAllowlist = @("supabase/migrations/20261004999999_pending_a.sql", "supabase/migrations/20261004999999_pending_b.sql")
    Add-TrackedFixtureMigrations -Fixture $fixture -Paths $state.LocalMigrationAllowlist
    $script:MockPendingMigrationPaths = @("supabase/migrations/20261004999999_pending_a.sql", "supabase/migrations/20261004999999_pending_b.sql")
    $proofResult = New-ApprovalProof -State $state -RepoRoot $fixture.RepoRoot
    $state.AuthorityProof = $proofResult.Proof
    # After signing, the LIVE pending set shrinks to just A - never re-signed.
    $script:MockPendingMigrationPaths = @("supabase/migrations/20261004999999_pending_a.sql")

    $result = Invoke-BoundedLocalDatabaseValidation -State $state -RepoRoot $fixture.RepoRoot -RequestedMigrations @("supabase/migrations/20261004999999_pending_a.sql")
    Assert-True (-not $result.Authorized) "[C] allowlist A+B / pending A must BLOCK (subset pending)."
    Assert-Equal $result.Stage "PENDING_MIGRATION_SET" "[C] must be caught at the pending-set-vs-allowlist stage."
    Write-Output "Task 1 test [C] allowlist A+B / pending A => BLOCK: PASS"
} finally {
    Remove-TamperTestFixture -Fixture $fixture
}

# [D] reordered same set => deterministic PASS
$fixture = New-TamperTestFixture
try {
    $env:TERAS_APPROVAL_TRUST_DIR_OVERRIDE = $fixture.TrustDir
    New-DisposableApprovalTrustKey -Path (Get-ApprovalTrustKeyPath)
    $state = New-TamperTestState -MigrationPath "supabase/migrations/20261004999999_pending_a.sql"
    $state.LocalMigrationAllowlist = @("supabase/migrations/20261004999999_pending_b.sql", "supabase/migrations/20261004999999_pending_a.sql")
    Add-TrackedFixtureMigrations -Fixture $fixture -Paths $state.LocalMigrationAllowlist
    # Dry-run naturally returns a canonically-sorted set; simulate the CLI
    # reporting the opposite on-disk/temporal order to prove normalization.
    $script:MockPendingMigrationPaths = @("supabase/migrations/20261004999999_pending_a.sql", "supabase/migrations/20261004999999_pending_b.sql")
    $proofResult = New-ApprovalProof -State $state -RepoRoot $fixture.RepoRoot
    $state.AuthorityProof = $proofResult.Proof

    $result = Invoke-BoundedLocalDatabaseValidation -State $state -RepoRoot $fixture.RepoRoot -RequestedMigrations @("supabase/migrations/20261004999999_pending_a.sql", "supabase/migrations/20261004999999_pending_b.sql")
    Assert-True $result.Authorized "[D] A reordered but identical set must deterministically PASS."
    Write-Output "Task 1 test [D] reordered same set => deterministic PASS: PASS"
} finally {
    Remove-TamperTestFixture -Fixture $fixture
}

# [E] duplicate => BLOCK
$fixture = New-TamperTestFixture
try {
    $env:TERAS_APPROVAL_TRUST_DIR_OVERRIDE = $fixture.TrustDir
    New-DisposableApprovalTrustKey -Path (Get-ApprovalTrustKeyPath)
    $state = New-TamperTestState -MigrationPath "supabase/migrations/20261004999999_pending_a.sql"
    $proofResult = New-ApprovalProof -State $state -RepoRoot $fixture.RepoRoot
    $state.AuthorityProof = $proofResult.Proof
    # Simulate a duplicate line in the CLI's dry-run output.
    $script:MockDryRunRawOutput = @(
        "DRY RUN: migrations will *not* be pushed to the database.",
        "Would push migration 20261004999999_pending_a.sql...",
        "Would push migration 20261004999999_pending_a.sql...",
        "Finished supabase db push."
    )
    $script:MockDryRunExitCode = 0

    $result = Invoke-BoundedLocalDatabaseValidation -State $state -RepoRoot $fixture.RepoRoot -RequestedMigrations @($state.LocalMigrationAllowlist[0])
    Assert-True (-not $result.Authorized) "[E] A duplicate pending-set entry must BLOCK."
    Assert-Equal $result.Stage "PENDING_SET_PREFLIGHT" "[E] duplicate CLI output must be caught at the preflight parse stage."
    Write-Output "Task 1 test [E] duplicate => BLOCK: PASS"
} finally {
    $script:MockDryRunRawOutput = $null
    Remove-TamperTestFixture -Fixture $fixture
}

# [F] malformed => BLOCK
$fixture = New-TamperTestFixture
try {
    $env:TERAS_APPROVAL_TRUST_DIR_OVERRIDE = $fixture.TrustDir
    New-DisposableApprovalTrustKey -Path (Get-ApprovalTrustKeyPath)
    $state = New-TamperTestState -MigrationPath "supabase/migrations/20261004999999_pending_a.sql"
    $proofResult = New-ApprovalProof -State $state -RepoRoot $fixture.RepoRoot
    $state.AuthorityProof = $proofResult.Proof
    # Simulate a malformed migration identifier in the CLI's dry-run output.
    $script:MockDryRunRawOutput = @(
        "DRY RUN: migrations will *not* be pushed to the database.",
        "Would push migration not-a-valid-migration-name...",
        "Finished supabase db push."
    )
    $script:MockDryRunExitCode = 0

    $result = Invoke-BoundedLocalDatabaseValidation -State $state -RepoRoot $fixture.RepoRoot -RequestedMigrations @($state.LocalMigrationAllowlist[0])
    Assert-True (-not $result.Authorized) "[F] A malformed migration identifier in dry-run output must BLOCK."
    Assert-Equal $result.Stage "PENDING_SET_PREFLIGHT" "[F] malformed identifier must be caught at the preflight parse stage."
    Write-Output "Task 1 test [F] malformed => BLOCK: PASS"
} finally {
    $script:MockDryRunRawOutput = $null
    Remove-TamperTestFixture -Fixture $fixture
}

# [F2] ambiguous/unparseable output => BLOCK (unknown-line contract violation)
$fixture = New-TamperTestFixture
try {
    $env:TERAS_APPROVAL_TRUST_DIR_OVERRIDE = $fixture.TrustDir
    New-DisposableApprovalTrustKey -Path (Get-ApprovalTrustKeyPath)
    $state = New-TamperTestState -MigrationPath "supabase/migrations/20261004999999_pending_a.sql"
    $proofResult = New-ApprovalProof -State $state -RepoRoot $fixture.RepoRoot
    $state.AuthorityProof = $proofResult.Proof
    $script:MockDryRunRawOutput = @(
        "DRY RUN: migrations will *not* be pushed to the database.",
        "Unexpected diagnostic line from a future CLI version",
        "Would push migration 20261004999999_pending_a.sql...",
        "Finished supabase db push."
    )
    $script:MockDryRunExitCode = 0

    $result = Invoke-BoundedLocalDatabaseValidation -State $state -RepoRoot $fixture.RepoRoot -RequestedMigrations @($state.LocalMigrationAllowlist[0])
    Assert-True (-not $result.Authorized) "[F2] Ambiguous/unparseable dry-run output must BLOCK."
    Assert-Equal $result.Stage "PENDING_SET_PREFLIGHT" "[F2] unparseable output must be caught at the preflight parse stage."
    Write-Output "Task 1 test [F2] ambiguous/unparseable output => BLOCK: PASS"
} finally {
    $script:MockDryRunRawOutput = $null
    Remove-TamperTestFixture -Fixture $fixture
}

# [G] preflight failure (nonzero exit / exception) => BLOCK before ledger
# consumption - proves the preflight check runs and fails closed strictly
# before Consume-ConsumptionLedgerEntry is ever called.
$fixture = New-TamperTestFixture
try {
    $env:TERAS_APPROVAL_TRUST_DIR_OVERRIDE = $fixture.TrustDir
    New-DisposableApprovalTrustKey -Path (Get-ApprovalTrustKeyPath)
    $state = New-TamperTestState -MigrationPath "supabase/migrations/20261004999999_pending_a.sql"
    $proofResult = New-ApprovalProof -State $state -RepoRoot $fixture.RepoRoot
    $state.AuthorityProof = $proofResult.Proof
    $script:MockDryRunExitCode = 1
    $script:MockDryRunRawOutput = @("supabase: unexpected local stack error")

    $script:OrderLogG = @()
    $originalConsumeBodyG = ${function:Consume-ConsumptionLedgerEntry}
    function Consume-ConsumptionLedgerEntry {
        param([string]$Nonce)
        $script:OrderLogG += "LEDGER_CONSUMED"
        return (& $originalConsumeBodyG $Nonce)
    }

    $result = Invoke-BoundedLocalDatabaseValidation -State $state -RepoRoot $fixture.RepoRoot -RequestedMigrations @($state.LocalMigrationAllowlist[0])
    Assert-True (-not $result.Authorized) "[G] A failed CLI/preflight call must BLOCK."
    Assert-Equal $result.Stage "PENDING_SET_PREFLIGHT" "[G] preflight failure must be caught at the preflight stage."
    Assert-Equal @($script:OrderLogG).Count 0 "[G] Preflight failure must occur BEFORE ledger consumption is ever attempted."
    Write-Output "Task 1 test [G] preflight failure => BLOCK before ledger: PASS"
} finally {
    Set-Item -Path Function:\Consume-ConsumptionLedgerEntry -Value $originalConsumeBodyG
    $script:MockDryRunRawOutput = $null
    $script:MockDryRunExitCode = 0
    Remove-TamperTestFixture -Fixture $fixture
}

# [H] full ordering: PENDING_SET_VERIFIED -> LEDGER_CONSUMED -> DB_PUSH_INVOKED
$script:DbPushInvocationLog = @()
$script:MockTaskState = $null
function Get-TaskState { return $script:MockTaskState }
function Save-TaskState { param($State) $script:MockTaskState = $State }
function Test-LocalSupabaseRunning { return $true }
function Read-Host { param($Prompt) return "YES" }

$fixture = New-TamperTestFixture
try {
    $env:TERAS_APPROVAL_TRUST_DIR_OVERRIDE = $fixture.TrustDir
    New-DisposableApprovalTrustKey -Path (Get-ApprovalTrustKeyPath)
    $RepoRoot = $fixture.RepoRoot
    $script:OrderLogH = @()

    $originalDryRunBodyH = ${function:Invoke-LocalSupabaseDbPushDryRunExecution}
    function Invoke-LocalSupabaseDbPushDryRunExecution {
        $script:OrderLogH += "PENDING_SET_VERIFIED"
        return (& $originalDryRunBodyH)
    }
    $originalConsumeBodyH = ${function:Consume-ConsumptionLedgerEntry}
    function Consume-ConsumptionLedgerEntry {
        param([string]$Nonce)
        $script:OrderLogH += "LEDGER_CONSUMED"
        return (& $originalConsumeBodyH $Nonce)
    }
    function Invoke-LocalSupabaseDbPushExecution {
        $script:OrderLogH += "DB_PUSH_INVOKED"
        $script:DbPushInvocationLog += "DB_PUSH_INVOKED_AT_$([DateTime]::UtcNow.Ticks)"
        return 0
    }

    $state = New-BoundedApplyFixtureState -Fixture $fixture -MigrationFile "supabase/migrations/20261004999999_ordering_h.sql"
    $proofResult = New-ApprovalProof -State $state -RepoRoot $fixture.RepoRoot
    $state.AuthorityProof = $proofResult.Proof
    $script:MockTaskState = $state

    Invoke-ApplyMigration -Target "LOCAL"
    Assert-Equal ($script:OrderLogH -join ",") "PENDING_SET_VERIFIED,LEDGER_CONSUMED,DB_PUSH_INVOKED" "[H] Full ordering must be PENDING_SET_VERIFIED -> LEDGER_CONSUMED -> DB_PUSH_INVOKED."
    Write-Output "Task 1 test [H] ordering PENDING_SET_VERIFIED -> LEDGER_CONSUMED -> DB_PUSH_INVOKED: PASS"
} finally {
    Set-Item -Path Function:\Invoke-LocalSupabaseDbPushDryRunExecution -Value $originalDryRunBodyH
    Set-Item -Path Function:\Consume-ConsumptionLedgerEntry -Value $originalConsumeBodyH
    Remove-TamperTestFixture -Fixture $fixture
}

# Full signed local-push set with a single reviewed target. Intercept the
# actual apply-to-gate call while delegating to the real gate and ledger.
$originalBoundedBodyMulti = ${function:Invoke-BoundedLocalDatabaseValidation}
function Invoke-BoundedLocalDatabaseValidation {
    param($State, [string]$RepoRoot, [string[]]$RequestedMigrations = @())
    $script:CapturedApplyRequested = @($RequestedMigrations)
    return (& $originalBoundedBodyMulti -State $State -RepoRoot $RepoRoot -RequestedMigrations $RequestedMigrations)
}
function Invoke-LocalSupabaseDbPushExecution {
    $script:DbPushInvocationLog += 'MOCK_LOCAL_PUSH'
    return 0
}
$multiSet = @(
    'supabase/migrations/20261001000000_historical_a.sql',
    'supabase/migrations/20261002000000_historical_b.sql',
    'supabase/migrations/20261004023132_c4_wave1_erector_snapshot.sql'
)
try {
    foreach ($scenario in @('exact', 'added', 'missing', 'duplicate', 'malformed', 'unstaged', 'staged', 'deleted', 'untracked-replacement', 'symlink-head')) {
        $fixture = New-TamperTestFixture
        try {
            $env:TERAS_APPROVAL_TRUST_DIR_OVERRIDE = $fixture.TrustDir
            New-DisposableApprovalTrustKey -Path (Get-ApprovalTrustKeyPath)
            $RepoRoot = $fixture.RepoRoot
            $state = New-BoundedApplyFixtureState -Fixture $fixture -MigrationFile $multiSet[2]
            $state.LocalMigrationAllowlist = @($multiSet)
            Add-TrackedFixtureMigrations -Fixture $fixture -Paths $multiSet
            if ($scenario -eq 'untracked-replacement') {
                Push-Location $fixture.RepoRoot
                try {
                    git rm --cached -- $multiSet[0] | Out-Null
                    git commit -m 'remove historical migration from HEAD' --quiet
                } finally { Pop-Location }
            }
            if ($scenario -eq 'symlink-head') {
                Push-Location $fixture.RepoRoot
                try {
                    $linkBlob = ('target.sql' | git hash-object -w --stdin | Out-String).Trim()
                    git update-index --add --cacheinfo "120000,$linkBlob,$($multiSet[0])"
                    git commit -m 'non-regular HEAD fixture' --quiet
                } finally { Pop-Location }
            }
            $script:MockPendingMigrationPaths = @($multiSet)
            $proofResult = New-ApprovalProof -State $state -RepoRoot $fixture.RepoRoot
            Assert-True $proofResult.Success "[$scenario] three-migration proof must sign."
            $state.AuthorityProof = $proofResult.Proof
            $script:MockDryRunRawOutput = $null
            $historicalPath = Join-Path $fixture.RepoRoot $multiSet[0]
            switch ($scenario) {
                'added' { $script:MockPendingMigrationPaths += 'supabase/migrations/20261005000000_unapproved.sql' }
                'missing' { $script:MockPendingMigrationPaths = @($multiSet[0], $multiSet[2]) }
                'duplicate' { $script:MockPendingMigrationPaths += $multiSet[0] }
                'malformed' {
                    $script:MockDryRunRawOutput = @(
                        'DRY RUN: migrations will *not* be pushed to the database.',
                        'Would push migration not-valid.sql...',
                        'Finished supabase db push.'
                    )
                }
                'unstaged' { Add-Content -LiteralPath $historicalPath -Value '-- tampered after signing' }
                'staged' {
                    Add-Content -LiteralPath $historicalPath -Value '-- staged tamper after signing'
                    Push-Location $fixture.RepoRoot
                    try { git add -- $multiSet[0] } finally { Pop-Location }
                }
                'deleted' { Remove-Item -LiteralPath $historicalPath }
            }
            $script:MockTaskState = $state
            $script:DbPushInvocationLog = @()
            $script:CapturedApplyRequested = @()

            Invoke-ApplyMigration -Target 'LOCAL'
            Assert-Equal ($script:CapturedApplyRequested -join "`n") ($multiSet -join "`n") "[$scenario] LOCAL apply must request the entire signed set, not DbMigrationFile alone."
            $ledger = Test-ConsumptionLedgerIntegrity -Path $state.AuthorityProof.ConsumptionLedgerPath -KeyBytes (Get-ApprovalTrustKeyBytes -Path (Get-ApprovalTrustKeyPath))
            Assert-True $ledger.Valid "[$scenario] ledger integrity must hold."
            if ($scenario -eq 'exact') {
                foreach ($path in $multiSet) {
                    $entry = Invoke-GitRepositoryProbe -RepoRoot $fixture.RepoRoot -GitArguments @('ls-tree', $state.AuthorityProof.BaseHeadSha, '--', $path)
                    Assert-True ($entry.Success -and @($entry.Output).Count -eq 1) "Clean allowlisted path must exist at bound HEAD: $path"
                }
                Assert-Equal $state.DbMigrationFile $multiSet[2] 'Single review target must remain the latest migration.'
                Assert-Equal $script:MockTaskState.DbApplyStatus 'APPLIED' 'Exact multi-migration pending set must authorize.'
                Assert-Equal @($script:DbPushInvocationLog).Count 1 'Exact multi-migration set must reach mocked execution once.'
                Assert-Equal ([int]$ledger.Entry.ConsumedIterations) 1 'Exact multi-migration authorization consumes exactly one iteration.'
                Assert-True (-not $ledger.Entry.Latched) 'Successful multi-migration authorization must not latch.'
            } else {
                Assert-Equal $script:MockTaskState.DbApplyStatus 'BLOCKED' "[$scenario] pending-set mismatch must fail closed."
                Assert-Equal @($script:DbPushInvocationLog).Count 0 "[$scenario] no execution before matching pending set."
                Assert-Equal ([int]$ledger.Entry.ConsumedIterations) 0 "[$scenario] mismatch cannot consume an iteration."
                Assert-True $ledger.Entry.Latched "[$scenario] first failure must latch."
                $expectedReason = if ($scenario -in @('unstaged', 'staged', 'deleted', 'untracked-replacement', 'symlink-head')) { 'ALLOWLIST_HEAD_CONTENT_FAILED' } elseif ($scenario -in @('duplicate', 'malformed')) { 'LOCAL_PENDING_SET_PREFLIGHT_FAILED' } else { 'PENDING_MIGRATION_SET_FAILED' }
                Assert-True ([string]$ledger.Entry.LatchReason -match $expectedReason) "[$scenario] failure must have its proper pending-set latch reason."
                if ($scenario -in @('unstaged', 'staged', 'deleted', 'untracked-replacement', 'symlink-head')) {
                    Assert-True ([string]$ledger.Entry.LatchReason -match [regex]::Escape($multiSet[0])) "[$scenario] must identify the non-target path."
                }
            }
            Write-Output "Multi-migration LOCAL apply [$scenario]: PASS"
        } finally {
            $script:MockDryRunRawOutput = $null
            Remove-TamperTestFixture -Fixture $fixture
        }
    }
} finally {
    Set-Item -Path Function:\Invoke-BoundedLocalDatabaseValidation -Value $originalBoundedBodyMulti
    Remove-Item Function:\Invoke-LocalSupabaseDbPushExecution -ErrorAction SilentlyContinue
}

# A missing review target must be rejected by the runtime gate itself,
# even when the signed pending set and the requested set are identical.
foreach ($missingTarget in @($null, '', '   ')) {
    $fixture = New-TamperTestFixture
    try {
        $env:TERAS_APPROVAL_TRUST_DIR_OVERRIDE = $fixture.TrustDir
        New-DisposableApprovalTrustKey -Path (Get-ApprovalTrustKeyPath)
        $RepoRoot = $fixture.RepoRoot
        $state = New-BoundedApplyFixtureState -Fixture $fixture
        $proof = New-ApprovalProof -State $state -RepoRoot $fixture.RepoRoot
        $state.AuthorityProof = $proof.Proof
        $state.DbMigrationFile = $missingTarget
        $result = Invoke-BoundedLocalDatabaseValidation -State $state -RepoRoot $fixture.RepoRoot -RequestedMigrations $state.LocalMigrationAllowlist
        Assert-True (-not $result.Authorized) 'Missing review target must block.'
        Assert-Equal $result.Stage 'MIGRATION_ALLOWLIST' 'Missing review target must fail the membership gate.'
        Assert-Equal $result.Reason 'REVIEW_TARGET_MISSING' 'Missing review target needs an explicit reason.'
        $ledger = Test-ConsumptionLedgerIntegrity -Path $state.AuthorityProof.ConsumptionLedgerPath -KeyBytes (Get-ApprovalTrustKeyBytes -Path (Get-ApprovalTrustKeyPath))
        Assert-True ($ledger.Valid -and $ledger.Entry.Latched -and [int]$ledger.Entry.ConsumedIterations -eq 0) 'Missing review target must latch with zero consumption.'
        Assert-Equal ([string]$ledger.Entry.LatchReason) 'REQUESTED_MIGRATION_SET_FAILED: REVIEW_TARGET_MISSING' 'Missing target latch reason must be explicit.'
    } finally { Remove-TamperTestFixture -Fixture $fixture }
}
Write-Output 'Missing review target (null/empty/whitespace): PASS'

# --- Part D: actual db-push failure latch regression tests (A-F) ---------
#
# These tests mock Invoke-LocalSupabaseDbPushExecution itself, so no real
# `supabase` CLI, Postgres, or Docker process is ever started by any of them
# (requirement F is verified structurally: each mock below is a pure
# in-memory PowerShell function body with no external process invocation).

# [A] actual push success => expected successful terminal state, and the
# ledger is NOT latched (success must not be confused with failure).
$fixture = New-TamperTestFixture
try {
    $env:TERAS_APPROVAL_TRUST_DIR_OVERRIDE = $fixture.TrustDir
    New-DisposableApprovalTrustKey -Path (Get-ApprovalTrustKeyPath)
    $RepoRoot = $fixture.RepoRoot
    $script:DbPushInvocationLog = @()
    function Invoke-LocalSupabaseDbPushExecution {
        $script:DbPushInvocationLog += "DB_PUSH_INVOKED_SUCCESS"
        return 0
    }
    $state = New-BoundedApplyFixtureState -Fixture $fixture -MigrationFile "supabase/migrations/20261004999999_latch_a.sql"
    $proofResult = New-ApprovalProof -State $state -RepoRoot $fixture.RepoRoot
    $state.AuthorityProof = $proofResult.Proof
    $script:MockTaskState = $state
    $keyBytesA = Get-ApprovalTrustKeyBytes -Path (Get-ApprovalTrustKeyPath)

    Invoke-ApplyMigration -Target "LOCAL"
    Assert-Equal @($script:DbPushInvocationLog).Count 1 "[A] actual push success must invoke the real execution exactly once."
    Assert-Equal $script:MockTaskState.DbApplyStatus "APPLIED" "[A] a successful push must reach the APPLIED terminal state."
    Assert-Equal $script:MockTaskState.DbState "DB_VERIFYING" "[A] a successful push must advance DbState to DB_VERIFYING."
    $ledgerCheckA = Test-ConsumptionLedgerIntegrity -Path (Join-Path (Get-ApprovalConsumptionDir) "$($state.AuthorityProof.Nonce).json") -KeyBytes $keyBytesA
    Assert-True $ledgerCheckA.Valid "[A] ledger integrity must remain intact after a successful push."
    Assert-True (-not [bool]$ledgerCheckA.Entry.Latched) "[A] a successful push must NOT latch the ledger entry."
    Write-Output "Task Part-D test [A] actual push success => expected successful terminal state: PASS"
} finally {
    Remove-Item Function:\Invoke-LocalSupabaseDbPushExecution -ErrorAction SilentlyContinue
    Remove-TamperTestFixture -Fixture $fixture
}

# [B] actual push failure => failure latch written exactly once.
$fixture = New-TamperTestFixture
try {
    $env:TERAS_APPROVAL_TRUST_DIR_OVERRIDE = $fixture.TrustDir
    New-DisposableApprovalTrustKey -Path (Get-ApprovalTrustKeyPath)
    $RepoRoot = $fixture.RepoRoot
    $script:DbPushInvocationLog = @()
    function Invoke-LocalSupabaseDbPushExecution {
        $script:DbPushInvocationLog += "DB_PUSH_INVOKED_FAILURE"
        return 1
    }
    $state = New-BoundedApplyFixtureState -Fixture $fixture -MigrationFile "supabase/migrations/20261004999999_latch_b.sql"
    $proofResult = New-ApprovalProof -State $state -RepoRoot $fixture.RepoRoot
    $state.AuthorityProof = $proofResult.Proof
    $script:MockTaskState = $state
    $keyBytesB = Get-ApprovalTrustKeyBytes -Path (Get-ApprovalTrustKeyPath)

    Invoke-ApplyMigration -Target "LOCAL"
    Assert-Equal @($script:DbPushInvocationLog).Count 1 "[B] actual push failure must still invoke the real execution exactly once."
    Assert-Equal $script:MockTaskState.DbApplyStatus "BLOCKED" "[B] a failed push must reach the BLOCKED terminal state."
    $ledgerCheckB = Test-ConsumptionLedgerIntegrity -Path (Join-Path (Get-ApprovalConsumptionDir) "$($state.AuthorityProof.Nonce).json") -KeyBytes $keyBytesB
    Assert-True $ledgerCheckB.Valid "[B] ledger integrity must remain intact after the failure latch write."
    Assert-True ([bool]$ledgerCheckB.Entry.Latched) "[B] an actual push failure must write the failure latch."
    Assert-True (([string]$ledgerCheckB.Entry.LatchReason) -match "LOCAL_DB_PUSH_EXECUTION_FAILED") "[B] the latch reason must record the real execution failure, not a preflight stage."
    Write-Output "Task Part-D test [B] actual push failure => failure latch written exactly once: PASS"
} finally {
    Remove-Item Function:\Invoke-LocalSupabaseDbPushExecution -ErrorAction SilentlyContinue
    Remove-TamperTestFixture -Fixture $fixture
}

# [C] failed push => no retry (a second Invoke-ApplyMigration call against the
# same already-latched nonce must not invoke the real execution again).
$fixture = New-TamperTestFixture
try {
    $env:TERAS_APPROVAL_TRUST_DIR_OVERRIDE = $fixture.TrustDir
    New-DisposableApprovalTrustKey -Path (Get-ApprovalTrustKeyPath)
    $RepoRoot = $fixture.RepoRoot
    $script:DbPushInvocationLog = @()
    function Invoke-LocalSupabaseDbPushExecution {
        $script:DbPushInvocationLog += "DB_PUSH_INVOKED_$($script:DbPushInvocationLog.Count)"
        return 1
    }
    $state = New-BoundedApplyFixtureState -Fixture $fixture -MigrationFile "supabase/migrations/20261004999999_latch_c.sql"
    $proofResult = New-ApprovalProof -State $state -RepoRoot $fixture.RepoRoot
    $state.AuthorityProof = $proofResult.Proof
    $script:MockTaskState = $state

    Invoke-ApplyMigration -Target "LOCAL"
    Assert-Equal @($script:DbPushInvocationLog).Count 1 "[C] first attempt must invoke the real execution exactly once."

    # Second attempt with the identical (already-consumed, now-latched) proof.
    Invoke-ApplyMigration -Target "LOCAL"
    Assert-Equal @($script:DbPushInvocationLog).Count 1 "[C] a retried apply against an already-latched nonce must NOT invoke the real execution a second time."
    Assert-Equal $script:MockTaskState.DbApplyStatus "BLOCKED" "[C] the retry must be blocked, not silently re-authorized."
    Write-Output "Task Part-D test [C] failed push => no retry: PASS"
} finally {
    Remove-Item Function:\Invoke-LocalSupabaseDbPushExecution -ErrorAction SilentlyContinue
    Remove-TamperTestFixture -Fixture $fixture
}

# [D] same proof/nonce cannot invoke another push after failure, even via a
# freshly re-derived call that reuses the exact same AuthorityProof object
# (not merely "the same Invoke-ApplyMigration call path" as in [C], but the
# identical proof/nonce handed to Invoke-BoundedLocalDatabaseValidation
# directly, bypassing the higher-level Invoke-ApplyMigration wrapper).
$fixture = New-TamperTestFixture
try {
    $env:TERAS_APPROVAL_TRUST_DIR_OVERRIDE = $fixture.TrustDir
    New-DisposableApprovalTrustKey -Path (Get-ApprovalTrustKeyPath)
    $RepoRoot = $fixture.RepoRoot
    $script:DbPushInvocationLog = @()
    function Invoke-LocalSupabaseDbPushExecution {
        $script:DbPushInvocationLog += "DB_PUSH_INVOKED"
        return 1
    }
    $state = New-BoundedApplyFixtureState -Fixture $fixture -MigrationFile "supabase/migrations/20261004999999_latch_d.sql"
    $proofResult = New-ApprovalProof -State $state -RepoRoot $fixture.RepoRoot
    $state.AuthorityProof = $proofResult.Proof
    $script:MockTaskState = $state

    Invoke-ApplyMigration -Target "LOCAL"
    Assert-Equal @($script:DbPushInvocationLog).Count 1 "[D] the initial failing apply must invoke execution exactly once."

    # Directly re-invoke the bounded authorization gate with the identical
    # (already latched) proof - this must fail closed at the gate itself,
    # never reaching a second Invoke-LocalSupabaseDbPushExecution call.
    $reauthResult = Invoke-BoundedLocalDatabaseValidation -State $state -RepoRoot $fixture.RepoRoot -RequestedMigrations @($state.LocalMigrationAllowlist[0])
    Assert-True (-not $reauthResult.Authorized) "[D] the same proof/nonce must not re-authorize after a latched failure."
    Assert-Equal $reauthResult.Stage "CONSUMPTION_LEDGER" "[D] re-authorization against a latched nonce must fail at the consumption-ledger stage."
    Assert-Equal @($script:DbPushInvocationLog).Count 1 "[D] the real execution must still have been invoked exactly once in total."
    Write-Output "Task Part-D test [D] same proof/nonce cannot invoke another push after failure: PASS"
} finally {
    Remove-Item Function:\Invoke-LocalSupabaseDbPushExecution -ErrorAction SilentlyContinue
    Remove-TamperTestFixture -Fixture $fixture
}

# [E] latch write itself failing => fail closed (the apply must still report
# BLOCKED and must not silently proceed as if nothing happened, even when
# Set-ConsumptionLedgerLatch itself cannot write - e.g. the trust key becomes
# unreadable between consumption and the latch attempt).
$fixture = New-TamperTestFixture
try {
    $env:TERAS_APPROVAL_TRUST_DIR_OVERRIDE = $fixture.TrustDir
    New-DisposableApprovalTrustKey -Path (Get-ApprovalTrustKeyPath)
    $RepoRoot = $fixture.RepoRoot
    $script:DbPushInvocationLog = @()
    function Invoke-LocalSupabaseDbPushExecution {
        $script:DbPushInvocationLog += "DB_PUSH_INVOKED"
        return 1
    }
    $originalSetLatchBodyE = ${function:Set-ConsumptionLedgerLatch}
    function Set-ConsumptionLedgerLatch {
        param([string]$Nonce, [string]$Reason)
        return $false
    }
    $state = New-BoundedApplyFixtureState -Fixture $fixture -MigrationFile "supabase/migrations/20261004999999_latch_e.sql"
    $proofResult = New-ApprovalProof -State $state -RepoRoot $fixture.RepoRoot
    $state.AuthorityProof = $proofResult.Proof
    $script:MockTaskState = $state

    Invoke-ApplyMigration -Target "LOCAL"
    Assert-Equal $script:MockTaskState.DbApplyStatus "BLOCKED" "[E] a BLOCKED terminal state must be reported even when the latch write itself fails."
    Assert-Equal $script:MockTaskState.DbState "DB_ATTENTION_REQUIRED" "[E] DbState must still move to DB_ATTENTION_REQUIRED when the latch write fails."
    Write-Output "Task Part-D test [E] latch write itself failing => fail closed: PASS"
} finally {
    Set-Item -Path Function:\Set-ConsumptionLedgerLatch -Value $originalSetLatchBodyE
    Remove-Item Function:\Invoke-LocalSupabaseDbPushExecution -ErrorAction SilentlyContinue
    Remove-TamperTestFixture -Fixture $fixture
}

# [F] no real Supabase command is executed by any of tests A-E: every mock
# above is a pure in-memory PowerShell function with no & supabase, no
# external process start, and no network/file-system mutation outside this
# fixture's disposable scratch directories. Verified structurally by
# confirming none of the test bodies above reference the real
# `supabase` executable or Start-Process/System.Diagnostics.Process.
$selfSourcePartD = Get-Content -LiteralPath $PSCommandPath -Raw
$partDSectionStart = $selfSourcePartD.IndexOf("# --- Part D: actual db-push failure latch regression tests")
$partDSectionEnd = $selfSourcePartD.IndexOf("# [F] no real Supabase command is executed")
$partDSection = $selfSourcePartD.Substring($partDSectionStart, $partDSectionEnd - $partDSectionStart)
if ($partDSection -match '&\s+supabase\b' -or $partDSection -match 'Start-Process' -or $partDSection -match 'System\.Diagnostics\.Process') {
    throw "[F] Part D regression tests must never invoke a real external process or the supabase CLI."
}
Write-Output "Task Part-D test [F] no real Supabase command is executed by these tests: PASS"

Write-Output "ALL PART D (ACTUAL DB-PUSH FAILURE LATCH) REGRESSION TESTS A-F: PASS"

Remove-Item Function:\Get-TaskState -ErrorAction SilentlyContinue
Remove-Item Function:\Save-TaskState -ErrorAction SilentlyContinue
Remove-Item Function:\Test-LocalSupabaseRunning -ErrorAction SilentlyContinue
Remove-Item Function:\Read-Host -ErrorAction SilentlyContinue
Remove-Item Function:\Invoke-LocalSupabaseDbPushExecution -ErrorAction SilentlyContinue

$env:TERAS_APPROVAL_TRUST_DIR_OVERRIDE = $script:SavedTrustDirOverride2
Write-Output "ALL TASK 1 (EXACT PENDING MIGRATION SET) REGRESSION TESTS A-H: PASS"

Write-Output "ALL CONTROL-PLANE HARDENING REPAIR-ROUND REGRESSION TESTS: PASS"
#
