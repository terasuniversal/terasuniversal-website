$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$aiDir = Join-Path $repoRoot ".ai"
. (Join-Path $PSScriptRoot "agent-runner.ps1")

function Assert-Equal {
    param($Actual, $Expected, [string]$Name)
    if ($Actual -ne $Expected) {
        throw "$Name failed. Expected '$Expected', got '$Actual'."
    }
}

Assert-Equal (Get-ClaudeRepairDecision -Verdict "PASS" -AttemptsUsed 0) "NO_REPAIR" "PASS does not repair"
Assert-Equal (Get-ClaudeRepairDecision -Verdict "PASS_WITH_NOTES" -AttemptsUsed 0) "NO_REPAIR" "PASS_WITH_NOTES does not repair"
Assert-Equal (Get-ClaudeRepairDecision -Verdict "CHANGES_REQUIRED" -AttemptsUsed 0) "REPAIR" "CHANGES_REQUIRED repairs"
Assert-Equal (Get-ClaudeRepairDecision -Verdict "CHANGES_REQUIRED" -AttemptsUsed 1) "REPAIR" "second bounded repair is allowed"
Assert-Equal (Get-ClaudeRepairDecision -Verdict "CHANGES_REQUIRED" -AttemptsUsed 2) "NEEDS_HUMAN_REVIEW" "maximum attempts stop"

$standard = Test-RepairMigrationGate -State ([pscustomobject]@{ DbRequired = $false; AllowedFiles = @("work/test.md") })
Assert-Equal $standard.Mode "STANDARD" "standard repair gate"

$migration = Test-RepairMigrationGate -State ([pscustomobject]@{ DbRequired = $true; AllowedFiles = @("supabase/migrations/test.sql") })
Assert-Equal $migration.Mode "EDIT_ONLY_NO_APPLY" "migration repair gate"

# Synthetic end-to-end state-machine test: Claude first requires changes,
# one Codex repair runs, and the next Claude review passes. CLI processes are
# intentionally mocked so this test is deterministic and cannot touch files.
$nullErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot "teras-agent.ps1"), [ref]$null, [ref]$nullErrors)
$loopAst = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq "Invoke-ClaudeRepairLoop" }, $true)
. ([scriptblock]::Create($loopAst.Extent.Text))
$script:reviewCalls = 0
$script:repairCalls = 0
function Save-TaskState { param($State) }
function Get-GitStatusSnapshot { return @() }
function Get-ImplementationDelta { return [pscustomobject]@{ PreExisting = @(); TaskGenerated = @("work/synthetic-repair-test.md") } }
function Test-ScopeViolation { return [pscustomobject]@{ Status = "PASS"; Unauthorized = @() } }
function New-CodexRepairHandoff { return "synthetic-repair-handoff.md" }
function Invoke-CodexImplementation { $script:repairCalls++; return $true }
function Invoke-ClaudeReadOnlyReview {
    $script:reviewCalls++
    if ($script:reviewCalls -eq 1) { return [pscustomobject]@{ Succeeded = $true; Verdict = "CHANGES_REQUIRED"; Output = "Synthetic finding" } }
    return [pscustomobject]@{ Succeeded = $true; Verdict = "PASS"; Output = "Synthetic pass" }
}
$syntheticState = [pscustomobject]@{
    RepairCyclesUsed = 0
    ReviewVerdict = "PENDING"
    State = "IMPLEMENTING"
    PendingAgentStep = $null
    PendingRepairHandoff = $null
    MigrationRepairGate = $null
    PreExistingFiles = @()
    TaskGeneratedFiles = @("work/synthetic-repair-test.md")
    ScopeCheck = "PASS"
    AllowedFiles = @("work/synthetic-repair-test.md")
    DbRequired = $false
    TaskId = "SYNTHETIC-REPAIR"
    Description = "Synthetic bounded repair test"
    Category = "Adapter Verification"
    Risk = "LOW"
}
$synthetic = Invoke-ClaudeRepairLoop -State $syntheticState -PreSnapshot @() -TaskGeneratedFiles @("work/synthetic-repair-test.md")
if (-not $synthetic.Completed -or $script:reviewCalls -ne 2 -or $script:repairCalls -ne 1 -or $synthetic.State.ReviewVerdict -ne "PASS") {
    throw "Synthetic CHANGES_REQUIRED -> Codex repair -> PASS flow failed."
}

$runnerSource = Get-Content (Join-Path $PSScriptRoot "agent-runner.ps1") -Raw
$pipelineSource = Get-Content (Join-Path $PSScriptRoot "teras-agent.ps1") -Raw
if ($runnerSource -notmatch "New-CodexRepairHandoff" -or $runnerSource -notmatch "Do not commit, push, merge, deploy, or apply a migration") { throw "Repair handoff governance assertions failed." }
if ($pipelineSource -notmatch "Invoke-ClaudeRepairLoop" -or $pipelineSource -notmatch "PENDING_CLAUDE_REVIEW" -or $pipelineSource -notmatch "PENDING_CODEX_REPAIR" -or $pipelineSource -notmatch "\$maximumAttempts = 2") { throw "Repair loop control assertions failed." }
if ($pipelineSource -notmatch 'State\.Implementer -ne "Codex"') { throw "Legacy review loop guard assertion failed." }

Write-Output "Repair loop static tests: PASS"
