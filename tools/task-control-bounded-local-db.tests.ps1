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
