<#
    db-runner.ps1 - dedicated database migration safety system for the
    TERAS AI Engineering Orchestrator. Dot-sourced by teras-agent.ps1,
    which must set $RepoRoot, $AiDir before sourcing this file. Depends on
    agent-router.ps1 (Format-FileList, Test-AnyKeyword, $DbSensitiveKeywords),
    agent-runner.ps1 (Test-ClaudeAvailable, Invoke-ClaudeImplementation),
    review-runner.ps1 (Test-CodexAvailable, Invoke-CodexReview), and
    approval-runner.ps1 (Save-ApprovalRecord) also being sourced first.

    This is a SEPARATE approval track from the application release track
    (approval-runner.ps1 / release-runner.ps1) - see section on
    "Db* fields are independent of the app State/Risk" below. A task can be
    RELEASE_READY on the application side and still DB_AWAITING_APPROVAL on
    the database side; -Release never implies -ApproveMigration or vice
    versa, and neither implies -ApplyMigration.

    Hard safety invariants enforced in this file, not just documented:
    - never runs `supabase db reset`, `DROP DATABASE`, or any destructive
      command against any environment, ever
    - PRODUCTION apply NEVER actually executes, even after full approval
      and the strengthened confirmation phrase - this script builds the
      complete gated workflow up to that point and then hands off to
      manual execution, the same boundary held for commit/push/merge/
      deploy throughout this orchestrator. See Invoke-ApplyMigration.
    - LOCAL apply only ever runs if a local Supabase stack is actually
      detected running (`supabase status`) - never assumed
    - STAGING apply never fabricates a staging environment that isn't
      actually configured
    - migration approval is bound to a SHA-256 hash of the migration file
      plus the git commit SHA; any drift invalidates the approval and
      requires a fresh Codex review and a fresh human approval
    - Codex is never invoked a second time for the same migration content
      (same hash) - see Test-DbReviewStale
    - no connection string, service-role key, or credential is ever
      written into a report file - see Get-RedactedText
#>

$script:MigrationFilenamePattern = '^\d{14}_[a-z0-9_]+\.sql$'

$script:SqlDangerPatterns = [ordered]@{
    "DROP TABLE"                     = '(?im)\bDROP\s+TABLE\b'
    "DROP SCHEMA"                    = '(?im)\bDROP\s+SCHEMA\b'
    "DROP COLUMN"                    = '(?im)\bDROP\s+COLUMN\b'
    "TRUNCATE"                       = '(?im)\bTRUNCATE\b'
    "DELETE FROM"                    = '(?im)\bDELETE\s+FROM\b'
    "ALTER TABLE ... DROP"           = '(?im)\bALTER\s+TABLE\s+\S+\s+DROP\b'
    "CASCADE"                        = '(?im)\bCASCADE\b'
    "DISABLE ROW LEVEL SECURITY"     = '(?im)\bDISABLE\s+ROW\s+LEVEL\s+SECURITY\b'
    "GRANT ALL"                      = '(?im)\bGRANT\s+ALL\b'
    "SECURITY DEFINER"               = '(?im)\bSECURITY\s+DEFINER\b'
}

$script:CertificateDbTokens = @(
    "certificate_number", "verification_token", "verification_url", "status",
    "verification_enabled", "deleted_at", "eligibility", "verify_and_log",
    "certificate"
)

$script:ObjectPatterns = @(
    @{ Label = "table"; Regex = '(?im)^\s*CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([\w\.]+)"?' }
    @{ Label = "table (altered)"; Regex = '(?im)^\s*ALTER\s+TABLE\s+"?([\w\.]+)"?' }
    @{ Label = "policy"; Regex = "(?im)^\s*CREATE\s+POLICY\s+[`"']?([\w ]+?)[`"']?\s+ON\s+([\w\.]+)" }
    @{ Label = "function"; Regex = '(?im)^\s*CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+"?([\w\.]+)"?' }
    @{ Label = "trigger"; Regex = '(?im)^\s*CREATE\s+(?:OR\s+REPLACE\s+)?TRIGGER\s+"?([\w\.]+)"?' }
    @{ Label = "index"; Regex = '(?im)^\s*CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([\w\.]+)"?' }
    @{ Label = "constraint"; Regex = '(?im)\bADD\s+CONSTRAINT\s+"?([\w\.]+)"?' }
)

$script:CriticalKeywords = @(
    "drop table", "drop column", "delete", "truncate", "cascade",
    "auth", "service_role", "security definer", "widen", "expand access"
)

# ---------------------------------------------------------------------------
# Detection / static analysis - all pure text operations, no live DB query.
# ---------------------------------------------------------------------------

function Test-MigrationFilenameConvention {
    param([string]$Path)
    $name = Split-Path -Leaf $Path
    return ($name -match $script:MigrationFilenamePattern)
}

# A migration file is only "new" if it did not exist at HEAD before this
# task's changes - historical migrations are immutable (section 5).
function Test-MigrationIsNew {
    param([string]$Path)
    Push-Location $RepoRoot
    try {
        # A nonexistent path is the expected/common case (a brand-new
        # migration), not a real error - `git cat-file -e`'s non-zero exit
        # throws under this script's $ErrorActionPreference = "Stop" even
        # with stderr redirected, so this must be a try/catch, not a
        # $LASTEXITCODE check.
        git cat-file -e "HEAD:$Path" 2>$null
        return $false
    } catch {
        return $true
    } finally {
        Pop-Location
    }
}

function Get-MigrationHash {
    param([string]$Path)
    $fullPath = Join-Path $RepoRoot $Path
    if (-not (Test-Path $fullPath)) { return $null }
    return (Get-FileHash -Path $fullPath -Algorithm SHA256).Hash
}

function Get-SqlDangerScan {
    param([string]$Sql)

    $flags = @()
    foreach ($label in $script:SqlDangerPatterns.Keys) {
        if ($Sql -match $script:SqlDangerPatterns[$label]) { $flags += $label }
    }

    foreach ($stmt in ($Sql -split ';')) {
        if ($stmt -match '(?im)^\s*UPDATE\s+\S+\s+SET' -and $stmt -notmatch '(?im)\bWHERE\b') {
            $flags += "UPDATE without WHERE"
            break
        }
    }

    return @($flags | Select-Object -Unique)
}

