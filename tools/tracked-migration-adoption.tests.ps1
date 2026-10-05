$ErrorActionPreference = 'Stop'
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
. (Join-Path $PSScriptRoot 'agent-router.ps1')
. (Join-Path $PSScriptRoot 'approval-runner.ps1')
. (Join-Path $PSScriptRoot 'db-runner.ps1')

function Assert-Condition { param([bool]$Condition, [string]$Message) if (-not $Condition) { throw "ASSERTION FAILED: $Message" } }
$script:Migration = 'supabase/migrations/20261004023132_c4_wave1_erector_snapshot.sql'
$script:Scratch = $env:TMPDIR
if ([string]::IsNullOrWhiteSpace($script:Scratch)) { $script:Scratch = Join-Path $env:LOCALAPPDATA 'hermes/cache/scratch' }
$script:OriginalTrustOverride = $env:TERAS_APPROVAL_TRUST_DIR_OVERRIDE
$script:StateSaves = 0
function Get-TaskState { return $script:FixtureState }
function Save-TaskState { param($State) $script:StateSaves++; $script:FixtureState = $State }
function New-DatabaseHandoff { param($State) return 'synthetic handoff (not written)' }
function Write-DatabaseReport { param($State) }

function New-AdoptionFixture {
    param([bool]$DuplicateAtHead = $false)
    $root = Join-Path $script:Scratch ('teras-adopt-' + [guid]::NewGuid().ToString('N'))
    $trust = Join-Path $script:Scratch ('teras-adopt-trust-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path (Join-Path $root 'supabase/migrations') -Force | Out-Null
    New-Item -ItemType Directory -Path $trust -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $root $script:Migration) -Value 'select 1;' -NoNewline -Encoding utf8
    if ($DuplicateAtHead) {
        Set-Content -LiteralPath (Join-Path $root 'supabase/migrations/20261004023132_duplicate.sql') -Value 'select 2;' -NoNewline -Encoding utf8
    }
    Push-Location $root
    try {
        git init --quiet .
        git config user.name 'Synthetic Test'
        git config user.email 'test@example.invalid'
        git checkout -b 'test/authorized' --quiet
        git add -- supabase/migrations
        git -c core.hooksPath=/dev/null commit -m 'synthetic baseline' --quiet
    } finally { Pop-Location }
    return [pscustomobject]@{ Root = $root; Trust = $trust; Junction = $null; EscapeTarget = $null }
}

function New-SignedFixtureState {
    param($Fixture, [string[]]$Allowlist = @($script:Migration))
    $env:TERAS_APPROVAL_TRUST_DIR_OVERRIDE = $Fixture.Trust
    New-DisposableApprovalTrustKey -Path (Get-ApprovalTrustKeyPath)
    $state = New-EmptyTaskState
    $state.TaskId = 'TERAS-SYNTHETIC-ADOPTION'
    $state.State = 'CREATED'
    $state.DbRequired = $true
    $state.Description = 'Synthetic local certificate database review; no DB execution'
    $state.LocalMigrationAllowlist = @($Allowlist)
    $state.LocalDisposableDatabaseAllowed = $true
    $state.LocalMigrationValidationAllowed = $true
    $state.DockerIterationsAllowed = 1
    $state.StopOnFirstFailure = $true
    $state.SyntheticDataOnly = $true
    $proof = New-ApprovalProof -State $state -RepoRoot $Fixture.Root
    Assert-Condition $proof.Success "Synthetic signed proof could not be created: $($proof.Reason)"
    $state.AuthorityProof = $proof.Proof
    return $state
}

function Remove-AdoptionFixture {
    param($Fixture)
    if ($Fixture.Junction -and (Test-Path -LiteralPath $Fixture.Junction)) {
        $item = Get-Item -LiteralPath $Fixture.Junction -Force
        Assert-Condition (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) 'Refusing to remove a non-junction fixture'
        [IO.Directory]::Delete($Fixture.Junction, $false)
    }
    if (Test-Path -LiteralPath $Fixture.Root) { Remove-Item -LiteralPath $Fixture.Root -Recurse -Force }
    if ($Fixture.EscapeTarget -and (Test-Path -LiteralPath $Fixture.EscapeTarget)) { Remove-Item -LiteralPath $Fixture.EscapeTarget -Recurse -Force }
    if (Test-Path -LiteralPath $Fixture.Trust) { Remove-Item -LiteralPath $Fixture.Trust -Recurse -Force }
}

