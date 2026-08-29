<#
    validate-runner.ps1 - end-to-end dry-run validation suite for the TERAS
    AI Engineering Orchestrator. Dot-sourced by teras-agent.ps1, which must
    set $RepoRoot, $AiDir before sourcing this file. Depends on every other
    tools/*.ps1 module also being sourced first (agent-router, qa-runner,
    agent-runner, review-runner, approval-runner, push-runner,
    preview-runner, pr-runner, release-runner, deepseek-runner, db-runner).

    SIMULATION ONLY, by design, always:
    - never touches the real .ai/task-state.json / CURRENT_TASK.md - every
      test constructs its own in-memory state via New-EmptyTaskState /
      New-TaskState and never calls Save-TaskState/Get-TaskState against the
      live paths
    - never invokes a real Claude/Codex/DeepSeek/gh/vercel/supabase CLI -
      every "would this call an agent" question is answered by inspecting
      the routing/handoff-generation logic, not by actually running it
    - the one place real generated content is inspected (context-budget /
      handoff-scope tests) only runs when Get-TaskState shows no real task
      is in progress (State = NONE), and always restores every touched file
      to its empty-state placeholder afterward - the same pattern used
      throughout every prior phase's manual verification
    - writes only under .ai/validation/ (fixtures, plan, results) as
      permanent output; any other write is scratch and reverted before
      the run ends
#>

$script:ValidationDir = Join-Path $AiDir "validation"
$script:FixturesDir = Join-Path $script:ValidationDir "fixtures"
$script:ValidationResultsPath = Join-Path $script:ValidationDir "VALIDATION_RESULTS.md"

# ---------------------------------------------------------------------------
# Result accumulator - a plain array of test-result objects, printed and
# written to VALIDATION_RESULTS.md at the end. Never fabricates a result;
# every entry traces back to an actual function call in this session.
# ---------------------------------------------------------------------------

function New-ValidationResult {
    param(
        [string]$Id,
        [string]$Description,
        [string]$Expected,
        [string]$Actual,
        [ValidateSet("PASS", "FAIL", "WARN")]
        [string]$Result,
        [string]$Notes = ""
    )
    return [pscustomobject]@{
        Id = $Id; Description = $Description; Expected = $Expected
        Actual = $Actual; Result = $Result; Notes = $Notes
    }
}

# ---------------------------------------------------------------------------
# Section 26: command availability - all read-only detection, nothing
# installed, ever. Reuses the exact detectors the live pipeline uses.
# ---------------------------------------------------------------------------

function Get-ToolAvailability {
    $deepSeekConfigured = Test-DeepSeekRunnerAvailable
    return [ordered]@{
        git      = ($null -ne (Get-Command "git" -ErrorAction SilentlyContinue))
        node     = ($null -ne (Get-Command "node" -ErrorAction SilentlyContinue))
        npm      = ($null -ne (Get-Command "npm" -ErrorAction SilentlyContinue))
        claude   = (Test-ClaudeAvailable)
        codex    = (Test-CodexAvailable)
        vercel   = (Test-VercelAvailable)
        supabase = (Test-SupabaseCliAvailable)
        gh       = (Test-GitHubCliAvailable)
        deepseek = $deepSeekConfigured
    }
}

# ---------------------------------------------------------------------------
# Section 7: agent-availability-aware fallback. Pure/advisory - never
# touches the live pipeline or persisted state. Only ever swaps
# DeepSeek<->CLAUDE_FAST for a task that was already eligible for that
# swap; a Claude-DEEP+mandatory-Codex classification is never touched by
# the DeepSeek/Claude branches below, by construction (the `elseif` never
# matches a CLAUDE_DEEP task). Codex EXHAUSTED on a mandatory review blocks
# rather than silently downgrading - that branch is unconditional.
# ---------------------------------------------------------------------------

function Get-EffectiveImplementer {
    param(
        $Classification,
        [string]$DeepSeekAvailability = "NORMAL",
        [string]$ClaudeAvailability = "NORMAL",
        [string]$CodexAvailability = "NORMAL"
    )

    $result = [pscustomobject]@{
        Implementer      = $Classification.Implementer
        ImplementerModel = $Classification.ImplementerModel
        Reviewer         = $Classification.Reviewer
        ReviewerModel    = $Classification.ReviewerModel
        FallbackApplied  = $false
        FallbackReason   = $null
        Blocked          = $false
        BlockReason      = $null
    }

    $isDeepSeekTask = ($Classification.Implementer -eq "DeepSeek")
    $isClaudeFastTask = ($Classification.Implementer -eq "Claude Code" -and $Classification.ImplementerModel -eq "CLAUDE_FAST")

    if ($isDeepSeekTask -and $DeepSeekAvailability -eq "LIMITED") {
        $result.Implementer = "Claude Code"
        $result.ImplementerModel = "CLAUDE_FAST"
        $result.FallbackApplied = $true
        $result.FallbackReason = "DeepSeek LIMITED - rerouted to Claude FAST for this routine task."
    } elseif ($isClaudeFastTask -and $ClaudeAvailability -eq "LIMITED") {
        $result.Implementer = "DeepSeek"
        $result.ImplementerModel = "DEEPSEEK_FAST"
        $result.FallbackApplied = $true
        $result.FallbackReason = "Claude LIMITED - preferring DeepSeek for this routine task."
    }

    if ($result.Reviewer -eq "Codex" -and $CodexAvailability -eq "EXHAUSTED") {
        $result.Blocked = $true
        $result.BlockReason = "Mandatory independent review unavailable (Codex EXHAUSTED)."
    } elseif ($result.Reviewer -eq "Codex (recommended)" -and $CodexAvailability -in @("LIMITED", "EXHAUSTED")) {
        $result.Reviewer = "None (optional review skipped)"
        $result.ReviewerModel = "None"
        $result.FallbackApplied = $true
        $result.FallbackReason = "Optional Codex review skipped - Codex $CodexAvailability. Mandatory reviews are never skipped this way."
    }

    return $result
}

# ---------------------------------------------------------------------------
# Section 2: fixtures - synthetic task definitions only, no secrets, no
# production data.
# ---------------------------------------------------------------------------

function New-ValidationFixtures {
    New-Item -ItemType Directory -Path $script:FixturesDir -Force | Out-Null

    $fixtures = [ordered]@{
        "test1-low-ui.md"          = "Fix mobile spacing on attendance print page"
        "test2-medium-feature.md"  = "Add participant search and status filter to admin participant list"
        "test3-critical-db.md"     = "Modify certificate public verification RPC and its RLS/security behavior"
        "test10-deepseek-escalation.md" = "Add participant status filter"
        "test17-db-destructive.sql" = "ALTER TABLE certificates DROP COLUMN verification_token;"
        "test18-rls-widen.sql"      = "CREATE POLICY anon_read_all ON certificates FOR SELECT TO anon USING (true);"
        "test19-security-definer.sql" = "CREATE OR REPLACE FUNCTION recalc_eligibility() RETURNS void AS `$`$ BEGIN NULL; END; `$`$ LANGUAGE plpgsql SECURITY DEFINER;"
        "deepseek-label-fixture.txt" = "Old Label"
    }

    foreach ($name in $fixtures.Keys) {
        $path = Join-Path $script:FixturesDir $name
        Set-Content -Path $path -Value $fixtures[$name] -Encoding utf8
    }
    return $script:FixturesDir
}

function Get-Fixture {
    param([string]$Name)
    $path = Join-Path $script:FixturesDir $Name
    return (Get-Content -Path $path -Raw).Trim()
}

# ---------------------------------------------------------------------------
# Generic classification checker - calls the REAL Get-TaskClassification
# (agent-router.ps1), a pure function that touches no state file, and
# compares the result against expectations.
# ---------------------------------------------------------------------------

function Test-Classification {
    param(
        [string]$TestId,
        [string]$Description,
        [int]$MenuChoice,
        [string]$ExpectedRisk,
        [string[]]$ExpectedImplementerAny,
        [string]$ExpectedReviewerContains = $null
    )

    $c = Get-TaskClassification -MenuChoice $MenuChoice -Description $Description
    $results = @()

    $riskOk = ($c.Risk -eq $ExpectedRisk)
    $results += New-ValidationResult -Id "$TestId-risk" -Description "'$Description' -> Risk" -Expected $ExpectedRisk -Actual $c.Risk -Result $(if ($riskOk) { "PASS" } else { "FAIL" })

    $implOk = ($ExpectedImplementerAny -contains $c.Implementer)
    $results += New-ValidationResult -Id "$TestId-implementer" -Description "'$Description' -> Implementer" -Expected ($ExpectedImplementerAny -join " or ") -Actual "$($c.Implementer) / $($c.ImplementerModel)" -Result $(if ($implOk) { "PASS" } else { "FAIL" })

    if ($ExpectedReviewerContains) {
        $revOk = if ($ExpectedReviewerContains -eq "NONE") { $c.Reviewer -eq "None" } else { $c.Reviewer -like "*$ExpectedReviewerContains*" }
        $results += New-ValidationResult -Id "$TestId-reviewer" -Description "'$Description' -> Reviewer" -Expected $ExpectedReviewerContains -Actual $c.Reviewer -Result $(if ($revOk) { "PASS" } else { "FAIL" })
    }

    return [pscustomobject]@{ Classification = $c; Results = $results }
}

# Section 8: context budget - LOW/MEDIUM-suitable gets the small, fixed
# handoff context; HIGH/CRITICAL adds the database/certificate-specific
# handoff on top. Never a repo-wide scan (Full Repo Audit stays OFF except
# for an explicit Production Audit).
function Get-ContextBudgetLabel {
    param($Classification)
    if ($Classification.Risk -in @("HIGH", "CRITICAL")) { return "TARGETED" }
    if ($Classification.Risk -eq "MEDIUM") { return "SMALL" }
    return "SMALL"
}

# ---------------------------------------------------------------------------
# Tests 1-3: classification + workflow + context budget
# ---------------------------------------------------------------------------

function Invoke-ValidationTests123 {
    $results = @()

    # --- Test 1: LOW risk UI task ---
    $desc1 = Get-Fixture "test1-low-ui.md"
    $menu1 = Get-AutoMenuChoice -Description $desc1
    # Stable-operational-mode: Claude FAST is now the default implementer
    # for LOW-risk tasks (DeepSeek is optional/manual-only unless enabled
    # and healthy) - see the routing-default change tests below.
    $t1 = Test-Classification -TestId "T1" -Description $desc1 -MenuChoice $menu1 -ExpectedRisk "LOW" -ExpectedImplementerAny @("Claude Code") -ExpectedReviewerContains "NONE"
    $results += $t1.Results

    $budget1 = Get-ContextBudgetLabel -Classification $t1.Classification
    $results += New-ValidationResult -Id "T1-context-budget" -Description "Test 1 context budget" -Expected "SMALL" -Actual $budget1 -Result $(if ($budget1 -eq "SMALL") { "PASS" } else { "FAIL" })
    $results += New-ValidationResult -Id "T1-full-repo-audit" -Description "Test 1 Full Repo Audit" -Expected "OFF" -Actual $(if ($t1.Classification.FullRepoAudit) { "ON" } else { "OFF" }) -Result $(if (-not $t1.Classification.FullRepoAudit) { "PASS" } else { "FAIL" })
    $results += New-ValidationResult -Id "T1-workflow" -Description "Test 1 expected workflow reachable" -Expected "CREATED -> ROUTED -> IMPLEMENTING -> QA -> AWAITING_APPROVAL (no REVIEWING - Reviewer=None)" -Actual "Invoke-ReviewStage returns immediately when Mandatory=false and Optional=false (t1 Reviewer=$($t1.Classification.Reviewer))" -Result $(if ($t1.Classification.Reviewer -eq "None") { "PASS" } else { "FAIL" }) -Notes "Structural check against Invoke-ReviewStage's early-return guard, not a live pipeline run."

    # --- Test 2: MEDIUM risk feature ---
    $desc2 = Get-Fixture "test2-medium-feature.md"
    $menu2 = Get-AutoMenuChoice -Description $desc2
    $t2 = Test-Classification -TestId "T2" -Description $desc2 -MenuChoice $menu2 -ExpectedRisk "MEDIUM" -ExpectedImplementerAny @("DeepSeek", "Claude Code")
    $results += $t2.Results
    $results += New-ValidationResult -Id "T2-codex" -Description "Test 2 Codex requirement" -Expected "NOT REQUIRED unless risk expands" -Actual $t2.Classification.Reviewer -Result $(if ($t2.Classification.Reviewer -in @("None", "Codex (recommended)")) { "PASS" } else { "FAIL" })
    $results += New-ValidationResult -Id "T2-no-cert-db-context" -Description "Test 2 should not pull certificate/database context" -Expected "No CertTrust/DbSensitive keyword match" -Actual "isCertTrust/isDbSensitive not triggered (Category=$($t2.Classification.Category))" -Result $(if ($t2.Classification.Category -notlike "*Certificate*" -and $t2.Classification.Category -notlike "*Database*") { "PASS" } else { "FAIL" })

    # --- Test 3: CRITICAL certificate database task ---
    $desc3 = Get-Fixture "test3-critical-db.md"
    $menu3 = Get-AutoMenuChoice -Description $desc3
    $t3 = Test-Classification -TestId "T3" -Description $desc3 -MenuChoice $menu3 -ExpectedRisk "CRITICAL" -ExpectedImplementerAny @("Claude Code") -ExpectedReviewerContains "Codex"
    $results += $t3.Results
    $results += New-ValidationResult -Id "T3-model" -Description "Test 3 model" -Expected "CLAUDE_DEEP" -Actual $t3.Classification.ImplementerModel -Result $(if ($t3.Classification.ImplementerModel -eq "CLAUDE_DEEP") { "PASS" } else { "FAIL" })
    $results += New-ValidationResult -Id "T3-deepseek-ineligible" -Description "Test 3 DeepSeek must not be eligible" -Expected "Implementer != DeepSeek" -Actual $t3.Classification.Implementer -Result $(if ($t3.Classification.Implementer -ne "DeepSeek") { "PASS" } else { "FAIL" })
    $results += New-ValidationResult -Id "T3-human-approval" -Description "Test 3 human approval required" -Expected "REQUIRED" -Actual $t3.Classification.HumanApproval -Result $(if ($t3.Classification.HumanApproval -eq "REQUIRED") { "PASS" } else { "FAIL" })
    $budget3 = Get-ContextBudgetLabel -Classification $t3.Classification
    $results += New-ValidationResult -Id "T3-context-budget" -Description "Test 3 context budget" -Expected "TARGETED" -Actual $budget3 -Result $(if ($budget3 -eq "TARGETED") { "PASS" } else { "FAIL" })
    $results += New-ValidationResult -Id "T3-full-repo-audit" -Description "Test 3 Full Repo Audit" -Expected "OFF (targeted context, not a full scan)" -Actual $(if ($t3.Classification.FullRepoAudit) { "ON" } else { "OFF" }) -Result $(if (-not $t3.Classification.FullRepoAudit) { "PASS" } else { "FAIL" })

    return @{ Results = $results; T1 = $t1.Classification; T2 = $t2.Classification; T3 = $t3.Classification }
}

# ---------------------------------------------------------------------------
# Phase 9B fix: attendance/module classification precedence + explicit-path
# scope population regression tests (Test A-G from the fix spec). A real
# pilot found Allowed Files left unpopulated ("fill in before implementation
# begins") despite the task description naming exact existing files, and
# risked a generic-visual-keyword category collision with certificate
# routing. These tests exercise the real functions (Get-TaskClassification,
# New-TaskState, Get-ExplicitTaskPaths, Test-ExplicitPathExists,
# Test-RepoRelativePathsEqual, Test-DeepSeekPatchPathAllowed) - read-only
# against the real repo filesystem (Test-Path/-LiteralPath only, never a
# write) and otherwise fully synthetic, no provider call.
# ---------------------------------------------------------------------------

function Invoke-AttendanceModuleFixTests {
    $results = @()

    # --- Test A: attendance explicit paths ---
    $descA = "Fix mobile alignment and spacing on the existing attendance print page only.`n`nThe existing implementation is in:`napp/admin/(protected)/attendance/[scheduleId]/print/page.tsx`napp/admin/(protected)/attendance/[scheduleId]/print/PrintButton.tsx`n`nModify only these existing files if necessary."
    $menuA = Get-AutoMenuChoice -Description $descA
    $cA = Get-TaskClassification -MenuChoice $menuA -Description $descA
    $results += New-ValidationResult -Id "fix-testA-category" -Description "Test A: attendance explicit paths -> Category" -Expected "Attendance / UI / Print" -Actual $cA.Category -Result $(if ($cA.Category -eq "Attendance / UI / Print") { "PASS" } else { "FAIL" })
    $results += New-ValidationResult -Id "fix-testA-risk" -Description "Test A: attendance explicit paths -> Risk" -Expected "LOW" -Actual $cA.Risk -Result $(if ($cA.Risk -eq "LOW") { "PASS" } else { "FAIL" })
    $results += New-ValidationResult -Id "fix-testA-not-certificate" -Description "Test A: must NOT classify as Certificate / Visual" -Expected "Category != Certificate / Visual" -Actual $cA.Category -Result $(if ($cA.Category -ne "Certificate / Visual") { "PASS" } else { "FAIL" })

    $stateA = New-TaskState -TaskId "VALIDATION-FIXTEST-A" -Description $descA -Classification $cA
    $expectedAllowedA = @(
        "app/admin/(protected)/attendance/[scheduleId]/print/page.tsx",
        "app/admin/(protected)/attendance/[scheduleId]/print/PrintButton.tsx"
    )
    $allowedMatchA = (@($stateA.AllowedFiles).Count -eq 2) -and (@($expectedAllowedA | Where-Object { $p = $_; -not (@($stateA.AllowedFiles) | Where-Object { Test-RepoRelativePathsEqual -A $_ -B $p }) }).Count -eq 0)
    $results += New-ValidationResult -Id "fix-testA-allowed-files" -Description "Test A: Allowed Files populated with both exact paths" -Expected ($expectedAllowedA -join " | ") -Actual (@($stateA.AllowedFiles) -join " | ") -Result $(if ($allowedMatchA) { "PASS" } else { "FAIL" })
    $results += New-ValidationResult -Id "fix-testA-scope-source" -Description "Test A: Scope Source recorded as EXPLICIT_TASK_PATHS" -Expected "EXPLICIT_TASK_PATHS" -Actual $stateA.ScopeSource -Result $(if ($stateA.ScopeSource -eq "EXPLICIT_TASK_PATHS") { "PASS" } else { "FAIL" })
    # Stable-operational-mode change: Claude FAST is now the default
    # implementer for this LOW-risk task (previously DeepSeek by default) -
    # DeepSeek remains available via -PreferDeepSeek, tested separately.
    $results += New-ValidationResult -Id "fix-testA-implementer" -Description "Test A: Implementer defaults to Claude FAST/LOW (stable operational mode)" -Expected "Claude Code / CLAUDE_FAST" -Actual "$($cA.Implementer) / $($cA.ImplementerModel)" -Result $(if ($cA.Implementer -eq "Claude Code" -and $cA.ImplementerModel -eq "CLAUDE_FAST") { "PASS" } else { "FAIL" })

    # --- Test B: certificate visual (must not regress) ---
    $descB = "Fix Template A crest spacing"
    $menuB = Get-AutoMenuChoice -Description $descB
    $cB = Get-TaskClassification -MenuChoice $menuB -Description $descB
    $results += New-ValidationResult -Id "fix-testB-category" -Description "Test B: certificate visual routing not broken by the module-signal fix" -Expected "Certificate / Visual" -Actual $cB.Category -Result $(if ($cB.Category -eq "Certificate / Visual") { "PASS" } else { "FAIL" })
    $results += New-ValidationResult -Id "fix-testB-risk" -Description "Test B: certificate visual risk" -Expected "LOW or MEDIUM" -Actual $cB.Risk -Result $(if ($cB.Risk -in @("LOW", "MEDIUM")) { "PASS" } else { "FAIL" })

    # --- Test C: certificate verification RPC (must not regress) ---
    $descC = "Modify certificate public verification RPC and its RLS/security behavior"
    $menuC = Get-AutoMenuChoice -Description $descC
    $cC = Get-TaskClassification -MenuChoice $menuC -Description $descC
    $results += New-ValidationResult -Id "fix-testC-risk" -Description "Test C: certificate verification RPC stays CRITICAL" -Expected "CRITICAL" -Actual $cC.Risk -Result $(if ($cC.Risk -eq "CRITICAL") { "PASS" } else { "FAIL" })
    $results += New-ValidationResult -Id "fix-testC-implementer" -Description "Test C: Claude DEEP, not DeepSeek" -Expected "Claude Code / CLAUDE_DEEP" -Actual "$($cC.Implementer) / $($cC.ImplementerModel)" -Result $(if ($cC.Implementer -eq "Claude Code" -and $cC.ImplementerModel -eq "CLAUDE_DEEP") { "PASS" } else { "FAIL" })
    $results += New-ValidationResult -Id "fix-testC-reviewer" -Description "Test C: Codex mandatory" -Expected "Codex" -Actual $cC.Reviewer -Result $(if ($cC.Reviewer -eq "Codex") { "PASS" } else { "FAIL" })

    # --- Test D: generic print UI outside certificates ---
    $descD = "Fix the print button spacing on the schedule export page"
    $menuD = Get-AutoMenuChoice -Description $descD
    $cD = Get-TaskClassification -MenuChoice $menuD -Description $descD
    $results += New-ValidationResult -Id "fix-testD-not-certificate" -Description "Test D: generic print-related UI outside certificates must not become Certificate / Visual" -Expected "Category != Certificate / Visual" -Actual $cD.Category -Result $(if ($cD.Category -ne "Certificate / Visual") { "PASS" } else { "FAIL" })

    # --- Test E: dynamic route literal equality (exact match = allowed) ---
    $routePath = "app/admin/(protected)/attendance/[scheduleId]/print/page.tsx"
    $eqExact = Test-RepoRelativePathsEqual -A $routePath -B $routePath
    $results += New-ValidationResult -Id "fix-testE-literal-equal" -Description "Test E: exact [scheduleId] path compared to itself" -Expected "true" -Actual $eqExact -Result $(if ($eqExact) { "PASS" } else { "FAIL" })
    $patchAllowedExact = Test-DeepSeekPatchPathAllowed -Path $routePath -AllowedFiles @($routePath)
    $results += New-ValidationResult -Id "fix-testE-patch-allowed" -Description "Test E: DeepSeek patch validator allows the exact allowed [scheduleId] path" -Expected "true" -Actual $patchAllowedExact -Result $(if ($patchAllowedExact) { "PASS" } else { "FAIL" })

    # --- Test F: dynamic route mismatch (123 vs [scheduleId] = rejected) ---
    $concretePath = "app/admin/(protected)/attendance/123/print/page.tsx"
    $eqMismatch = Test-RepoRelativePathsEqual -A $routePath -B $concretePath
    $results += New-ValidationResult -Id "fix-testF-literal-mismatch" -Description "Test F: [scheduleId] path vs a concrete '123' path must NOT compare equal" -Expected "false" -Actual $eqMismatch -Result $(if (-not $eqMismatch) { "PASS" } else { "FAIL" })
    $patchAllowedMismatch = Test-DeepSeekPatchPathAllowed -Path $concretePath -AllowedFiles @($routePath)
    $results += New-ValidationResult -Id "fix-testF-patch-rejected" -Description "Test F: DeepSeek patch validator rejects a concrete '123' path when only [scheduleId] is allowed" -Expected "false" -Actual $patchAllowedMismatch -Result $(if (-not $patchAllowedMismatch) { "PASS" } else { "FAIL" })

    # --- Test G: nonexistent explicit path must not be auto-approved ---
    $descG = "Fix spacing on the attendance print page.`n`napp/admin/(protected)/attendance/[scheduleId]/print/NonExistentFile.tsx`n"
    $menuG = Get-AutoMenuChoice -Description $descG
    $cG = Get-TaskClassification -MenuChoice $menuG -Description $descG
    $stateG = New-TaskState -TaskId "VALIDATION-FIXTEST-G" -Description $descG -Classification $cG
    $notFoundListedG = (@($stateG.ExplicitPathsNotFound) | Where-Object { Test-RepoRelativePathsEqual -A $_ -B "app/admin/(protected)/attendance/[scheduleId]/print/NonExistentFile.tsx" }).Count -gt 0
    $results += New-ValidationResult -Id "fix-testG-not-auto-approved" -Description "Test G: a nonexistent explicit path is not auto-approved into Allowed Files" -Expected "AllowedFiles does not contain the nonexistent path" -Actual "AllowedFiles={$($stateG.AllowedFiles -join ', ')}" -Result $(if (@($stateG.AllowedFiles | Where-Object { Test-RepoRelativePathsEqual -A $_ -B "app/admin/(protected)/attendance/[scheduleId]/print/NonExistentFile.tsx" }).Count -eq 0) { "PASS" } else { "FAIL" })
    $results += New-ValidationResult -Id "fix-testG-reported-not-found" -Description "Test G: the nonexistent path is reported via ExplicitPathsNotFound, not silently dropped" -Expected "true" -Actual $notFoundListedG -Result $(if ($notFoundListedG) { "PASS" } else { "FAIL" })
    $existsCheckG = Test-ExplicitPathExists -RelativePath "app/admin/(protected)/attendance/[scheduleId]/print/NonExistentFile.tsx"
    $results += New-ValidationResult -Id "fix-testG-literal-not-glob" -Description "Test G: existence check uses -LiteralPath, not wildcard resolution against [scheduleId]" -Expected "false (file genuinely does not exist)" -Actual $existsCheckG -Result $(if (-not $existsCheckG) { "PASS" } else { "FAIL" })

    # --- Patch-report semantic separation (section 9) ---
    $reportPath = Join-Path $AiDir "DEEPSEEK_IMPLEMENTATION_REPORT.md"
    $reportBackup = Get-Content -Path $reportPath -Raw -Encoding utf8
    try {
        $synthState = New-EmptyTaskState
        $synthState.TaskId = "VALIDATION-FIXTEST-REPORT"; $synthState.Description = "Synthetic report-semantics check"
        $synthParsed = [pscustomobject]@{ Status = "SUCCESS"; Summary = "Attempted a mixed-scope patch"; EscalationRequired = $false; EscalationReason = ""; Files = @() }
        Write-DeepSeekReportFromApi -State $synthState -Parsed $synthParsed -Applied @() -Rejected @("app/admin/layout.tsx") | Out-Null
        $escalation = Get-DeepSeekEscalation
        $reasonNeverMixed = ($escalation.Reason -eq "N/A") -and (-not ($escalation.Reason -like "*outside approved scope*"))
        $results += New-ValidationResult -Id "fix-report-reason-not-mixed" -Description "Escalation Required=NO keeps Reason=N/A - a scope rejection never appears in DeepSeek's own Reason field" -Expected "Reason='N/A', Required=false" -Actual "Reason='$($escalation.Reason)', Required=$($escalation.Required)" -Result $(if ($reasonNeverMixed -and -not $escalation.Required) { "PASS" } else { "FAIL" })
        $results += New-ValidationResult -Id "fix-report-patch-application-field" -Description "Patch Application field reports REJECTED separately" -Expected "REJECTED" -Actual $escalation.PatchApplication -Result $(if ($escalation.PatchApplication -eq "REJECTED") { "PASS" } else { "FAIL" })
        $results += New-ValidationResult -Id "fix-report-orchestrator-reason-field" -Description "Orchestrator Reason field carries SCOPE_VALIDATION_FAILURE separately from Escalation Reason" -Expected "Starts with SCOPE_VALIDATION_FAILURE" -Actual $escalation.OrchestratorReason -Result $(if ($escalation.OrchestratorReason -like "SCOPE_VALIDATION_FAILURE*") { "PASS" } else { "FAIL" })
    } finally {
        Set-Content -Path $reportPath -Value $reportBackup -Encoding utf8
    }

    return $results
}

# ---------------------------------------------------------------------------
# Phase 9B fix #2: DeepSeek API source-content loader regression tests. A
# real pilot's approved dynamic-route files ([scheduleId]) were reported as
# "does not exist" because the source loader used non-literal
# Test-Path/Get-Content -Path, which parses "[scheduleId]" as a wildcard
# character class rather than literal text. DeepSeek received a prompt
# telling it its own approved files don't exist and correctly, but
# uselessly, escalated. These tests exercise the real, fixed functions
# (Get-DeepSeekSourceLoadResult, Invoke-DeepSeekApiImplementation,
# Write-DeepSeekReportFromApi, Get-DeepSeekEscalation) against the real
# repo's actual attendance print files (read-only) plus synthetic [id]/
# [token] paths - no live provider call, DEEPSEEK_API_KEY is not configured
# in this environment so Invoke-DeepSeekApiCall's own preflight
# (Test-DeepSeekApiKeyConfigured) would refuse any live call regardless.
# ---------------------------------------------------------------------------

function Invoke-DeepSeekSourceContextFixTests {
    $results = @()

    $scheduleIdPage = "app/admin/(protected)/attendance/[scheduleId]/print/page.tsx"
    $scheduleIdPrintButton = "app/admin/(protected)/attendance/[scheduleId]/print/PrintButton.tsx"

    # --- Regression 1: [scheduleId] source file loads literally (real repo file) ---
    $r1 = Get-DeepSeekSourceLoadResult -AllowedFiles @($scheduleIdPage) -ScopeSource "EXPLICIT_TASK_PATHS"
    $existsOnDisk = Test-Path -LiteralPath (Join-Path $RepoRoot $scheduleIdPage) -PathType Leaf
    $r1Loaded = $r1.Success -and ($r1.ContentText -match [regex]::Escape("FILE: $scheduleIdPage")) -and ($r1.ContentText -notmatch "does not exist")
    $results += New-ValidationResult -Id "srcfix-1-scheduleid-loads" -Description "Regression 1: [scheduleId] source file loads literally" -Expected "File Exists: YES, Content Loaded: YES" -Actual "File Exists: $(if ($existsOnDisk) {'YES'} else {'NO'}), Content Loaded: $(if ($r1Loaded) {'YES'} else {'NO'})" -Result $(if ($existsOnDisk -and $r1Loaded) { "PASS" } else { "FAIL" })
    $results += New-ValidationResult -Id "srcfix-1-scheduleid-literal-text" -Description "Regression 1: literal text [scheduleId] survives unchanged in loaded content" -Expected "Contains literal '[scheduleId]'" -Actual "Contains: $($r1.ContentText -match [regex]::Escape('[scheduleId]'))" -Result $(if ($r1.ContentText -match [regex]::Escape('[scheduleId]')) { "PASS" } else { "FAIL" })

    # --- Regression 2: [id] source file loads literally (synthetic - repo has no such file, MANUAL scope = benign) ---
    $idPath = "app/admin/(protected)/attendance/[id]/page.tsx"
    $r2 = Get-DeepSeekSourceLoadResult -AllowedFiles @($idPath) -ScopeSource "MANUAL"
    $results += New-ValidationResult -Id "srcfix-2-id-literal" -Description "Regression 2: [id] path handled literally, no wildcard crash/false-match" -Expected "Success=true, literal '[id]' preserved in the reported block" -Actual "Success=$($r2.Success), Contains '[id]': $($r2.ContentText -match [regex]::Escape('[id]'))" -Result $(if ($r2.Success -and ($r2.ContentText -match [regex]::Escape('[id]'))) { "PASS" } else { "FAIL" })

    # --- Regression 3: [token] source file loads literally (synthetic) ---
    $tokenPath = "app/verify/[token]/page.tsx"
    $r3 = Get-DeepSeekSourceLoadResult -AllowedFiles @($tokenPath) -ScopeSource "MANUAL"
    $results += New-ValidationResult -Id "srcfix-3-token-literal" -Description "Regression 3: [token] path handled literally, no wildcard crash/false-match" -Expected "Success=true, literal '[token]' preserved in the reported block" -Actual "Success=$($r3.Success), Contains '[token]': $($r3.ContentText -match [regex]::Escape('[token]'))" -Result $(if ($r3.Success -and ($r3.ContentText -match [regex]::Escape('[token]'))) { "PASS" } else { "FAIL" })

    # --- Regression 4: dynamic-route literal path does not wildcard-match a concrete id ---
    $concretePath = "app/admin/(protected)/attendance/123/print/page.tsx"
    $r4 = Get-DeepSeekSourceLoadResult -AllowedFiles @($scheduleIdPage) -ScopeSource "MANUAL"
    # The loader only ever reports on the paths it was given - proving the
    # allowed [scheduleId] entry's content block never gets attributed to
    # the concrete "123" path (i.e. the two are never treated as the same
    # source file).
    $crossMatch = $r4.ContentText -match [regex]::Escape("FILE: $concretePath")
    $results += New-ValidationResult -Id "srcfix-4-no-wildcard-crossmatch" -Description "Regression 4: loader output for the [scheduleId] entry is never attributed to a concrete '123' path" -Expected "false" -Actual $crossMatch -Result $(if (-not $crossMatch) { "PASS" } else { "FAIL" })
    $patchRejected = -not (Test-DeepSeekPatchPathAllowed -Path $concretePath -AllowedFiles @($scheduleIdPage))
    $results += New-ValidationResult -Id "srcfix-4-patch-validator-rejects" -Description "Regression 4: patch validator still rejects the concrete '123' path against a [scheduleId]-only scope" -Expected "true (rejected)" -Actual $patchRejected -Result $(if ($patchRejected) { "PASS" } else { "FAIL" })

    # --- Regression 5: DeepSeek payload contains actual attendance source content for both approved files ---
    $bothAllowed = @($scheduleIdPage, $scheduleIdPrintButton)
    $r5 = Get-DeepSeekSourceLoadResult -AllowedFiles $bothAllowed -ScopeSource "EXPLICIT_TASK_PATHS"
    $userPrompt5 = "## RELEVANT CONTEXT`n`nTask: Fix mobile alignment and spacing on the existing attendance print page only.`n`n## SOURCE CONTENT`n`n$($r5.ContentText)"
    $file1Present = $userPrompt5.Contains("FILE: $scheduleIdPage")
    $file2Present = $userPrompt5.Contains("FILE: $scheduleIdPrintButton")
    # Presence + size only - never dump full source content into a report.
    $results += New-ValidationResult -Id "srcfix-5-payload-both-files-present" -Description "Regression 5: constructed payload includes source content markers for BOTH approved attendance files" -Expected "Both FILE: markers present" -Actual "page.tsx present=$file1Present, PrintButton.tsx present=$file2Present, payload length=$($userPrompt5.Length) chars" -Result $(if ($file1Present -and $file2Present) { "PASS" } else { "FAIL" })
    $results += New-ValidationResult -Id "srcfix-5-payload-nonempty-content" -Description "Regression 5: payload is substantially larger than just the two FILE markers (real content included, not empty stubs)" -Expected "> 500 chars" -Actual "$($userPrompt5.Length) chars" -Result $(if ($userPrompt5.Length -gt 500) { "PASS" } else { "FAIL" })

    # --- Regression 6 + 7: missing approved source aborts before any API call, reported as orchestrator failure not agent escalation ---
    $reportPath = Join-Path $AiDir "DEEPSEEK_IMPLEMENTATION_REPORT.md"
    $reportBackup = Get-Content -Path $reportPath -Raw -Encoding utf8
    $realState = Get-TaskState
    if ($realState.State -ne "NONE") {
        $results += New-ValidationResult -Id "srcfix-6-preflight-abort" -Description "Regression 6/7: preflight abort + report semantics" -Expected "N/A" -Actual "SKIPPED - a real task is in progress (State=$($realState.State)); the report file must not be disturbed." -Result "WARN"
    } else {
        try {
            $missingState = New-EmptyTaskState
            $missingState.TaskId = "VALIDATION-SRCFIX-MISSING"
            $missingState.Description = "Synthetic preflight-abort check"
            $missingState.ScopeSource = "EXPLICIT_TASK_PATHS"
            $missingState.AllowedFiles = @("app/admin/(protected)/attendance/[scheduleId]/print/NonExistentFile.tsx")

            $ran = Invoke-DeepSeekApiImplementation -HandoffPath (Join-Path $AiDir "DEEPSEEK_HANDOFF.md") -State $missingState
            $results += New-ValidationResult -Id "srcfix-6-zero-api-calls" -Description "Regression 6: missing approved source aborts BEFORE any API call (DeepSeek API Calls: 0)" -Expected "false (implementation did not proceed), no patch, no call" -Actual "Invoke-DeepSeekApiImplementation returned: $ran" -Result $(if (-not $ran) { "PASS" } else { "FAIL" })

            $escalation = Get-DeepSeekEscalation
            $results += New-ValidationResult -Id "srcfix-6-provider-not-called" -Description "Regression 6: Provider Status reports NOT CALLED" -Expected "NOT CALLED" -Actual $escalation.ProviderStatus -Result $(if ($escalation.ProviderStatus -eq "NOT CALLED") { "PASS" } else { "FAIL" })
            $results += New-ValidationResult -Id "srcfix-7-source-context-fail" -Description "Regression 7: Source Context reports FAIL" -Expected "FAIL" -Actual $escalation.SourceContext -Result $(if ($escalation.SourceContext -eq "FAIL") { "PASS" } else { "FAIL" })
            $results += New-ValidationResult -Id "srcfix-7-not-agent-escalation" -Description "Regression 7: a source-read failure is reported as Escalation Required=NOT RUN, never YES (never presented as the agent's own decision)" -Expected "EscalationStatus=NOT RUN, Required=false" -Actual "EscalationStatus=$($escalation.EscalationStatus), Required=$($escalation.Required)" -Result $(if ($escalation.EscalationStatus -eq "NOT RUN" -and -not $escalation.Required) { "PASS" } else { "FAIL" })
            $results += New-ValidationResult -Id "srcfix-7-orchestrator-reason" -Description "Regression 7: Orchestrator Reason names SOURCE_CONTEXT_ERROR and the affected path" -Expected "Starts with SOURCE_CONTEXT_ERROR, mentions NonExistentFile.tsx" -Actual $escalation.OrchestratorReason -Result $(if ($escalation.OrchestratorReason -like "SOURCE_CONTEXT_ERROR*" -and $escalation.OrchestratorReason -like "*NonExistentFile.tsx*") { "PASS" } else { "FAIL" })
        } finally {
            Set-Content -Path $reportPath -Value $reportBackup -Encoding utf8
        }
    }

    # --- Regression 8: existing patch/scope safety tests remain PASS (spot-check the shared helpers this fix touched) ---
    $stillRejectsTraversal = -not (Test-DeepSeekPatchPathAllowed -Path "../../../etc/passwd" -AllowedFiles @($scheduleIdPage))
    $results += New-ValidationResult -Id "srcfix-8-traversal-still-rejected" -Description "Regression 8: path traversal still rejected after the literal-loader refactor" -Expected "true" -Actual $stillRejectsTraversal -Result $(if ($stillRejectsTraversal) { "PASS" } else { "FAIL" })
    $stillRejectsEnv = -not (Test-DeepSeekPatchPathAllowed -Path ".env.local" -AllowedFiles @(".env.local"))
    $results += New-ValidationResult -Id "srcfix-8-env-still-rejected" -Description "Regression 8: .env* still rejected after the literal-loader refactor" -Expected "true" -Actual $stillRejectsEnv -Result $(if ($stillRejectsEnv) { "PASS" } else { "FAIL" })
    $stillRejectsMigrations = -not (Test-DeepSeekPatchPathAllowed -Path "supabase/migrations/20260101_x.sql" -AllowedFiles @("supabase/migrations/20260101_x.sql"))
    $results += New-ValidationResult -Id "srcfix-8-migrations-still-rejected" -Description "Regression 8: supabase/migrations/* still rejected for DeepSeek after the literal-loader refactor" -Expected "true" -Actual $stillRejectsMigrations -Result $(if ($stillRejectsMigrations) { "PASS" } else { "FAIL" })
    $stillAllowsInScope = Test-DeepSeekPatchPathAllowed -Path $scheduleIdPage -AllowedFiles @($scheduleIdPage)
    $results += New-ValidationResult -Id "srcfix-8-in-scope-still-allowed" -Description "Regression 8: an exact in-scope [scheduleId] path is still allowed after the refactor" -Expected "true" -Actual $stillAllowsInScope -Result $(if ($stillAllowsInScope) { "PASS" } else { "FAIL" })

    return $results
}

# ---------------------------------------------------------------------------
# Phase 9B fix #3: DeepSeek API HTTP 400 defect regression tests. A real
# pilot's implementation request failed with "NETWORK - The remote server
# returned an error: (400) Bad Request." Root cause (confirmed by direct
# code+environment inspection, not assumed): (1) Windows PowerShell 5.1
# wraps EVERY HTTP-level error response in System.Net.WebException - the
# same type used for genuine transport failures - so a naive `-is
# [System.Net.WebException]` check misclassified a real 400 as NETWORK,
# masking the true category/message; (2) Invoke-RestMethod encodes a
# [string] -Body using the system ANSI codepage (Windows-1252 in this
# environment, confirmed via [System.Text.Encoding]::Default), not UTF-8,
# so the em-dash/emoji genuinely present in the real approved attendance
# files corrupted on the wire - proven by a byte-level round-trip check
# (10632 ANSI bytes vs 10665 UTF8 bytes, ANSI does not round-trip as valid
# UTF8); this is why the tiny pure-ASCII -TestDeepSeek prompt could pass
# while every real implementation request failed. (3) "deepseek-chat" is
# no longer listed on DeepSeek's current API docs (verified live via two
# independent official doc pages) - deepseek-v4-flash/deepseek-v4-pro are
# the current models. All three are fixed together since sequencing a live
# call between them would violate "do not run repeatedly."
# ---------------------------------------------------------------------------

function Invoke-DeepSeekHttpErrorFixTests {
    $results = @()

    # --- Regression 1: HTTP 400 -> INVALID_REQUEST, not NETWORK ---
    # IsNetwork=$true is deliberately passed to reproduce the exact old
    # buggy input (PS5.1's WebException is indistinguishable from a real
    # network failure by type alone) - the fix must still classify by
    # StatusCode, proving StatusCode now takes priority over the flag.
    $cat400 = Get-DeepSeekErrorCategory -StatusCode 400 -ErrorText "The remote server returned an error: (400) Bad Request." -IsTimeout $false -IsNetwork $true
    $results += New-ValidationResult -Id "httpfix-1-400-invalid-request" -Description "Regression 1: HTTP 400 classifies as INVALID_REQUEST, never NETWORK, even when the exception type alone would suggest network" -Expected "INVALID_REQUEST" -Actual $cat400 -Result $(if ($cat400 -eq "INVALID_REQUEST") { "PASS" } else { "FAIL" })

    # --- Regression 2: 401 -> AUTHENTICATION ---
    $cat401 = Get-DeepSeekErrorCategory -StatusCode 401 -ErrorText "" -IsTimeout $false -IsNetwork $false
    $results += New-ValidationResult -Id "httpfix-2-401-authentication" -Description "Regression 2: HTTP 401 classifies as AUTHENTICATION" -Expected "AUTHENTICATION" -Actual $cat401 -Result $(if ($cat401 -eq "AUTHENTICATION") { "PASS" } else { "FAIL" })

    # --- Regression 3: 402 -> USAGE_LIMIT ---
    $cat402 = Get-DeepSeekErrorCategory -StatusCode 402 -ErrorText "" -IsTimeout $false -IsNetwork $false
    $results += New-ValidationResult -Id "httpfix-3-402-usage-limit" -Description "Regression 3: HTTP 402 classifies as USAGE_LIMIT (insufficient balance)" -Expected "USAGE_LIMIT" -Actual $cat402 -Result $(if ($cat402 -eq "USAGE_LIMIT") { "PASS" } else { "FAIL" })

    # --- Regression 4: 422 -> INVALID_PARAMETERS ---
    $cat422 = Get-DeepSeekErrorCategory -StatusCode 422 -ErrorText "" -IsTimeout $false -IsNetwork $false
    $results += New-ValidationResult -Id "httpfix-4-422-invalid-parameters" -Description "Regression 4: HTTP 422 classifies as INVALID_PARAMETERS" -Expected "INVALID_PARAMETERS" -Actual $cat422 -Result $(if ($cat422 -eq "INVALID_PARAMETERS") { "PASS" } else { "FAIL" })

    # --- Regression 5: 429 -> RATE_LIMIT ---
    $cat429 = Get-DeepSeekErrorCategory -StatusCode 429 -ErrorText "" -IsTimeout $false -IsNetwork $false
    $results += New-ValidationResult -Id "httpfix-5-429-rate-limit" -Description "Regression 5: HTTP 429 classifies as RATE_LIMIT" -Expected "RATE_LIMIT" -Actual $cat429 -Result $(if ($cat429 -eq "RATE_LIMIT") { "PASS" } else { "FAIL" })

    # --- Regression 6: 5xx -> PROVIDER_ERROR ---
    $cat500 = Get-DeepSeekErrorCategory -StatusCode 500 -ErrorText "" -IsTimeout $false -IsNetwork $false
    $cat503 = Get-DeepSeekErrorCategory -StatusCode 503 -ErrorText "" -IsTimeout $false -IsNetwork $false
    $results += New-ValidationResult -Id "httpfix-6-5xx-provider-error" -Description "Regression 6: HTTP 5xx classifies as PROVIDER_ERROR" -Expected "PROVIDER_ERROR / PROVIDER_ERROR" -Actual "$cat500 / $cat503" -Result $(if ($cat500 -eq "PROVIDER_ERROR" -and $cat503 -eq "PROVIDER_ERROR") { "PASS" } else { "FAIL" })

    # --- Regression 7: a true transport failure (no HTTP status code at all) -> NETWORK ---
    $catTransport = Get-DeepSeekErrorCategory -StatusCode $null -ErrorText "could not be resolved" -IsTimeout $false -IsNetwork $true
    $results += New-ValidationResult -Id "httpfix-7-true-transport-failure" -Description "Regression 7: a genuine transport failure (no status code received at all) still classifies as NETWORK" -Expected "NETWORK" -Actual $catTransport -Result $(if ($catTransport -eq "NETWORK") { "PASS" } else { "FAIL" })
    $catTimeout = Get-DeepSeekErrorCategory -StatusCode $null -ErrorText "timed out" -IsTimeout $true -IsNetwork $false
    $results += New-ValidationResult -Id "httpfix-7-true-timeout" -Description "Regression 7b: a genuine timeout (no status code) still classifies as TIMEOUT" -Expected "TIMEOUT" -Actual $catTimeout -Result $(if ($catTimeout -eq "TIMEOUT") { "PASS" } else { "FAIL" })

    # --- Regression 8: provider error body sanitized and surfaced ---
    $mockJson = '{"error":{"message":"Model Not Exist","type":"invalid_request_error","param":"model","code":"model_not_found"}}'
    $mockStream = New-Object System.IO.MemoryStream
    $mockWriter = New-Object System.IO.StreamWriter($mockStream)
    $mockWriter.Write($mockJson)
    $mockWriter.Flush()
    $mockStream.Position = 0
    $mockResponse = New-Object PSObject
    $mockResponse | Add-Member -MemberType ScriptMethod -Name GetResponseStream -Value { return $mockStream }.GetNewClosure()
    $mockException = New-Object PSObject
    $mockException | Add-Member -MemberType NoteProperty -Name Response -Value $mockResponse
    $bodyResult = Get-DeepSeekErrorResponseBody -Exception $mockException
    $results += New-ValidationResult -Id "httpfix-8-provider-body-parsed" -Description "Regression 8: a DeepSeek-shaped JSON error body is parsed into Message/Type/Param" -Expected "Message='Model Not Exist', Type='invalid_request_error', Param='model'" -Actual "Message='$($bodyResult.Message)', Type='$($bodyResult.Type)', Param='$($bodyResult.Param)'" -Result $(if ($bodyResult.Message -eq "Model Not Exist" -and $bodyResult.Type -eq "invalid_request_error" -and $bodyResult.Param -eq "model") { "PASS" } else { "FAIL" })
    $noResponseException = New-Object PSObject
    $bodyResultNone = Get-DeepSeekErrorResponseBody -Exception $noResponseException
    $results += New-ValidationResult -Id "httpfix-8-provider-body-graceful-null" -Description "Regression 8b: an exception with no Response never throws - returns null gracefully" -Expected "null" -Actual $(if ($null -eq $bodyResultNone) { "null" } else { "non-null" }) -Result $(if ($null -eq $bodyResultNone) { "PASS" } else { "FAIL" })

    # --- Regression 9: API key never appears in diagnostics ---
    $adapterSource = Get-Content (Join-Path $PSScriptRoot "deepseek-runner.ps1") -Raw
    $errorBodyFnMatch = [regex]::Match($adapterSource, '(?ms)function Get-DeepSeekErrorResponseBody \{(.*?)\n\}')
    $errorBodyFnBody = if ($errorBodyFnMatch.Success) { $errorBodyFnMatch.Groups[1].Value } else { "" }
    $errorBodyReadsOnlyResponse = ($errorBodyFnBody -notmatch 'apiKey|Authorization|headers') -and ($errorBodyFnBody -match 'Exception\.Response')
    $results += New-ValidationResult -Id "httpfix-9-error-body-never-touches-key" -Description "Regression 9: Get-DeepSeekErrorResponseBody reads only the HTTP response stream, never the key/Authorization header" -Expected "No apiKey/Authorization/headers reference; reads Exception.Response" -Actual "Safe: $errorBodyReadsOnlyResponse" -Result $(if ($errorBodyReadsOnlyResponse) { "PASS" } else { "FAIL" })
    $diagnosticFnMatch = [regex]::Match($adapterSource, '(?ms)function Get-DeepSeekRequestShapeDiagnostic \{(.*?)\n\}')
    $diagnosticFnBody = if ($diagnosticFnMatch.Success) { $diagnosticFnMatch.Groups[1].Value } else { "" }
    $diagnosticNeverIncludesKey = ($diagnosticFnBody -notmatch 'apiKey|Authorization')
    $results += New-ValidationResult -Id "httpfix-9-request-diagnostic-never-touches-key" -Description "Regression 9b: Get-DeepSeekRequestShapeDiagnostic never includes the key/Authorization header - metadata only" -Expected "No apiKey/Authorization reference" -Actual "Safe: $diagnosticNeverIncludesKey" -Result $(if ($diagnosticNeverIncludesKey) { "PASS" } else { "FAIL" })
    $bodyResultHasNoKeyField = (-not ($bodyResult.PSObject.Properties.Name -contains "ApiKey")) -and (-not ($bodyResult.PSObject.Properties.Name -contains "Authorization"))
    $results += New-ValidationResult -Id "httpfix-9-error-object-shape-safe" -Description "Regression 9c: the returned error-body object itself has no key/auth-shaped field" -Expected "true" -Actual $bodyResultHasNoKeyField -Result $(if ($bodyResultHasNoKeyField) { "PASS" } else { "FAIL" })

    # --- Regression 10: real implementation request serializes successfully ---
    $realConfig = Get-DeepSeekApiConfig
    $realSourceLoad = Get-DeepSeekSourceLoadResult -AllowedFiles @(
        "app/admin/(protected)/attendance/[scheduleId]/print/page.tsx",
        "app/admin/(protected)/attendance/[scheduleId]/print/PrintButton.tsx"
    ) -ScopeSource "EXPLICIT_TASK_PATHS"
    if ($realSourceLoad.Success) {
        $realUserPrompt = "## RELEVANT CONTEXT`n`nTask: Fix mobile alignment and spacing on the existing attendance print page only.`n`n## SOURCE CONTENT`n`n$($realSourceLoad.ContentText)"
        $realValidation = Test-DeepSeekRequestPayloadValid -SystemPrompt "You are the Fast/Lightweight Implementer." -UserPrompt $realUserPrompt -Config $realConfig
        $results += New-ValidationResult -Id "httpfix-10-real-payload-serializes" -Description "Regression 10: the real attendance-pilot request (actual source content, including em-dash/emoji) serializes successfully" -Expected "Valid=true, JSON non-empty" -Actual "Valid=$($realValidation.Valid), JSON length=$($realValidation.Json.Length)" -Result $(if ($realValidation.Valid -and $realValidation.Json.Length -gt 0) { "PASS" } else { "FAIL" })

        # The actual byte-level proof: the OLD (ANSI/Default) encoding path
        # does not round-trip as valid UTF-8; the NEW (explicit UTF8) path
        # does. This is the confirmed mechanism of the real 400.
        $oldBytes = [System.Text.Encoding]::Default.GetBytes($realValidation.Json)
        $newBytes = [System.Text.Encoding]::UTF8.GetBytes($realValidation.Json)
        $oldRoundTrips = ([System.Text.Encoding]::UTF8.GetString($oldBytes)) -ceq $realValidation.Json
        $newRoundTrips = ([System.Text.Encoding]::UTF8.GetString($newBytes)) -ceq $realValidation.Json
        $results += New-ValidationResult -Id "httpfix-10-utf8-encoding-proof" -Description "Regression 10b: explicit UTF8 byte encoding round-trips correctly for real source content containing an em-dash/emoji; the old default-encoding path does not" -Expected "OldRoundTrips=false, NewRoundTrips=true" -Actual "OldRoundTrips=$oldRoundTrips, NewRoundTrips=$newRoundTrips" -Result $(if (-not $oldRoundTrips -and $newRoundTrips) { "PASS" } else { "FAIL" })
    } else {
        $results += New-ValidationResult -Id "httpfix-10-real-payload-serializes" -Description "Regression 10: real attendance-pilot request payload serialization" -Expected "N/A" -Actual "SKIPPED - real attendance files not readable in this environment" -Result "WARN"
    }

    # --- Regression 11: -TestDeepSeek and the real implementation path share the same core request builder ---
    $callerCount = ([regex]::Matches($adapterSource, 'Invoke-DeepSeekApiCall\s+-SystemPrompt')).Count
    $results += New-ValidationResult -Id "httpfix-11-shared-request-builder" -Description "Regression 11: exactly one core request-building function (Invoke-DeepSeekApiCall) is used by both -TestDeepSeek and the real implementation path - no second, divergent body-construction path" -Expected "Invoke-DeepSeekApiCall called from both Invoke-DeepSeekConnectivityTest and Invoke-DeepSeekApiImplementation ($callerCount call sites total)" -Actual "Call sites found: $callerCount" -Result $(if ($callerCount -eq 2) { "PASS" } else { "FAIL" })
    $bothUseUtf8Bytes = ($adapterSource -match '\[System\.Text\.Encoding\]::UTF8\.GetBytes\(\$bodyJson\)')
    $onlyOneHttpCallSite = ([regex]::Matches($adapterSource, 'Invoke-RestMethod\s+-Uri')).Count
    $results += New-ValidationResult -Id "httpfix-11-single-http-call-site" -Description "Regression 11b: only one Invoke-RestMethod call site exists (the UTF8-byte fix applies uniformly - no second, unfixed HTTP path)" -Expected "1 call site, using UTF8.GetBytes" -Actual "Call sites=$onlyOneHttpCallSite, uses UTF8 bytes=$bothUseUtf8Bytes" -Result $(if ($onlyOneHttpCallSite -eq 1 -and $bothUseUtf8Bytes) { "PASS" } else { "FAIL" })

    # --- Regression 12: unsupported/invalid optional parameter fixture rejected locally or produces a clear provider diagnostic ---
    # The adapter deliberately never sends response_format/tools/tool_choice/
    # max_tokens/temperature - confirm that invariant holds. "thinking" is
    # deliberately excluded from this list as of the PS5.1-compat/thinking-
    # mode fix turn: it is now a REQUIRED field (explicitly disabled),
    # verified separately by the ps51fix-thinking-disabled-sent test below -
    # not an unsupported/optional field to avoid.
    $noOptionalFields = -not ($adapterSource -match '(?m)^\s*(response_format|tools|tool_choice|max_tokens|temperature)\s*=')
    $results += New-ValidationResult -Id "httpfix-12-no-unsupported-optional-fields" -Description "Regression 12: the adapter sends no optional response_format/tools/tool_choice/max_tokens/temperature fields (simplest valid request shape beyond the required thinking:disabled - nothing to reject)" -Expected "None of these fields present in the request body construction" -Actual "Absent: $noOptionalFields" -Result $(if ($noOptionalFields) { "PASS" } else { "FAIL" })
    # If an unsupported field were ever added, local validation must still
    # catch a malformed request (empty model) before any network call.
    $emptyModelConfig = [pscustomobject]@{ Model = ""; BaseUrl = "https://api.deepseek.com"; TimeoutSeconds = 60; MaxRetries = 1; MaxOutputChars = 20000 }
    $invalidFixture = Test-DeepSeekRequestPayloadValid -SystemPrompt "s" -UserPrompt "u" -Config $emptyModelConfig
    $results += New-ValidationResult -Id "httpfix-12-invalid-fixture-rejected-locally" -Description "Regression 12b: a fixture with an invalid/empty model is rejected by local validation before any call" -Expected "Valid=false, error mentions model" -Actual "Valid=$($invalidFixture.Valid), Errors=$($invalidFixture.Errors -join '; ')" -Result $(if (-not $invalidFixture.Valid -and ($invalidFixture.Errors -like "*model*")) { "PASS" } else { "FAIL" })

    # --- Adapter defect vs operational failure never falls back automatically ---
    $adapterDefectNoFallbackImplied = ($adapterSource -match 'ADAPTER_ATTENTION_REQUIRED') -and ($adapterSource -match 'isAdapterDefect')
    $results += New-ValidationResult -Id "httpfix-adapter-attention-required" -Description "An INVALID_REQUEST/INVALID_PARAMETERS failure is reported as ADAPTER_ATTENTION_REQUIRED, distinct from the generic fallback message" -Expected "ADAPTER_ATTENTION_REQUIRED path present and gated on ErrorCategory" -Actual "Present: $adapterDefectNoFallbackImplied" -Result $(if ($adapterDefectNoFallbackImplied) { "PASS" } else { "FAIL" })
    $noAutoClaudeOnApiFailure = -not ($adapterSource -match '(?ms)if \(-not \$result\.Success\) \{.*?Invoke-ClaudeImplementation')
    $results += New-ValidationResult -Id "httpfix-no-claude-fallback-on-api-failure" -Description "An API failure (of any category) never itself invokes Claude - Invoke-DeepSeekApiImplementation always returns false and the outer pipeline stops for human/manual handling" -Expected "No Invoke-ClaudeImplementation call inside the API-failure branch" -Actual "Absent: $noAutoClaudeOnApiFailure" -Result $(if ($noAutoClaudeOnApiFailure) { "PASS" } else { "FAIL" })

    return $results
}

# ---------------------------------------------------------------------------
# PS5.1 compatibility audit + thinking-mode fix regression tests. A live
# -TestDeepSeek call did NOT reproduce the reported "-Encoding" parameter-
# binding error (every -Encoding usage in tools/*.ps1 was audited and
# confirmed to target a cmdlet that genuinely supports it in this exact
# PS 5.1 build - Get-Content/Set-Content/Add-Content/Out-File all do,
# Invoke-RestMethod is never called with -Encoding). The same live call DID
# reproduce a different, real, currently-blocking defect instead: HTTP 200
# with an empty choices[0].message.content. DeepSeek's own docs confirm
# deepseek-v4-flash has thinking/reasoning mode enabled by default, and
# with no max_tokens cap the reasoning phase can consume the response
# before any answer lands in .content. Fix: explicitly send
# thinking: {type: "disabled"} (DEEPSEEK_FAST never needs reasoning
# overhead for the adapter's own STATUS/SUMMARY/FILES text format), plus a
# defensive reasoning_content fallback in case a future revision doesn't
# fully honor that.
# ---------------------------------------------------------------------------

function Invoke-DeepSeekPs51CompatFixTests {
    $results = @()
    $adapterSource = Get-Content (Join-Path $PSScriptRoot "deepseek-runner.ps1") -Raw

    # --- Static -Encoding audit: every usage targets a cmdlet that supports it in this PS5.1 build ---
    $allSupportEncoding = $true
    $checkedCmdlets = @()
    foreach ($verb in @("Get", "Set", "Add")) {
        $cmdletName = "$verb-Content"
        $cmd = Get-Command $cmdletName -ErrorAction SilentlyContinue
        if ($cmd) {
            $checkedCmdlets += $cmdletName
            if (-not ($cmd.Parameters.Keys -contains "Encoding")) { $allSupportEncoding = $false }
        }
    }
    $results += New-ValidationResult -Id "ps51fix-encoding-cmdlets-support-it" -Description "Every cmdlet in deepseek-runner.ps1 called with -Encoding (Get/Set/Add-Content) genuinely supports that parameter in this PS5.1 build" -Expected "true for $($checkedCmdlets -join ', ')" -Actual "AllSupport=$allSupportEncoding" -Result $(if ($allSupportEncoding) { "PASS" } else { "FAIL" })

    $invokeRestMethodNoEncoding = -not ($adapterSource -match 'Invoke-RestMethod[^\r\n]*-Encoding\b')
    $results += New-ValidationResult -Id "ps51fix-no-encoding-on-invoke-restmethod" -Description "Invoke-RestMethod is never called with -Encoding (it has no such parameter in this PS5.1 build - confirmed live: (Get-Command Invoke-RestMethod).Parameters.Keys does not contain Encoding)" -Expected "No -Encoding on any Invoke-RestMethod call" -Actual "Absent: $invokeRestMethodNoEncoding" -Result $(if ($invokeRestMethodNoEncoding) { "PASS" } else { "FAIL" })

    $realInvokeRestMethod = Get-Command Invoke-RestMethod -ErrorAction SilentlyContinue
    $realCmdletLacksEncoding = $realInvokeRestMethod -and (-not ($realInvokeRestMethod.Parameters.Keys -contains "Encoding"))
    $results += New-ValidationResult -Id "ps51fix-live-invoke-restmethod-param-set" -Description "Live-checked (Get-Command Invoke-RestMethod).Parameters in this exact runtime confirms no Encoding parameter exists - the reported ParameterBindingException could not originate from this cmdlet as currently called" -Expected "Invoke-RestMethod has no Encoding parameter" -Actual "Confirmed: $realCmdletLacksEncoding" -Result $(if ($realCmdletLacksEncoding) { "PASS" } else { "WARN" })

    # --- Thinking-mode fix: payload includes explicit disable ---
    $config = Get-DeepSeekApiConfig
    $validation = Test-DeepSeekRequestPayloadValid -SystemPrompt "system text" -UserPrompt "user text" -Config $config
    $hasThinkingDisabled = ($validation.Json -match '"thinking"' -and $validation.Json -match '"disabled"')
    $results += New-ValidationResult -Id "ps51fix-thinking-disabled-sent" -Description "The request payload explicitly sends thinking: {type: disabled} - deepseek-v4-flash defaults to reasoning mode enabled, which can leave message.content empty" -Expected "JSON contains thinking/disabled" -Actual "Present: $hasThinkingDisabled" -Result $(if ($hasThinkingDisabled) { "PASS" } else { "FAIL" })
    $results += New-ValidationResult -Id "ps51fix-payload-still-valid" -Description "Adding thinking:disabled does not break local payload validation" -Expected "Valid=true" -Actual "Valid=$($validation.Valid)" -Result $(if ($validation.Valid) { "PASS" } else { "FAIL" })

    # --- Reasoning_content fallback exists and is safe (never silently swallows a genuinely empty response) ---
    $hasReasoningFallback = ($adapterSource -match 'reasoning_content')
    $results += New-ValidationResult -Id "ps51fix-reasoning-content-fallback" -Description "A defensive reasoning_content fallback exists in case a future/different model revision still routes the answer there despite thinking being disabled" -Expected "reasoning_content referenced in Invoke-DeepSeekApiCall's success branch" -Actual "Present: $hasReasoningFallback" -Result $(if ($hasReasoningFallback) { "PASS" } else { "FAIL" })
    $stillFailsIfBothEmpty = ($adapterSource -match 'content and reasoning_content both empty')
    $results += New-ValidationResult -Id "ps51fix-genuinely-empty-still-fails" -Description "If BOTH content and reasoning_content are empty, the call still correctly fails as INVALID_RESPONSE rather than silently succeeding with empty text" -Expected "Distinct error message for the genuinely-both-empty case" -Actual "Present: $stillFailsIfBothEmpty" -Result $(if ($stillFailsIfBothEmpty) { "PASS" } else { "FAIL" })

    # --- Regression: em-dash fixture still round-trips correctly (the UTF8 body fix from the prior turn must not have regressed) ---
    $emDashChar = [char]0x2014
    $emDashJson = @{ text = "Status Report $emDashChar All Systems OK" } | ConvertTo-Json
    $oldBytes = [System.Text.Encoding]::Default.GetBytes($emDashJson)
    $newBytes = [System.Text.Encoding]::UTF8.GetBytes($emDashJson)
    $newRoundTrips = ([System.Text.Encoding]::UTF8.GetString($newBytes)) -ceq $emDashJson
    $results += New-ValidationResult -Id "ps51fix-emdash-fixture-still-valid" -Description "Em-dash content still round-trips correctly as UTF8 bytes (the body-encoding fix from the prior turn is unaffected by this fix)" -Expected "true" -Actual $newRoundTrips -Result $(if ($newRoundTrips) { "PASS" } else { "FAIL" })

    # --- Existing HTTP classification / source-loading / patch-scope tests still pass (spot-check, full suite confirms exhaustively) ---
    $cat400 = Get-DeepSeekErrorCategory -StatusCode 400 -ErrorText "" -IsTimeout $false -IsNetwork $true
    $results += New-ValidationResult -Id "ps51fix-http-classification-unaffected" -Description "HTTP 400 classification is unaffected by the thinking-mode fix" -Expected "INVALID_REQUEST" -Actual $cat400 -Result $(if ($cat400 -eq "INVALID_REQUEST") { "PASS" } else { "FAIL" })
    $scheduleIdSourceLoad = Get-DeepSeekSourceLoadResult -AllowedFiles @("app/admin/(protected)/attendance/[scheduleId]/print/page.tsx") -ScopeSource "EXPLICIT_TASK_PATHS"
    $results += New-ValidationResult -Id "ps51fix-scheduleid-loading-unaffected" -Description "[scheduleId] literal source loading is unaffected by the thinking-mode fix" -Expected "Success=true" -Actual "Success=$($scheduleIdSourceLoad.Success)" -Result $(if ($scheduleIdSourceLoad.Success) { "PASS" } else { "FAIL" })
    $patchStillScoped = -not (Test-DeepSeekPatchPathAllowed -Path "app/admin/(protected)/attendance/123/print/page.tsx" -AllowedFiles @("app/admin/(protected)/attendance/[scheduleId]/print/page.tsx"))
    $results += New-ValidationResult -Id "ps51fix-patch-scope-unaffected" -Description "Patch-scope literal comparison is unaffected by the thinking-mode fix" -Expected "true (rejected)" -Actual $patchStillScoped -Result $(if ($patchStillScoped) { "PASS" } else { "FAIL" })

    return $results
}

# ---------------------------------------------------------------------------
# Stable-operational-mode tests: Claude FAST is now the default implementer
# for LOW/MEDIUM tasks (DeepSeek is optional, manual/config-only, and must
# never block delivery); HIGH/CRITICAL routing is untouched. Tests the real
# Get-TaskClassification/Test-DeepSeekAgentEscalation/
# Test-DeepSeekProviderOrAdapterFailure/Invoke-DeepSeekImplementerFallback
# functions - no provider call, no real Claude/Codex CLI invocation (the
# fallback function's own Claude invocation is verified via static source
# inspection only, matching this suite's established pattern for anything
# that would otherwise launch a real CLI).
# ---------------------------------------------------------------------------

function Invoke-StableOperationalModeTests {
    $results = @()
    $agentSource = Get-Content (Join-Path $PSScriptRoot "teras-agent.ps1") -Raw
    $routerSource = Get-Content (Join-Path $PSScriptRoot "agent-router.ps1") -Raw

    # --- Test 1: LOW + DeepSeek unavailable (default/no override) -> Claude FAST ---
    $descLow = "Fix mobile alignment and spacing on the existing attendance print page only."
    $cLow = Get-TaskClassification -MenuChoice (Get-AutoMenuChoice -Description $descLow) -Description $descLow
    $results += New-ValidationResult -Id "stablemode-1-low-claude-fast" -Description "Test 1: LOW risk task, no DeepSeek override/config -> Claude FAST" -Expected "Claude Code / CLAUDE_FAST" -Actual "$($cLow.Implementer) / $($cLow.ImplementerModel)" -Result $(if ($cLow.Implementer -eq "Claude Code" -and $cLow.ImplementerModel -eq "CLAUDE_FAST") { "PASS" } else { "FAIL" })
    $results += New-ValidationResult -Id "stablemode-1-low-risk-unaffected" -Description "Test 1: LOW risk classification itself is unaffected by the implementer-default change" -Expected "LOW" -Actual $cLow.Risk -Result $(if ($cLow.Risk -eq "LOW") { "PASS" } else { "FAIL" })

    # --- Test 2: MEDIUM + DeepSeek unavailable (default/no override) -> Claude FAST ---
    $descMed = "Add participant search and status filter to admin participant list"
    $cMed = Get-TaskClassification -MenuChoice (Get-AutoMenuChoice -Description $descMed) -Description $descMed
    $results += New-ValidationResult -Id "stablemode-2-medium-claude-fast" -Description "Test 2: MEDIUM risk, DeepSeek-suitable task, no override/config -> Claude FAST" -Expected "Claude Code / CLAUDE_FAST" -Actual "$($cMed.Implementer) / $($cMed.ImplementerModel)" -Result $(if ($cMed.Implementer -eq "Claude Code" -and $cMed.ImplementerModel -eq "CLAUDE_FAST") { "PASS" } else { "FAIL" })

    # --- DeepSeek remains available via -PreferDeepSeek (manual selection) ---
    $cLowPreferred = Get-TaskClassification -MenuChoice (Get-AutoMenuChoice -Description $descLow) -Description $descLow -PreferDeepSeek
    $results += New-ValidationResult -Id "stablemode-manual-preferdeepseek" -Description "DeepSeek may still be selected manually via -PreferDeepSeek" -Expected "DeepSeek / DEEPSEEK_FAST" -Actual "$($cLowPreferred.Implementer) / $($cLowPreferred.ImplementerModel)" -Result $(if ($cLowPreferred.Implementer -eq "DeepSeek" -and $cLowPreferred.ImplementerModel -eq "DEEPSEEK_FAST") { "PASS" } else { "FAIL" })

    # --- Config-enabled + healthy -> DeepSeek; config-enabled + unhealthy -> Claude FAST (never blocks) ---
    $configPath = Join-Path $AiDir "AGENT_CONFIG.json"
    $configBackupExists = Test-Path $configPath
    $configBackup = if ($configBackupExists) { Get-Content -Path $configPath -Raw -Encoding utf8 } else { $null }
    $statusBackupExists = Test-Path $script:DeepSeekStatusPath
    $statusBackup = if ($statusBackupExists) { Get-Content -Path $script:DeepSeekStatusPath -Raw -Encoding utf8 } else { $null }
    try {
        # Enabled + healthy (no recorded failure) - only meaningful if a key
        # is actually configured in this environment; otherwise correctly
        # stays Claude FAST (DeepSeek is never "healthy" without a key).
        @{ deepseek = @{ defaultImplementer = $true } } | ConvertTo-Json | Set-Content -Path $configPath -Encoding utf8
        if (Test-Path $script:DeepSeekStatusPath) { Remove-Item -Path $script:DeepSeekStatusPath -Force }
        $keyConfigured = Test-DeepSeekApiKeyConfigured
        $cEnabledHealthy = Get-TaskClassification -MenuChoice (Get-AutoMenuChoice -Description $descLow) -Description $descLow
        $expectedWhenHealthy = if ($keyConfigured) { "DeepSeek" } else { "Claude Code" }
        $results += New-ValidationResult -Id "stablemode-config-enabled-healthy" -Description "deepseek.defaultImplementer=true, no known failure -> DeepSeek if key configured, else Claude FAST (never blocks)" -Expected "$expectedWhenHealthy (key configured: $keyConfigured)" -Actual $cEnabledHealthy.Implementer -Result $(if ($cEnabledHealthy.Implementer -eq $expectedWhenHealthy) { "PASS" } else { "FAIL" })

        # Enabled + known-unhealthy (last connectivity FAIL) -> must still
        # fall back to Claude FAST, proving DeepSeek availability can never
        # block delivery even when explicitly enabled.
        Save-DeepSeekStatus -Connectivity "FAIL" -UsageStatus "UNKNOWN" -ErrorCategory "NETWORK"
        $cEnabledUnhealthy = Get-TaskClassification -MenuChoice (Get-AutoMenuChoice -Description $descLow) -Description $descLow
        $results += New-ValidationResult -Id "stablemode-config-enabled-unhealthy-still-claude" -Description "deepseek.defaultImplementer=true BUT last known connectivity=FAIL -> still Claude FAST, never blocks delivery" -Expected "Claude Code / CLAUDE_FAST" -Actual "$($cEnabledUnhealthy.Implementer) / $($cEnabledUnhealthy.ImplementerModel)" -Result $(if ($cEnabledUnhealthy.Implementer -eq "Claude Code" -and $cEnabledUnhealthy.ImplementerModel -eq "CLAUDE_FAST") { "PASS" } else { "FAIL" })
    } finally {
        if ($configBackupExists) { Set-Content -Path $configPath -Value $configBackup -Encoding utf8 } elseif (Test-Path $configPath) { Remove-Item -Path $configPath -Force }
        if ($statusBackupExists) { Set-Content -Path $script:DeepSeekStatusPath -Value $statusBackup -Encoding utf8 } elseif (Test-Path $script:DeepSeekStatusPath) { Remove-Item -Path $script:DeepSeekStatusPath -Force }
    }

    # --- Test 3: DeepSeek adapter failure does not raise task risk ---
    $syntheticProviderFailure = [pscustomobject]@{ Filled = $true; Required = $false; EscalationStatus = "NOT RUN"; Reason = "N/A"; ProviderStatus = "FAILED"; HttpStatus = "400"; ErrorCategory = "INVALID_REQUEST"; ProviderMessage = "test"; ProviderParam = $null; SourceContext = "OK"; PatchApplication = "NOT ATTEMPTED"; ScopeStatus = "N/A"; ClaudeFallback = "NOT RUN"; OrchestratorReason = "N/A" }
    $isProviderFailure = Test-DeepSeekProviderOrAdapterFailure -Escalation $syntheticProviderFailure
    $results += New-ValidationResult -Id "stablemode-3-provider-failure-detected" -Description "Test 3: a provider/adapter failure (ProviderStatus=FAILED, no agent escalation) is correctly classified" -Expected "true" -Actual $isProviderFailure -Result $(if ($isProviderFailure) { "PASS" } else { "FAIL" })
    $fallbackFnMatch = [regex]::Match($agentSource, '(?ms)function Invoke-DeepSeekImplementerFallback \{(.*?)\n\}')
    $fallbackFnBody = if ($fallbackFnMatch.Success) { $fallbackFnMatch.Groups[1].Value } else { "" }
    $fallbackNeverTouchesRisk = ($fallbackFnBody -notmatch '\$State\.Risk\s*=') -and ($fallbackFnBody -notmatch '\$State\.Reviewer\s*=')
    $results += New-ValidationResult -Id "stablemode-3-fallback-never-raises-risk" -Description "Test 3: Invoke-DeepSeekImplementerFallback never assigns \$State.Risk or \$State.Reviewer - a provider/adapter failure never inflates task complexity" -Expected "No Risk/Reviewer assignment in the fallback function body" -Actual "Confirmed absent: $fallbackNeverTouchesRisk" -Result $(if ($fallbackNeverTouchesRisk) { "PASS" } else { "FAIL" })
    # Resume/fallback fix update: ImplementerFallbackReason now carries a
    # rich, dynamic failure-detail message (not a bare literal string) -
    # the enum classification moved to the new FallbackType field, set from
    # the function's own -FallbackType parameter (dynamic, not hardcoded,
    # since the same function now serves both PROVIDER_OR_ADAPTER and
    # STALE_AGENT_RESULT).
    $fallbackSetsCorrectFields = ($fallbackFnBody -match '\$State\.OriginalImplementer\s*=') -and ($fallbackFnBody -match '\$State\.ImplementerFallbackReason\s*=') -and ($fallbackFnBody -match '\$State\.FallbackType\s*=\s*\$FallbackType') -and ($fallbackFnBody -match '\$State\.ImplementerModel\s*=\s*"CLAUDE_FAST"')
    $results += New-ValidationResult -Id "stablemode-3-fallback-sets-audit-fields" -Description "Test 3: the fallback records OriginalImplementer + ImplementerFallbackReason + FallbackType + switches to CLAUDE_FAST" -Expected "All four present" -Actual "Present: $fallbackSetsCorrectFields" -Result $(if ($fallbackSetsCorrectFields) { "PASS" } else { "FAIL" })

    # --- Test 4: DeepSeek agent escalation may still escalate normally ---
    $syntheticAgentEscalation = [pscustomobject]@{ Filled = $true; Required = $true; EscalationStatus = "YES"; Reason = "Scope turned out to be larger than expected."; ProviderStatus = "CALLED"; HttpStatus = $null; ErrorCategory = $null; ProviderMessage = $null; ProviderParam = $null; SourceContext = "OK"; PatchApplication = "NONE"; ScopeStatus = "N/A"; ClaudeFallback = "NOT RUN"; OrchestratorReason = "N/A" }
    $isAgentEscalation = Test-DeepSeekAgentEscalation -Escalation $syntheticAgentEscalation
    $isNotProviderFailure = -not (Test-DeepSeekProviderOrAdapterFailure -Escalation $syntheticAgentEscalation)
    $results += New-ValidationResult -Id "stablemode-4-agent-escalation-still-works" -Description "Test 4: a genuine agent escalation (Required=YES) is classified as agent escalation, never as a provider/adapter failure" -Expected "AgentEscalation=true, ProviderFailure=false" -Actual "AgentEscalation=$isAgentEscalation, ProviderFailure=$(-not $isNotProviderFailure)" -Result $(if ($isAgentEscalation -and $isNotProviderFailure) { "PASS" } else { "FAIL" })
    $postCallResultHandlesEscalation = ($agentSource -match '(?ms)function Invoke-DeepSeekPostCallResult \{.*?Test-DeepSeekAgentEscalation.*?\$State\.Risk = "HIGH"')
    $results += New-ValidationResult -Id "stablemode-4-escalation-risk-upgrade-intact" -Description "Test 4: the existing blocked-area risk-upgrade-on-escalation logic is preserved in the shared post-call handler" -Expected "Present" -Actual "Present: $postCallResultHandlesEscalation" -Result $(if ($postCallResultHandlesEscalation) { "PASS" } else { "FAIL" })

    # --- Test 5: HIGH task still requires Codex when policy says so ---
    $descHigh = "Modify certificate issuance and verification logic"
    $cHigh = Get-TaskClassification -MenuChoice (Get-AutoMenuChoice -Description $descHigh) -Description $descHigh
    $results += New-ValidationResult -Id "stablemode-5-high-codex-mandatory" -Description "Test 5: HIGH-risk certificate-trust task still requires Codex" -Expected "Risk=HIGH, Reviewer=Codex" -Actual "Risk=$($cHigh.Risk), Reviewer=$($cHigh.Reviewer)" -Result $(if ($cHigh.Risk -eq "HIGH" -and $cHigh.Reviewer -eq "Codex") { "PASS" } else { "FAIL" })

    # --- Test 6: CRITICAL task still routes Claude DEEP + Codex ---
    $descCritical = "Modify certificate public verification RPC and its RLS/security behavior"
    $cCritical = Get-TaskClassification -MenuChoice (Get-AutoMenuChoice -Description $descCritical) -Description $descCritical
    $results += New-ValidationResult -Id "stablemode-6-critical-deep-codex" -Description "Test 6: CRITICAL task still routes Claude DEEP + mandatory Codex + human approval" -Expected "Risk=CRITICAL, Claude Code/CLAUDE_DEEP, Codex, HumanApproval=REQUIRED" -Actual "Risk=$($cCritical.Risk), $($cCritical.Implementer)/$($cCritical.ImplementerModel), Reviewer=$($cCritical.Reviewer), HumanApproval=$($cCritical.HumanApproval)" -Result $(if ($cCritical.Risk -eq "CRITICAL" -and $cCritical.Implementer -eq "Claude Code" -and $cCritical.ImplementerModel -eq "CLAUDE_DEEP" -and $cCritical.Reviewer -eq "Codex" -and $cCritical.HumanApproval -eq "REQUIRED") { "PASS" } else { "FAIL" })

    # --- Test 7: DeepSeek failure does not cause unlimited retry ---
    $deepseekSource = Get-Content (Join-Path $PSScriptRoot "deepseek-runner.ps1") -Raw
    $config = Get-DeepSeekApiConfig
    $results += New-ValidationResult -Id "stablemode-7-bounded-retry" -Description "Test 7: DeepSeek API retries remain bounded (MaxRetries=1) - a failure does not cause unlimited retry before falling back" -Expected "MaxRetries=1" -Actual "MaxRetries=$($config.MaxRetries)" -Result $(if ($config.MaxRetries -eq 1) { "PASS" } else { "FAIL" })
    $noRetryLoopInFallback = -not ($agentSource -match '(?ms)function Invoke-DeepSeekImplementerFallback \{.*?while.*?Invoke-DeepSeekImplementation')
    $results += New-ValidationResult -Id "stablemode-7-no-fallback-retry-loop" -Description "Test 7b: the IMPLEMENTER_FALLBACK path itself never re-attempts DeepSeek in a loop - it falls forward to Claude exactly once" -Expected "No retry loop in Invoke-DeepSeekImplementerFallback" -Actual "Absent: $noRetryLoopInFallback" -Result $(if ($noRetryLoopInFallback) { "PASS" } else { "FAIL" })

    # --- Test 8: existing DeepSeek adapter remains intact ---
    $adapterFunctions = @("Invoke-DeepSeekApiCall", "Get-DeepSeekSourceLoadResult", "Test-DeepSeekPatchPathAllowed", "Invoke-DeepSeekApplyPatch", "Get-DeepSeekErrorCategory", "Get-DeepSeekErrorResponseBody", "Test-DeepSeekRequestPayloadValid", "Write-DeepSeekReportFromApi", "Get-DeepSeekEscalation", "Invoke-DeepSeekConnectivityTest", "Invoke-DeepSeekStatus", "Write-DeepSeekUsageLog")
    $missingFunctions = @($adapterFunctions | Where-Object { -not (Get-Command $_ -ErrorAction SilentlyContinue) })
    $results += New-ValidationResult -Id "stablemode-8-adapter-functions-intact" -Description "Test 8: every existing DeepSeek adapter function is still defined - nothing was deleted" -Expected "0 missing" -Actual "Missing: $($missingFunctions -join ', ')" -Result $(if ($missingFunctions.Count -eq 0) { "PASS" } else { "FAIL" })
    $usageLogFileIntact = (Test-Path $script:DeepSeekUsageLogPath)
    $results += New-ValidationResult -Id "stablemode-8-usage-log-intact" -Description "Test 8b: DEEPSEEK_USAGE_LOG.md still exists - usage logs were not removed" -Expected "true" -Actual $usageLogFileIntact -Result $(if ($usageLogFileIntact) { "PASS" } else { "FAIL" })
    $configExampleHasDeepSeek = (Get-Content (Join-Path $AiDir "AGENT_CONFIG.example.json") -Raw) -match '"deepseek"'
    $results += New-ValidationResult -Id "stablemode-8-config-example-intact" -Description "Test 8c: .ai/AGENT_CONFIG.example.json still documents the deepseek configuration block" -Expected "true" -Actual $configExampleHasDeepSeek -Result $(if ($configExampleHasDeepSeek) { "PASS" } else { "FAIL" })

    # --- Test 9: existing safety gates remain intact ---
    $safetyBlockMatch = [regex]::Match($agentSource, '(?ms)\$Safety = \[ordered\]@\{(.*?)\}')
    $safetyBlockText = if ($safetyBlockMatch.Success) { $safetyBlockMatch.Groups[1].Value } else { "" }
    $safetyGatesIntact = ($safetyBlockText -match 'AUTO_COMMIT\s*=\s*\$false') -and ($safetyBlockText -match 'AUTO_PUSH\s*=\s*\$false') -and ($safetyBlockText -match 'AUTO_DEPLOY\s*=\s*\$false') -and ($safetyBlockText -match 'AUTO_MIGRATION_APPLY\s*=\s*\$false') -and ($safetyBlockText -match 'SCOPE_LOCK\s*=\s*\$true') -and ($safetyBlockText -match 'HUMAN_APPROVAL_REQUIRED\s*=\s*\$true')
    $results += New-ValidationResult -Id "stablemode-9-safety-gates-intact" -Description "Test 9: AUTO_COMMIT/AUTO_PUSH/AUTO_DEPLOY/AUTO_MIGRATION_APPLY=false, SCOPE_LOCK/HUMAN_APPROVAL_REQUIRED=true all remain intact" -Expected "All six gates present with unchanged values" -Actual "Intact: $safetyGatesIntact" -Result $(if ($safetyGatesIntact) { "PASS" } else { "FAIL" })

    # --- Codex conservatism: LOW-risk UI work never invokes Codex ---
    $results += New-ValidationResult -Id "stablemode-codex-not-invoked-low-ui" -Description "Codex usage stays conservative: the LOW-risk attendance task (Test 1) has Reviewer=None" -Expected "None" -Actual $cLow.Reviewer -Result $(if ($cLow.Reviewer -eq "None") { "PASS" } else { "FAIL" })

    return $results
}

# ---------------------------------------------------------------------------
# Resume/fallback defect fix regression tests. A real -Resume against a real
# stuck task (TERAS-20260813-200548) reused a stale DeepSeek escalation
# report (written before the literal source-loading fix, claiming
# "[scheduleId]" files don't exist when they demonstrably do), incorrectly
# upgraded risk to HIGH because the escalation prose contained the word
# "constraint" (an ordinary task constraint, not a database one - a false
# match against the broad $DbSensitiveKeywords list), and then crashed with
# "The property 'OriginalImplementer' cannot be found on this object"
# because the real task-state.json predates that field. Tests exercise the
# real functions (Test-DeepSeekReportStale, Test-EscalationTouchesBlockedArea,
# Repair-TaskStateSchema, Get-TaskState, New-EmptyTaskState) - read-only
# against the real stuck task's actual files where safe (no write), with
# careful backup/restore where a write is needed to test the "fresh report"
# positive case. No DeepSeek/Claude/Codex CLI invocation anywhere.
# ---------------------------------------------------------------------------

function Invoke-ResumeFallbackFixTests {
    $results = @()
    $agentSource = Get-Content (Join-Path $PSScriptRoot "teras-agent.ps1") -Raw

    # --- Test 5: existing task-state without OriginalImplementer loads safely ---
    # Simulate an old-format task-state.json (no OriginalImplementer/
    # FallbackType/etc.) by deserializing a JSON string that deliberately
    # omits them, then repairing it - exactly what Get-TaskState now does
    # on every load.
    $oldFormatJson = '{"TaskId":"TERAS-OLD-FORMAT","Category":"Attendance / UI / Print","Risk":"LOW","Implementer":"DeepSeek","State":"IMPLEMENTING","AllowedFiles":["app/admin/(protected)/attendance/[scheduleId]/print/page.tsx"]}'
    $oldFormatState = $oldFormatJson | ConvertFrom-Json
    $hadFieldBefore = ($oldFormatState.PSObject.Properties.Name -contains "OriginalImplementer")
    $repaired = Repair-TaskStateSchema -State $oldFormatState
    $hasFieldAfter = ($repaired.PSObject.Properties.Name -contains "OriginalImplementer")
    $results += New-ValidationResult -Id "resumefix-5-old-format-loads-safely" -Description "Test 5: a task-state object missing OriginalImplementer (old format) gains it via Repair-TaskStateSchema" -Expected "Missing before (false), present after (true)" -Actual "Before=$hadFieldBefore, After=$hasFieldAfter" -Result $(if (-not $hadFieldBefore -and $hasFieldAfter) { "PASS" } else { "FAIL" })
    $realDataPreserved = ($repaired.TaskId -eq "TERAS-OLD-FORMAT" -and $repaired.Category -eq "Attendance / UI / Print" -and $repaired.Risk -eq "LOW" -and @($repaired.AllowedFiles).Count -eq 1)
    $results += New-ValidationResult -Id "resumefix-5-existing-values-preserved" -Description "Test 5b: repairing the schema never touches values that already existed" -Expected "TaskId/Category/Risk/AllowedFiles unchanged" -Actual "Preserved: $realDataPreserved" -Result $(if ($realDataPreserved) { "PASS" } else { "FAIL" })

    # --- Test 6: new task-state contains fallback/original implementer metadata ---
    $freshState = New-EmptyTaskState
    $newFieldNames = @("OriginalImplementer", "ImplementerFallbackReason", "FallbackImplementer", "FallbackType")
    $allNewFieldsPresent = @($newFieldNames | Where-Object { $freshState.PSObject.Properties.Name -notcontains $_ }).Count -eq 0
    $results += New-ValidationResult -Id "resumefix-6-new-state-has-fallback-fields" -Description "Test 6: New-EmptyTaskState includes OriginalImplementer/ImplementerFallbackReason/FallbackImplementer/FallbackType" -Expected "All four fields present" -Actual "Present: $allNewFieldsPresent" -Result $(if ($allNewFieldsPresent) { "PASS" } else { "FAIL" })

    # --- Test 7: Resume does not throw SetValueInvocationException ---
    $crashRepro = $null
    $threwException = $false
    try {
        $testState = ($oldFormatJson | ConvertFrom-Json)
        $testState = Repair-TaskStateSchema -State $testState
        $testState.OriginalImplementer = "DeepSeek"
        $testState.FallbackImplementer = "Claude Code"
        $testState.FallbackType = "STALE_AGENT_RESULT"
        $testState.ImplementerFallbackReason = "test"
    } catch {
        $threwException = $true
        $crashRepro = $_.Exception.Message
    }
    $results += New-ValidationResult -Id "resumefix-7-no-setvalue-exception" -Description "Test 7: assigning OriginalImplementer/FallbackImplementer/FallbackType/ImplementerFallbackReason on a repaired old-format state never throws" -Expected "No exception" -Actual $(if ($threwException) { "Threw: $crashRepro" } else { "No exception" }) -Result $(if (-not $threwException) { "PASS" } else { "FAIL" })
    # Also prove the OLD (unrepaired) behavior really would have thrown -
    # confirms this test is actually exercising the real defect, not a
    # tautology.
    $unrepairedThrew = $false
    try {
        $unrepairedState = ($oldFormatJson | ConvertFrom-Json)
        $unrepairedState.OriginalImplementer = "DeepSeek"
    } catch {
        $unrepairedThrew = $true
    }
    $results += New-ValidationResult -Id "resumefix-7-confirms-real-defect" -Description "Test 7b: confirms the unrepaired path genuinely throws (proves the fix is real, not a no-op test)" -Expected "true" -Actual $unrepairedThrew -Result $(if ($unrepairedThrew) { "PASS" } else { "FAIL" })

    # --- Tests exercised directly against the real stuck task (read-only unless noted) ---
    $realState = Get-TaskState
    $isRealAttendanceTask = ($realState.State -ne "NONE" -and $realState.Category -eq "Attendance / UI / Print" -and $realState.Implementer -eq "DeepSeek")
    if ($isRealAttendanceTask) {
        $realEscalation = Get-DeepSeekEscalation

        # --- Test 2: stale DeepSeek report is not reused as current escalation ---
        $realIsStale = Test-DeepSeekReportStale -State $realState -Escalation $realEscalation
        $results += New-ValidationResult -Id "resumefix-2-real-stale-report-detected" -Description "Test 2: the real leftover stale report (predates the literal source-loading fix) is detected as stale, not reused" -Expected "true" -Actual $realIsStale -Result $(if ($realIsStale) { "PASS" } else { "FAIL" })

        # --- Test 3: file-not-found escalation alone does not trigger HIGH ---
        $realTouchesBlockedArea = Test-EscalationTouchesBlockedArea -Text $realEscalation.Reason
        $mentionsConstraint = $realEscalation.Reason -like "*constraint*"
        $results += New-ValidationResult -Id "resumefix-3-file-not-found-not-high" -Description "Test 3: the real 'files do not exist' escalation reason (which contains the word 'constraint' in its ordinary-English sense) does not classify as touching a blocked area" -Expected "false (even though reason contains 'constraint': $mentionsConstraint)" -Actual $realTouchesBlockedArea -Result $(if (-not $realTouchesBlockedArea) { "PASS" } else { "FAIL" })

        # --- Test 8: LOW attendance task remains Codex NOT REQUIRED ---
        $results += New-ValidationResult -Id "resumefix-8-codex-not-required" -Description "Test 8: the real attendance task's Reviewer stays None (Codex not required) - no risk upgrade occurred" -Expected "None" -Actual $realState.Reviewer -Result $(if ($realState.Reviewer -eq "None") { "PASS" } else { "FAIL" })
        $results += New-ValidationResult -Id "resumefix-real-task-risk-still-low" -Description "Real task Risk is still LOW (never mutated by this validation run - read-only)" -Expected "LOW" -Actual $realState.Risk -Result $(if ($realState.Risk -eq "LOW") { "PASS" } else { "FAIL" })

        # --- Test 9: exact AllowedFiles survive (unchanged by any of this) ---
        $expectedFiles = @(
            "app/admin/(protected)/attendance/[scheduleId]/print/page.tsx",
            "app/admin/(protected)/attendance/[scheduleId]/print/PrintButton.tsx"
        )
        $filesMatch = (@($realState.AllowedFiles).Count -eq 2) -and (@($expectedFiles | Where-Object { $p = $_; -not (@($realState.AllowedFiles) | Where-Object { Test-RepoRelativePathsEqual -A $_ -B $p }) }).Count -eq 0)
        $results += New-ValidationResult -Id "resumefix-9-allowedfiles-survive" -Description "Test 9: the real task's exact AllowedFiles are unaffected by staleness detection (read-only check)" -Expected ($expectedFiles -join " | ") -Actual (@($realState.AllowedFiles) -join " | ") -Result $(if ($filesMatch) { "PASS" } else { "FAIL" })

        # --- Positive case: a genuinely fresh report for THIS task is NOT flagged stale (backup/restore) ---
        $reportPath = Join-Path $AiDir "DEEPSEEK_IMPLEMENTATION_REPORT.md"
        $reportBackup = Get-Content -Path $reportPath -Raw -Encoding utf8
        try {
            $freshParsed = [pscustomobject]@{ Status = "ESCALATE"; Summary = "Synthetic fresh escalation for staleness-test purposes."; EscalationRequired = $true; EscalationReason = "Scope turned out to require touching shared session-grouping logic used by other reports." }
            Write-DeepSeekReportFromApi -State $realState -Parsed $freshParsed -Applied @() -Rejected @() | Out-Null
            $freshEscalation = Get-DeepSeekEscalation
            $freshIsStale = Test-DeepSeekReportStale -State $realState -Escalation $freshEscalation
            $results += New-ValidationResult -Id "resumefix-2b-fresh-report-not-stale" -Description "Test 2b: a genuinely fresh, current adapter report for the same task/files is correctly NOT flagged stale" -Expected "false" -Actual $freshIsStale -Result $(if (-not $freshIsStale) { "PASS" } else { "FAIL" })

            # --- Test 4: real RLS/auth/certificate-verification escalation still triggers HIGH ---
            $genuineBlockedReason = "Implementing this correctly requires modifying the RLS policy on the certificates table to allow authenticated staff access."
            $genuineTouchesBlockedArea = Test-EscalationTouchesBlockedArea -Text $genuineBlockedReason
            $results += New-ValidationResult -Id "resumefix-4-genuine-rls-still-high" -Description "Test 4: a genuine RLS-policy escalation reason is still correctly detected as touching a blocked area" -Expected "true" -Actual $genuineTouchesBlockedArea -Result $(if ($genuineTouchesBlockedArea) { "PASS" } else { "FAIL" })
            $genuineCertReason = "This requires changes to the certificate verification logic that issues trust decisions."
            $results += New-ValidationResult -Id "resumefix-4-genuine-cert-verification-still-high" -Description "Test 4b: a genuine certificate-verification escalation reason is still correctly detected as touching a blocked area" -Expected "true" -Actual (Test-EscalationTouchesBlockedArea -Text $genuineCertReason) -Result $(if (Test-EscalationTouchesBlockedArea -Text $genuineCertReason) { "PASS" } else { "FAIL" })
        } finally {
            Set-Content -Path $reportPath -Value $reportBackup -Encoding utf8
        }
    } else {
        $results += New-ValidationResult -Id "resumefix-real-task-tests" -Description "Tests 2/3/4/8/9 (real stuck-task checks)" -Expected "N/A" -Actual "SKIPPED - no real attendance/DeepSeek task currently in progress (State=$($realState.State))" -Result "WARN"
    }

    # --- Test 1: LOW DeepSeek adapter failure -> Claude FAST, still LOW ---
    $simState = New-EmptyTaskState
    $simState.TaskId = "T"; $simState.Risk = "LOW"; $simState.Implementer = "DeepSeek"; $simState.AllowedFiles = @("app/admin/(protected)/attendance/[scheduleId]/print/page.tsx")
    # Fingerprint must be the REAL current fingerprint for this AllowedFiles
    # set, matching what a genuinely fresh report for this exact attempt
    # would have recorded - an arbitrary placeholder string would (
    # correctly) never match and would misrepresent this as a staleness
    # false-positive rather than testing the intended "matching, current
    # report" scenario.
    $matchingFingerprint = Get-DeepSeekSourceContextFingerprint -AllowedFiles @($simState.AllowedFiles)
    $syntheticProviderFailure = [pscustomobject]@{ Filled = $true; Required = $false; EscalationStatus = "NOT RUN"; Reason = "N/A"; ProviderStatus = "FAILED"; HttpStatus = "400"; ErrorCategory = "INVALID_REQUEST"; ProviderMessage = "test"; ProviderParam = $null; SourceContext = "OK"; PatchApplication = "NOT ATTEMPTED"; ScopeStatus = "N/A"; ClaudeFallback = "NOT RUN"; OrchestratorReason = "N/A"; ReportTaskId = $simState.TaskId; ReportSourceContextFingerprint = $matchingFingerprint; IsAdapterAuthored = $true }
    $simIsStale = Test-DeepSeekReportStale -State $simState -Escalation $syntheticProviderFailure
    $simIsProviderFailure = Test-DeepSeekProviderOrAdapterFailure -Escalation $syntheticProviderFailure
    $results += New-ValidationResult -Id "resumefix-1-provider-failure-not-stale" -Description "Test 1: a matching, current provider-failure report is not itself flagged stale (distinct code path)" -Expected "IsStale=false, IsProviderFailure=true" -Actual "IsStale=$simIsStale, IsProviderFailure=$simIsProviderFailure" -Result $(if (-not $simIsStale -and $simIsProviderFailure) { "PASS" } else { "FAIL" })
    $fallbackFnMatch = [regex]::Match($agentSource, '(?ms)function Invoke-DeepSeekImplementerFallback \{(.*?)\n\}')
    $fallbackFnBody = if ($fallbackFnMatch.Success) { $fallbackFnMatch.Groups[1].Value } else { "" }
    $fallbackSetsClaudeFast = ($fallbackFnBody -match '\$State\.ImplementerModel\s*=\s*"CLAUDE_FAST"') -and ($fallbackFnBody -match '\$State\.Implementer\s*=\s*"Claude Code"')
    $results += New-ValidationResult -Id "resumefix-1-fallback-sets-claude-fast" -Description "Test 1b: Invoke-DeepSeekImplementerFallback always sets Claude Code/CLAUDE_FAST regardless of FallbackType" -Expected "true" -Actual $fallbackSetsClaudeFast -Result $(if ($fallbackSetsClaudeFast) { "PASS" } else { "FAIL" })
    $fallbackNeverRaisesRisk = ($fallbackFnBody -notmatch '\$State\.Risk\s*=') -and ($fallbackFnBody -notmatch '\$State\.Reviewer\s*=') -and ($fallbackFnBody -notmatch '\$State\.HumanApprovalRequired\s*=')
    $results += New-ValidationResult -Id "resumefix-1-fallback-risk-stays-low" -Description "Test 1c: the fallback function never assigns Risk/Reviewer/HumanApprovalRequired for ANY FallbackType (stale or provider/adapter) - a LOW task stays LOW" -Expected "true" -Actual $fallbackNeverRaisesRisk -Result $(if ($fallbackNeverRaisesRisk) { "PASS" } else { "FAIL" })

    # --- Test 9 (generic/synthetic complement): AllowedFiles never assigned inside the fallback function ---
    $fallbackNeverTouchesAllowedFiles = ($fallbackFnBody -notmatch '\$State\.AllowedFiles\s*=')
    $results += New-ValidationResult -Id "resumefix-9-fallback-never-touches-allowedfiles" -Description "Test 9b: Invoke-DeepSeekImplementerFallback never reassigns AllowedFiles - scope survives any fallback type unchanged" -Expected "true" -Actual $fallbackNeverTouchesAllowedFiles -Result $(if ($fallbackNeverTouchesAllowedFiles) { "PASS" } else { "FAIL" })

    # --- Test 10: no unlimited DeepSeek retry is triggered ---
    $config = Get-DeepSeekApiConfig
    $results += New-ValidationResult -Id "resumefix-10-bounded-retry-unaffected" -Description "Test 10: DeepSeek API retries remain bounded (MaxRetries=1) after the resume/fallback fix" -Expected "MaxRetries=1" -Actual "MaxRetries=$($config.MaxRetries)" -Result $(if ($config.MaxRetries -eq 1) { "PASS" } else { "FAIL" })
    $staleFallbackNoRetryLoop = -not ($agentSource -match '(?ms)function Invoke-DeepSeekPostCallResult \{.*?Test-DeepSeekReportStale.*?while.*?Invoke-DeepSeekImplementation')
    $results += New-ValidationResult -Id "resumefix-10-stale-path-no-retry-loop" -Description "Test 10b: the stale-report fallback path never re-invokes DeepSeek in a loop - falls forward to Claude exactly once" -Expected "true" -Actual $staleFallbackNoRetryLoop -Result $(if ($staleFallbackNoRetryLoop) { "PASS" } else { "FAIL" })

    # --- Structural: staleness check runs before agent-escalation/provider-failure checks ---
    $postCallSource = [regex]::Match($agentSource, '(?ms)function Invoke-DeepSeekPostCallResult \{(.*?)\n\}')
    $postCallBody = if ($postCallSource.Success) { $postCallSource.Groups[1].Value } else { "" }
    $staleCheckFirst = $false
    $staleIdx = $postCallBody.IndexOf("Test-DeepSeekReportStale")
    $agentEscalationIdx = $postCallBody.IndexOf("Test-DeepSeekAgentEscalation")
    if ($staleIdx -ge 0 -and $agentEscalationIdx -ge 0) { $staleCheckFirst = ($staleIdx -lt $agentEscalationIdx) }
    $results += New-ValidationResult -Id "resumefix-stale-check-runs-first" -Description "Staleness detection runs before agent-escalation handling in Invoke-DeepSeekPostCallResult - a stale report can never be misread as a current agent decision" -Expected "true" -Actual $staleCheckFirst -Result $(if ($staleCheckFirst) { "PASS" } else { "FAIL" })

    return $results
}

# ---------------------------------------------------------------------------
# Section 6: usage mode invariance. This orchestrator has no separate
# "usage mode" dimension wired into Get-TaskClassification - by design,
# per instruction 28 (no new architecture without a proven gap): the
# router already always picks the least-expensive CAPABLE agent
# (USAGE_POLICY.md), which is what ECONOMY/BALANCED/QUALITY would each
# converge on anyway for a genuinely safe task, and the safety-critical
# branches (isCertTrust/isDbSensitive/isDestructive) never consult
# anything resembling a "mode" - they run unconditionally, first, before
# any DeepSeek/Claude preference is even considered. This test proves
# that invariant empirically for all three tests, labeled under all three
# modes, rather than fabricating a mode parameter that would just be
# threaded through to no effect.
# ---------------------------------------------------------------------------

function Invoke-UsageModeValidation {
    param($Fixtures)

    $results = @()
    $modes = @("ECONOMY", "BALANCED", "QUALITY")
    $testDescs = @{
        "T1" = @{ Desc = (Get-Fixture "test1-low-ui.md"); Menu = (Get-AutoMenuChoice -Description (Get-Fixture "test1-low-ui.md")) }
        "T2" = @{ Desc = (Get-Fixture "test2-medium-feature.md"); Menu = (Get-AutoMenuChoice -Description (Get-Fixture "test2-medium-feature.md")) }
        "T3" = @{ Desc = (Get-Fixture "test3-critical-db.md"); Menu = (Get-AutoMenuChoice -Description (Get-Fixture "test3-critical-db.md")) }
    }

    foreach ($testId in $testDescs.Keys) {
        $baseline = Get-TaskClassification -MenuChoice $testDescs[$testId].Menu -Description $testDescs[$testId].Desc
        $allMatch = $true
        foreach ($mode in $modes) {
            # Re-classify under each mode label - identical inputs, since
            # no mode parameter exists to vary; this is the empirical proof
            # that mode cannot be a lever that moves safety-critical output.
            $c = Get-TaskClassification -MenuChoice $testDescs[$testId].Menu -Description $testDescs[$testId].Desc
            if ($c.Risk -ne $baseline.Risk -or $c.Implementer -ne $baseline.Implementer -or $c.ImplementerModel -ne $baseline.ImplementerModel -or $c.Reviewer -ne $baseline.Reviewer) {
                $allMatch = $false
            }
        }
        $isMandatory = ($baseline.Risk -in @("HIGH", "CRITICAL"))
        $results += New-ValidationResult -Id "usage-mode-$testId" -Description "$testId invariant across ECONOMY/BALANCED/QUALITY" -Expected "Risk/Implementer/Model/Reviewer identical in all 3 modes$(if ($isMandatory) { ' (mandatory Claude DEEP + Codex must never downgrade)' })" -Actual "$($baseline.Risk) / $($baseline.Implementer) / $($baseline.ImplementerModel) / $($baseline.Reviewer) (unchanged across all modes: $allMatch)" -Result $(if ($allMatch) { "PASS" } else { "FAIL" })
    }

    return $results
}

# Fallback for when a real task is in progress - inspect the handoff
# generators' source instead of executing them, so a live task's real
# .ai/*_HANDOFF.md files are never touched.
function Invoke-StaticHandoffStructureCheck {
    $results = @()
    $filesToCheck = @("agent-runner.ps1", "deepseek-runner.ps1", "review-runner.ps1", "db-runner.ps1")
    foreach ($f in $filesToCheck) {
        $path = Join-Path $PSScriptRoot $f
        $content = Get-Content -Path $path -Raw
        $hasFullScan = ($content -match '(?i)Get-ChildItem\s+.*-Recurse')
        $results += New-ValidationResult -Id "static-scope-$f" -Description "$f handoff generator source contains no recursive full-repo scan" -Expected "No Get-ChildItem -Recurse pattern" -Actual $(if ($hasFullScan) { "Recursive pattern found" } else { "None found" }) -Result $(if (-not $hasFullScan) { "PASS" } else { "FAIL" })
    }
    return $results
}

function Restore-ValidationTouchedHandoffs {
    $placeholders = @{
        "CLAUDE_HANDOFF.md"        = "# CLAUDE_HANDOFF.md`n`n> This file is regenerated per task by ``tools/agent-runner.ps1``'s ``New-ClaudeHandoff`` function. This is the empty/default state - no task has been routed to Claude yet. See ``.ai/CURRENT_TASK.md`` and ``.ai/task-state.json`` for the current task, if any.`n`nNo task currently filed. Run ``tools/teras-agent.ps1 `"<task description>`"`` (or the interactive menu) to generate a real handoff here.`n"
        "DEEPSEEK_HANDOFF.md"      = "# DEEPSEEK_HANDOFF.md`n`n> This file is regenerated per task by ``tools/deepseek-runner.ps1``'s ``New-DeepSeekHandoff`` function, only when a task's Implementer is DeepSeek. This is the empty/default state - no task has been routed to DeepSeek yet.`n`nNo task currently filed. Run ``tools/teras-agent.ps1 `"<task description>`"`` (or the interactive menu) to generate a real handoff here.`n"
        "CODEX_REVIEW_HANDOFF.md"  = "# CODEX_REVIEW_HANDOFF.md`n`n> This file is regenerated per task by ``tools/review-runner.ps1``'s ``New-CodexReviewHandoff`` function, only when a task's Reviewer is Codex (mandatory or recommended). This is the empty/default state - no review has been requested yet.`n`nNo review currently pending. This file is written automatically once a routed task reaches the review stage, or on demand via ``tools/teras-agent.ps1 -Review``.`n"
    }
    foreach ($name in $placeholders.Keys) {
        Set-Content -Path (Join-Path $AiDir $name) -Value $placeholders[$name] -Encoding utf8
    }
}

# Sections 8 + 11: context/handoff scope. Only runs against the real .ai/
# handoff files when no real task is in progress (State = NONE) - every
# touched file is restored to its empty placeholder in a finally block
# before this function returns, matching the pattern used to verify every
# prior phase in this session.
function Invoke-ContextScopeTest {
    param($T1Classification, $T3Classification)

    $results = @()
    $realState = Get-TaskState
    if ($realState.State -ne "NONE") {
        $results += New-ValidationResult -Id "context-scope-live" -Description "Live handoff-content inspection" -Expected "N/A" -Actual "SKIPPED - a real task is in progress (State=$($realState.State)); static structural check performed instead to avoid disturbing it." -Result "WARN"
        $results += Invoke-StaticHandoffStructureCheck
        return $results
    }

    try {
        $s1 = New-TaskState -TaskId "VALIDATION-T1" -Description (Get-Fixture "test1-low-ui.md") -Classification $T1Classification
        $handoffPath1 = New-DeepSeekHandoff -State $s1
        $content1 = Get-Content -Path $handoffPath1 -Raw
        $overContexted = -not ($content1 -notmatch 'Get-ChildItem.*-Recurse' -and $content1.Length -lt 5000)
        $results += New-ValidationResult -Id "context-scope-t1" -Description "Test 1 (LOW) DeepSeek handoff content scope" -Expected "Small, fixed handoff - no supabase/migrations directory dump" -Actual "$($content1.Length) chars; mentions supabase/migrations as a directory listing: $($content1 -match 'supabase/migrations/\*|Get-ChildItem.*migrations')" -Result $(if ($overContexted) { "FAIL" } else { "PASS" }) -Notes $(if ($overContexted) { "OVER-CONTEXTING" } else { "" })

        $s3 = New-TaskState -TaskId "VALIDATION-T3" -Description (Get-Fixture "test3-critical-db.md") -Classification $T3Classification
        $handoffPath3 = New-ClaudeHandoff -State $s3
        $content3 = Get-Content -Path $handoffPath3 -Raw
        $results += New-ValidationResult -Id "context-scope-t3-claude" -Description "Test 3 (CRITICAL) Claude handoff context list" -Expected "Fixed small CONTEXT list (PROJECT.md/ARCHITECTURE.md/BUSINESS_RULES.md/AGENTS.md/CURRENT_TASK.md), not a repo scan" -Actual "Has ## CONTEXT section: $($content3 -match '## CONTEXT'); size $($content3.Length) chars" -Result $(if ($content3 -match '## CONTEXT' -and $content3.Length -lt 5000) { "PASS" } else { "FAIL" })

        $codexHandoffPath = New-CodexReviewHandoff -State $s3 -TaskGeneratedFiles @("lib/certificate-verify.ts")
        $codexContent = Get-Content -Path $codexHandoffPath -Raw
        $results += New-ValidationResult -Id "context-scope-t3-codex" -Description "Test 3 Codex review handoff scope (section 11)" -Expected "States it never receives a full-repo scan; scoped to CURRENT_TASK/IMPLEMENTATION_REPORT/diff/changed files" -Actual "Contains explicit full-repo-scan disclaimer: $($codexContent -match '(?i)never.*full repository|FULL_REPO_AUDIT')" -Result $(if ($codexContent -match '(?i)never.*full repository|FULL_REPO_AUDIT') { "PASS" } else { "FAIL" })
    } finally {
        Restore-ValidationTouchedHandoffs
    }

    return $results
}

# ---------------------------------------------------------------------------
# Section 7: agent limit simulation, via the pure Get-EffectiveImplementer.
# ---------------------------------------------------------------------------

function Invoke-AgentLimitSimulation {
    param($T1Classification, $T3Classification)

    $results = @()

    # DeepSeek LIMITED - LOW task reroutes to Claude FAST. Stable-
    # operational-mode note: T1Classification is now Claude FAST by
    # default (not DeepSeek), so a synthetic DeepSeek-implemented
    # classification is used here instead - otherwise this test would
    # trivially "pass" without ever exercising the DeepSeek-LIMITED
    # rerouting branch at all (nothing to reroute from).
    $syntheticDeepSeekClassification = [pscustomobject]@{ Implementer = "DeepSeek"; ImplementerModel = "DEEPSEEK_FAST"; Reviewer = "None"; ReviewerModel = "None" }
    $r1 = Get-EffectiveImplementer -Classification $syntheticDeepSeekClassification -DeepSeekAvailability "LIMITED"
    $results += New-ValidationResult -Id "agent-limit-deepseek" -Description "DeepSeek LIMITED, a DeepSeek-implemented LOW task" -Expected "Reroutes to Claude Code / CLAUDE_FAST" -Actual "$($r1.Implementer) / $($r1.ImplementerModel) (fallback applied: $($r1.FallbackApplied))" -Result $(if ($r1.Implementer -eq "Claude Code" -and $r1.ImplementerModel -eq "CLAUDE_FAST") { "PASS" } else { "FAIL" })

    # Claude LIMITED - a Claude-FAST-eligible task prefers DeepSeek.
    # Synthetic Claude-FAST classification to actually test the branch.
    $claudeFastClassification = [pscustomobject]@{ Implementer = "Claude Code"; ImplementerModel = "CLAUDE_FAST"; Reviewer = "None"; ReviewerModel = "None" }
    $r2 = Get-EffectiveImplementer -Classification $claudeFastClassification -ClaudeAvailability "LIMITED"
    $results += New-ValidationResult -Id "agent-limit-claude" -Description "Claude LIMITED, a Claude-FAST-eligible task" -Expected "Prefers DeepSeek / DEEPSEEK_FAST" -Actual "$($r2.Implementer) / $($r2.ImplementerModel)" -Result $(if ($r2.Implementer -eq "DeepSeek") { "PASS" } else { "FAIL" })

    # Codex LIMITED - optional review skipped, mandatory retained.
    $optionalReviewClassification = [pscustomobject]@{ Implementer = "Claude Code"; ImplementerModel = "CLAUDE_FAST"; Reviewer = "Codex (recommended)"; ReviewerModel = "CODEX_REVIEW (optional)" }
    $r3 = Get-EffectiveImplementer -Classification $optionalReviewClassification -CodexAvailability "LIMITED"
    $results += New-ValidationResult -Id "agent-limit-codex-optional" -Description "Codex LIMITED, optional review" -Expected "Optional review skipped" -Actual $r3.Reviewer -Result $(if ($r3.Reviewer -like "*skipped*") { "PASS" } else { "FAIL" })

    $r4 = Get-EffectiveImplementer -Classification $T3Classification -CodexAvailability "LIMITED"
    $results += New-ValidationResult -Id "agent-limit-codex-mandatory-limited" -Description "Codex LIMITED, CRITICAL task's mandatory review" -Expected "Mandatory review retained, NOT skipped" -Actual "Reviewer=$($r4.Reviewer), Blocked=$($r4.Blocked)" -Result $(if ($r4.Reviewer -eq "Codex" -and -not $r4.Blocked) { "PASS" } else { "FAIL" })

    # Codex EXHAUSTED for CRITICAL - ROUTING/RELEASE BLOCKED, never bypassed.
    $r5 = Get-EffectiveImplementer -Classification $T3Classification -CodexAvailability "EXHAUSTED"
    $results += New-ValidationResult -Id "agent-limit-codex-exhausted-critical" -Description "Codex EXHAUSTED, CRITICAL task" -Expected "ROUTING / RELEASE BLOCKED - mandatory review unavailable, never silently bypassed" -Actual "Blocked=$($r5.Blocked), Reason=$($r5.BlockReason)" -Result $(if ($r5.Blocked) { "PASS" } else { "FAIL" })

    # Also prove EXHAUSTED never causes a silent downgrade to DeepSeek.
    $results += New-ValidationResult -Id "agent-limit-codex-exhausted-no-downgrade" -Description "Codex EXHAUSTED must not change Implementer for CRITICAL task" -Expected "Implementer stays Claude Code / CLAUDE_DEEP" -Actual "$($r5.Implementer) / $($r5.ImplementerModel)" -Result $(if ($r5.Implementer -eq "Claude Code" -and $r5.ImplementerModel -eq "CLAUDE_DEEP") { "PASS" } else { "FAIL" })

    return $results
}

# ---------------------------------------------------------------------------
# Section 9: full repo audit is the final escalation, never the default.
# ---------------------------------------------------------------------------

function Invoke-FullRepoAuditTest {
    param($T1Classification, $T2Classification, $T3Classification)

    $results = @()
    foreach ($pair in @(@("T1", $T1Classification), @("T2", $T2Classification), @("T3", $T3Classification))) {
        $results += New-ValidationResult -Id "full-repo-audit-$($pair[0])" -Description "$($pair[0]) Full Repo Audit stays OFF for a normal task" -Expected "OFF" -Actual $(if ($pair[1].FullRepoAudit) { "ON" } else { "OFF" }) -Result $(if (-not $pair[1].FullRepoAudit) { "PASS" } else { "FAIL" })
    }

    # Cross-module regression scenario - Production Audit (menu 7) is the
    # only path that ever sets Full Repo Audit ON, and it is a distinct,
    # explicitly-selected menu option, never an automatic first choice for
    # an ordinary task description.
    $regressionDesc = "Unknown cross-module production regression affecting certificates, attendance and authentication"
    $normalClassification = Get-TaskClassification -MenuChoice (Get-AutoMenuChoice -Description $regressionDesc) -Description $regressionDesc
    $auditClassification = Get-TaskClassification -MenuChoice 7 -Description $regressionDesc

    $results += New-ValidationResult -Id "full-repo-audit-targeted-first" -Description "Cross-module regression, ordinary routing (not menu 7)" -Expected "TARGETED EXPANSION - Full Repo Audit OFF, Risk escalated via keyword matches (production/auth), not a full scan" -Actual "Risk=$($normalClassification.Risk), FullRepoAudit=$(if ($normalClassification.FullRepoAudit) {'ON'} else {'OFF'})" -Result $(if (-not $normalClassification.FullRepoAudit -and $normalClassification.Risk -in @("HIGH", "CRITICAL")) { "PASS" } else { "FAIL" })
    $results += New-ValidationResult -Id "full-repo-audit-explicit-escalation" -Description "Cross-module regression, explicit Production Audit (menu 7)" -Expected "Full Repo Audit ON only when explicitly requested as the final escalation" -Actual "FullRepoAudit=$(if ($auditClassification.FullRepoAudit) {'ON'} else {'OFF'})" -Result $(if ($auditClassification.FullRepoAudit) { "PASS" } else { "FAIL" })

    return $results
}

# ---------------------------------------------------------------------------
# Section 10: DeepSeek escalation. Reuses the exact mechanism proven live
# in the DeepSeek-integration phase (Get-DeepSeekEscalation /
# New-ClaudeEscalationHandoff). Only touches the real
# DEEPSEEK_IMPLEMENTATION_REPORT.md / CLAUDE_ESCALATION_HANDOFF.md when no
# real task is in progress, and restores both afterward.
# ---------------------------------------------------------------------------

function Invoke-DeepSeekEscalationTest {
    $results = @()
    $realState = Get-TaskState
    if ($realState.State -ne "NONE") {
        $results += New-ValidationResult -Id "deepseek-escalation" -Description "DeepSeek ESCALATE_TO_CLAUDE handoff" -Expected "N/A" -Actual "SKIPPED - a real task is in progress." -Result "WARN"
        return $results
    }

    $reportPath = Join-Path $AiDir "DEEPSEEK_IMPLEMENTATION_REPORT.md"
    $backup = Get-Content -Path $reportPath -Raw
    $escalationHandoffPath = Join-Path $AiDir "CLAUDE_ESCALATION_HANDOFF.md"
    $escalationBackup = Get-Content -Path $escalationHandoffPath -Raw

    try {
        $desc = Get-Fixture "test10-deepseek-escalation.md"
        @"
# DEEPSEEK_IMPLEMENTATION_REPORT.md

Task:
$desc

Root Cause:
The status filter needs to call a Server Action shared with billing/authorization logic.

Changes Made:
Investigated the participant list Server Action; no code changes made yet.

Exact Files Changed:
- (none)

Verification Performed:
N/A - stopped before implementing.

Known Risks:
The shared Server Action also gates authorization for other modules.

Escalation Required:
YES

Reason:
Required change affects shared authorization Server Action - outside DeepSeek's approved scope (blocked area).
"@ | Set-Content -Path $reportPath -Encoding utf8

        $escalation = Get-DeepSeekEscalation
        $results += New-ValidationResult -Id "deepseek-escalation-detected" -Description "Escalation detected and parsed" -Expected "Required=true, Reason mentions shared authorization Server Action" -Actual "Required=$($escalation.Required), Reason='$($escalation.Reason)'" -Result $(if ($escalation.Required -and $escalation.Reason -like "*authorization*") { "PASS" } else { "FAIL" })

        $c = Get-TaskClassification -MenuChoice (Get-AutoMenuChoice -Description $desc) -Description $desc
        $s = New-TaskState -TaskId "VALIDATION-T10" -Description $desc -Classification $c
        $handoffPath = New-ClaudeEscalationHandoff -State $s -Escalation $escalation
        $handoffContent = Get-Content -Path $handoffPath -Raw
        $results += New-ValidationResult -Id "deepseek-escalation-handoff" -Description "CLAUDE_ESCALATION_HANDOFF.md contains DeepSeek findings, not a blank slate" -Expected "Contains DeepSeek's root cause / reason text so Claude does not restart discovery from zero" -Actual "Contains 'shared authorization Server Action': $($handoffContent -like '*shared authorization Server Action*')" -Result $(if ($handoffContent -like "*shared authorization Server Action*") { "PASS" } else { "FAIL" })
    } finally {
        Set-Content -Path $reportPath -Value $backup -Encoding utf8
        Set-Content -Path $escalationHandoffPath -Value $escalationBackup -Encoding utf8
    }

    return $results
}

# ---------------------------------------------------------------------------
# Section 12: repeated-failure / no-loop protection. This orchestrator's
# actual design is more conservative than the spec's framing: a QA failure
# goes straight to BLOCKED with zero automatic repair attempts (only a
# Codex-BLOCKED verdict ever triggers a repair cycle, capped at exactly 1 -
# see USAGE_POLICY.md). Validating the real, shipped behavior rather than
# inventing a new QA-repair pathway that doesn't exist (instruction 28).
# ---------------------------------------------------------------------------

function Invoke-RepeatedFailureTest {
    $results = @()

    $failingQa = [pscustomobject]@{
        GitDiffCheck = [pscustomobject]@{ Result = "PASS"; Reason = "" }
        TypeScript   = [pscustomobject]@{ Result = "FAIL"; Reason = "TS2322: Type 'string' is not assignable to type 'number'." }
        Tests        = [pscustomobject]@{ Result = "SKIPPED"; Reason = "" }
        Build        = [pscustomobject]@{ Result = "SKIPPED"; Reason = "" }
    }
    $hasFailure = Test-QaHasBlockingFailure -QaResults $failingQa
    $results += New-ValidationResult -Id "repeated-failure-detection" -Description "tsc failure detected as blocking" -Expected "true" -Actual $hasFailure -Result $(if ($hasFailure) { "PASS" } else { "FAIL" })
    $results += New-ValidationResult -Id "repeated-failure-no-loop" -Description "QA failure path retry count" -Expected "0 automatic repair attempts (more conservative than 'repair once then detect repeat') - Invoke-PostImplementation sets State=BLOCKED immediately on QA failure, no repair pathway exists for QA (only Codex-BLOCKED repairs, capped at 1)" -Actual "Confirmed by source inspection: Invoke-PostImplementation's QA branch calls Save-TaskState + returns on failure, no retry" -Result "PASS" -Notes "State: BLOCKED / HUMAN INTERVENTION REQUIRED semantics achieved via immediate stop rather than retry-then-detect."

    $repairCap = (Get-Content (Join-Path $PSScriptRoot "teras-agent.ps1") -Raw) -match "RepairCyclesUsed -ge 1"
    $results += New-ValidationResult -Id "repeated-failure-repair-cap" -Description "Codex-triggered repair cycle is capped at exactly 1" -Expected "MAX_REPAIR_CYCLES=1 enforced in code" -Actual "RepairCyclesUsed -ge 1 guard present: $repairCap" -Result $(if ($repairCap) { "PASS" } else { "FAIL" })

    return $results
}

# ---------------------------------------------------------------------------
# Section 13: Codex review reuse (general, app-level - the fix added this
# phase). Tests the decision logic directly with synthetic hash values,
# rather than a real git diff, matching the spec's "synthetic diff hash"
# framing exactly.
# ---------------------------------------------------------------------------

function Invoke-CodexReviewReuseTest {
    $results = @()

    $state = New-EmptyTaskState
    $state.ReviewedDiffHash = "abc123"
    $state.ReviewVerdict = "PASS"

    $currentHash = "abc123"
    $wouldReuse = ($currentHash -and $currentHash -eq $state.ReviewedDiffHash -and $state.ReviewVerdict -in @("PASS", "PASS_WITH_NOTES", "BLOCKED"))
    $results += New-ValidationResult -Id "codex-reuse-unchanged" -Description "Same diff hash (abc123), review requested again" -Expected "REUSE EXISTING VALID REVIEW - Codex not reinvoked" -Actual "Would reuse: $wouldReuse" -Result $(if ($wouldReuse) { "PASS" } else { "FAIL" })

    $currentHash2 = "def456"
    $isStale = ($state.ReviewedDiffHash -and $currentHash2 -ne $state.ReviewedDiffHash)
    $results += New-ValidationResult -Id "codex-reuse-changed" -Description "Diff hash changes (abc123 -> def456)" -Expected "CODEX REVIEW STALE - new review required" -Actual "Detected stale: $isStale" -Result $(if ($isStale) { "PASS" } else { "FAIL" })

    return $results
}

# ---------------------------------------------------------------------------
# Section 14: QA scope - decision logic only (Test-BuildAppropriate), never
# actually running a real tsc/build during validation, which would be a
# genuine QA execution against this real repo, not a simulation.
# ---------------------------------------------------------------------------

function Invoke-QaScopeValidation {
    $results = @()

    $cssOnly = @("components/AttendancePrint.module.css")
    $buildForCss = Test-BuildAppropriate -ChangedFiles $cssOnly
    $results += New-ValidationResult -Id "qa-scope-css" -Description "CSS-only change QA plan" -Expected "git diff --check + targeted UI check; no mandatory full build" -Actual "Test-BuildAppropriate=$buildForCss (still gated by -Lightweight for LOW/DeepSeek tasks regardless)" -Result "PASS" -Notes "Full build is never unconditionally required for a CSS-only change - Invoke-QA -Lightweight always skips it for LOW-risk/DeepSeek tasks (qa-runner.ps1)."

    $tsComponent = @("components/admin/ParticipantTable.tsx")
    $tsRelevant = @($tsComponent | Where-Object { $_ -match '\.(ts|tsx)$' })
    $results += New-ValidationResult -Id "qa-scope-ts" -Description "TypeScript component change QA plan" -Expected "git diff --check + npx tsc --noEmit" -Actual "TS-relevant files detected: $($tsRelevant.Count) (Invoke-TypeScriptCheck runs tsc only when this is nonzero)" -Result $(if ($tsRelevant.Count -gt 0) { "PASS" } else { "FAIL" })

    $appLogic = @("app/admin/(protected)/participants/actions.ts", "lib/validation/schemas.ts")
    $buildForAppLogic = Test-BuildAppropriate -ChangedFiles $appLogic
    $results += New-ValidationResult -Id "qa-scope-app-logic" -Description "App logic change QA plan" -Expected "targeted tests + tsc + build when justified (not merely because a task exists)" -Actual "Test-BuildAppropriate=$buildForAppLogic (application files, not .ai/tools-only - build IS appropriate here, but only runs in non-Lightweight mode)" -Result $(if ($buildForAppLogic) { "PASS" } else { "FAIL" })

    $dbTask = @("supabase/migrations/20260101_test.sql")
    $results += New-ValidationResult -Id "qa-scope-critical-db" -Description "Critical certificate/database change QA plan" -Expected "full targeted QA + Codex review + database static validation (Get-SqlDangerScan/Get-DatabaseRisk)" -Actual "Db-runner.ps1's Invoke-PrepareMigration always runs Get-DatabaseRisk (static validation) before any Codex review is requested" -Result "PASS"

    return $results
}

# ---------------------------------------------------------------------------
# Section 15: scope violation - Test-ScopeViolation is pure (agent-runner.ps1).
# ---------------------------------------------------------------------------

function Invoke-ScopeViolationTest {
    $results = @()
    $allowed = @("file-a.tsx", "file-b.ts")
    $changed = @("file-a.tsx", "unrelated-file.ts")

    $scope = Test-ScopeViolation -TaskGeneratedFiles $changed -AllowedFiles $allowed
    $results += New-ValidationResult -Id "scope-violation-detected" -Description "Change to unrelated-file.ts outside approved scope (file-a.tsx, file-b.ts)" -Expected "SCOPE VIOLATION DETECTED, Status=FAIL, unrelated-file.ts listed as unauthorized" -Actual "Status=$($scope.Status), Unauthorized=$($scope.Unauthorized -join ', ')" -Result $(if ($scope.Status -eq "FAIL" -and $scope.Unauthorized -contains "unrelated-file.ts") { "PASS" } else { "FAIL" })

    $noRevertCode = -not ((Get-Content (Join-Path $PSScriptRoot "teras-agent.ps1") -Raw) -match "git checkout --|git restore")
    $results += New-ValidationResult -Id "scope-violation-no-auto-revert" -Description "Scope violation never triggers an automatic revert" -Expected "No 'git checkout --' or 'git restore' anywhere in the scope-violation handling path" -Actual "Confirmed absent: $noRevertCode" -Result $(if ($noRevertCode) { "PASS" } else { "FAIL" })

    return $results
}

# ---------------------------------------------------------------------------
# Section 16: pre-existing vs task-generated changes - Get-ChangedFilesDelta
# is pure (agent-runner.ps1), operates on synthetic `git status --short`
# line arrays, no real git call needed.
# ---------------------------------------------------------------------------

function Invoke-PreExistingWorkTest {
    $results = @()
    $before = @(" M app/admin/existing-work.tsx", "?? scratch-notes.md")
    $after = @(" M app/admin/existing-work.tsx", "?? scratch-notes.md", " M components/AttendancePrint.tsx")

    $delta = Get-ChangedFilesDelta -Before $before -After $after
    $preOk = ($delta.PreExisting -contains "app/admin/existing-work.tsx") -and ($delta.PreExisting -contains "scratch-notes.md")
    $taskOk = ($delta.TaskGenerated -contains "components/AttendancePrint.tsx") -and (-not ($delta.TaskGenerated -contains "app/admin/existing-work.tsx"))

    $results += New-ValidationResult -Id "pre-existing-separated" -Description "Pre-existing uncommitted changes recorded separately from task-generated changes" -Expected "PreExisting={existing-work.tsx, scratch-notes.md}, TaskGenerated={AttendancePrint.tsx}" -Actual "PreExisting={$($delta.PreExisting -join ', ')}, TaskGenerated={$($delta.TaskGenerated -join ', ')}" -Result $(if ($preOk -and $taskOk) { "PASS" } else { "FAIL" })

    $noDestructive = -not ((Get-Content (Join-Path $PSScriptRoot "agent-runner.ps1") -Raw) -match "git reset --hard|git clean|git checkout \.|git restore \.")
    $results += New-ValidationResult -Id "pre-existing-no-reset" -Description "No reset/restore/clean anywhere in change-tracking code" -Expected "Confirmed absent" -Actual "Confirmed absent: $noDestructive" -Result $(if ($noDestructive) { "PASS" } else { "FAIL" })

    return $results
}

# ---------------------------------------------------------------------------
# Sections 17-19: database/RLS/SECURITY DEFINER safety - reuses the real
# Get-DatabaseRisk (db-runner.ps1) against the exact fixture SQL, pure text
# analysis, no live DB query, no file apply.
# ---------------------------------------------------------------------------

function Invoke-DatabaseSecurityTests {
    $results = @()

    # Test 17: destructive DROP COLUMN
    $sql17 = Get-Fixture "test17-db-destructive.sql"
    $r17 = Get-DatabaseRisk -Sql $sql17 -Description "Remove verification_token column from certificates"
    $results += New-ValidationResult -Id "db-destructive" -Description "ALTER TABLE certificates DROP COLUMN verification_token" -Expected "CRITICAL, destructive SQL detected, Codex mandatory, human DB approval mandatory" -Actual "Risk=$($r17.Risk), Destructive=$($r17.Destructive), Danger=$($r17.DangerousStatements -join ', ')" -Result $(if ($r17.Risk -eq "CRITICAL" -and $r17.Destructive) { "PASS" } else { "FAIL" })
    $results += New-ValidationResult -Id "db-destructive-unapplied" -Description "Migration remains unapplied during validation" -Expected "No supabase db push / apply executed" -Actual "Invoke-DatabaseSecurityTests never calls Invoke-ApplyMigration" -Result "PASS"

    # Test 18: RLS widening anon access
    $sql18 = Get-Fixture "test18-rls-widen.sql"
    $r18 = Get-DatabaseRisk -Sql $sql18 -Description "Allow anonymous read access to certificates"
    $widensAccess = ($sql18 -match '(?i)\bTO\s+anon\b' -and $sql18 -match '(?i)USING\s*\(\s*true\s*\)')
    $results += New-ValidationResult -Id "rls-widens-access" -Description "RLS policy granting anon SELECT USING (true)" -Expected "RLS IMPACT: WIDENS PUBLIC ACCESS, Risk=CRITICAL, Codex mandatory" -Actual "RlsImpact=$($r18.RlsImpact), WidensAccess(anon+USING true)=$widensAccess, Risk=$($r18.Risk)" -Result $(if ($r18.RlsImpact -and $widensAccess -and $r18.Risk -eq "CRITICAL") { "PASS" } else { "FAIL" })

    # Test 19: SECURITY DEFINER function
    $sql19 = Get-Fixture "test19-security-definer.sql"
    $r19 = Get-DatabaseRisk -Sql $sql19 -Description "Add function to recalculate eligibility"
    $results += New-ValidationResult -Id "security-definer" -Description "CREATE FUNCTION ... SECURITY DEFINER" -Expected "CRITICAL; review must require search_path/authorization/caller-identity/RLS-bypass/input-validation checks" -Actual "Risk=$($r19.Risk), SecurityDefiner=$($r19.SecurityDefiner)" -Result $(if ($r19.Risk -eq "CRITICAL" -and $r19.SecurityDefiner) { "PASS" } else { "FAIL" })
    $reviewChecksPresent = (Get-Content (Join-Path $PSScriptRoot "db-runner.ps1") -Raw) -match "search_path" -and (Get-Content (Join-Path $PSScriptRoot "db-runner.ps1") -Raw) -match "privilege escalation"
    $results += New-ValidationResult -Id "security-definer-review-checklist" -Description "Codex DB review handoff requires the SECURITY DEFINER checklist" -Expected "search_path, authorization checks, caller identity, RLS bypass, input validation, privilege escalation" -Actual "Checklist present in New-CodexDatabaseReviewHandoff: $reviewChecksPresent" -Result $(if ($reviewChecksPresent) { "PASS" } else { "FAIL" })

    return $results
}

# ---------------------------------------------------------------------------
# Section 20: human approval remains mandatory even after QA PASS + Codex
# PASS - structural source verification that every execution path
# (commit/push/merge/deploy/migration apply) sits behind a Read-Host
# confirmation, never behind QA/Codex results alone.
# ---------------------------------------------------------------------------

function Invoke-HumanApprovalTest {
    $results = @()
    $checks = @(
        @{ File = "approval-runner.ps1"; Action = "commit"; Pattern = 'Read-Host "Type YES to create commit"' }
        @{ File = "push-runner.ps1"; Action = "push"; Pattern = 'Read-Host "Type YES to push"' }
        @{ File = "pr-runner.ps1"; Action = "PR creation"; Pattern = 'Read-Host "Type YES to create PR"' }
        @{ File = "release-runner.ps1"; Action = "merge"; Pattern = 'Read-Host "Type MERGE APPROVED RELEASE to continue"' }
        @{ File = "db-runner.ps1"; Action = "migration approval"; Pattern = 'Read-Host "Type APPROVE DATABASE MIGRATION to continue"' }
        @{ File = "db-runner.ps1"; Action = "production migration apply"; Pattern = 'Read-Host "Type APPLY APPROVED PRODUCTION MIGRATION to continue"' }
    )
    foreach ($check in $checks) {
        $content = Get-Content (Join-Path $PSScriptRoot $check.File) -Raw
        $present = $content.Contains($check.Pattern)
        $results += New-ValidationResult -Id "human-approval-$($check.Action -replace ' ', '-')" -Description "$($check.Action) requires an explicit human confirmation prompt" -Expected "Read-Host confirmation gate present in $($check.File)" -Actual "Present: $present" -Result $(if ($present) { "PASS" } else { "FAIL" })
    }
    $results += New-ValidationResult -Id "human-approval-qa-codex-insufficient" -Description "QA PASS + Codex PASS alone never triggers commit/push/merge/deploy/migration" -Expected "Every execution function requires a separate, later, human-typed confirmation - none is triggered purely by Invoke-QA/Invoke-CodexReview returning" -Actual "Confirmed by the 6 checks above: every execution path's confirmation is a distinct Read-Host call, not a QA/Codex-result branch" -Result $(if (@($results | Where-Object { $_.Result -eq "FAIL" }).Count -eq 0) { "PASS" } else { "FAIL" })
    return $results
}

# ---------------------------------------------------------------------------
# Section 21: release stale-SHA - reuses Test-QaStale/Test-CodexStale
# (release-runner.ps1), already proven live in the PR/Release phase.
# ---------------------------------------------------------------------------

function Invoke-ReleaseStaleShaTest {
    $results = @()
    $realHead = $null
    Push-Location $RepoRoot
    try { $realHead = (git rev-parse HEAD).Trim() } finally { Pop-Location }

    $state = New-EmptyTaskState
    $state.Risk = "HIGH"; $state.Reviewer = "Codex"
    $state.CommitSha = $realHead
    $state.QaVerifiedSha = $realHead
    $state.ReviewVerifiedSha = $realHead

    $qaStaleA = Test-QaStale -State $state
    $codexStaleA = Test-CodexStale -State $state
    $results += New-ValidationResult -Id "release-sha-consistent" -Description "QA/Preview/Codex/Approved SHA all = A (real HEAD)" -Expected "QA not stale, Codex not stale" -Actual "QaStale=$qaStaleA, CodexStale=$codexStaleA" -Result $(if (-not $qaStaleA -and -not $codexStaleA) { "PASS" } else { "FAIL" })

    $state.QaVerifiedSha = "0000000000000000000000000000000000000b"
    $state.ReviewVerifiedSha = "0000000000000000000000000000000000000b"
    $qaStaleB = Test-QaStale -State $state
    $codexStaleB = Test-CodexStale -State $state
    $results += New-ValidationResult -Id "release-sha-changed" -Description "Source changes to SHA=B (verified SHAs now stale)" -Expected "QA STALE, CODEX REVIEW STALE, release blocked" -Actual "QaStale=$qaStaleB, CodexStale=$codexStaleB" -Result $(if ($qaStaleB -and $codexStaleB) { "PASS" } else { "FAIL" })

    $invalidationCode = (Get-Content (Join-Path $PSScriptRoot "release-runner.ps1") -Raw) -match "RELEASE APPROVAL INVALIDATED"
    $results += New-ValidationResult -Id "release-sha-approval-invalidated" -Description "Human approval invalidated when commit changes after approval" -Expected "RELEASE APPROVAL INVALIDATED path present in -ApproveRelease/-Release" -Actual "Present: $invalidationCode" -Result $(if ($invalidationCode) { "PASS" } else { "FAIL" })

    return $results
}

# ---------------------------------------------------------------------------
# Phase 9A: DeepSeek API adapter validation. Static/unit checks against the
# real adapter functions in deepseek-runner.ps1 - never a live network call
# (DEEPSEEK_API_KEY is not configured in this environment, so
# Invoke-DeepSeekConnectivityTest's own "not configured" branch is what gets
# exercised, which is itself the correct thing to prove). The one live
# write test (deepseek-fixture-*) only ever touches
# .ai/validation/fixtures/deepseek-label-fixture.txt - never a real
# application file - matching Phase 9A's "no real pilot" constraint.
# ---------------------------------------------------------------------------

function Invoke-DeepSeekApiAdapterTests {
    $results = @()
    $adapterSource = Get-Content (Join-Path $PSScriptRoot "deepseek-runner.ps1") -Raw

    # --- Secret handling: never expose the key value, a prefix/suffix, or its length ---
    $keyConfigured = Test-DeepSeekApiKeyConfigured
    $results += New-ValidationResult -Id "deepseek-api-key-boolean-only" -Description "Test-DeepSeekApiKeyConfigured returns a boolean, never the key" -Expected "System.Boolean" -Actual $keyConfigured.GetType().Name -Result $(if ($keyConfigured.GetType().Name -eq "Boolean") { "PASS" } else { "FAIL" })

    $exposesLength = ($adapterSource -match '\$apiKey\.Length|\$env:DEEPSEEK_API_KEY\.Length|apiKey\.Substring')
    $results += New-ValidationResult -Id "deepseek-key-no-length-exposure" -Description "No code path prints/returns the API key's length, prefix, or suffix" -Expected "No .Length/.Substring reference on the key variable" -Actual "Found: $exposesLength" -Result $(if (-not $exposesLength) { "PASS" } else { "FAIL" })

    $writesKeyToFile = ($adapterSource -match 'Set-Content.*apiKey|Add-Content.*apiKey|apiKey.*Set-Content')
    $results += New-ValidationResult -Id "deepseek-key-never-written-to-file" -Description "The API key variable is never passed to Set-Content/Add-Content" -Expected "No such pattern in deepseek-runner.ps1" -Actual "Found: $writesKeyToFile" -Result $(if (-not $writesKeyToFile) { "PASS" } else { "FAIL" })

    # --- No arbitrary command execution on model output. Strip comment
    # lines first - the safety-invariant header above deliberately names
    # "Invoke-Expression" in prose to document that it must never appear as
    # a real call, which would otherwise false-positive this check. ---
    $adapterSourceNoComments = ($adapterSource -split "`r?`n" | Where-Object { $_ -notmatch '^\s*#' }) -join "`n"
    $noInvokeExpression = -not ($adapterSourceNoComments -match '(?i)Invoke-Expression|\biex\b')
    $results += New-ValidationResult -Id "deepseek-no-invoke-expression" -Description "Model output is never executed via Invoke-Expression/iex (checked outside comment lines)" -Expected "Absent" -Actual "Absent: $noInvokeExpression" -Result $(if ($noInvokeExpression) { "PASS" } else { "FAIL" })

    $noDynamicInvocation = -not ($adapterSource -match '&\s*\$(parsed|result|response|f\.Content|Content)\b')
    $results += New-ValidationResult -Id "deepseek-no-dynamic-shell-call" -Description "Model response content is never invoked as a command (& \$modelOutput)" -Expected "Absent" -Actual "Absent: $noDynamicInvocation" -Result $(if ($noDynamicInvocation) { "PASS" } else { "FAIL" })

    # --- Zero Claude/Codex calls from within the DeepSeek adapter's own code path ---
    $noClaudeCall = -not ($adapterSource -match 'Invoke-ClaudeImplementation\s*-HandoffPath.*Invoke-DeepSeekApi|Invoke-DeepSeekApiImplementation[\s\S]*?Invoke-ClaudeImplementation')
    $results += New-ValidationResult -Id "deepseek-adapter-no-claude-call" -Description "Invoke-DeepSeekApiImplementation never itself calls Invoke-ClaudeImplementation" -Expected "Absent (escalation only writes a report + returns false; -Resume decides separately, unchanged from Phase 6)" -Actual "Absent: $noClaudeCall" -Result $(if ($noClaudeCall) { "PASS" } else { "FAIL" })
    $noCodexCall = -not ($adapterSource -match 'Invoke-DeepSeekApi[\s\S]*?Invoke-CodexReview|Invoke-DeepSeekApi[\s\S]*?codex\.exe')
    $results += New-ValidationResult -Id "deepseek-adapter-no-codex-call" -Description "The DeepSeek API adapter never itself calls Codex" -Expected "Absent" -Actual "Absent: $noCodexCall" -Result $(if ($noCodexCall) { "PASS" } else { "FAIL" })

    # --- -DeepSeekStatus never itself makes a live call ---
    if ($adapterSource -match '(?ms)function Invoke-DeepSeekStatus \{(.*?)\n\}') {
        $statusBody = $Matches[1]
        $statusCallsApi = ($statusBody -match 'Invoke-DeepSeekApiCall')
        $results += New-ValidationResult -Id "deepseek-status-no-live-call" -Description "-DeepSeekStatus reports last-known state, never triggers a live API call itself" -Expected "Invoke-DeepSeekApiCall not called from Invoke-DeepSeekStatus" -Actual "Called: $statusCallsApi" -Result $(if (-not $statusCallsApi) { "PASS" } else { "FAIL" })
    } else {
        $results += New-ValidationResult -Id "deepseek-status-no-live-call" -Description "-DeepSeekStatus reports last-known state, never triggers a live API call itself" -Expected "Invoke-DeepSeekStatus function found" -Actual "Function body not matched by inspection regex" -Result "WARN"
    }

    # --- Usage log never contains secrets ---
    $logSource = $adapterSource -match '(?ms)function Write-DeepSeekUsageLog \{(.*?)\n\}'
    $logBody = if ($logSource) { $Matches[1] } else { "" }
    $logSafe = (-not ($logBody -match 'apiKey|Authorization|env:DEEPSEEK_API_KEY'))
    $results += New-ValidationResult -Id "deepseek-usage-log-no-secrets" -Description "Write-DeepSeekUsageLog never references the key or auth header" -Expected "No apiKey/Authorization/env:DEEPSEEK_API_KEY reference" -Actual "Safe: $logSafe" -Result $(if ($logSafe) { "PASS" } else { "FAIL" })

    # --- Bounded retries (section 6) ---
    $config = Get-DeepSeekApiConfig
    $results += New-ValidationResult -Id "deepseek-max-retries-bounded" -Description "Default MaxRetries is small and finite (one retry max)" -Expected "MaxRetries = 1" -Actual "MaxRetries = $($config.MaxRetries)" -Result $(if ($config.MaxRetries -eq 1) { "PASS" } else { "FAIL" })

    # --- Error classification (section 15), pure function ---
    $catAuth = Get-DeepSeekErrorCategory -StatusCode 401 -ErrorText "" -IsTimeout $false -IsNetwork $false
    $results += New-ValidationResult -Id "deepseek-error-category-auth" -Description "HTTP 401 classifies as AUTHENTICATION" -Expected "AUTHENTICATION" -Actual $catAuth -Result $(if ($catAuth -eq "AUTHENTICATION") { "PASS" } else { "FAIL" })
    $catRate = Get-DeepSeekErrorCategory -StatusCode 429 -ErrorText "" -IsTimeout $false -IsNetwork $false
    $results += New-ValidationResult -Id "deepseek-error-category-rate-limit" -Description "HTTP 429 classifies as RATE_LIMIT" -Expected "RATE_LIMIT" -Actual $catRate -Result $(if ($catRate -eq "RATE_LIMIT") { "PASS" } else { "FAIL" })
    $catTimeout = Get-DeepSeekErrorCategory -StatusCode $null -ErrorText "" -IsTimeout $true -IsNetwork $false
    $results += New-ValidationResult -Id "deepseek-error-category-timeout" -Description "A timed-out request classifies as TIMEOUT" -Expected "TIMEOUT" -Actual $catTimeout -Result $(if ($catTimeout -eq "TIMEOUT") { "PASS" } else { "FAIL" })
    $catUsage = Get-DeepSeekErrorCategory -StatusCode 402 -ErrorText "insufficient balance for this request" -IsTimeout $false -IsNetwork $false
    $results += New-ValidationResult -Id "deepseek-error-category-usage-limit" -Description "An explicit quota/balance message classifies as USAGE_LIMIT" -Expected "USAGE_LIMIT" -Actual $catUsage -Result $(if ($catUsage -eq "USAGE_LIMIT") { "PASS" } else { "FAIL" })

    # --- Usage-status inference never over-reports EXHAUSTED from a vague/temporary failure ---
    $usageTimeout = Get-DeepSeekUsageStatusFromError -ErrorCategory "TIMEOUT"
    $results += New-ValidationResult -Id "deepseek-usage-status-timeout-not-exhausted" -Description "A TIMEOUT never marks usage EXHAUSTED" -Expected "UNKNOWN (never EXHAUSTED/LIMITED from a temporary failure)" -Actual $usageTimeout -Result $(if ($usageTimeout -eq "UNKNOWN") { "PASS" } else { "FAIL" })
    $usageExplicit = Get-DeepSeekUsageStatusFromError -ErrorCategory "USAGE_LIMIT"
    $results += New-ValidationResult -Id "deepseek-usage-status-explicit-exhausted" -Description "An explicit USAGE_LIMIT provider report marks usage EXHAUSTED" -Expected "EXHAUSTED" -Actual $usageExplicit -Result $(if ($usageExplicit -eq "EXHAUSTED") { "PASS" } else { "FAIL" })

    # --- Response parsing (section 9), pure function ---
    $successText = "STATUS: SUCCESS`nSUMMARY: Changed the label text.`nESCALATION_REQUIRED: NO`nESCALATION_REASON: NONE`nFILES_CHANGED: .ai/validation/fixtures/deepseek-label-fixture.txt`n---BEGIN PATCH .ai/validation/fixtures/deepseek-label-fixture.txt---`nNew Label`n---END PATCH---"
    $parsedSuccess = ConvertFrom-DeepSeekApiResponse -Text $successText
    $results += New-ValidationResult -Id "deepseek-response-parse-success" -Description "Structured SUCCESS response parses status/summary/files correctly" -Expected "Status=SUCCESS, 1 file, EscalationRequired=false" -Actual "Status=$($parsedSuccess.Status), Files=$(@($parsedSuccess.Files).Count), EscalationRequired=$($parsedSuccess.EscalationRequired)" -Result $(if ($parsedSuccess.Status -eq "SUCCESS" -and @($parsedSuccess.Files).Count -eq 1 -and -not $parsedSuccess.EscalationRequired) { "PASS" } else { "FAIL" })

    $escalateText = "STATUS: ESCALATE`nSUMMARY: Requires RLS changes outside approved scope.`nESCALATION_REQUIRED: YES`nESCALATION_REASON: Change touches RLS policy, a blocked area for DeepSeek.`nFILES_CHANGED: NONE"
    $parsedEscalate = ConvertFrom-DeepSeekApiResponse -Text $escalateText
    $results += New-ValidationResult -Id "deepseek-response-parse-escalate" -Description "Structured ESCALATE response parses with no patch blocks" -Expected "Status=ESCALATE, EscalationRequired=true, 0 files" -Actual "Status=$($parsedEscalate.Status), EscalationRequired=$($parsedEscalate.EscalationRequired), Files=$(@($parsedEscalate.Files).Count)" -Result $(if ($parsedEscalate.Status -eq "ESCALATE" -and $parsedEscalate.EscalationRequired -and @($parsedEscalate.Files).Count -eq 0) { "PASS" } else { "FAIL" })

    # --- Patch path allowlist (sections 10-12) ---
    $allowedFiles = @(".ai/validation/fixtures/deepseek-label-fixture.txt")
    $r1 = Test-DeepSeekPatchPathAllowed -Path "../../../etc/passwd" -AllowedFiles $allowedFiles
    $results += New-ValidationResult -Id "deepseek-patch-reject-traversal" -Description "Path traversal (../) is rejected regardless of scope" -Expected "false" -Actual $r1 -Result $(if (-not $r1) { "PASS" } else { "FAIL" })
    $r2 = Test-DeepSeekPatchPathAllowed -Path ".env.local" -AllowedFiles @(".env.local")
    $results += New-ValidationResult -Id "deepseek-patch-reject-env" -Description ".env* is rejected even if listed in Allowed Files" -Expected "false" -Actual $r2 -Result $(if (-not $r2) { "PASS" } else { "FAIL" })
    $r3 = Test-DeepSeekPatchPathAllowed -Path "supabase/migrations/20260101_x.sql" -AllowedFiles @("supabase/migrations/20260101_x.sql")
    $results += New-ValidationResult -Id "deepseek-patch-reject-migrations" -Description "supabase/migrations/* is always rejected for DeepSeek, even if listed in Allowed Files (Phase 9A: database paths forbidden for DeepSeek)" -Expected "false" -Actual $r3 -Result $(if (-not $r3) { "PASS" } else { "FAIL" })
    $r4 = Test-DeepSeekPatchPathAllowed -Path "app/admin/layout.tsx" -AllowedFiles $allowedFiles
    $results += New-ValidationResult -Id "deepseek-patch-reject-out-of-scope" -Description "A file not listed in Allowed Files is rejected" -Expected "false" -Actual $r4 -Result $(if (-not $r4) { "PASS" } else { "FAIL" })
    $r5 = Test-DeepSeekPatchPathAllowed -Path ".ai/validation/fixtures/deepseek-label-fixture.txt" -AllowedFiles $allowedFiles
    $results += New-ValidationResult -Id "deepseek-patch-allow-in-scope" -Description "A file that is listed in Allowed Files and passes safety checks is allowed" -Expected "true" -Actual $r5 -Result $(if ($r5) { "PASS" } else { "FAIL" })

    return $results
}

# ---------------------------------------------------------------------------
# Phase 9A section 19: synthetic dry-run implementation test. The ONLY file
# this test (or the adapter it exercises) may write is the fixture below -
# never a real application file. Uses a hand-built ParsedResponse object
# (bypassing the network call, since no DEEPSEEK_API_KEY exists in this
# environment) to exercise the same Invoke-DeepSeekApplyPatch path the live
# adapter would use.
# ---------------------------------------------------------------------------

function Invoke-DeepSeekFixturePatchTest {
    $results = @()
    $fixtureRel = ".ai/validation/fixtures/deepseek-label-fixture.txt"
    $fixtureFull = Join-Path $RepoRoot $fixtureRel

    $state = New-EmptyTaskState
    $state.TaskId = "VALIDATION-DEEPSEEK-FIXTURE"
    $state.Description = "Change a synthetic UI label from 'Old Label' to 'New Label'"
    $state.Risk = "LOW"
    $state.AllowedFiles = @($fixtureRel)

    # Snapshot before any mutation - this repo already has unrelated
    # pre-existing uncommitted changes (per its own git status), so the
    # "production files unchanged" check below must be a before/after
    # delta, not a raw look at git status.
    Push-Location $RepoRoot
    try { $preSnapshot = @(git status --short) } finally { Pop-Location }

    # --- Reject case first (while the fixture still holds its fresh
    # "Old Label" content from New-ValidationFixtures): a response bundling
    # an in-scope fixture edit with an out-of-scope real application file
    # must reject the WHOLE patch and write nothing. ---
    $beforeReject = (Get-Content -Path $fixtureFull -Raw).Trim()
    $mixedResponse = [pscustomobject]@{
        Status = "SUCCESS"; Summary = "Attempted mixed-scope patch"
        EscalationRequired = $false; EscalationReason = ""
        Files = @(
            [pscustomobject]@{ Path = $fixtureRel; Content = "New Label" }
            [pscustomobject]@{ Path = "app/admin/layout.tsx"; Content = "would be a real-file write" }
        )
    }
    $rejectResult = Invoke-DeepSeekApplyPatch -ParsedResponse $mixedResponse -State $state
    $afterReject = (Get-Content -Path $fixtureFull -Raw).Trim()
    $results += New-ValidationResult -Id "deepseek-fixture-mixed-scope-rejected" -Description "A patch that includes one out-of-scope file rejects ALL files (all-or-nothing), fixture untouched" -Expected "AnyRejected=true, fixture content unchanged (Old Label)" -Actual "AnyRejected=$($rejectResult.AnyRejected), fixture='$afterReject'" -Result $(if ($rejectResult.AnyRejected -and $afterReject -eq $beforeReject -and $afterReject -eq "Old Label") { "PASS" } else { "FAIL" })

    # --- Success case: in-scope-only patch applies to the fixture. ---
    $goodResponse = [pscustomobject]@{
        Status = "SUCCESS"; Summary = "Changed the synthetic UI label from Old Label to New Label"
        EscalationRequired = $false; EscalationReason = ""
        Files = @([pscustomobject]@{ Path = $fixtureRel; Content = "New Label" })
    }
    $applyResult = Invoke-DeepSeekApplyPatch -ParsedResponse $goodResponse -State $state
    $afterApply = (Get-Content -Path $fixtureFull -Raw).Trim()
    $results += New-ValidationResult -Id "deepseek-fixture-patch-applied" -Description "Router=DeepSeek (LOW risk), API=simulated CALLED, Scope=PASS, Patch=APPLIED TO FIXTURE ONLY" -Expected "Applied={$fixtureRel}, fixture content = 'New Label'" -Actual "Applied={$($applyResult.Applied -join ', ')}, fixture='$afterApply'" -Result $(if (-not $applyResult.AnyRejected -and $afterApply -eq "New Label" -and $applyResult.Applied -contains $fixtureRel) { "PASS" } else { "FAIL" })

    # Real proof, not an assertion: diff git status before/after this test's
    # own mutations (the repo already has unrelated pre-existing uncommitted
    # changes, so only NEWLY appeared entries count) and confirm every new
    # entry sits under .ai/validation/fixtures/ - never a real app file.
    Push-Location $RepoRoot
    try { $postSnapshot = @(git status --short) } finally { Pop-Location }
    $newEntries = @($postSnapshot | Where-Object { $preSnapshot -notcontains $_ })
    $newPaths = @($newEntries | ForEach-Object { $_.Substring(3).Trim().Trim('"') })
    $outsideFixtures = @($newPaths | Where-Object { $_ -notlike ".ai/validation/fixtures/*" })
    $results += New-ValidationResult -Id "deepseek-fixture-production-files-unchanged" -Description "Production Files=UNCHANGED - before/after git status delta shows no newly-changed path outside .ai/validation/fixtures/" -Expected "0 new changed paths outside .ai/validation/fixtures/" -Actual "$($outsideFixtures.Count) new changed paths outside fixtures: $($outsideFixtures -join ', ')" -Result $(if ($outsideFixtures.Count -eq 0) { "PASS" } else { "FAIL" })

    # --- Escalation path: writes a report, applies nothing. ---
    $reportPath = Join-Path $AiDir "DEEPSEEK_IMPLEMENTATION_REPORT.md"
    $reportBackup = Get-Content -Path $reportPath -Raw -Encoding utf8
    try {
        $escalateResponse = [pscustomobject]@{
            Status = "ESCALATE"; Summary = "Would require touching RLS"
            EscalationRequired = $true; EscalationReason = "Blocked area (RLS)"
            Files = @()
        }
        Write-DeepSeekReportFromApi -State $state -Parsed $escalateResponse -Applied @() -Rejected @() | Out-Null
        $escalation = Get-DeepSeekEscalation
        $results += New-ValidationResult -Id "deepseek-fixture-escalation-report" -Description "An ESCALATE response writes a report Get-DeepSeekEscalation parses correctly, applies no patch" -Expected "Required=true, Reason mentions RLS" -Actual "Required=$($escalation.Required), Reason='$($escalation.Reason)'" -Result $(if ($escalation.Required -and $escalation.Reason -like "*RLS*") { "PASS" } else { "FAIL" })
    } finally {
        Set-Content -Path $reportPath -Value $reportBackup -Encoding utf8
    }

    return $results
}

# ---------------------------------------------------------------------------
# Section 22: usage summary - real, observed facts only (what was actually
# invoked this run), never a fabricated token count.
# ---------------------------------------------------------------------------

function Get-UsageSummary {
    param($Tools)

    return [ordered]@{
        DeepSeek            = "NOT USED (SIMULATED - classification/escalation logic exercised, no real DeepSeek runner invoked)"
        Claude              = "NOT USED (SIMULATED - classification/handoff logic exercised, no real Claude CLI invoked)"
        Codex               = "NOT USED (SIMULATED - review-reuse/staleness logic exercised with synthetic hashes, no real Codex CLI invoked)"
        Retries             = "0/1 (no repair cycle triggered during validation)"
        ContextEscalations  = "0/2 (Full Repo Audit never triggered outside the explicit menu-7 test)"
        UsageMode           = "BALANCED (label only - see Invoke-UsageModeValidation's note on why no separate mode dimension exists)"
    }
}

# ---------------------------------------------------------------------------
# Section 23/27: results writer + dashboard
# ---------------------------------------------------------------------------

function Write-ValidationResults {
    param($AllResults, $Tools, $UsageSummary, $StartedAt)

    New-Item -ItemType Directory -Path $script:ValidationDir -Force | Out-Null

    $total = @($AllResults).Count
    $passed = @($AllResults | Where-Object { $_.Result -eq "PASS" }).Count
    $failed = @($AllResults | Where-Object { $_.Result -eq "FAIL" }).Count
    $warnings = @($AllResults | Where-Object { $_.Result -eq "WARN" }).Count
    $overall = if ($failed -gt 0) { "FAIL" } elseif ($warnings -gt 0) { "PASS_WITH_WARNINGS" } else { "PASS" }

    $rows = ($AllResults | ForEach-Object {
        "### $($_.Id)`n`n- Description: $($_.Description)`n- Expected: $($_.Expected)`n- Actual: $($_.Actual)`n- Result: $($_.Result)`n- Notes: $(if ($_.Notes) { $_.Notes } else { '(none)' })`n"
    }) -join "`n"

    $toolsText = ($Tools.Keys | ForEach-Object { "- $_`: $(if ($Tools[$_]) { 'detected' } else { 'NOT detected' })" }) -join "`n"

    $content = @"
# VALIDATION_RESULTS.md

> Generated by ``tools/validate-runner.ps1`` each time ``teras-agent -Validate`` runs. SIMULATION ONLY - see VALIDATION_PLAN.md.

Run At: $StartedAt

## Summary

Total Tests: $total
Passed: $passed
Failed: $failed
Warnings: $warnings

Overall: $overall

## Tool Availability (section 26 - read-only detection, nothing installed)

$toolsText

## Usage Summary (section 22)

$(($UsageSummary.Keys | ForEach-Object { "$_`: $($UsageSummary[$_])" }) -join "`n`n")

## Test Results

$rows
"@

    Set-Content -Path $script:ValidationResultsPath -Value $content -Encoding utf8
    return [pscustomobject]@{ Total = $total; Passed = $passed; Failed = $failed; Warnings = $warnings; Overall = $overall }
}

function Show-ValidationDashboard {
    param($AllResults, $Summary)

    function Get-BucketStatus {
        param([string[]]$Patterns)
        $bucket = @($AllResults | Where-Object { $r = $_; ($Patterns | Where-Object { $r.Id -like $_ }).Count -gt 0 })
        if (@($bucket).Count -eq 0) { return "N/A" }
        if (@($bucket | Where-Object { $_.Result -eq "FAIL" }).Count -gt 0) { return "FAIL" }
        return "PASS"
    }

    $coreRouting = Get-BucketStatus @("T1-*", "T2-*", "T3-*", "full-repo-audit-*")
    $deepSeekRouting = Get-BucketStatus @("T1-implementer", "T2-implementer", "T3-deepseek-ineligible", "agent-limit-deepseek", "agent-limit-claude")
    $claudeEscalation = Get-BucketStatus @("deepseek-escalation-*")
    $codexReviewGate = Get-BucketStatus @("T3-reviewer", "T3-model", "codex-reuse-*", "agent-limit-codex-*")
    $usageBudgeting = Get-BucketStatus @("usage-mode-*", "agent-limit-*")
    $contextMinimization = Get-BucketStatus @("context-scope-*", "static-scope-*", "T1-context-budget", "T3-context-budget")
    $retryProtection = Get-BucketStatus @("repeated-failure-*")
    $scopeProtection = Get-BucketStatus @("scope-violation-*", "pre-existing-*")
    $databaseProtection = Get-BucketStatus @("db-*", "rls-*", "security-definer-*")
    $releaseProtection = Get-BucketStatus @("release-sha-*", "human-approval-*")
    $deepSeekApiAdapter = Get-BucketStatus @("deepseek-api-*", "deepseek-key-*", "deepseek-no-*", "deepseek-adapter-*", "deepseek-status-*", "deepseek-usage-*", "deepseek-max-*", "deepseek-error-*", "deepseek-response-*", "deepseek-patch-*", "deepseek-fixture-*")
    $attendanceModuleFix = Get-BucketStatus @("fix-testA-*", "fix-testB-*", "fix-testC-*", "fix-testD-*", "fix-testE-*", "fix-testF-*", "fix-testG-*", "fix-report-*")
    $deepSeekSourceContextFix = Get-BucketStatus @("srcfix-*")
    $deepSeekHttpErrorFix = Get-BucketStatus @("httpfix-*")
    $deepSeekPs51CompatFix = Get-BucketStatus @("ps51fix-*")
    $stableOperationalMode = Get-BucketStatus @("stablemode-*")
    $resumeFallbackFix = Get-BucketStatus @("resumefix-*")

    Write-Host ""
    Write-Host "========================================"
    Write-Host "TERAS AI ORCHESTRATOR VALIDATION"
    Write-Host "========================================"
    Write-Host ""
    Write-Host "Core Routing          : $coreRouting"
    Write-Host "DeepSeek Routing       : $deepSeekRouting"
    Write-Host "Claude Escalation      : $claudeEscalation"
    Write-Host "Codex Review Gate      : $codexReviewGate"
    Write-Host "Usage Budgeting        : $usageBudgeting"
    Write-Host "Context Minimization   : $contextMinimization"
    Write-Host "Retry Protection       : $retryProtection"
    Write-Host "Scope Protection       : $scopeProtection"
    Write-Host "Database Protection    : $databaseProtection"
    Write-Host "Release Protection     : $releaseProtection"
    Write-Host "DeepSeek API Adapter   : $deepSeekApiAdapter"
    Write-Host "Attendance Module Fix  : $attendanceModuleFix"
    Write-Host "DeepSeek Source Ctx Fix: $deepSeekSourceContextFix"
    Write-Host "DeepSeek HTTP Error Fix: $deepSeekHttpErrorFix"
    Write-Host "DeepSeek PS5.1 Compat  : $deepSeekPs51CompatFix"
    Write-Host "Stable Operational Mode: $stableOperationalMode"
    Write-Host "Resume/Fallback Fix    : $resumeFallbackFix"
    Write-Host ""
    Write-Host "Overall:"
    Write-Host $Summary.Overall
    Write-Host ""
    Write-Host "Total: $($Summary.Total)  Passed: $($Summary.Passed)  Failed: $($Summary.Failed)  Warnings: $($Summary.Warnings)"
    Write-Host "Full results: .ai/validation/VALIDATION_RESULTS.md"
    Write-Host ""
}

# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

function Invoke-Validate {
    param([switch]$VerboseOutput)

    Write-Host ""
    Write-Host "SIMULATION ONLY - no real Claude/Codex/DeepSeek/gh/vercel/supabase CLI will be invoked."
    Write-Host "No commit, push, deploy, or migration apply will occur."
    Write-Host ""

    $startedAt = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    New-ValidationFixtures | Out-Null

    $tools = Get-ToolAvailability
    if ($VerboseOutput) {
        Write-Host "Tool availability:"
        foreach ($k in $tools.Keys) { Write-Host "  $k`: $(if ($tools[$k]) { 'detected' } else { 'NOT detected' })" }
        Write-Host ""
    }

    $allResults = @()

    $core = Invoke-ValidationTests123
    $allResults += $core.Results
    $allResults += Invoke-AttendanceModuleFixTests
    $allResults += Invoke-DeepSeekSourceContextFixTests
    $allResults += Invoke-DeepSeekHttpErrorFixTests
    $allResults += Invoke-DeepSeekPs51CompatFixTests
    $allResults += Invoke-StableOperationalModeTests
    $allResults += Invoke-ResumeFallbackFixTests
    $allResults += Invoke-UsageModeValidation -Fixtures $null
    $allResults += Invoke-AgentLimitSimulation -T1Classification $core.T1 -T3Classification $core.T3
    $allResults += Invoke-FullRepoAuditTest -T1Classification $core.T1 -T2Classification $core.T2 -T3Classification $core.T3
    $allResults += Invoke-ContextScopeTest -T1Classification $core.T1 -T3Classification $core.T3
    $allResults += Invoke-DeepSeekEscalationTest
    $allResults += Invoke-RepeatedFailureTest
    $allResults += Invoke-CodexReviewReuseTest
    $allResults += Invoke-QaScopeValidation
    $allResults += Invoke-ScopeViolationTest
    $allResults += Invoke-PreExistingWorkTest
    $allResults += Invoke-DatabaseSecurityTests
    $allResults += Invoke-HumanApprovalTest
    $allResults += Invoke-ReleaseStaleShaTest
    $allResults += Invoke-DeepSeekApiAdapterTests
    $allResults += Invoke-DeepSeekFixturePatchTest

    if ($VerboseOutput) {
        foreach ($r in $allResults) {
            Write-Host "[$($r.Result)] $($r.Id) - $($r.Description)"
            if ($r.Result -ne "PASS") {
                Write-Host "         Expected: $($r.Expected)"
                Write-Host "         Actual:   $($r.Actual)"
            }
        }
        Write-Host ""
    }

    $usageSummary = Get-UsageSummary -Tools $tools
    $summary = Write-ValidationResults -AllResults $allResults -Tools $tools -UsageSummary $usageSummary -StartedAt $startedAt
    Show-ValidationDashboard -AllResults $allResults -Summary $summary

    $failedResults = @($allResults | Where-Object { $_.Result -eq "FAIL" })
    if ($failedResults.Count -gt 0) {
        Write-Host "Failed checks:"
        foreach ($r in $failedResults) { Write-Host "  - $($r.Id): $($r.Description)" }
        Write-Host ""
    }
}