function Get-SqlObjectsChanged {
    param([string]$Sql)

    $objects = @()
    foreach ($p in $script:ObjectPatterns) {
        foreach ($m in [regex]::Matches($Sql, $p.Regex)) {
            $objects += "$($p.Label): $($m.Groups[1].Value.Trim())"
        }
    }
    return @($objects | Select-Object -Unique)
}

function Test-CertificateDbImpact {
    param([string]$Sql)
    foreach ($token in $script:CertificateDbTokens) {
        if ($Sql -match "(?im)\b$([regex]::Escape($token))\b") { return $true }
    }
    return $false
}

function Test-DataMigration {
    param([string]$Sql)
    return ($Sql -match '(?im)^\s*(UPDATE|DELETE|INSERT\s+INTO\s+\S+\s+SELECT)\b')
}

function Get-ForeignKeyNotes {
    param([string]$Sql)
    $notes = @()
    if ($Sql -match '(?im)\bREFERENCES\b') {
        if ($Sql -match '(?im)ON\s+DELETE\s+CASCADE') { $notes += "ON DELETE CASCADE present - confirm cascade is intentional, not assumed safe." }
        if ($Sql -notmatch '(?im)ON\s+DELETE\b') { $notes += "Foreign key with no explicit ON DELETE behavior - confirm the default (NO ACTION/RESTRICT) is intended." }
        $notes += "New foreign key detected - verify no orphaned records exist for the referencing column before this can be applied."
    }
    return @($notes)
}

function Get-IndexNotes {
    param([string]$Sql)
    $notes = @()
    if ($Sql -match '(?im)\bCREATE\s+(UNIQUE\s+)?INDEX\b') {
        $notes += "Index creation detected - confirm this has an explicit query/constraint purpose, not speculative, and that build-time locking impact on a live table has been considered."
    }
    return @($notes)
}

function Get-DatabaseRisk {
    param([string]$Sql, [string]$Description)

    $danger = Get-SqlDangerScan -Sql $Sql
    $destructive = @($danger | Where-Object { $_ -in @("DROP TABLE", "DROP SCHEMA", "DROP COLUMN", "TRUNCATE", "DELETE FROM", "ALTER TABLE ... DROP") }).Count -gt 0
    $securityDefiner = ($danger -contains "SECURITY DEFINER")
    # RLS/auth access expansion (section 3's CRITICAL list) is not just
    # DISABLE RLS / GRANT ALL - a brand-new policy granting anon/public
    # access with an unconditional USING (true) is the far more common way
    # a migration actually widens access, and is just as CRITICAL.
    $rlsExpansion = ($Sql -match '(?im)\bDISABLE\s+ROW\s+LEVEL\s+SECURITY\b') -or
                     ($Sql -match '(?im)\bGRANT\s+ALL\b') -or
                     (($Sql -match '(?ims)\bCREATE\s+POLICY\b.*?\bTO\s+(anon|public)\b') -and ($Sql -match '(?im)USING\s*\(\s*true\s*\)'))
    $certImpact = Test-CertificateDbImpact -Sql $Sql
    $dataMigration = Test-DataMigration -Sql $Sql
    $hasUnique = ($Sql -match '(?im)\bUNIQUE\b')

    $isCritical = $destructive -or $securityDefiner -or $rlsExpansion -or $certImpact -or $dataMigration -or
                  (Test-AnyKeyword -Text $Description -Keywords $script:CriticalKeywords)

    return [pscustomobject]@{
        Risk               = if ($isCritical) { "CRITICAL" } else { "HIGH" }
        DangerousStatements = $danger
        Destructive        = $destructive
        SecurityDefiner    = $securityDefiner
        RlsImpact          = ($Sql -match '(?im)\b(POLICY|ROW\s+LEVEL\s+SECURITY)\b')
        AuthImpact         = ($Sql -match '(?im)\bauth\.')
        CertificateImpact  = $certImpact
        DataMigration      = $dataMigration
        HasUniqueConstraint = $hasUnique
        ObjectsChanged     = Get-SqlObjectsChanged -Sql $Sql
        ForeignKeyNotes    = Get-ForeignKeyNotes -Sql $Sql
        IndexNotes         = Get-IndexNotes -Sql $Sql
    }
}

# Never let a connection string or key leak into a generated report, even
# accidentally pasted into a description or found in surrounding SQL comments.
function Get-RedactedText {
    param([string]$Text)
    if ([string]::IsNullOrEmpty($Text)) { return $Text }
    $redacted = $Text -replace '(?i)(postgres(?:ql)?:\/\/)[^@\s]+@', '$1***REDACTED***@'
    $redacted = $redacted -replace '(?i)(service_role|SUPABASE_SERVICE_ROLE_KEY)\s*[:=]\s*\S+', '$1=***REDACTED***'
    $redacted = $redacted -replace 'eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\S*', '***REDACTED_JWT***'
    return $redacted
}

# ---------------------------------------------------------------------------
# -PrepareMigration
# ---------------------------------------------------------------------------

function Find-MigrationFile {
    param($State)
    $candidates = @(@($State.TaskGeneratedFiles) | Where-Object { $_ -match '(^|/)supabase/migrations/.*\.sql$' })
    if ($candidates.Count -gt 0) { return $candidates[0] }
    return $null
}

