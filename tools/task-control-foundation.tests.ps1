$ErrorActionPreference = "Stop"

<#
    Task-control foundation coverage: CreateTask workflow, task-state schema,
    default-deny bounded DB permissions, and supersede/history reconciliation.
    The appended standalone scope-check regressions exercise live Git status,
    authority proof invariants, reparse-point defense, and legacy scope paths.
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

# Standalone scope-check regression coverage (ported from the reviewed focused reference).
$ErrorActionPreference = 'Stop'
function Assert-Condition { param([bool]$Condition, [string]$Message) if (-not $Condition) { throw "ASSERTION FAILED: $Message" } }
function Assert-ScopeInvariants {
    param($Expected, [byte[]]$Ledger, [string]$Label, [string[]]$ExpectedGeneratedFiles = @())
    $actual = Get-Content -LiteralPath $script:TaskStatePath -Raw | ConvertFrom-Json
    Assert-Condition (($actual.AuthorityProof | ConvertTo-Json -Depth 10 -Compress) -ceq ($Expected.AuthorityProof | ConvertTo-Json -Depth 10 -Compress)) "$Label`: entire proof unchanged"
    Assert-Condition ((@($actual.AllowedFiles) -join "`n") -ceq (@($Expected.AllowedFiles) -join "`n")) "$Label`: allowed files unchanged"
    Assert-Condition ((@($actual.TaskGeneratedFiles) -join "`n") -ceq (@($ExpectedGeneratedFiles) -join "`n")) "$Label`: generated files unchanged"
    Assert-Condition (($actual.LocalMigrationAllowlist | ConvertTo-Json -Compress) -ceq ($Expected.LocalMigrationAllowlist | ConvertTo-Json -Compress)) "$Label`: allowlist unchanged"
    foreach ($name in @('LocalDisposableDatabaseAllowed','LocalMigrationValidationAllowed','DockerIterationsAllowed','StopOnFirstFailure','SyntheticDataOnly','RemoteDbAllowed','StagingAllowed','ProductionAllowed','PublishedPortsAllowed','PersistentDbVolumeAllowed','SourceEditAllowedDuringRuntime','PushAllowed','MergeAllowed','DeployAllowed')) {
        Assert-Condition ($actual.$name -ceq $Expected.$name) "$Label`: bounded permission $name unchanged"
    }
    Assert-Condition ([Convert]::ToBase64String([IO.File]::ReadAllBytes($Expected.AuthorityProof.ConsumptionLedgerPath)) -ceq [Convert]::ToBase64String($Ledger)) "$Label`: ledger unchanged"
    Assert-Condition (-not $actual.DbApproved) "$Label`: DbApproved remains false"
    Assert-Condition ($actual.CodexExecutionStatus -ceq 'NOT_STARTED') "$Label`: implementer not dispatched"
    return $actual
}
function Assert-LiveScopeFailure {
    param([string]$Label, [string]$UnauthorizedPath, $Expected, [byte[]]$Ledger, [string]$Cli)
    $output = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $Cli -CheckScope 2>&1
    Assert-Condition ($LASTEXITCODE -eq 2 -and ((@($output) -join "`n") -match 'SCOPE CHECK: FAIL') -and
        ((@($output) -join "`n").Contains("Unauthorized file: $UnauthorizedPath"))) "$Label`: live change must be named as unauthorized: $($output -join ' | ')"
    $after = Assert-ScopeInvariants -Expected $Expected -Ledger $Ledger -Label $Label
    Assert-Condition (@($after.TaskGeneratedFiles).Count -eq 0) "$Label`: recorded generated-file list must stay empty"
    Write-Output "$Label`: PASS"
}
function Assert-ReparseBlocked {
    param([string]$Label, [string]$ChangedPath, $Expected, [byte[]]$Ledger, [string]$Cli)
    $state = Get-TaskState
    $state.TaskGeneratedFiles = @($ChangedPath)
    Save-TaskState -State $state
    $output = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $Cli -CheckScope 2>&1
    Assert-Condition ($LASTEXITCODE -eq 2 -and ((@($output) -join "`n") -match 'SCOPE CHECK: BLOCKED - REPARSE_COMPONENT:')) "$Label`: must block for reparse reason: $($output -join ' | ')"
    $after = Assert-ScopeInvariants -Expected $Expected -Ledger $Ledger -Label $Label -ExpectedGeneratedFiles @($ChangedPath)
    Assert-Condition ($after.ScopeCheck -ceq $state.ScopeCheck) "$Label`: blocked check must not record PASS"
    Write-Output "$Label`: PASS"
}
function Assert-ParserReason {
    param([object[]]$Records, [string]$ExpectedReason)
    $reason = $null
    try { ConvertFrom-StandaloneGitStatus -Output $Records | Out-Null }
    catch { $reason = $_.Exception.Message }
    Assert-Condition ($reason -ceq $ExpectedReason) "S: expected parser reason '$ExpectedReason', got '$reason'"
}
$scratch = if ($env:TMPDIR) { $env:TMPDIR } else { Join-Path $env:LOCALAPPDATA 'hermes/cache/scratch' }
$root = Join-Path $scratch ('teras-scope-' + [guid]::NewGuid().ToString('N'))
$otherRoot = Join-Path $scratch ('teras-scope-other-' + [guid]::NewGuid().ToString('N'))
$trust = Join-Path $scratch ('teras-scope-trust-' + [guid]::NewGuid().ToString('N'))
$oldOverride = $env:TERAS_APPROVAL_TRUST_DIR_OVERRIDE
try {
    New-Item -ItemType Directory -Path (Join-Path $root 'tools'), (Join-Path $root '.ai'), (Join-Path $root 'allowed-dir'), $trust -Force | Out-Null
    Get-ChildItem -LiteralPath $PSScriptRoot -Filter '*.ps1' -File | Copy-Item -Destination (Join-Path $root 'tools')
    [IO.File]::WriteAllText((Join-Path $root 'allowed.txt'), 'fixture')
    [IO.File]::WriteAllText((Join-Path $root 'outside.txt'), 'fixture')
    [IO.File]::WriteAllText((Join-Path $root 'delete.txt'), 'fixture')
    [IO.File]::WriteAllText((Join-Path $root 'allowed-dir/marker.txt'), 'fixture')
    Push-Location $root
    try {
        git init --quiet .
        git config user.name 'Synthetic Scope Test'
        git config user.email 'scope@example.invalid'
        git checkout -b test/scope --quiet
        git add -- tools allowed.txt outside.txt delete.txt allowed-dir/marker.txt
        git -c core.hooksPath=/dev/null commit --quiet -m 'fixture'
    } finally { Pop-Location }
    $env:TERAS_APPROVAL_TRUST_DIR_OVERRIDE = $trust
    $script:RepoRoot = $root
    $script:AiDir = Join-Path $root '.ai'
    $script:TaskStatePath = Join-Path $script:AiDir 'task-state.json'
    $script:CurrentTaskPath = Join-Path $script:AiDir 'CURRENT_TASK.md'
    . (Join-Path $PSScriptRoot 'agent-router.ps1')
    . (Join-Path $PSScriptRoot 'agent-runner.ps1')
    . (Join-Path $PSScriptRoot 'approval-runner.ps1')
    . (Join-Path $PSScriptRoot 'db-runner.ps1')
    New-DisposableApprovalTrustKey -Path (Get-ApprovalTrustKeyPath)
    $state = New-EmptyTaskState
    $state.TaskId = 'TERAS-SYNTHETIC-SCOPE'
    $state.State = 'CREATED'
    $state.AllowedFiles = @('allowed.txt', 'allowed-dir')
    $state.TaskGeneratedFiles = @()
    $state.DbApproved = $false
    $proof = New-ApprovalProof -State $state -RepoRoot $root
    Assert-Condition $proof.Success "Synthetic proof failed: $($proof.Reason)"
    $state.AuthorityProof = $proof.Proof
    Save-TaskState -State $state
    $before = Get-Content -LiteralPath $script:TaskStatePath -Raw | ConvertFrom-Json
    $ledgerBefore = [IO.File]::ReadAllBytes($proof.Proof.ConsumptionLedgerPath)
    $cli = Join-Path $root 'tools/teras-agent.ps1'
    $output = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $cli -CheckScope 2>&1
    Assert-Condition ($LASTEXITCODE -eq 0) "A: auth-only check must exit 0: $($output -join ' | ')"
    $after = Assert-ScopeInvariants -Expected $before -Ledger $ledgerBefore -Label 'A/F/G/H/I/J'
    Assert-Condition ($after.ScopeCheck -ceq 'PASS') 'A: canonical scope must PASS for zero generated files'
    Assert-Condition ((@($output) -join "`n") -match 'SCOPE CHECK: PASS') 'A: CLI must expose PASS'
    Assert-Condition ($after.AuthorityProof.Hmac -ceq $before.AuthorityProof.Hmac) 'F: proof unchanged'
    Assert-Condition (($after.LocalMigrationAllowlist | ConvertTo-Json -Compress) -ceq ($before.LocalMigrationAllowlist | ConvertTo-Json -Compress)) 'G: allowlist unchanged'
    Assert-Condition ([Convert]::ToBase64String([IO.File]::ReadAllBytes($proof.Proof.ConsumptionLedgerPath)) -ceq [Convert]::ToBase64String($ledgerBefore)) 'H: ledger unchanged'
    Assert-Condition (-not $after.DbApproved) 'I: DbApproved remains false'
    Assert-Condition ($after.CodexExecutionStatus -ceq 'NOT_STARTED') 'J: no implementer dispatch'
    Write-Output 'A/F/G/H/I/J auth-only, invariants and no dispatch: PASS'

    # Generated files are not part of the signed authorization tuple; scope
    # must still reject one outside the signed allowlist.
    $state.TaskGeneratedFiles = @('outside.txt')
    Save-TaskState -State $state
    $output = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $cli -CheckScope 2>&1
    Assert-Condition ($LASTEXITCODE -eq 2) "B: out-of-scope check must exit 2: $($output -join ' | ')"
    Assert-Condition ((@($output) -join "`n") -match 'SCOPE CHECK: FAIL') 'B: CLI must expose FAIL'
    $after = Assert-ScopeInvariants -Expected $before -Ledger $ledgerBefore -Label 'B' -ExpectedGeneratedFiles @('outside.txt')
    Assert-Condition ($after.ScopeCheck -ceq 'FAIL') 'B: persisted scope must FAIL'
    Write-Output 'B out-of-scope generated file: PASS'
    $state = Get-TaskState
    $state.TaskGeneratedFiles = @()
    Save-TaskState -State $state

    $outside = Join-Path $root 'outside.txt'
    $allowed = Join-Path $root 'allowed.txt'
    $deleted = Join-Path $root 'delete.txt'
    [IO.File]::WriteAllText($outside, 'changed outside the task')
    Assert-LiveScopeFailure -Label 'L unstaged unauthorized' -UnauthorizedPath 'outside.txt' -Expected $before -Ledger $ledgerBefore -Cli $cli
    [IO.File]::WriteAllText($outside, 'fixture')

    [IO.File]::WriteAllText($outside, 'staged outside the task')
    Push-Location $root
    try { git add -- outside.txt } finally { Pop-Location }
    Assert-LiveScopeFailure -Label 'M staged unauthorized' -UnauthorizedPath 'outside.txt' -Expected $before -Ledger $ledgerBefore -Cli $cli
    Push-Location $root
    try { git restore --staged -- outside.txt } finally { Pop-Location }
    [IO.File]::WriteAllText($outside, 'fixture')

    $untracked = Join-Path $root 'new-outside.txt'
    [IO.File]::WriteAllText($untracked, 'untracked outside the task')
    Assert-LiveScopeFailure -Label 'N untracked unauthorized' -UnauthorizedPath 'new-outside.txt' -Expected $before -Ledger $ledgerBefore -Cli $cli
    [IO.File]::Delete($untracked)

    [IO.File]::Delete($deleted)
    Assert-LiveScopeFailure -Label 'O unauthorized deletion' -UnauthorizedPath 'delete.txt' -Expected $before -Ledger $ledgerBefore -Cli $cli
    [IO.File]::WriteAllText($deleted, 'fixture')

    [IO.File]::WriteAllText($allowed, 'changed within the task')
    $output = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $cli -CheckScope 2>&1
    Assert-Condition ($LASTEXITCODE -eq 0 -and ((@($output) -join "`n") -match 'SCOPE CHECK: PASS')) "P: authorized live file must PASS: $($output -join ' | ')"
    $after = Assert-ScopeInvariants -Expected $before -Ledger $ledgerBefore -Label 'P'
    Assert-Condition ($after.ScopeCheck -ceq 'PASS') 'P: authorized file status must persist PASS'
    [IO.File]::WriteAllText($allowed, 'fixture')
    Write-Output 'P authorized file: PASS'

    $bookkeeping = Join-Path $script:AiDir 'IMPLEMENTATION_REPORT.md'
    [IO.File]::WriteAllText($bookkeeping, 'synthetic agent bookkeeping')
    $output = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $cli -CheckScope 2>&1
    Assert-Condition ($LASTEXITCODE -eq 0 -and ((@($output) -join "`n") -match 'SCOPE CHECK: PASS')) "Q: canonical bookkeeping must PASS: $($output -join ' | ')"
    $after = Assert-ScopeInvariants -Expected $before -Ledger $ledgerBefore -Label 'Q'
    Assert-Condition ($after.ScopeCheck -ceq 'PASS') 'Q: bookkeeping-only status must persist PASS'
    [IO.File]::Delete($bookkeeping)
    Write-Output 'Q canonical bookkeeping: PASS'

    $extraAi = Join-Path $script:AiDir 'unauthorized.txt'
    [IO.File]::WriteAllText($extraAi, 'not task bookkeeping')
    Assert-LiveScopeFailure -Label 'R arbitrary .ai file' -UnauthorizedPath '.ai/unauthorized.txt' -Expected $before -Ledger $ledgerBefore -Cli $cli
    [IO.File]::Delete($extraAi)

    Push-Location $root
    try { git mv -- allowed.txt renamed-outside.txt } finally { Pop-Location }
    Assert-LiveScopeFailure -Label 'R1 authorized source only' -UnauthorizedPath 'renamed-outside.txt' -Expected $before -Ledger $ledgerBefore -Cli $cli
    Push-Location $root
    try { git mv -- renamed-outside.txt allowed.txt } finally { Pop-Location }

    Push-Location $root
    try { git mv -- outside.txt allowed-dir/moved-outside.txt } finally { Pop-Location }
    Assert-LiveScopeFailure -Label 'R2 authorized destination only' -UnauthorizedPath 'outside.txt' -Expected $before -Ledger $ledgerBefore -Cli $cli
    Push-Location $root
    try { git mv -- allowed-dir/moved-outside.txt outside.txt } finally { Pop-Location }

    Push-Location $root
    try { git mv -- allowed.txt allowed-dir/moved-allowed.txt } finally { Pop-Location }
    $output = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $cli -CheckScope 2>&1
    Assert-Condition ($LASTEXITCODE -eq 0 -and ((@($output) -join "`n") -match 'SCOPE CHECK: PASS')) "R3: both authorized rename paths must PASS: $($output -join ' | ')"
    $after = Assert-ScopeInvariants -Expected $before -Ledger $ledgerBefore -Label 'R3'
    Assert-Condition ($after.ScopeCheck -ceq 'PASS') 'R3: persisted scope must PASS'
    Push-Location $root
    try { git mv -- allowed-dir/moved-allowed.txt allowed.txt } finally { Pop-Location }
    Write-Output 'R3 both authorized rename paths: PASS'

    Push-Location $root
    try { git mv -- outside.txt renamed-outside.txt } finally { Pop-Location }
    Assert-LiveScopeFailure -Label 'R4 neither rename path authorized' -UnauthorizedPath 'renamed-outside.txt' -Expected $before -Ledger $ledgerBefore -Cli $cli
    Push-Location $root
    try { git mv -- renamed-outside.txt outside.txt } finally { Pop-Location }

    # The host does not grant file-symlink creation. Directory junctions are
    # reparse points governed by the same component guard, and can dangle.
    foreach ($fixture in @(
        [pscustomobject]@{ Label = 'T dangling leaf junction'; Link = 'allowed-dir/dangling-leaf'; Changed = 'allowed-dir/dangling-leaf' },
        [pscustomobject]@{ Label = 'U dangling parent junction'; Link = 'allowed-dir/dangling-parent'; Changed = 'allowed-dir/dangling-parent/child.txt' }
    )) {
        $link = Join-Path $root $fixture.Link
        $missingTarget = Join-Path $scratch ('teras-absent-link-target-' + [guid]::NewGuid().ToString('N'))
        Assert-Condition (-not (Test-Path -LiteralPath $missingTarget)) 'Junction target must be absent and disposable'
        try {
            $linkOutput = & cmd.exe /c "mklink /J `"$link`" `"$missingTarget`"" 2>&1
            Assert-Condition ($LASTEXITCODE -eq 0) "Junction fixture unavailable; do not claim PASS: $($linkOutput -join ' | ')"
            $attrs = [IO.File]::GetAttributes($link)
            Assert-Condition (($attrs -band [IO.FileAttributes]::ReparsePoint) -ne 0 -and -not (Test-Path -LiteralPath $missingTarget)) 'Fixture must be a dangling reparse object'
            Assert-ReparseBlocked -Label $fixture.Label -ChangedPath $fixture.Changed -Expected $before -Ledger $ledgerBefore -Cli $cli
        } finally {
            # Never recurse through the junction, even on test failure.
            if (@([IO.Directory]::EnumerateFileSystemEntries((Split-Path -Parent $link))) -contains $link) {
                [IO.Directory]::Delete($link, $false)
            }
            $state = Get-TaskState
            $state.TaskGeneratedFiles = @()
            Save-TaskState -State $state
        }
    }

    # V/W: following the dangling fixtures, absent deleted leaves must still
    # be checked as scope violations, while ordinary allowed paths pass.
    [IO.File]::Delete($deleted)
    Assert-LiveScopeFailure -Label 'V normal deleted non-reparse leaf' -UnauthorizedPath 'delete.txt' -Expected $before -Ledger $ledgerBefore -Cli $cli
    [IO.File]::WriteAllText($deleted, 'fixture')
    [IO.File]::WriteAllText($allowed, 'ordinary allowed modification')
    $output = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $cli -CheckScope 2>&1
    Assert-Condition ($LASTEXITCODE -eq 0 -and ((@($output) -join "`n") -match 'SCOPE CHECK: PASS')) "W: normal authorized path must PASS: $($output -join ' | ')"
    $after = Assert-ScopeInvariants -Expected $before -Ledger $ledgerBefore -Label 'W'
    Assert-Condition ($after.ScopeCheck -ceq 'PASS') 'W: authorized path status must persist PASS'
    [IO.File]::WriteAllText($allowed, 'fixture')
    Write-Output 'W normal authorized non-reparse path: PASS'

    # Parse the actual pure parser definition: no fake Git executable and no
    # test-only status format accepted by the CLI.
    $parseErrors = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'teras-agent.ps1'), [ref]$null, [ref]$parseErrors)
    Assert-Condition (@($parseErrors).Count -eq 0) 'S: production parser source must AST-parse'
    $definition = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'ConvertFrom-StandaloneGitStatus' }, $true)
    Assert-Condition ($null -ne $definition) 'S: production status parser must exist'
    Invoke-Expression $definition.Extent.Text
    foreach ($status in @('R', 'C')) {
        $paths = @(ConvertFrom-StandaloneGitStatus -Output @(("$status  renamed.txt" + [char]0 + 'outside.txt' + [char]0)))
        Assert-Condition ($paths.Count -eq 2 -and $paths[0] -ceq 'renamed.txt' -and $paths[1] -ceq 'outside.txt') "Copy/rename $status must parse destination and source identically"
        $copyScope = Test-ScopeViolation -TaskGeneratedFiles $paths -AllowedFiles @('renamed.txt')
        Assert-Condition ($copyScope.Status -ceq 'FAIL' -and @($copyScope.Unauthorized).Count -eq 1 -and $copyScope.Unauthorized[0] -ceq 'outside.txt') "Copy/rename $status must reject unauthorized source"
    }
    Write-Output 'Copy/rename shared parser and canonical source enforcement: PASS'

    $scopeBeforeParser = (Get-TaskState).ScopeCheck
    Assert-ParserReason -Records @(' M outside.txt') -ExpectedReason 'Malformed live Git status output (encoding or terminator).'
    Assert-ParserReason -Records @(('!! outside.txt' + [char]0)) -ExpectedReason 'Unsupported live Git status: !!'
    Assert-ParserReason -Records @(('R  new.txt' + [char]0)) -ExpectedReason 'Malformed live Git rename/copy record.'
    Assert-ParserReason -Records @(('C  new.txt' + [char]0)) -ExpectedReason 'Malformed live Git rename/copy record.'
    Assert-ParserReason -Records @(('?? ' + [char]0)) -ExpectedReason 'Malformed live Git status record.'
    Assert-ParserReason -Records @(('?? outside.txt' + [char]0), ('?? other.txt' + [char]0)) -ExpectedReason 'Malformed live Git status output (multiple records).'
    $unrelatedRejected = $false
    try { Assert-ParserReason -Records @(('!! outside.txt' + [char]0)) -ExpectedReason 'UNRELATED_EXCEPTION' }
    catch { $unrelatedRejected = $_.Exception.Message -match '^ASSERTION FAILED: S: expected parser reason' }
    Assert-Condition $unrelatedRejected 'An unrelated exception/reason must not satisfy the malformed control'
    Assert-Condition ((Get-TaskState).ScopeCheck -ceq $scopeBeforeParser) 'Parser failures must not persist a scope PASS'
    Write-Output 'S malformed Git status exact reasons and unrelated-exception control: PASS'

    # P1/P2/P8/P9: ordinary CreateTask-shaped state has no signed proof.
    $ordinary = New-EmptyTaskState
    $ordinary.TaskId = 'TERAS-SYNTHETIC-SCOPE'
    $ordinary.State = 'CREATED'
    $ordinary.AllowedFiles = @('allowed.txt')
    $ordinary.TaskGeneratedFiles = @('allowed.txt')
    $ordinary.WorkspaceBoundary.CanonicalWorkspace = (Resolve-Path -LiteralPath $root).Path
    $ordinary.WorkspaceBoundary.Branch = 'test/scope'
    Save-TaskState -State $ordinary
    $ordinaryBefore = Get-Content -LiteralPath $script:TaskStatePath -Raw | ConvertFrom-Json
    $ordinaryProofBefore = $ordinaryBefore.AuthorityProof | ConvertTo-Json -Depth 10 -Compress
    [IO.File]::WriteAllText($allowed, 'ordinary allowed change')
    $output = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $cli -CheckScope 2>&1
    Assert-Condition ($LASTEXITCODE -eq 0 -and ((@($output) -join "`n") -match 'SCOPE CHECK: PASS')) "P1: ordinary no-proof scope PASS: $($output -join ' | ')"
    $ordinaryAfter = Get-Content -LiteralPath $script:TaskStatePath -Raw | ConvertFrom-Json
    Assert-Condition (($ordinaryAfter.AuthorityProof | ConvertTo-Json -Depth 10 -Compress) -ceq $ordinaryProofBefore) 'P9: empty proof unchanged'
    Assert-Condition (-not $ordinaryAfter.LocalDisposableDatabaseAllowed -and -not $ordinaryAfter.LocalMigrationValidationAllowed -and
        $ordinaryAfter.DockerIterationsAllowed -eq 0 -and @($ordinaryAfter.LocalMigrationAllowlist).Count -eq 0 -and -not $ordinaryAfter.DbApproved) 'P8: no DB capability gained'
    Write-Output 'P1/P8/P9 ordinary no-proof PASS, no escalation and proof immutability: PASS'
    # Ordinary tasks still require live identity attestation.
    $ordinary.WorkspaceBoundary.Branch = 'test/not-live'
    Save-TaskState -State $ordinary
    $output = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $cli -CheckScope 2>&1
    Assert-Condition ($LASTEXITCODE -eq 2 -and ((@($output) -join "`n") -match 'BRANCH_MISMATCH')) 'P1a: ordinary branch mismatch must block'
    $ordinary.WorkspaceBoundary.Branch = 'test/scope'
    $ordinary.WorkspaceBoundary.CanonicalWorkspace = (Join-Path $root 'wrong-root')
    Save-TaskState -State $ordinary
    $output = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $cli -CheckScope 2>&1
    Assert-Condition ($LASTEXITCODE -eq 2 -and ((@($output) -join "`n") -match 'WORKTREE_MISMATCH')) 'P1b: ordinary worktree mismatch must block'
    $ordinary.WorkspaceBoundary = $null
    Save-TaskState -State $ordinary
    $output = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $cli -CheckScope 2>&1
    Assert-Condition ($LASTEXITCODE -eq 2 -and ((@($output) -join "`n") -match 'TASK_IDENTITY_BINDING_MISSING')) 'P1c: ordinary missing boundary must block'
    $ordinary.WorkspaceBoundary = [pscustomobject]@{ CanonicalWorkspace = (Resolve-Path -LiteralPath $root).Path; Branch = 'test/scope' }
    Save-TaskState -State $ordinary
    $archiveDir = Join-Path $root '.ai/history/TERAS-SYNTHETIC-OLD'
    New-Item -ItemType Directory -Path $archiveDir -Force | Out-Null
    foreach ($archiveFile in @('task-state.json','CURRENT_TASK.md','IMPLEMENTATION_REPORT.md','REVIEW_REPORT.md','FINAL_REPORT.md','APPROVAL.md')) {
        [IO.File]::WriteAllText((Join-Path $archiveDir $archiveFile), 'archived fixture')
    }
    $output = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $cli -CheckScope 2>&1
    Assert-Condition ($LASTEXITCODE -eq 0 -and ((@($output) -join "`n") -match 'SCOPE CHECK: PASS')) 'P1d: canonical history archive files are bookkeeping'
    [IO.File]::WriteAllText((Join-Path $archiveDir 'unrelated.txt'), 'must remain in scope')
    $output = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $cli -CheckScope 2>&1
    Assert-Condition ($LASTEXITCODE -eq 2 -and ((@($output) -join "`n").Contains('.ai/history/TERAS-SYNTHETIC-OLD/unrelated.txt'))) 'P1e: unrelated history content remains unauthorized'
    Remove-Item -LiteralPath (Join-Path $root '.ai/history') -Recurse -Force
    [IO.File]::WriteAllText($allowed, 'fixture')
    [IO.File]::WriteAllText($outside, 'ordinary unauthorized change')
    $output = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $cli -CheckScope 2>&1
    Assert-Condition ($LASTEXITCODE -eq 2 -and ((@($output) -join "`n") -match 'SCOPE CHECK: FAIL') -and
        ((@($output) -join "`n") -match 'Unauthorized file: outside.txt') -and
        ((@($output) -join "`n") -notmatch 'AUTHORITY_PROOF')) "P2: ordinary task must fail for unauthorized live path: $($output -join ' | ')"
    [IO.File]::WriteAllText($outside, 'fixture')
    Write-Output 'P2 ordinary no-proof intended scope failure: PASS'

    # P3-P7: a signed bounded-local tuple requires proof, including when a
    # caller tampers with any single field after creating a legitimate proof.
    $privileged = New-EmptyTaskState
    $privileged.TaskId = 'TERAS-SYNTHETIC-SCOPE'
    $privileged.State = 'CREATED'
    $privileged.AllowedFiles = @('allowed.txt')
    $privileged.LocalDisposableDatabaseAllowed = $true
    $privileged.LocalMigrationValidationAllowed = $true
    $privileged.DockerIterationsAllowed = 1
    $privileged.StopOnFirstFailure = $true
    $privileged.SyntheticDataOnly = $true
    $privileged.LocalMigrationAllowlist = @('supabase/migrations/20261005000000_synthetic.sql')
    $privProof = New-ApprovalProof -State $privileged -RepoRoot $root
    Assert-Condition $privProof.Success "P3: isolated signed proof fixture creation failed: $($privProof.Reason)"
    $privileged.AuthorityProof = $privProof.Proof
    Save-TaskState -State $privileged
    $privLedgerBefore = [Convert]::ToBase64String([IO.File]::ReadAllBytes($privProof.Proof.ConsumptionLedgerPath))
    $output = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $cli -CheckScope 2>&1
    Assert-Condition ($LASTEXITCODE -eq 0 -and ((@($output) -join "`n") -match 'SCOPE CHECK: PASS')) "P3: valid privileged proof must proceed: $($output -join ' | ')"
    Assert-Condition ([Convert]::ToBase64String([IO.File]::ReadAllBytes($privProof.Proof.ConsumptionLedgerPath)) -ceq $privLedgerBefore) 'P10: check must not consume bounded DB ledger'
    Write-Output 'P3/P10 valid bounded-local proof and no ledger consumption: PASS'
    $privileged.AuthorityProof = (New-EmptyTaskState).AuthorityProof
    Save-TaskState -State $privileged
    $output = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $cli -CheckScope 2>&1
    Assert-Condition ($LASTEXITCODE -eq 2 -and ((@($output) -join "`n") -match 'SCOPE CHECK: BLOCKED - AUTHORITY_PROOF_REQUIRED:')) "P4: exact proof-required reason: $($output -join ' | ')"
    Write-Output 'P4 privileged missing proof: PASS'
    $privileged.AuthorityProof = $privProof.Proof | Select-Object *
    $privileged.AuthorityProof.Hmac = 'not-a-hmac'
    Save-TaskState -State $privileged
    $output = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $cli -CheckScope 2>&1
    Assert-Condition ($LASTEXITCODE -eq 2 -and ((@($output) -join "`n") -match 'AUTHORITY_PROOF_SCHEMA_MALFORMED_HMAC')) "P5: malformed proof reason: $($output -join ' | ')"
    Write-Output 'P5 privileged malformed proof: PASS'
    $privileged.AuthorityProof = $privProof.Proof | Select-Object *
    $privileged.AuthorityProof.BaseHeadSha = ('f' * 40)
    Save-TaskState -State $privileged
    $output = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $cli -CheckScope 2>&1
    Assert-Condition ($LASTEXITCODE -eq 2 -and ((@($output) -join "`n") -match 'AUTHORITY_PROOF_HMAC_MISMATCH_TAMPER_DETECTED')) "P6: signed HEAD mismatch reason: $($output -join ' | ')"
    Write-Output 'P6 privileged proof HEAD mismatch: PASS'
    $permissionCases = @(
        @{ Name = 'LocalDisposableDatabaseAllowed'; Field = 'LocalDisposableDatabaseAllowed'; Value = $true },
        @{ Name = 'LocalMigrationValidationAllowed'; Field = 'LocalMigrationValidationAllowed'; Value = $true },
        @{ Name = 'DockerIterationsAllowed'; Field = 'DockerIterationsAllowed'; Value = 1 },
        @{ Name = 'StopOnFirstFailure'; Field = 'StopOnFirstFailure'; Value = $true },
        @{ Name = 'SyntheticDataOnly'; Field = 'SyntheticDataOnly'; Value = $true },
        @{ Name = 'RemoteDbAllowed'; Field = 'RemoteDbAllowed'; Value = $true },
        @{ Name = 'StagingAllowed'; Field = 'StagingAllowed'; Value = $true },
        @{ Name = 'ProductionAllowed'; Field = 'ProductionAllowed'; Value = $true },
        @{ Name = 'PublishedPortsAllowed'; Field = 'PublishedPortsAllowed'; Value = $true },
        @{ Name = 'PersistentDbVolumeAllowed'; Field = 'PersistentDbVolumeAllowed'; Value = $true },
        @{ Name = 'SourceEditAllowedDuringRuntime'; Field = 'SourceEditAllowedDuringRuntime'; Value = $true },
        @{ Name = 'PushAllowed'; Field = 'PushAllowed'; Value = $true },
        @{ Name = 'MergeAllowed'; Field = 'MergeAllowed'; Value = $true },
        @{ Name = 'DeployAllowed'; Field = 'DeployAllowed'; Value = $true },
        @{ Name = 'MigrationAllowlist'; Field = 'LocalMigrationAllowlist'; Value = @('supabase/migrations/20261005000000_synthetic.sql') }
    )
    foreach ($case in $permissionCases) {
        $unsigned = New-EmptyTaskState
        $unsigned.TaskId = 'TERAS-SYNTHETIC-SCOPE'
        $unsigned.State = 'CREATED'
        $unsigned.AllowedFiles = @('allowed.txt')
        $unsigned.($case.Field) = $case.Value
        Save-TaskState -State $unsigned
        $output = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $cli -CheckScope 2>&1
        Assert-Condition ($LASTEXITCODE -eq 2 -and ((@($output) -join "`n") -match 'AUTHORITY_PROOF_REQUIRED:')) "P7 $($case.Name): unsigned signed capability must block: $($output -join ' | ')"
    }
    Assert-Condition ([Convert]::ToBase64String([IO.File]::ReadAllBytes($privProof.Proof.ConsumptionLedgerPath)) -ceq $privLedgerBefore) 'P7: privileged negative checks must not consume ledger'
    Write-Output 'P7 unsigned migration/Docker/remote/push state: PASS'
    [IO.File]::WriteAllText($script:TaskStatePath, ($before | ConvertTo-Json -Depth 20))

    # Switch branch without moving HEAD so this isolates the branch binding.
    $blockedScopeBefore = (Get-TaskState).ScopeCheck
    Push-Location $root
    try { git checkout -b test/wrong --quiet } finally { Pop-Location }
    $output = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $cli -CheckScope 2>&1
    Assert-Condition ($LASTEXITCODE -eq 2 -and ((@($output) -join "`n") -match 'SCOPE CHECK: BLOCKED.*BRANCH_MISMATCH')) "D: branch mismatch must block: $($output -join ' | ')"
    $after = Assert-ScopeInvariants -Expected $before -Ledger $ledgerBefore -Label 'D'
    Assert-Condition ($after.ScopeCheck -ceq $blockedScopeBefore) 'D: blocked check must not rewrite prior scope status'
    Push-Location $root
    try { git checkout test/scope --quiet } finally { Pop-Location }
    Write-Output 'D branch mismatch: PASS'

    # An independently initialized repository has its own root but receives
    # a copy of the signed task. Its proof must not authorize that root.
    New-Item -ItemType Directory -Path (Join-Path $otherRoot 'tools'), (Join-Path $otherRoot '.ai') -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $root 'tools/teras-agent.ps1') -Destination (Join-Path $otherRoot 'tools/teras-agent.ps1')
    Copy-Item -LiteralPath $script:TaskStatePath -Destination (Join-Path $otherRoot '.ai/task-state.json')
    Push-Location $otherRoot
    try { git init --quiet . } finally { Pop-Location }
    $output = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $cli -CheckScope -TargetWorkspacePath $otherRoot 2>&1
    Assert-Condition ($LASTEXITCODE -eq 2 -and ((@($output) -join "`n") -match 'SCOPE CHECK: BLOCKED.*WORKTREE_MISMATCH')) "E: worktree mismatch must block: $($output -join ' | ')"
    $after = Assert-ScopeInvariants -Expected $before -Ledger $ledgerBefore -Label 'E'
    Assert-Condition ($after.ScopeCheck -ceq $blockedScopeBefore) 'E: blocked check must not alter original state'
    Write-Output 'E worktree mismatch: PASS'

    Push-Location $root
    try {
        [IO.File]::WriteAllText((Join-Path $root 'head-change.txt'), 'synthetic')
        git add -- head-change.txt
        git -c core.hooksPath=/dev/null commit --quiet -m 'change synthetic HEAD'
    } finally { Pop-Location }
    $output = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $cli -CheckScope 2>&1
    Assert-Condition ($LASTEXITCODE -eq 2 -and ((@($output) -join "`n") -match 'SCOPE CHECK: BLOCKED.*HEAD_MISMATCH')) "C: HEAD mismatch must block: $($output -join ' | ')"
    $after = Assert-ScopeInvariants -Expected $before -Ledger $ledgerBefore -Label 'C'
    Assert-Condition ($after.ScopeCheck -ceq $blockedScopeBefore) 'C: blocked check must not rewrite prior scope status'
    Write-Output 'C HEAD mismatch: PASS'

    # Execute the existing state-machine functions with synthetic outputs.
    # Only the actual implementer/QA/reviewer/file writes are mocked; scope
    # matching and implementation-delta calculation remain the real helpers.
    foreach ($name in @('Get-OrchestratorManagedPaths', 'Get-ImplementationDelta', 'Invoke-PostImplementation', 'Invoke-ClaudeRepairLoop', 'Invoke-Resume')) {
        $fn = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }, $true)
        Assert-Condition ($null -ne $fn) "Compatibility function missing: $name"
        . ([scriptblock]::Create($fn.Extent.Text))
    }
    $script:realScope = ${function:Test-ScopeViolation}
    $script:scopeCalls = 0
    $script:standaloneCalls = 0
    $script:saveStates = @()
    $script:statusLines = @('?? outside.txt')
    function Test-ScopeViolation {
        param([string[]]$TaskGeneratedFiles, [string[]]$AllowedFiles)
        $script:scopeCalls++
        & $script:realScope -TaskGeneratedFiles $TaskGeneratedFiles -AllowedFiles $AllowedFiles
    }
    function Get-GitStatusSnapshot { return $script:statusLines }
    function Save-TaskState { param($State) $script:saveStates += "$($State.State):$($State.ScopeCheck)" }
    function Invoke-StandaloneScopeCheck { $script:standaloneCalls++; throw 'Standalone check must not run implicitly' }
    function Invoke-QA { throw 'QA must not follow a scope violation' }
    $postState = New-EmptyTaskState
    $postState.State = 'IMPLEMENTING'
    $postState.Risk = 'LOW'
    $postState.AllowedFiles = @('allowed.txt')
    $postResult = Invoke-PostImplementation -State $postState -PreSnapshot @()
    Assert-Condition ($script:scopeCalls -eq 1 -and $postResult.State -ceq 'BLOCKED' -and $postResult.ScopeCheck -ceq 'FAIL' -and
        @($postResult.TaskGeneratedFiles).Count -eq 1 -and $postResult.TaskGeneratedFiles[0] -ceq 'outside.txt' -and
        $script:saveStates -contains 'IMPLEMENTING:FAIL' -and $script:saveStates -contains 'BLOCKED:FAIL') 'C1: real post-implementation canonical scope and BLOCKED transition'
    Assert-Condition ($script:standaloneCalls -eq 0) 'C4: post-implementation must not call standalone check'
    Write-Output 'C1 post-implementation scope transition and C4 isolation: PASS'

    $script:scopeCalls = 0
    $script:saveStates = @()
    $script:reviewCalls = 0
    $script:repairCalls = 0
    function Invoke-ClaudeReadOnlyReview { $script:reviewCalls++; return [pscustomobject]@{ Succeeded = $true; Verdict = 'CHANGES_REQUIRED'; Output = 'synthetic finding' } }
    function Get-ClaudeRepairDecision { return 'REPAIR' }
    function Test-RepairMigrationGate { return [pscustomobject]@{ Mode = 'STANDARD'; Reason = 'synthetic repair' } }
    function New-CodexRepairHandoff { return 'synthetic-handoff' }
    function Invoke-CodexImplementation { $script:repairCalls++; return $true }
    $repairState = New-EmptyTaskState
    $repairState.State = 'IMPLEMENTING'
    $repairState.Risk = 'HIGH'
    $repairState.AllowedFiles = @('allowed.txt')
    $repairResult = Invoke-ClaudeRepairLoop -State $repairState -PreSnapshot @() -TaskGeneratedFiles @('allowed.txt')
    Assert-Condition (-not $repairResult.Completed -and $repairResult.State.State -ceq 'BLOCKED' -and
        $repairResult.State.ScopeCheck -ceq 'FAIL' -and $script:scopeCalls -eq 1 -and
        $script:reviewCalls -eq 1 -and $script:repairCalls -eq 1 -and
        $script:saveStates -contains 'IMPLEMENTING_REPAIR:FAIL' -and $script:saveStates -contains 'BLOCKED:FAIL') 'C2: real repair canonical scope and BLOCKED transition'
    Assert-Condition ($script:standaloneCalls -eq 0) 'C4: repair must not call standalone check'
    Write-Output 'C2 repair scope transition and C4 isolation: PASS'

    $script:resumeState = New-EmptyTaskState
    $script:resumeState.TaskId = 'SYNTHETIC-RESUME'
    $script:resumeState.State = 'PENDING_CLAUDE_REVIEW'
    $script:resumeState.PreImplementationSnapshot = @(' M allowed.txt')
    $script:resumed = @()
    function Get-TaskState { return $script:resumeState }
    function Invoke-PostImplementation { param($State, [string[]]$PreSnapshot) $script:resumed += ,@($PreSnapshot) }
    function Invoke-ResumeDispatchForbidden { throw 'No agent may be dispatched by this Resume fixture' }
    Invoke-Resume | Out-Null
    Assert-Condition ($script:resumed.Count -eq 1 -and $script:resumed[0].Count -eq 1 -and
        $script:resumed[0][0] -ceq ' M allowed.txt' -and $script:standaloneCalls -eq 0 -and
        $script:repairCalls -eq 1) 'C3/C4: Resume must keep its pending-review post-implementation path without standalone or implementer dispatch'
    Write-Output 'C3 Resume pending-review semantics and C4 isolation: PASS'

    $source = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'teras-agent.ps1'))
    Assert-Condition ($source -match '(?s)function Invoke-PostImplementation \{.*?Test-ScopeViolation -TaskGeneratedFiles \$delta.TaskGenerated -AllowedFiles \$State.AllowedFiles') 'K: post-implementation scope call must remain'
    Assert-Condition ($source -match '(?s)function Invoke-ClaudeRepairLoop \{.*?Test-ScopeViolation -TaskGeneratedFiles \$currentFiles -AllowedFiles \$State.AllowedFiles') 'K: repair scope call must remain'
    Assert-Condition ($source -match '(?s)function Invoke-ReviewStage \{.*?Test-ScopeViolation -TaskGeneratedFiles \$delta.TaskGenerated -AllowedFiles \$State.AllowedFiles') 'K: legacy repair scope call must remain'
    Assert-Condition ($source -match 'function Invoke-Resume \{' -and $source -match 'Invoke-PostImplementation -State \$state -PreSnapshot \$preSnapshot') 'K: resume must still reach post-implementation scope'
    Write-Output 'K existing implementation/repair/resume scope call paths: PASS'
} finally {
    $env:TERAS_APPROVAL_TRUST_DIR_OVERRIDE = $oldOverride
    if (Test-Path -LiteralPath $root) { Remove-Item -LiteralPath $root -Recurse -Force }
    if (Test-Path -LiteralPath $otherRoot) { Remove-Item -LiteralPath $otherRoot -Recurse -Force }
    if (Test-Path -LiteralPath $trust) { Remove-Item -LiteralPath $trust -Recurse -Force }
}