try {
    # A: committed target on precisely the signed HEAD, with unrelated .ai
    # state outside the target path, prepares without faking generation.
    $fixture = New-AdoptionFixture
    try {
        $RepoRoot = $fixture.Root
        $script:FixtureState = New-SignedFixtureState -Fixture $fixture
        $script:FixtureState.DbApproved = $true
        $script:FixtureState.DbApprovedHash = 'stale-prior-hash'
        $script:FixtureState.DbApplyApproved = $true
        $script:FixtureState.DbReviewVerdict = 'PASS'
        $script:FixtureState.DbReviewedHash = 'stale-prior-hash'
        $script:StateSaves = 0
        $ledger = $script:FixtureState.AuthorityProof.ConsumptionLedgerPath
        $ledgerBefore = Get-Content -LiteralPath $ledger -Raw
        Invoke-PrepareMigration -MigrationFile $script:Migration
        Assert-Condition ($script:FixtureState.DbMigrationFile -ceq $script:Migration) 'A: exact migration path not recorded'
        Assert-Condition ($script:FixtureState.DbMigrationProvenance -ceq 'EXISTING_TRACKED_HEAD') 'A: provenance not recorded'
        Assert-Condition ($script:FixtureState.DbMigrationHash -ceq (Get-MigrationHash -Path $script:Migration)) 'A: raw SHA256 not recorded'
        Assert-Condition ($script:FixtureState.DbStaticValidation -eq 'PASS') 'A: static validation must pass'
        Assert-Condition (-not $script:FixtureState.DbApproved -and -not $script:FixtureState.DbApprovedHash -and -not $script:FixtureState.DbApplyApproved) 'A: prior approval must be cleared'
        Assert-Condition (-not $script:FixtureState.DbReviewedHash -and $script:FixtureState.DbReviewVerdict -eq 'PENDING') 'A: separate review gate must remain pending'
        Assert-Condition (@($script:FixtureState.TaskGeneratedFiles).Count -eq 0) 'A: TaskGeneratedFiles must remain empty'
        Assert-Condition ((Get-Content -LiteralPath $ledger -Raw) -ceq $ledgerBefore) 'A: ledger must not be consumed or changed'
        Write-Output 'A exact tracked HEAD / signed proof: PASS'

        $script:StateSaves = 0
        $errorText = $null
        try { Invoke-PrepareMigration | Out-Null } catch { $errorText = $_.Exception.Message }
        Assert-Condition ($errorText -match 'TRACKED_MIGRATION_REJECTED') 'A2: no-argument re-prepare must not downgrade tracked provenance'
        Assert-Condition ($script:FixtureState.DbMigrationProvenance -ceq 'EXISTING_TRACKED_HEAD' -and $script:StateSaves -eq 0) 'A2: provenance/state changed on rejected re-prepare'
        Set-Content -LiteralPath (Join-Path $RepoRoot $script:Migration) -Value 'select 7;' -NoNewline -Encoding utf8
        foreach ($gate in @('Review', 'Approve')) {
            $errorText = $null
            try {
                if ($gate -eq 'Review') { Invoke-ReviewMigration | Out-Null } else { Invoke-ApproveMigration | Out-Null }
            } catch { $errorText = $_.Exception.Message }
            Assert-Condition ($errorText -match 'TRACKED_MIGRATION_REJECTED') "A2: ${gate} must reject a modified adopted file before any side effect"
            Assert-Condition ($script:StateSaves -eq 0) "A2: ${gate} wrote state on a denied file"
        }
        $script:FixtureState.DbMigrationProvenance = 'TASK_GENERATED_NEW'
        $errorText = $null
        try { Invoke-ReviewMigration | Out-Null } catch { $errorText = $_.Exception.Message }
        Assert-Condition ($errorText -match 'TRACKED_MIGRATION_REJECTED') 'A2: tracked file with downgraded provenance must be rejected at review'
        $errorText = $null
        try { Invoke-ApproveMigration | Out-Null } catch { $errorText = $_.Exception.Message }
        Assert-Condition ($errorText -match 'TRACKED_MIGRATION_REJECTED') 'A2: tracked file with downgraded provenance must be rejected at approval'
        $script:FixtureState.DbApproved = $true
        $script:FixtureState.DbApprovedHash = Get-MigrationHash -Path $script:Migration
        function Test-LocalSupabaseRunning { throw 'UNSAFE_SUPABASE_CHECK_REACHED' }
        function Invoke-BoundedLocalDatabaseValidation { throw 'UNSAFE_BOUNDED_GATE_REACHED' }
        $errorText = $null
        try { Invoke-ApplyMigration -Target 'LOCAL' | Out-Null } catch { $errorText = $_.Exception.Message }
        Assert-Condition ($errorText -match 'TRACKED_MIGRATION_REJECTED') "A2: Apply must reject a downgraded tracked file before any Supabase/ledger path ($errorText)"
        Assert-Condition ($script:StateSaves -eq 0) 'A2: denied Apply mutated task state'
        Assert-Condition ((Get-Content -LiteralPath $ledger -Raw) -ceq $ledgerBefore) 'A2: ledger changed during review/approval denial'
        Write-Output 'A2 provenance downgrade and stale review/approval/apply: PASS'
    } finally { Remove-AdoptionFixture $fixture }

    foreach ($case in @('B-untracked', 'C-modified', 'D-staged', 'D2-staged-only', 'E-outside', 'F-traversal', 'G-junction', 'H-not-allowed', 'I-wrong-head', 'J-duplicate', 'K-bad-hmac', 'L-duplicate-allowlist', 'M-empty-path')) {
        $fixture = New-AdoptionFixture -DuplicateAtHead:($case -eq 'J-duplicate')
        try {
            $RepoRoot = $fixture.Root
            $allowlist = if ($case -eq 'H-not-allowed') { @('supabase/migrations/20261004023133_other.sql') } else { @($script:Migration) }
            $script:FixtureState = New-SignedFixtureState -Fixture $fixture -Allowlist $allowlist
            $path = $script:Migration
            switch ($case) {
                'B-untracked' {
                    $path = 'supabase/migrations/20261004023133_untracked.sql'
                    Set-Content -LiteralPath (Join-Path $RepoRoot $path) -Value 'select 3;' -NoNewline -Encoding utf8
                    # Sign a fresh proof that legitimately names this path.
                    $script:FixtureState.LocalMigrationAllowlist = @($path)
                    $proof = New-ApprovalProof -State $script:FixtureState -RepoRoot $RepoRoot
                    Assert-Condition $proof.Success 'B: synthetic re-sign failed'
                    $script:FixtureState.AuthorityProof = $proof.Proof
                }
                'C-modified' { Set-Content -LiteralPath (Join-Path $RepoRoot $path) -Value 'select 4;' -NoNewline -Encoding utf8 }
                'D-staged' {
                    Set-Content -LiteralPath (Join-Path $RepoRoot $path) -Value 'select 5;' -NoNewline -Encoding utf8
                    & git -C $RepoRoot add -- $path
                }
                'D2-staged-only' {
                    $originalBytes = [IO.File]::ReadAllBytes((Join-Path $RepoRoot $path))
                    Set-Content -LiteralPath (Join-Path $RepoRoot $path) -Value 'select 6;' -NoNewline -Encoding utf8
                    & git -C $RepoRoot add -- $path
                    [IO.File]::WriteAllBytes((Join-Path $RepoRoot $path), $originalBytes)
                }
                'E-outside' { $path = 'tools/20261004023132_not_a_migration.sql' }
                'F-traversal' { $path = 'supabase/migrations/../migrations/20261004023132_c4_wave1_erector_snapshot.sql' }
                'G-junction' {
                    $original = Join-Path $RepoRoot 'supabase/migrations'
                    $fixture.EscapeTarget = Join-Path $script:Scratch ('teras-adopt-target-' + [guid]::NewGuid().ToString('N'))
                    New-Item -ItemType Directory -Path $fixture.EscapeTarget -Force | Out-Null
                    Copy-Item -LiteralPath (Join-Path $RepoRoot $path) -Destination (Join-Path $fixture.EscapeTarget (Split-Path -Leaf $path))
                    $marker = Join-Path $fixture.EscapeTarget 'sentinel.txt'
                    Set-Content -LiteralPath $marker -Value 'untouched' -NoNewline
                    Move-Item -LiteralPath $original -Destination (Join-Path $RepoRoot 'supabase/migrations-saved')
                    New-Item -ItemType Junction -Path $original -Target $fixture.EscapeTarget | Out-Null
                    $fixture.Junction = $original
                }
                'I-wrong-head' {
                    & git -C $RepoRoot -c core.hooksPath=/dev/null commit --allow-empty -m 'synthetic later HEAD' --quiet
                }
                'K-bad-hmac' { $script:FixtureState.AuthorityProof.Hmac = ('0' * 64) }
                'L-duplicate-allowlist' {
                    $script:FixtureState.LocalMigrationAllowlist = @($path, $path)
                    $proof = New-ApprovalProof -State $script:FixtureState -RepoRoot $RepoRoot
                    Assert-Condition $proof.Success 'L: synthetic re-sign failed'
                    $script:FixtureState.AuthorityProof = $proof.Proof
                }
                'M-empty-path' { $path = '' }
            }
            $script:StateSaves = 0
            $ledger = $script:FixtureState.AuthorityProof.ConsumptionLedgerPath
            $ledgerBefore = Get-Content -LiteralPath $ledger -Raw
            $errorText = $null
            try { Invoke-PrepareMigration -MigrationFile $path | Out-Null } catch { $errorText = $_.Exception.Message }
            Assert-Condition ($null -ne $errorText -and $errorText -match 'TRACKED_MIGRATION_REJECTED') "${case}: expected a tracked-migration rejection; got: $errorText"
            Assert-Condition ($script:StateSaves -eq 0) "${case}: denied preparation must not write task state"
            Assert-Condition (-not $script:FixtureState.DbMigrationFile -and -not $script:FixtureState.DbApproved) "${case}: denied preparation must not record/approve a file"
            Assert-Condition ((Get-Content -LiteralPath $ledger -Raw) -ceq $ledgerBefore) "${case}: ledger must remain untouched"
            if ($case -eq 'G-junction') { Assert-Condition ((Get-Content -LiteralPath $marker -Raw) -ceq 'untouched') 'G: escaped target changed' }
            Write-Output "$case rejected before state write: PASS"
        } finally { Remove-AdoptionFixture $fixture }
    }

    # Legacy task-generated new migration remains usable without an AuthorityProof.
    $fixture = New-AdoptionFixture
    try {
        $RepoRoot = $fixture.Root
        $script:FixtureState = New-EmptyTaskState
        $script:FixtureState.State = 'CREATED'
        $script:FixtureState.Description = 'Synthetic generated SQL review'
        $generated = 'supabase/migrations/20261004023133_generated.sql'
        Set-Content -LiteralPath (Join-Path $RepoRoot $generated) -Value 'select 1;' -NoNewline -Encoding utf8
        $script:FixtureState.TaskGeneratedFiles = @($generated)
        Invoke-PrepareMigration
        Assert-Condition ($script:FixtureState.DbMigrationFile -ceq $generated) 'Legacy: task-generated migration not found'
        Assert-Condition ($script:FixtureState.DbStaticValidation -ceq 'PASS') 'Legacy: static validation regressed'
        Assert-Condition ($script:FixtureState.DbMigrationProvenance -ceq 'TASK_GENERATED_NEW') 'Legacy: provenance must reflect task generation'
        function New-CodexDatabaseReviewHandoff { param($State) return 'synthetic review (not written)' }
        function Invoke-CodexReview { param($HandoffPath) return $false }
        Invoke-ReviewMigration
        Assert-Condition ($script:FixtureState.DbReviewVerdict -eq 'PENDING') 'Legacy: Review could not reach the review step'
        $script:FixtureState.DbState = 'DB_AWAITING_APPROVAL'
        $script:FixtureState.DbReviewVerdict = 'PASS'
        $script:FixtureState.DbReviewedHash = Get-MigrationHash -Path $generated
        function Read-Host { param([string]$Prompt) return 'NO' }
        Invoke-ApproveMigration
        Assert-Condition (-not $script:FixtureState.DbApproved) 'Legacy: declined human approval was bypassed'
        Write-Output 'Legacy TaskGeneratedFiles flow: PASS'
    } finally { Remove-AdoptionFixture $fixture }
    Write-Output 'ALL TRACKED MIGRATION ADOPTION TESTS: PASS'
} finally {
    $env:TERAS_APPROVAL_TRUST_DIR_OVERRIDE = $script:OriginalTrustOverride
}