function New-DatabaseHandoff {
    param($State)

    $path = Join-Path $AiDir "DATABASE_HANDOFF.md"
    $allowedText = if (@($State.AllowedFiles).Count -gt 0) { (@($State.AllowedFiles) | ForEach-Object { "- $_" }) -join "`n" } else { "- supabase/migrations/ (new file only - see MIGRATION FILE RULE below)" }

    $content = @"
# DATABASE_HANDOFF.md

> Generated per task by ``tools/db-runner.ps1``. This is a controlled, separate track from the ordinary Claude handoff - database changes get an additional dedicated review/approval/apply pipeline on top of everything in CLAUDE_HANDOFF.md.

## TASK

Task ID: $($State.TaskId)
Description: $($State.Description)

## BUSINESS PURPOSE

$($State.Description)

## RISK

$($State.Risk) (final database-specific risk is reassessed from the actual SQL once written - see MODEL_ROUTING.md/DATABASE_SAFETY.md)

## CURRENT DATABASE ASSUMPTIONS

Do not assume the live schema matches any historical migration file's intent. Verify against the connected Supabase project (list_tables / list_migrations) before writing SQL that alters or references an existing object - per the root CLAUDE.md section 11 rule 1.

## APPROVED TABLES / FUNCTIONS / POLICIES

$allowedText

Only touch database objects directly required by the task description above. Do not modify unrelated tables, functions, or policies "while you're in there."

## ALLOWED MIGRATION FILE

A single new file under ``supabase/migrations/`` named ``YYYYMMDDHHMMSS_description.sql`` (project convention). Historical migrations are IMMUTABLE - if a past migration was wrong, write a NEW correcting migration, never edit an old one.

## BLOCKED DATABASE OBJECTS

Anything not named in APPROVED TABLES / FUNCTIONS / POLICIES above, and anything touching certificate issuance/verification/eligibility/numbering logic unless that is explicitly this task's purpose.

## DATA LOSS RISK

State explicitly in your implementation report whether this migration can destroy data (DROP, TRUNCATE, DELETE, a column type change that truncates values, etc). Assume "yes, treat as destructive" if uncertain.

## ROLLBACK REQUIREMENT

Describe how this migration would be reversed - a NEW migration undoing it - and whether that reversal is fully safe (e.g. dropping a column you just added is safe; recovering data you just deleted is not).

## VERIFICATION REQUIREMENTS

Describe, in your implementation report, how a human would confirm this migration did what it claims (which table/column/policy/function to check, and what a correct result looks like).

## EXPLICIT INSTRUCTIONS

Prepare SQL only.

Do NOT apply the migration.
Do NOT execute production writes.
Do NOT reset the database.
Do NOT modify unrelated schema.
Do NOT bypass RLS.
"@

    Set-Content -Path $path -Value $content -Encoding utf8
    return $path
}

function Invoke-PrepareMigration {
    $state = Get-TaskState
    if ($state.State -eq "NONE") {
        Write-Host ""
        Write-Host "No current task found."
        Write-Host ""
        return
    }

    if (-not $state.DbRequired) {
        $state.DbRequired = $true
    }
    $state.DbState = "DB_PREPARING"
    Save-TaskState -State $state

    $handoffPath = New-DatabaseHandoff -State $state
    Write-Host ""
    Write-Host "Database handoff generated: $handoffPath"

    $migrationFile = Find-MigrationFile -State $state
    if (-not $migrationFile) {
        Write-Host ""
        Write-Host "No migration file found yet under supabase/migrations/ among this task's changed files."
        Write-Host "Use .ai/DATABASE_HANDOFF.md when running Claude for this task (CLAUDE_DEEP is already selected for DB-sensitive tasks)."
        Write-Host "Re-run -PrepareMigration once the migration file exists to run static validation."
        Write-Host ""
        return
    }

    $staticOk = $true
    if (-not (Test-MigrationFilenameConvention -Path $migrationFile)) {
        $staticOk = $false
        Write-Host ""
        Write-Host "MIGRATION FILENAME CONVENTION VIOLATION"
        Write-Host ""
        Write-Host "$migrationFile does not match supabase/migrations/YYYYMMDDHHMMSS_description.sql"
        Write-Host ""
    }
    if (-not (Test-MigrationIsNew -Path $migrationFile)) {
        $staticOk = $false
        Write-Host ""
        Write-Host "HISTORICAL MIGRATION MODIFIED"
        Write-Host ""
        Write-Host "$migrationFile already existed before this task - historical migrations are immutable."
        Write-Host "Write a NEW correcting migration instead, unless this edit was explicitly, separately approved."
        Write-Host ""
    }

    $sqlPath = Join-Path $RepoRoot $migrationFile
    $sql = if (Test-Path $sqlPath) { Get-Content -Path $sqlPath -Raw } else { "" }
    $analysis = Get-DatabaseRisk -Sql $sql -Description $state.Description

    $state.DbMigrationFile = $migrationFile
    $state.DbMigrationHash = Get-MigrationHash -Path $migrationFile
    $state.DbObjectsChanged = $analysis.ObjectsChanged
    $state.DbDangerousStatements = $analysis.DangerousStatements
    $state.DbSecurityDefinerDetected = $analysis.SecurityDefiner
    $state.DbRlsImpact = $analysis.RlsImpact
    $state.DbAuthImpact = $analysis.AuthImpact
    $state.DbCertificateImpact = $analysis.CertificateImpact
    $state.DbDataMigration = $analysis.DataMigration
    $state.DbDestructiveSql = $analysis.Destructive
    $state.DbForeignKeyNotes = $analysis.ForeignKeyNotes
    $state.DbIndexNotes = $analysis.IndexNotes
    $state.DbDuplicatePrecheck = if ($analysis.HasUniqueConstraint) { "NOT_RUN" } else { "N/A" }
    $state.DbRisk = $analysis.Risk
    $state.DbStaticValidation = if ($staticOk) { "PASS" } else { "FAIL" }
    $state.DbState = if ($staticOk) { "DB_REVIEWING" } else { "DB_REVIEW_BLOCKED" }

    # Certificate-affecting or SECURITY DEFINER DB work always escalates the
    # whole task, not just the migration - sections 7/22.
    if ($analysis.CertificateImpact -or $analysis.SecurityDefiner) {
        $state.Risk = "CRITICAL"
        $state.ImplementerModel = "CLAUDE_DEEP"
        $state.Reviewer = "Codex"; $state.ReviewerModel = "CODEX_REVIEW"
        $state.HumanApprovalRequired = "REQUIRED"
    }

    Save-TaskState -State $state
    Write-DatabaseReport -State $state

    Write-Host ""
    Write-Host "DANGEROUS SQL DETECTED: $(if (@($analysis.DangerousStatements).Count -gt 0) { $analysis.DangerousStatements -join ', ' } else { 'None' })"
    Write-Host "Database Risk: $($state.DbRisk)"
    Write-Host "Objects Changed: $(if (@($analysis.ObjectsChanged).Count -gt 0) { $analysis.ObjectsChanged -join '; ' } else { '(none detected)' })"
    Write-Host ""
    Write-Host "See .ai/DATABASE_REPORT.md. Next: teras-agent -ReviewMigration"
    Write-Host ""
}

