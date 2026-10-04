$ErrorActionPreference = "Stop"

<#
    Bootstrap/task-control-foundation-formalization: minimal targeted tests
    for the task-control foundation only (CreateTask workflow, task-state
    schema, default-deny bounded DB permission fields, and supersede/
    history reconciliation). Deliberately does NOT test runtime enforcement,
    integrity-bound approval proof, reparse-point defense, or exact
    migration-allowlist execution gating - those belong to the follow-on
    hardening task and have no implementation here to test.
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
$testRoot = Join-Path $testScratch ("teras-task-control-foundation-" + [Guid]::NewGuid().ToString("N"))

try {
    $script:RepoRoot = $testRoot
    $script:AiDir = Join-Path $testRoot ".ai"
    $script:CurrentTaskPath = Join-Path $script:AiDir "CURRENT_TASK.md"
    $script:TaskStatePath = Join-Path $script:AiDir "task-state.json"
    New-Item -ItemType Directory -Path $script:AiDir -Force | Out-Null

    . (Join-Path $PSScriptRoot "agent-router.ps1")

    # --- Default-deny schema: every bounded field starts false/0/empty ---
    $empty = New-EmptyTaskState
    foreach ($name in @(
        "LocalDisposableDatabaseAllowed", "LocalMigrationValidationAllowed", "StopOnFirstFailure",
        "RemoteDbAllowed", "StagingAllowed", "ProductionAllowed", "PublishedPortsAllowed",
        "PersistentDbVolumeAllowed", "SyntheticDataOnly", "SourceEditAllowedDuringRuntime",
        "PushAllowed", "MergeAllowed", "DeployAllowed"
    )) {
        Assert-True (-not $empty.$name) "New task must default-deny $name."
    }
    Assert-Equal $empty.DockerIterationsAllowed 0 "New task must default Docker iterations to zero."
    Assert-Equal @($empty.LocalMigrationAllowlist).Count 0 "New task must default migration allowlist to empty."
    Assert-Equal $empty.LocalDisposableDatabaseApprovalStatus "NOT_REQUESTED" "New task must start with no pending approval request."

    # --- Backward compatibility: a legacy task-state.json without the new
    # fields must be repaired to the same default-deny shape, never error ---
    $legacy = [pscustomobject]@{ TaskId = "TERAS-LEGACY"; State = "BLOCKED"; Description = "pre-existing task" }
    $repaired = Repair-TaskStateSchema -State $legacy
    Assert-True (-not $repaired.LocalDisposableDatabaseAllowed) "Legacy task repaired to schema must still default-deny local DB."
    Assert-True ($null -eq $repaired.TaskName) "Legacy task repaired to schema must backfill TaskName as null."

    # --- Supersede/history: saving a second task must archive the first
    # task's evidence under .ai/history/ rather than silently discarding it.
    $firstTask = New-EmptyTaskState
    $firstTask.TaskId = "TERAS-FOUNDATION-FIRST"
    $firstTask.CreatedAt = "2026-10-04 12:00:00"
    $firstTask.TaskName = "First synthetic task"
    $firstTask.TaskType = "control-plane foundation test"
    $firstTask.Category = "Feature"
    $firstTask.Risk = "LOW"
    $firstTask.Description = "First task, to be superseded."
    $firstTask.State = "BLOCKED"
    Save-TaskState -State $firstTask
    Assert-True (Test-Path -LiteralPath $script:TaskStatePath) "First task save must write task-state.json."

    $secondTask = New-EmptyTaskState
    $secondTask.TaskId = "TERAS-FOUNDATION-SECOND"
    $secondTask.CreatedAt = "2026-10-04 12:05:00"
    $secondTask.TaskName = "Second synthetic task"
    $secondTask.TaskType = "control-plane foundation test"
    $secondTask.Category = "Feature"
    $secondTask.Risk = "LOW"
    $secondTask.Description = "Second task, supersedes the first."
    Save-TaskState -State $secondTask
    Assert-True $secondTask.PreviousTaskHistoryPreserved "Second task save must record that prior history was preserved."
    Assert-Equal $secondTask.SupersededTaskId "TERAS-FOUNDATION-FIRST" "Second task must record which task it superseded."
    Assert-True (Test-Path -LiteralPath $secondTask.SupersededHistoryPath) "Superseded task evidence must exist on disk."
    Assert-True (Test-Path -LiteralPath (Join-Path $secondTask.SupersededHistoryPath "task-state.json")) "Superseded task-state.json must be archived."

    # Re-saving the SAME task (a status transition) must not be treated as
    # a supersede event.
    $secondTask.State = "COMPLETE"
    $beforeArchiveCount = @(Get-ChildItem -LiteralPath (Join-Path $script:AiDir "history") -Directory).Count
    Save-TaskState -State $secondTask
    $afterArchiveCount = @(Get-ChildItem -LiteralPath (Join-Path $script:AiDir "history") -Directory).Count
    Assert-Equal $afterArchiveCount $beforeArchiveCount "Updating the same in-flight task must not create a new history archive."

    Write-Output "Task-control foundation schema/history tests: PASS"
} finally {
    if (Test-Path -LiteralPath $testRoot) { Remove-Item -LiteralPath $testRoot -Recurse -Force }
}

