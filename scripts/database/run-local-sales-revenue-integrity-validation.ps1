param(
  [string]$ProjectId = 'terasuniversal-website-marketing-roi'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$container = "supabase_db_$ProjectId"
$localDbUrl = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
$actorId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
$env:TERAS_DOCKER_DB_CONTAINER = $container

function Invoke-LocalSqlFile([string]$Path) {
  Get-Content -Raw -LiteralPath $Path | docker exec -i $container psql -v ON_ERROR_STOP=1 -U postgres -d postgres
  if ($LASTEXITCODE -ne 0) { throw "SQL file failed: $Path" }
}

function Invoke-LocalSql([string]$Sql) {
  $Sql | docker exec -i $container psql -v ON_ERROR_STOP=1 -U postgres -d postgres -At
  if ($LASTEXITCODE -ne 0) { throw 'Local SQL query failed.' }
}

function Invoke-LocalPgTapFile([string]$Path) {
  $sql = "SET search_path = public, extensions;`n" + (Get-Content -Raw -LiteralPath $Path)
  $sql | docker exec -i $container psql -v ON_ERROR_STOP=1 -U postgres -d postgres
  if ($LASTEXITCODE -ne 0) { throw "pgTAP SQL file failed: $Path" }
}

if ($localDbUrl -notmatch '^postgresql://[^/]+@(localhost|127\.0\.0\.1):54322/postgres$') {
  throw 'Refusing to run: local database guard failed.'
}
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'Docker is required.' }
if (-not (Get-Command supabase -ErrorAction SilentlyContinue)) { throw 'Supabase CLI is required.' }

Write-Output "LOCAL_ONLY_TARGET host=127.0.0.1 port=54322 database=postgres project=$ProjectId"
$savedErrorActionPreference = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
& supabase.cmd stop --workdir $root --project-id $ProjectId --no-backup 2>&1 | Out-Null
& supabase.cmd start --workdir $root 2>&1 | Out-Null
$startExitCode = $LASTEXITCODE
$ErrorActionPreference = $savedErrorActionPreference
if ($startExitCode -ne 0) { throw 'Local Supabase failed to start.' }

$running = docker ps --filter "name=^$container$" --format '{{.Names}}'
if ($running -ne $container) { throw "Expected local database container is not running: $container" }
$identity = Invoke-LocalSql "select current_database() || '|' || coalesce(inet_server_addr()::text, 'local-socket') || '|' || current_setting('port');"
if ($identity -notmatch '^postgres\|[^|]*\|5432$') {
  throw "Unexpected local DB identity: $identity"
}
Write-Output "DB_IDENTITY $identity"

try {
  $migrations = Get-ChildItem "$root\supabase\migrations" -File -Filter '*.sql' |
    Where-Object { $_.BaseName -match '^\d{14}_' -and $_.BaseName.Substring(0,14) -ge '20260817000000' } |
    Sort-Object Name
  $target = $migrations | Where-Object { $_.Name -eq '20260821010000_standard_scaffold_certificate_activation.sql' }
  if (-not $target) { throw 'Target standard scaffold migration not found.' }

  foreach ($file in ($migrations | Where-Object { $_.Name -lt $target.Name })) {
    Write-Output "APPLYING_PRE_TARGET $($file.Name)"
    Invoke-LocalSqlFile $file.FullName
  }
  Write-Output 'APPLYING_REFERENCE_FIXTURE standard_scaffold_reference_seed.sql'
  Invoke-LocalSqlFile "$root\supabase\tests\fixtures\standard_scaffold_reference_seed.sql"

  foreach ($file in ($migrations | Where-Object { $_.Name -ge $target.Name })) {
    Write-Output "APPLYING_POST_FIXTURE $($file.Name)"
    Invoke-LocalSqlFile $file.FullName
  }

  Write-Output 'APPLYING_ADMIN_FIXTURE sales_revenue_integrity_admin_seed.sql'
  Invoke-LocalSqlFile "$root\supabase\tests\fixtures\sales_revenue_integrity_admin_seed.sql"
  Write-Output 'ENABLING_PGTAP_LOCAL_ONLY'
  Invoke-LocalSql "create extension if not exists pgtap with schema extensions;"
  $pgTapIdentity = Invoke-LocalSql "select extname || '|' || extnamespace::regnamespace::text from pg_extension where extname = 'pgtap';"
  if ($pgTapIdentity -ne 'pgtap|extensions') { throw "pgTAP local setup failed: $pgTapIdentity" }
  Write-Output "PGTAP_IDENTITY $pgTapIdentity"
  Write-Output 'RUNNING_STRUCTURAL_PGTAP'
  Invoke-LocalPgTapFile "$root\supabase\tests\sales_revenue_integrity_hardening_test.sql"
  Write-Output 'RUNNING_BEHAVIOR_PGTAP'
  $behaviorSql = "SET search_path = public, extensions;`n" + (Get-Content -Raw -LiteralPath "$root\supabase\tests\sales_revenue_integrity_behavior_test.sql")
  $behaviorSql |
    docker exec -i $container psql -v ON_ERROR_STOP=1 -v actor_id=$actorId -U postgres -d postgres -f /dev/stdin
  if ($LASTEXITCODE -ne 0) { throw 'Behavior suite failed.' }

  Invoke-LocalSqlFile "$root\supabase\tests\fixtures\sales_revenue_integrity_concurrency_fixture.sql"
  $env:TERAS_RUN_ISOLATED_DB_TESTS = '1'
  $env:TERAS_ALLOW_ISOLATED_MIGRATION = '0'
  $env:TERAS_ISOLATED_DB_URL = $localDbUrl
  $env:TERAS_DOCKER_DB_CONTAINER = $container
  $env:TERAS_TEST_ACTOR_ID = $actorId
  $env:TERAS_TEST_QUOTE_A = '30000000-0000-0000-0000-000000000901'
  $env:TERAS_TEST_QUOTE_B = '30000000-0000-0000-0000-000000000902'
  $env:TERAS_TEST_OPPORTUNITY_ID = '20000000-0000-0000-0000-000000000901'
  Write-Output "HARNESS_DB_CONTAINER $env:TERAS_DOCKER_DB_CONTAINER"
  Write-Output 'RUNNING_CONCURRENCY_HARNESS'
  node "$root\scripts\database\sales-revenue-integrity-db-harness.mjs" --preflight
  if ($LASTEXITCODE -ne 0) { throw 'Concurrency harness failed.' }
  Write-Output 'VALIDATION_COMPLETE'
}
finally {
  $savedErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  & supabase.cmd stop --workdir $root --project-id $ProjectId --no-backup 2>&1 | Out-Null
  $ErrorActionPreference = $savedErrorActionPreference
}