# ---------------------------------------------------------------------------
# DATABASE_REPORT.md - the mechanical fields are always regenerated from
# state; the "Codex Review:" line and findings section are written by Codex
# (or a human on its behalf) via CODEX_DATABASE_REVIEW_HANDOFF.md, then
# re-parsed back into state by Get-DbReviewVerdict before the next rewrite.
# ---------------------------------------------------------------------------

function Write-DatabaseReport {
    param($State)

    $path = Join-Path $AiDir "DATABASE_REPORT.md"
    $objectsText = if (@($State.DbObjectsChanged).Count -gt 0) { (@($State.DbObjectsChanged) | ForEach-Object { "- $_" }) -join "`n" } else { "- (none detected)" }
    $dangerText = if (@($State.DbDangerousStatements).Count -gt 0) { ($State.DbDangerousStatements -join ", ") } else { "None" }
    $fkNotes = @($State.DbForeignKeyNotes | Where-Object { $_ })
    $fkText = if ($fkNotes.Count -gt 0) { ($fkNotes | ForEach-Object { "- $_" }) -join "`n" } else { "- N/A" }
    $idxNotes = @($State.DbIndexNotes | Where-Object { $_ })
    $idxText = if ($idxNotes.Count -gt 0) { ($idxNotes | ForEach-Object { "- $_" }) -join "`n" } else { "- N/A" }
    $dataImpact = if ($State.DbDestructiveSql -or $State.DbDataMigration) { "HIGH" } elseif (@($State.DbObjectsChanged).Count -gt 0) { "MEDIUM" } else { "LOW" }
    $rollback = if ($State.DbDestructiveSql -or $State.DbDataMigration) { "NOT SAFE - see .ai/ROLLBACK_PLAN.md" } else { "AVAILABLE" }

    $content = @"
# DATABASE_REPORT.md

TERAS DATABASE REVIEW

Task ID:
$($State.TaskId)

Migration:
$(if ($State.DbMigrationFile) { $State.DbMigrationFile } else { "(none)" })

Migration Hash:
$(if ($State.DbMigrationHash) { $State.DbMigrationHash } else { "(none)" })

Risk:
$(if ($State.DbRisk) { $State.DbRisk } else { "(not yet classified)" })

Objects Changed:
$objectsText

Data Impact:
$dataImpact

Destructive SQL:
$(if ($State.DbDestructiveSql) { "YES - $dangerText" } else { "NO" })

RLS Impact:
$(if ($State.DbRlsImpact) { "YES" } else { "NO" })

Auth Impact:
$(if ($State.DbAuthImpact) { "YES" } else { "NO" })

Certificate Impact:
$(if ($State.DbCertificateImpact) { "YES" } else { "NO" })

SECURITY DEFINER Detected:
$(if ($State.DbSecurityDefinerDetected) { "YES - mandatory security review (search_path, authorization checks, caller identity, RLS bypass, input validation, privilege escalation)" } else { "NO" })

Duplicate Precheck (UNIQUE constraints):
$($State.DbDuplicatePrecheck)

Foreign Key Notes:
$fkText

Index Notes:
$idxText

Rollback:
$rollback

Static Validation:
$($State.DbStaticValidation)

Codex Review:
$($State.DbReviewVerdict)

Migration Apply:
NOT APPROVED

---

## Codex Database Review Findings

_(Filled in by Codex - or a human reviewing on its behalf - via .ai/CODEX_DATABASE_REVIEW_HANDOFF.md. The "Codex Review:" line above is parsed programmatically and must be exactly PASS, PASS_WITH_NOTES, or BLOCKED on the line right after it.)_

Correctness:
Data Integrity:
RLS:
Authorization:
Security:
Backward Compatibility:
Deployment Ordering:
Rollback:
Certificate/Verification Impact:
Blocking Findings:
"@

    Set-Content -Path $path -Value (Get-RedactedText -Text $content) -Encoding utf8
}

function New-CodexDatabaseReviewHandoff {
    param($State)

    $path = Join-Path $AiDir "CODEX_DATABASE_REVIEW_HANDOFF.md"
    $sqlPath = Join-Path $RepoRoot $State.DbMigrationFile
    $sql = if (Test-Path $sqlPath) { Get-Content -Path $sqlPath -Raw } else { "(migration file not found)" }
    $sql = Get-RedactedText -Text $sql

    $diffText = ""
    if ($State.DbMigrationFile) {
        Push-Location $RepoRoot
        try { $diffText = (git diff -- $State.DbMigrationFile | Out-String) } finally { Pop-Location }
    }
    if ([string]::IsNullOrWhiteSpace($diffText)) { $diffText = "(no diff captured - file may be untracked)" }

    $content = @"
# CODEX_DATABASE_REVIEW_HANDOFF.md

> Generated by ``tools/db-runner.ps1``. READ ONLY REVIEW - do not modify SQL during this pass. Do not scan the full repository - you receive only what is listed below.

## WHAT YOU RECEIVE

- .ai/CURRENT_TASK.md
- .ai/DATABASE_HANDOFF.md
- The migration SQL (below)
- git diff for the migration file (below)
- Relevant current schema references, only if you explicitly ask for them - do not assume

## MIGRATION SQL ($($State.DbMigrationFile))

``````sql
$sql
``````

## GIT DIFF

``````diff
$diffText
``````

## STATIC SCAN RESULTS (already run - verify, do not just trust)

Dangerous statements flagged: $(if (@($State.DbDangerousStatements).Count -gt 0) { $State.DbDangerousStatements -join ", " } else { "None" })
SECURITY DEFINER detected: $(if ($State.DbSecurityDefinerDetected) { "YES" } else { "NO" })
Certificate-related objects touched: $(if ($State.DbCertificateImpact) { "YES" } else { "NO" })

## YOUR TASK

Perform an independent, read-only review. Write your findings into ``.ai/DATABASE_REPORT.md``'s "Codex Database Review Findings" section, covering exactly: Correctness, Data Integrity, RLS, Authorization, Security, Backward Compatibility, Deployment Ordering, Rollback, Certificate/Verification Impact, Blocking Findings.

For RLS specifically, report whether the policy widens access, narrows access, changes tenant isolation, affects public access, or affects certificate verification.

For SECURITY DEFINER specifically, check: search_path, authorization checks, caller identity assumptions, RLS bypass implications, input validation, privilege escalation risk.

Then set the ``Codex Review:`` line near the top of that same file to exactly one of:

Codex Review:
PASS

Codex Review:
PASS_WITH_NOTES

Codex Review:
BLOCKED
"@

    Set-Content -Path $path -Value $content -Encoding utf8
    return $path
}