# Invoke-CreateTask lives in teras-agent.ps1, which is a script (not a
# module) that derives $RepoRoot/$AiDir/$CurrentTaskPath/$TaskStatePath from
# its own $PSScriptRoot - so it is exercised below via the actual CLI
# invocation rather than by dot-sourcing its functions into this scope.
try {
    $cliRoot = Join-Path $testRoot "cli"
    $cliTools = Join-Path $cliRoot "tools"
    $cliAi = Join-Path $cliRoot ".ai"
    New-Item -ItemType Directory -Path $cliTools, $cliAi -Force | Out-Null
    Get-ChildItem -LiteralPath $PSScriptRoot -Filter "*.ps1" -File | Copy-Item -Destination $cliTools
    $cliScript = Join-Path $cliTools "teras-agent.ps1"

    # Conflicting action must be rejected before any state is written.
    $conflictOutput = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $cliScript `
        -CreateTask -TaskName "Conflict test" -TaskType "test" -Task "Must reject combined actions." -Status 2>&1
    Assert-Equal $LASTEXITCODE 2 "CreateTask combined with another action must exit nonzero."
    Assert-True ((@($conflictOutput) -join "`n") -match "cannot be combined with another action: Status") "CLI must name the conflicting action."
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $cliAi "task-state.json"))) "Conflicting action must not write task state."

    # Default-deny CLI path (no DB switches at all) must succeed without
    # any interactive prompt and record a fully denied task.
    $defaultOutput = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $cliScript `
        -CreateTask -TaskName "Default deny test" -TaskType "control-plane foundation test" -Task "Create a default-denied task." 2>&1
    Assert-Equal $LASTEXITCODE 0 "Default-deny CreateTask must succeed: $($defaultOutput -join ' | ')"
    Assert-True ((@($defaultOutput) -join "`n") -match "State: CREATED \(no implementer launched\)") "CreateTask must stop after writing task state."
    $state = Get-Content -LiteralPath (Join-Path $cliAi "task-state.json") -Raw | ConvertFrom-Json
    Assert-True (-not $state.LocalDisposableDatabaseAllowed -and -not $state.LocalMigrationValidationAllowed) "Default-deny task must deny local DB access."
    Assert-True (-not $state.RemoteDbAllowed -and -not $state.StagingAllowed -and -not $state.ProductionAllowed) "Default-deny task must deny remote/staging/production."
    Assert-True (-not $state.PushAllowed -and -not $state.MergeAllowed -and -not $state.DeployAllowed) "Default-deny task must deny push/merge/deploy."
    Assert-Equal $state.TaskName "Default deny test" "CLI must record the supplied task name."
    $md = [IO.File]::ReadAllText((Join-Path $cliAi "CURRENT_TASK.md"))
    Assert-True ($md -match "LOCAL_DISPOSABLE_DATABASE_ALLOWED: NO") "Generated CURRENT_TASK.md must show the denied local DB permission."
    Assert-True ($md -match "Task Name: Default deny test") "Generated CURRENT_TASK.md must show the task name."

    # Mismatched DB switches (one without the other) must be rejected.
    $mismatchOutput = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $cliScript `
        -CreateTask -TaskName "Mismatch test" -TaskType "control-plane foundation test" -Task "Must reject mismatched switches." `
        -LocalDisposableDatabaseAllowed 2>&1
    Assert-Equal $LASTEXITCODE 2 "Mismatched DB switches must be rejected."
    Assert-True ((@($mismatchOutput) -join "`n") -match "must be requested together") "CLI must explain the mismatched switches."

    # Piped/redirected confirmation must never authorize the bounded local
    # database tuple - interactive console input only.
    $migrationRel = "supabase/migrations/20261004000000_foundation_test.sql"
    New-Item -ItemType Directory -Path (Join-Path $cliRoot "supabase/migrations") -Force | Out-Null
    [IO.File]::WriteAllText((Join-Path $cliRoot ($migrationRel -replace '/', [IO.Path]::DirectorySeparatorChar)), "-- synthetic fixture, never executed`n")
    $pipeOutput = "AUTHORIZE ONE LOCAL DISPOSABLE DATABASE ITERATION" | & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $cliScript `
        -CreateTask -TaskName "Piped confirmation test" -TaskType "control-plane foundation test" `
        -Task "Must reject piped authorization." -LocalDisposableDatabaseAllowed -LocalMigrationValidationAllowed `
        -DockerIterationsAllowed 1 -StopOnFirstFailure -SyntheticDataOnly -MigrationAllowlist $migrationRel 2>&1
    Assert-Equal $LASTEXITCODE 2 "Piped confirmation must be rejected."
    Assert-True ((@($pipeOutput) -join "`n") -match "redirected input is not accepted") "CLI must explain redirected input is rejected."
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $cliAi "task-state.json")) -or ((Get-Content -LiteralPath (Join-Path $cliAi "task-state.json") -Raw | ConvertFrom-Json).TaskName -ne "Piped confirmation test")) "Piped confirmation must not create the bounded-DB task."

    Write-Output "Task-control foundation CLI tests: PASS"
} finally {
    if (Test-Path -LiteralPath $testRoot) { Remove-Item -LiteralPath $testRoot -Recurse -Force }
}
