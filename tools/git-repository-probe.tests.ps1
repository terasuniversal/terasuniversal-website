$ErrorActionPreference = "Stop"

<#
    Focused regression test for Invoke-GitRepositoryProbe (agent-router.ps1).

    Root cause under test: Windows PowerShell 5.1, with the script-wide
    $ErrorActionPreference = "Stop" that teras-agent.ps1 sets, can turn a
    native command's stderr write into a terminating NativeCommandError even
    though the call used 2>$null - so an intentional "is $RepoRoot a git
    repository?" probe against a non-git scratch directory (as exercised by
    tools/task-control-foundation.tests.ps1's CLI harness) must not crash the
    whole script. This test proves the fix without weakening fail-closed
    behavior for a genuine, unrelated git failure.
#>

function Assert-True {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { throw "ASSERTION FAILED: $Message" }
}

function Assert-Equal {
    param($Actual, $Expected, [string]$Message)
    if ($Actual -cne $Expected) { throw "ASSERTION FAILED: $Message`nExpected: $Expected`nActual: $Actual" }
}

$testScratch = $env:TMPDIR
if ([string]::IsNullOrWhiteSpace($testScratch)) {
    if (-not [string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) { $testScratch = Join-Path $env:LOCALAPPDATA "hermes/cache/scratch" }
    else { $testScratch = [IO.Path]::GetTempPath() }
}
if (-not (Test-Path -LiteralPath $testScratch)) { New-Item -ItemType Directory -Path $testScratch -Force | Out-Null }
$testRoot = Join-Path $testScratch ("teras-git-probe-" + [Guid]::NewGuid().ToString("N"))

try {
    # Dot-source only the function definitions. agent-router.ps1 computes its
    # own $RepoRoot/$AiDir from $PSScriptRoot at dot-source time, which is
    # fine here - this test never relies on those script-scoped paths.
    . (Join-Path $PSScriptRoot "agent-router.ps1")

    $ErrorActionPreference = "Stop"

    # --- A: non-git scratch RepoRoot must not terminate the script ---
    $nonGitRoot = Join-Path $testRoot "not-a-repo"
    New-Item -ItemType Directory -Path $nonGitRoot -Force | Out-Null
    $negativeProbe = $null
    $threw = $false
    try {
        $negativeProbe = Invoke-GitRepositoryProbe -RepoRoot $nonGitRoot -GitArguments @("branch", "--show-current")
    } catch {
        $threw = $true
    }
    Assert-True (-not $threw) "A non-git RepoRoot probe must not throw a terminating error under PS5.1 `$ErrorActionPreference = 'Stop'."

    # --- B: result must correctly report it is not a git repository ---
    Assert-True ($null -ne $negativeProbe) "Probe must return a result object for a non-git directory."
    Assert-Equal $negativeProbe.Success $false "A non-git directory probe must report Success = `$false."
    Assert-Equal $negativeProbe.IsGitRepository $false "A non-git directory probe must explicitly report IsGitRepository = `$false (not `$null, not `$true)."

    # --- C: normal valid git RepoRoot behavior must still work ---
    # This repository's own worktree root is a real, valid git repository.
    $realRepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
    $positiveProbe = Invoke-GitRepositoryProbe -RepoRoot $realRepoRoot -GitArguments @("rev-parse", "--is-inside-work-tree")
    Assert-Equal $positiveProbe.Success $true "A valid git repository probe must succeed."
    Assert-Equal $positiveProbe.IsGitRepository $true "A valid git repository probe must report IsGitRepository = `$true."
    Assert-True (($positiveProbe.Output -join "`n").Trim() -eq "true") "A valid git repository probe must return git's real stdout output."

    # --- D: an unexpected/unrelated git failure must stay a failure, never
    # be silently reinterpreted as a clean negative probe or as success.
    # An invalid rev-list range against a real repo produces a non-128,
    # non-"not a git repository" git error - this must surface as
    # IsGitRepository = $null (unexpected failure), not $false or $true.
    $unexpectedFailureProbe = Invoke-GitRepositoryProbe -RepoRoot $realRepoRoot -GitArguments @("rev-list", "--left-right", "--count", "this-ref-does-not-exist...HEAD")
    Assert-Equal $unexpectedFailureProbe.Success $false "An unrelated git failure must still report Success = `$false."
    Assert-True ($null -eq $unexpectedFailureProbe.IsGitRepository) "An unrelated git failure (not 'not a git repository') must report IsGitRepository = `$null, never `$true/`$false - a security-relevant failure must never be silently converted to a clean result."

    # --- End-to-end: New-TaskState itself must not crash when $RepoRoot is
    # a non-git scratch directory, and must record IsGitRepository = $false
    # rather than leaving WorkspaceBoundary half-populated or throwing.
    $script:RepoRoot = $nonGitRoot
    $classification = @{ Category = "Feature"; Risk = "LOW"; Implementer = "Codex"; ImplementerModel = "CODEX"; Reviewer = "None"; ReviewerModel = "None"; Reason = "test"; HumanApproval = "NOT REQUIRED"; FullRepoAudit = $false }
    $endToEndThrew = $false
    $endToEndState = $null
    try {
        $endToEndState = New-TaskState -TaskId "TERAS-GIT-PROBE-TEST" -Description "End-to-end non-git RepoRoot probe test." -Classification $classification
    } catch {
        $endToEndThrew = $true
    }
    Assert-True (-not $endToEndThrew) "New-TaskState must not throw when `$RepoRoot is a non-git scratch directory."
    Assert-Equal $endToEndState.WorkspaceBoundary.IsGitRepository $false "New-TaskState must record IsGitRepository = `$false for a non-git `$RepoRoot."
    Assert-True ($null -eq $endToEndState.WorkspaceBoundary.Branch) "New-TaskState must leave Branch unset (not fabricated) when `$RepoRoot is not a git repository."

    Write-Output "Git repository probe regression tests: PASS"
} finally {
    if (Test-Path -LiteralPath $testRoot) { Remove-Item -LiteralPath $testRoot -Recurse -Force }
}