function Get-DbReviewVerdict {
    $path = Join-Path $AiDir "DATABASE_REPORT.md"
    if (-not (Test-Path $path)) { return "PENDING" }
    $content = Get-Content -Path $path -Raw
    if ($content -match "(?m)^Codex Review:\s*\r?\n\s*(PASS_WITH_NOTES|PASS|BLOCKED)\b") { return $Matches[1] }
    if ($content -match "(?m)^Codex Review:\s*(PASS_WITH_NOTES|PASS|BLOCKED)\b") { return $Matches[1] }
    return "PENDING"
}

function Get-DbReviewBlockingFindings {
    $path = Join-Path $AiDir "DATABASE_REPORT.md"
    if (-not (Test-Path $path)) { return @() }
    $content = Get-Content -Path $path
    $capture = $false
    $findings = @()
    foreach ($line in $content) {
        if ($line -match "^Blocking Findings:") { $capture = $true; continue }
        if ($capture -and $line.Trim().Length -eq 0) { break }
        if ($capture -and $line.Trim().Length -gt 0) { $findings += $line.Trim() }
    }
    return @($findings)
}

# Never call Codex a second time for identical migration content - section 33.
function Test-DbReviewStale {
    param($State)
    if (-not $State.DbMigrationFile) { return $false }
    $currentHash = Get-MigrationHash -Path $State.DbMigrationFile
    return ($currentHash -ne $State.DbReviewedHash)
}

function Invoke-ReviewMigration {
    $state = Get-TaskState
    if (-not $state.DbMigrationFile) {
        Write-Host ""
        Write-Host "No migration file recorded. Run -PrepareMigration first."
        Write-Host ""
        return
    }

    if ($state.DbStaticValidation -eq "FAIL") {
        Write-Host ""
        Write-Host "REVIEW BLOCKED"
        Write-Host ""
        Write-Host "Static validation failed (filename convention or historical-migration immutability). Fix before requesting review."
        Write-Host ""
        return
    }

    $currentHash = Get-MigrationHash -Path $state.DbMigrationFile
    if (-not (Test-DbReviewStale -State $state) -and $state.DbReviewVerdict -in @("PASS", "PASS_WITH_NOTES", "BLOCKED")) {
        Write-Host ""
        Write-Host "Migration content unchanged since the last review (hash match) - reusing existing verdict: $($state.DbReviewVerdict)."
        Write-Host "Change the SQL to force a fresh review; Codex is not re-invoked for identical content."
        Write-Host ""
        return
    }

    $state.DbState = "DB_REVIEWING"
    Save-TaskState -State $state

    $handoffPath = New-CodexDatabaseReviewHandoff -State $state
    $ran = Invoke-CodexReview -HandoffPath $handoffPath
    $verdict = if ($ran) { Get-DbReviewVerdict } else { "PENDING" }

    $state.DbReviewVerdict = $verdict
    $state.DbReviewedHash = $currentHash
    $state.DbBlockingFindings = if ($verdict -eq "BLOCKED") { Get-DbReviewBlockingFindings } else { @() }
    $state.DbState = switch ($verdict) {
        "PASS" { "DB_AWAITING_APPROVAL" }
        "PASS_WITH_NOTES" { "DB_AWAITING_APPROVAL" }
        "BLOCKED" { "DB_REVIEW_BLOCKED" }
        default { "DB_REVIEWING" }
    }
    Save-TaskState -State $state
    Write-DatabaseReport -State $state

    Write-Host ""
    Write-Host "Codex Database Review verdict: $verdict"
    if ($verdict -eq "BLOCKED") {
        Write-Host "Blocking findings:"
        foreach ($f in $state.DbBlockingFindings) { Write-Host "- $f" }
    }
    Write-Host "See .ai/DATABASE_REPORT.md."
    Write-Host ""
}

# ---------------------------------------------------------------------------
# -ApproveMigration - a separate human gate from -Approve/-ApproveRelease.
# ---------------------------------------------------------------------------

