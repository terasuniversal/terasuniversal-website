<#
    qa-runner.ps1 - controlled QA sequence for the TERAS AI Engineering
    Orchestrator. Dot-sourced by teras-agent.ps1, which must set $RepoRoot
    before sourcing this file.

    Runs the BUSINESS_RULES.md QA sequence once per task, in order:
    git diff --check, npx tsc --noEmit, targeted tests (if identifiable),
    npm run build (only when appropriate). A command that is unavailable
    or inappropriate is recorded SKIPPED with a reason - never silently
    upgraded to PASS.
#>

function Test-CommandAvailable {
    param([string]$Name)
    return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Invoke-GitDiffCheck {
    Push-Location $RepoRoot
    try {
        $output = git diff --check 2>&1
        if ($LASTEXITCODE -eq 0) {
            return [pscustomobject]@{ Result = "PASS"; Reason = "No whitespace/conflict-marker issues." }
        }
        return [pscustomobject]@{ Result = "FAIL"; Reason = ($output -join " | ") }
    } finally {
        Pop-Location
    }
}

function Invoke-TypeScriptCheck {
    param([string[]]$ChangedFiles)

    $tsRelevant = @($ChangedFiles | Where-Object { $_ -match '\.(ts|tsx)$' })
    if ($tsRelevant.Count -eq 0) {
        return [pscustomobject]@{ Result = "SKIPPED"; Reason = "No .ts/.tsx files changed." }
    }
    if (-not (Test-CommandAvailable "npx")) {
        return [pscustomobject]@{ Result = "SKIPPED"; Reason = "npx not available on PATH." }
    }

    Push-Location $RepoRoot
    try {
        $output = npx tsc --noEmit 2>&1
        if ($LASTEXITCODE -eq 0) {
            return [pscustomobject]@{ Result = "PASS"; Reason = "npx tsc --noEmit reported no errors." }
        }
        return [pscustomobject]@{ Result = "FAIL"; Reason = (($output | Select-Object -First 10) -join " | ") }
    } finally {
        Pop-Location
    }
}

function Invoke-TargetedTests {
    param([string[]]$ChangedFiles)

    if (@($ChangedFiles).Count -eq 0) {
        return [pscustomobject]@{ Result = "SKIPPED"; Reason = "No changed files to target tests against." }
    }
    # This repo has no test runner wired up (per CLAUDE.md's documented
    # state) - report SKIPPED with the real reason rather than fabricating
    # a pass for tests that were never run.
    $hasTestScript = $false
    $pkgJsonPath = Join-Path $RepoRoot "package.json"
    if (Test-Path $pkgJsonPath) {
        try {
            $pkg = Get-Content $pkgJsonPath -Raw | ConvertFrom-Json
            if ($pkg.scripts -and $pkg.scripts.test -and $pkg.scripts.test -notmatch "no test specified") {
                $hasTestScript = $true
            }
        } catch {
            # Unreadable/invalid package.json - treat as no test script rather than failing QA on it.
        }
    }
    if (-not $hasTestScript) {
        return [pscustomobject]@{ Result = "SKIPPED"; Reason = "No test script configured in package.json for this area." }
    }
    return [pscustomobject]@{ Result = "SKIPPED"; Reason = "Targeted test selection is not implemented; run the relevant tests manually." }
}

# Building on every orchestration-only task (only .ai/tools files changed)
# would violate BUSINESS_RULES.md's "build once, as final verification, not
# an investigation loop" - and there is nothing for Next.js to build there.
function Test-BuildAppropriate {
    param([string[]]$ChangedFiles)

    $appRelevant = @($ChangedFiles | Where-Object { $_ -notmatch '^(\.ai/|tools/)' })
    return ($appRelevant.Count -gt 0)
}

function Invoke-ProductionBuild {
    param([string[]]$ChangedFiles)

    if (-not (Test-BuildAppropriate -ChangedFiles $ChangedFiles)) {
        return [pscustomobject]@{ Result = "SKIPPED"; Reason = "Only orchestration files (.ai/, tools/) changed - no application build required." }
    }
    if (-not (Test-CommandAvailable "npm")) {
        return [pscustomobject]@{ Result = "SKIPPED"; Reason = "npm not available on PATH." }
    }

    Push-Location $RepoRoot
    try {
        $output = npm run build 2>&1
        if ($LASTEXITCODE -eq 0) {
            return [pscustomobject]@{ Result = "PASS"; Reason = "npm run build completed successfully." }
        }
        return [pscustomobject]@{ Result = "FAIL"; Reason = (($output | Select-Object -Last 15) -join " | ") }
    } finally {
        Pop-Location
    }
}

function Invoke-QA {
    param([string[]]$ChangedFiles, [switch]$Lightweight)

    # Lightweight mode (DeepSeek / LOW-risk tasks, USAGE_POLICY.md): still
    # runs git diff --check, targeted tests, and tsc when TypeScript changed
    # - just never triggers a full production build for a routine CSS/CRUD
    # change. A human can still run `npm run build` themselves, or it runs
    # anyway at -PrepareCommit/-PrepareRelease time if truly needed.
    $build = if ($Lightweight) {
        [pscustomobject]@{ Result = "SKIPPED"; Reason = "Lightweight QA for a DeepSeek/LOW-risk task - full build is not run automatically. See .ai/USAGE_POLICY.md." }
    } else {
        Invoke-ProductionBuild -ChangedFiles $ChangedFiles
    }

    $results = [pscustomobject]@{
        GitDiffCheck = Invoke-GitDiffCheck
        TypeScript   = Invoke-TypeScriptCheck -ChangedFiles $ChangedFiles
        Tests        = Invoke-TargetedTests -ChangedFiles $ChangedFiles
        Build        = $build
    }

    Write-Host ""
    Write-Host "QA RESULTS"
    Write-Host ""
    Write-Host "Git Diff Check    : $($results.GitDiffCheck.Result)"
    Write-Host "TypeScript        : $($results.TypeScript.Result)"
    Write-Host "Targeted Tests    : $($results.Tests.Result)"
    Write-Host "Production Build  : $($results.Build.Result)"
    Write-Host ""

    return $results
}

function Test-QaHasBlockingFailure {
    param($QaResults)
    foreach ($key in @("GitDiffCheck", "TypeScript", "Tests", "Build")) {
        if ($QaResults.$key.Result -eq "FAIL") { return $true }
    }
    return $false
}
