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

# A directory junction inside the repo points to the parent directory. The
# fixture uses an existing repository file through that escape and is always
# removed. Junction creation normally requires no elevation on Windows.
$linkFixture = Join-Path $PSScriptRoot "__path_safety_junction_fixture"
$reparseEscapeStatus = "NOT_TESTED"
$reparseFixtureMethod = "Windows directory Junction"
$junctionTarget = Split-Path -Parent $RepoRoot
$escapedExistingPath = "tools/__path_safety_junction_fixture/$(Split-Path -Leaf $RepoRoot)/AGENTS.md"
try {
    New-Item -ItemType Junction -Path $linkFixture -Target $junctionTarget -ErrorAction Stop | Out-Null
    $reparseEscapeStatus = if (-not (Test-ExplicitPathExists -RelativePath $escapedExistingPath)) { "PASS" } else { "FAIL" }
}
catch {
    $reparseEscapeStatus = "NOT_TESTED"
    $reparseFixtureReason = $_.Exception.Message
}
finally {
    if (Test-Path -LiteralPath $linkFixture) { Remove-Item -LiteralPath $linkFixture -Force -ErrorAction SilentlyContinue }
}
if ($reparseEscapeStatus -eq "FAIL") { throw "ASSERTION FAILED: A reparse-point path resolving outside the repository was accepted." }
Write-Output "REPARSE_ESCAPE_REJECTION=$reparseEscapeStatus"
Write-Output "REPARSE_FIXTURE_METHOD=$reparseFixtureMethod"
if ($reparseEscapeStatus -eq "NOT_TESTED") { Write-Output "REPARSE_FIXTURE_REASON=$reparseFixtureReason" }