function Invoke-ApproveMigration {
    $state = Get-TaskState
    if ($state.State -eq "NONE") {
        Write-Host ""; Write-Host "No current task found."; Write-Host ""
        return
    }
    if (-not $state.DbMigrationFile) {
        Write-Host ""; Write-Host "No migration file recorded. Run -PrepareMigration first."; Write-Host ""
        return
    }
    if ($state.DbState -ne "DB_AWAITING_APPROVAL") {
        Write-Host ""
        Write-Host "MIGRATION APPROVAL BLOCKED"
        Write-Host ""
        Write-Host "Reason:"
        Write-Host "Database state is $($state.DbState), not DB_AWAITING_APPROVAL (Codex Database Review must PASS or PASS_WITH_NOTES first)."
        Write-Host ""
        return
    }
    if (Test-DbReviewStale -State $state) {
        $state.DbState = "DB_REVIEW_BLOCKED"
        Save-TaskState -State $state
        Write-Host ""
        Write-Host "MIGRATION APPROVAL INVALIDATED"
        Write-Host ""
        Write-Host "The migration SQL has changed since the last Codex review. Re-run -ReviewMigration."
        Write-Host ""
        return
    }
    if ($state.DbReviewVerdict -notin @("PASS", "PASS_WITH_NOTES")) {
        Write-Host ""
        Write-Host "MIGRATION APPROVAL BLOCKED"
        Write-Host ""
        Write-Host "Reason:"
        Write-Host "Codex Database Review verdict is $($state.DbReviewVerdict)."
        Write-Host ""
        return
    }

    Push-Location $RepoRoot
    try { $headSha = (git rev-parse HEAD).Trim() } finally { Pop-Location }

    Write-Host ""
    Write-Host "========================================"
    Write-Host "TERAS DATABASE MIGRATION APPROVAL"
    Write-Host "========================================"
    Write-Host ""
    Write-Host "Task:"
    Write-Host $state.Description
    Write-Host ""
    Write-Host "Migration:"
    Write-Host $state.DbMigrationFile
    Write-Host ""
    Write-Host "Risk:"
    Write-Host $state.DbRisk
    Write-Host ""
    Write-Host "Codex:"
    Write-Host $state.DbReviewVerdict
    if ($state.DbReviewVerdict -eq "PASS_WITH_NOTES") {
        Write-Host "(PASS_WITH_NOTES - see .ai/DATABASE_REPORT.md; typing the approval phrase below is explicit acceptance of those notes.)"
    }
    Write-Host ""
    Write-Host "Destructive SQL:"
    Write-Host $(if ($state.DbDestructiveSql) { "YES - $($state.DbDangerousStatements -join ', ')" } else { "NO" })
    Write-Host ""
    Write-Host "RLS Impact:"
    Write-Host $(if ($state.DbRlsImpact) { "YES" } else { "NO" })
    Write-Host ""
    Write-Host "Production Data Impact:"
    Write-Host $(if ($state.DbDestructiveSql -or $state.DbDataMigration) { "HIGH" } elseif (@($state.DbObjectsChanged).Count -gt 0) { "MEDIUM" } else { "LOW" })
    Write-Host ""
    Write-Host "Duplicate Precheck:"
    Write-Host $state.DbDuplicatePrecheck
    if ($state.DbDuplicatePrecheck -eq "NOT_RUN") {
        Write-Host "(A UNIQUE constraint was detected and no automated duplicate check was run - this tool cannot query the live database. Confirm manually that no duplicate data exists before approving.)"
    }
    Write-Host ""
    Write-Host "Rollback:"
    Write-Host $(if ($state.DbDestructiveSql -or $state.DbDataMigration) { "NOT SAFE - see .ai/ROLLBACK_PLAN.md" } else { "AVAILABLE" })
    Write-Host ""
    Write-Host "Application Release Approval:"
    Write-Host $(if ($state.ReleaseApproved) { "YES" } else { "NO" })
    Write-Host ""
    Write-Host "Migration Apply Approval:"
    Write-Host "NO"
    Write-Host ""

    $confirm = Read-Host "Type APPROVE DATABASE MIGRATION to continue"
    if ($confirm -cne "APPROVE DATABASE MIGRATION") {
        Write-Host ""
        Write-Host "Migration approval cancelled."
        Write-Host ""
        return
    }

    $state.DbApproved = $true
    $state.DbApprovedAt = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $state.DbApprovedHash = $state.DbMigrationHash
    $state.DbApprovedCommitSha = $headSha
    $state.DbState = "DB_APPROVED"
    Save-TaskState -State $state
    Save-ApprovalRecord -State $state -Decision "DATABASE_MIGRATION_APPROVED"
    Write-DatabaseReport -State $state

    Write-Host ""
    Write-Host "Migration APPROVED (safety/correctness sign-off)."
    Write-Host "This does NOT grant Migration Apply Approval - that is a separate step: teras-agent -ApplyMigration"
    Write-Host ""
}

# ---------------------------------------------------------------------------
# -ApplyMigration - environment-gated. See file header for why PRODUCTION
# never actually executes here, even after full approval.
# ---------------------------------------------------------------------------

function Test-SupabaseCliAvailable {
    return $null -ne (Get-Command "supabase" -ErrorAction SilentlyContinue)
}

function Test-LocalSupabaseRunning {
    if (-not (Test-SupabaseCliAvailable)) { return $false }
    Push-Location $RepoRoot
    try {
        # Not-running is the expected/common failure case, not a real error
        # - see Test-GitHubCliAvailable's comment for why this is a
        # try/catch rather than a $LASTEXITCODE check.
        supabase status *> $null
        return $true
    } catch {
        return $false
    } finally {
        Pop-Location
    }
}

function Invoke-ApplyMigration {
    param([string]$Target)

    $state = Get-TaskState
    if (-not $state.DbApproved) {
        Write-Host ""
        Write-Host "APPLY BLOCKED"
        Write-Host ""
        Write-Host "Reason:"
        Write-Host "Migration has not been approved (teras-agent -ApproveMigration first)."
        Write-Host ""
        return
    }

    if ((Get-MigrationHash -Path $state.DbMigrationFile) -ne $state.DbApprovedHash) {
        $state.DbApproved = $false
        $state.DbState = "DB_REVIEW_BLOCKED"
        Save-TaskState -State $state
        Write-Host ""
        Write-Host "MIGRATION APPROVAL INVALIDATED"
        Write-Host ""
        Write-Host "The migration SQL has changed since approval. Re-run -ReviewMigration then -ApproveMigration."
        Write-Host ""
        return
    }

    if ([string]::IsNullOrWhiteSpace($Target)) {
        Write-Host ""
        Write-Host "APPLY BLOCKED"
        Write-Host ""
        Write-Host "An explicit target is required: teras-agent -ApplyMigration -Target LOCAL|STAGING|PRODUCTION"
        Write-Host "Environment is never inferred from environment variables alone."
        Write-Host ""
        return
    }
    $target = $Target.ToUpperInvariant()
    if ($target -notin @("LOCAL", "STAGING", "PRODUCTION")) {
        Write-Host ""
        Write-Host "APPLY BLOCKED"
        Write-Host ""
        Write-Host "Unknown target '$Target'. Must be LOCAL, STAGING, or PRODUCTION."
        Write-Host ""
        return
    }

    $state.DbApplyTarget = $target
    Save-TaskState -State $state

    if ($target -eq "STAGING") {
        Write-Host ""
        Write-Host "STAGING DATABASE NOT CONFIGURED"
        Write-Host ""
        Write-Host "No staging Supabase project is configured for this repository."
        Write-Host "This tool will not fabricate one. Apply to LOCAL for validation, or proceed to PRODUCTION only after full review."
        Write-Host ""
        return
    }

    if ($target -eq "LOCAL") {
        if (-not (Test-LocalSupabaseRunning)) {
            Write-Host ""
            Write-Host "LOCAL SUPABASE NOT DETECTED"
            Write-Host ""
            Write-Host "No running local Supabase stack was detected ('supabase status' failed, or the CLI is not installed)."
            Write-Host "Run 'supabase start' yourself first if you want a local apply target. Nothing was executed."
            Write-Host ""
            return
        }

        Write-Host ""
        Write-Host "This will apply $($state.DbMigrationFile) to your LOCAL Supabase instance only."
        Write-Host ""
        $confirm = Read-Host "Type YES to apply locally"
        if ($confirm -cne "YES") {
            Write-Host ""
            Write-Host "Apply cancelled."
            Write-Host ""
            return
        }

        $state.DbState = "DB_APPLYING"
        Save-TaskState -State $state
        Push-Location $RepoRoot
        try {
            # try/catch, not just 2>&1 - a native command's stderr output
            # becomes a terminating error under this script's
            # $ErrorActionPreference = "Stop" otherwise (same pattern as
            # Invoke-ClaudeImplementation/Invoke-CodexReview).
            supabase db push 2>&1 | Out-Host
            $exitCode = $LASTEXITCODE
        } catch {
            Write-Host "supabase db push failed: $($_.Exception.Message)"
            $exitCode = 1
        } finally {
            Pop-Location
        }

        if ($exitCode -eq 0) {
            $state.DbApplyStatus = "APPLIED"
            $state.DbState = "DB_VERIFYING"
            Write-Host ""
            Write-Host "Applied to LOCAL. Next: teras-agent -VerifyDatabase"
        } else {
            $state.DbApplyStatus = "BLOCKED"
            $state.DbState = "DB_ATTENTION_REQUIRED"
            Write-Host ""
            Write-Host "LOCAL apply failed - see output above."
        }
        Save-TaskState -State $state
        Write-Host ""
        return
    }

    # PRODUCTION - full gate, but this script never actually executes the
    # apply, even after the strengthened confirmation. See file header.
    Write-Host ""
    Write-Host "========================================"
    Write-Host "PRODUCTION DATABASE CHANGE"
    Write-Host "========================================"
    Write-Host ""
    Write-Host "Environment:"
    Write-Host "PRODUCTION"
    Write-Host ""
    Write-Host "Migration:"
    Write-Host $state.DbMigrationFile
    Write-Host ""
    Write-Host "Risk:"
    Write-Host $state.DbRisk
    Write-Host ""
    Write-Host "Affected Objects:"
    foreach ($o in @($state.DbObjectsChanged)) { Write-Host "- $o" }
    Write-Host ""
    Write-Host "Potential Data Loss:"
    Write-Host $(if ($state.DbDestructiveSql) { "YES - $($state.DbDangerousStatements -join ', ')" } else { "NO" })
    Write-Host ""
    Write-Host "RLS Change:"
    Write-Host $(if ($state.DbRlsImpact) { "YES" } else { "NO" })
    Write-Host ""
    Write-Host "Codex Review:"
    Write-Host $state.DbReviewVerdict
    Write-Host ""
    Write-Host "Rollback:"
    Write-Host $(if ($state.DbDestructiveSql -or $state.DbDataMigration) { "NOT FULLY REVERSIBLE" } else { "PARTIAL" })
    Write-Host ""

    if ($state.DbRisk -eq "CRITICAL" -and $state.DbDestructiveSql) {
        Write-Host "Backup Required: YES"
        Write-Host "Backup verification is not available from this tool - it cannot confirm a Supabase backup/PITR checkpoint exists."
        Write-Host ""
        Write-Host "PRODUCTION MIGRATION BLOCKED"
        Write-Host "A human must independently verify a backup/restore point exists before this destructive CRITICAL migration can proceed."
        Write-Host ""
        return
    }

    Write-Host "This action may change live database behavior."
    Write-Host ""

    $confirm = Read-Host "Type APPLY APPROVED PRODUCTION MIGRATION to continue"
    if ($confirm -cne "APPLY APPROVED PRODUCTION MIGRATION") {
        Write-Host ""
        Write-Host "Production apply cancelled. No production database change was made."
        Write-Host ""
        return
    }

    $state.DbApplyApproved = $true
    Save-TaskState -State $state
    Save-ApprovalRecord -State $state -Decision "DATABASE_MIGRATION_APPROVED"

    Write-Host ""
    Write-Host "Confirmed. This orchestrator does not execute production database writes automatically,"
    Write-Host "even after full approval - the connected Supabase project holds real production data, and"
    Write-Host "destructive database operations always require an explicit, in-the-moment human action"
    Write-Host "(root CLAUDE.md's own rule on this)."
    Write-Host ""
    Write-Host "Apply this migration yourself now, using whichever of the following you already have configured:"
    Write-Host "  - the Supabase MCP tools (apply_migration), or"
    Write-Host "  - supabase db push, run directly in your own terminal against the linked project, or"
    Write-Host "  - the Supabase dashboard SQL editor"
    Write-Host ""
    Write-Host "Then run 'teras-agent -VerifyDatabase' to record verification."
    Write-Host ""
}

# ---------------------------------------------------------------------------
# -VerifyDatabase / -DatabaseStatus / -DryRunMigration
# ---------------------------------------------------------------------------

function Invoke-VerifyDatabase {
    $state = Get-TaskState
    if ($state.DbApplyStatus -ne "APPLIED") {
        Write-Host ""
        Write-Host "No applied migration recorded for this task yet (Apply Status: $($state.DbApplyStatus))."
        Write-Host ""
        return
    }

    $state.DbState = "DB_VERIFYING"
    Save-TaskState -State $state

    Write-Host ""
    Write-Host "Verification checklist (non-destructive, read-only):"
    foreach ($o in @($state.DbObjectsChanged)) { Write-Host "- expected object present: $o" }
    Write-Host ""

    if (Test-SupabaseCliAvailable) {
        Push-Location $RepoRoot
        try {
            $list = supabase migration list 2>&1
            $exitCode = $LASTEXITCODE
        } catch {
            $list = @()
            $exitCode = 1
        } finally {
            Pop-Location
        }
        $migrationId = if ($state.DbMigrationFile) { (Split-Path -Leaf $state.DbMigrationFile) -replace '_.*$', '' } else { $null }
        $found = ($exitCode -eq 0) -and $migrationId -and (($list -join "`n") -match [regex]::Escape($migrationId))
        if ($found) {
            $state.DbVerificationStatus = "PASS"
            $state.DbState = "DB_COMPLETE"
            Write-Host "Migration ID $migrationId found in 'supabase migration list' output."
        } else {
            $state.DbVerificationStatus = "PENDING"
            Write-Host "Could not confirm the migration via 'supabase migration list' - verify the objects above manually."
        }
    } else {
        $state.DbVerificationStatus = "PENDING"
        Write-Host "supabase CLI not available - verify the objects above manually."
    }

    Save-TaskState -State $state
    Write-Host ""
    Write-Host "Database Verification: $($state.DbVerificationStatus)"
    Write-Host ""
}

function Invoke-DatabaseStatus {
    $state = Get-TaskState
    Write-Host ""
    Write-Host "========================================"
    Write-Host "TERAS DATABASE STATUS"
    Write-Host "========================================"
    Write-Host ""
    if ($state.State -eq "NONE" -or -not $state.DbRequired) {
        Write-Host "No database-relevant task currently active."
        Write-Host ""
        return
    }
    Write-Host "Task ID: $($state.TaskId)"
    Write-Host "Database State: $($state.DbState)"
    Write-Host "Database Risk: $(if ($state.DbRisk) { $state.DbRisk } else { '(not yet classified)' })"
    Write-Host "Migration File: $(if ($state.DbMigrationFile) { $state.DbMigrationFile } else { '(none)' })"
    Write-Host "Static Validation: $($state.DbStaticValidation)"
    Write-Host "Codex Database Review: $($state.DbReviewVerdict)"
    Write-Host "Migration Approved: $(if ($state.DbApproved) { 'YES' } else { 'NO' })"
    Write-Host "Migration Apply Approved: $(if ($state.DbApplyApproved) { 'YES' } else { 'NO' })"
    Write-Host "Apply Target: $(if ($state.DbApplyTarget) { $state.DbApplyTarget } else { '(none)' })"
    Write-Host "Apply Status: $($state.DbApplyStatus)"
    Write-Host "Database Verification: $($state.DbVerificationStatus)"
    Write-Host ""
    Write-Host "Application State: $($state.State)  (a separate track - see BUSINESS_RULES.md)"
    Write-Host ""
}

# Section 26/27: never guess when compatibility is uncertain - flag it
# instead. Called from release-runner.ps1's Write-ReleaseReport.
function Get-DeploymentOrder {
    param($State)

    if (-not $State.DbRequired -or -not $State.DbMigrationFile) {
        return "N/A - no database change in this release."
    }

    if ($State.DbDestructiveSql -or $State.DbDataMigration -or $State.DbSecurityDefinerDetected) {
        return @"
UNCERTAIN - Codex should confirm before release. This migration includes destructive/data-modifying/SECURITY DEFINER SQL, so application code and schema may not be safely deployable in either order. Do not assume atomicity - a coordinated maintenance-style deployment (or an expand/contract split into two migrations) is likely required. See section 27 of the database-safety workflow and .ai/DATABASE_REPORT.md.
"@.Trim()
    }

    if ($State.DbRlsImpact -or $State.DbAuthImpact) {
        return "DB FIRST, then verify, then deploy application - RLS/auth changes should be live before application code that depends on the new access rules ships, to avoid a window where the app assumes permissions the database doesn't grant yet (or vice versa)."
    }

    return @"
1. Apply the additive migration ($($State.DbMigrationFile))
2. Verify schema (teras-agent -VerifyDatabase)
3. Deploy application
This is the EXPAND pattern: the migration only adds objects (per static scan), so it is backward-compatible with the application code currently in production.
"@.Trim()
}

function Invoke-DryRunMigration {
    $state = Get-TaskState
    Write-Host ""
    Write-Host "DRY RUN MIGRATION - nothing will be executed."
    Write-Host ""
    if (-not $state.DbRequired) {
        Write-Host "This task is not currently flagged as database-relevant."
        Write-Host ""
        return
    }
    Write-Host "Migration: $(if ($state.DbMigrationFile) { $state.DbMigrationFile } else { '(not written yet)' })"
    Write-Host "Database Risk: $(if ($state.DbRisk) { $state.DbRisk } else { '(not yet classified)' })"
    Write-Host ""
    if ($state.DbMigrationFile) {
        $sqlPath = Join-Path $RepoRoot $state.DbMigrationFile
        $sql = if (Test-Path $sqlPath) { Get-Content -Path $sqlPath -Raw } else { "" }
        $danger = Get-SqlDangerScan -Sql $sql
        Write-Host "Dangerous statement scan: $(if (@($danger).Count -gt 0) { $danger -join ', ' } else { 'None detected' })"
    } else {
        Write-Host "Dangerous statement scan: (not run - no migration file yet)"
    }
    Write-Host ""
    Write-Host "Required Codex review: $(if ($state.DbReviewVerdict -in @('PASS', 'PASS_WITH_NOTES')) { 'already satisfied' } else { 'CODEX_REVIEW required before approval' })"
    Write-Host "Required approvals: -ApproveMigration (exact phrase APPROVE DATABASE MIGRATION), then -ApplyMigration -Target <LOCAL|STAGING|PRODUCTION>"
    Write-Host "  PRODUCTION additionally requires the exact phrase APPLY APPROVED PRODUCTION MIGRATION, and is never executed automatically even then - see -ApplyMigration."
    Write-Host ""
    Write-Host "Intended Supabase command: 'supabase db push' (LOCAL only, only if a local stack is detected running)"
    Write-Host "Verification plan: 'supabase migration list' (read-only) plus manual confirmation of expected objects: $(if (@($state.DbObjectsChanged).Count -gt 0) { $state.DbObjectsChanged -join '; ' } else { '(none detected yet)' })"
    Write-Host ""
}
