# DATABASE_SAFETY.md — Database Migration Safety System

A dedicated, separate workflow layered on top of the ordinary task pipeline for anything touching Supabase schema, SQL migrations, RLS, database policies, RPCs/functions, indexes, constraints, or triggers. Encoded in `tools/db-runner.ps1`. Database approval is a **separate track** from application approval (`approval-runner.ps1`/`release-runner.ps1`) — a task can be `RELEASE_READY` on the application side while still `DB_AWAITING_APPROVAL` on the database side. `-Release` never implies `-ApproveMigration`, and neither implies `-ApplyMigration`.

## Pipeline

```
Database Task -> Risk Classification -> Claude DEEP -> Migration/SQL Prepared
-> Static SQL Validation -> Codex Database Review -> DATABASE_REPORT.md
-> Human Migration Approval -> Optional Safe Apply -> Database Verification
-> Release Eligibility
```

## Commands

```
teras-agent -DatabaseStatus                          Show the database track's current state
teras-agent -PrepareMigration                         Static-scan the SQL, generate DATABASE_HANDOFF.md / DATABASE_REPORT.md
teras-agent -ReviewMigration                          Dedicated Codex database review (never re-run for unchanged SQL)
teras-agent -ApproveMigration                         Human approval - exact phrase "APPROVE DATABASE MIGRATION"
teras-agent -ApplyMigration -Target LOCAL|STAGING|PRODUCTION
teras-agent -VerifyDatabase                            Non-destructive verification the migration's objects exist
teras-agent -DryRunMigration                           Show the above without executing anything
```

## Routing

Any task matching `supabase/migrations/`, RLS, `CREATE POLICY`/`ALTER POLICY`/`DROP POLICY`, `CREATE FUNCTION`, RPC, TRIGGER, CONSTRAINT, UNIQUE INDEX, SCHEMA, or AUTHORIZATION routes to `Implementer: Claude Code`, `Model: CLAUDE_DEEP`, `Reviewer: Codex` — this is the same `$DbSensitiveKeywords` check `agent-router.ps1` already uses to force HIGH risk (see `MODEL_ROUTING.md`), so DeepSeek is structurally excluded from every database task, not just conventionally. `New-TaskState` sets `DbRequired: true` the moment a task looks database-shaped; `-PrepareMigration` re-evaluates against the real SQL once it exists.

## Risk: HIGH vs CRITICAL

`Get-DatabaseRisk` (`db-runner.ps1`) classifies from the actual SQL, not just the task description:

- **HIGH** (default): new table, new nullable column, non-destructive index, ordinary function addition, non-destructive RLS policy.
- **CRITICAL**: `DROP TABLE`/`DROP COLUMN`, data deletion, destructive `ALTER`, RLS/auth access expansion, `SECURITY DEFINER`, certificate verification/issuance objects, a uniqueness constraint against live data, a data migration (`UPDATE`/`DELETE`/`INSERT ... SELECT`), mass `UPDATE`/`DELETE`, or a function changing security boundaries.

`SECURITY DEFINER` and any certificate-database-object match (`certificate_number`, `verification_token`, `verification_url`, `status`, `verification_enabled`, `deleted_at`, `eligibility`, `verify_and_log`, or the literal word `certificate`) always force CRITICAL + mandatory Codex + mandatory human approval, and escalate the whole task's Risk too, not just the migration's.

## Static SQL danger scan

`Get-SqlDangerScan` flags (never auto-rejects) `DROP TABLE`/`DROP SCHEMA`/`DROP COLUMN`, `TRUNCATE`, `DELETE FROM`, `UPDATE` without `WHERE`, `ALTER TABLE ... DROP`, `CASCADE`, `DISABLE ROW LEVEL SECURITY`, `GRANT ALL`, `SECURITY DEFINER`. Every match is surfaced in `DATABASE_HANDOFF.md`'s "STATIC SCAN RESULTS" section for Codex to verify, not trust blindly.

## Migration file rules

Filename must match `supabase/migrations/YYYYMMDDHHMMSS_description.sql` (`Test-MigrationFilenameConvention`). Historical migrations are immutable — `Test-MigrationIsNew` checks the file didn't already exist at `HEAD` before this task; a correction is always a *new* migration, never an edit to an old one. Either violation sets `Static Validation: FAIL` and blocks `-ReviewMigration`.

## Codex database review

`-ReviewMigration` generates `.ai/CODEX_DATABASE_REVIEW_HANDOFF.md` — the migration SQL, its diff, and the static scan results only, never a full-repo scan. Required sections: Correctness, Data Integrity, RLS, Authorization, Security, Backward Compatibility, Deployment Ordering, Rollback, Certificate/Verification Impact, Blocking Findings. Verdict is `PASS` / `PASS_WITH_NOTES` / `BLOCKED`, parsed back out of `DATABASE_REPORT.md`.

**Reuse, never re-invoke for identical content**: `Test-DbReviewStale` compares the migration file's live SHA-256 hash against the hash at last review. Unchanged SQL reuses the existing verdict; Codex is not called again. Any SQL change invalidates the prior review and (if already approved) the prior approval too.

## Approval and apply are two separate gates

1. **`-ApproveMigration`** — safety/correctness sign-off. Requires the exact phrase `APPROVE DATABASE MIGRATION`. Binds Task ID + migration file + SHA-256 hash + git commit SHA. If the SQL changes afterward, `MIGRATION APPROVAL INVALIDATED` and both a fresh Codex review and a fresh approval are required.
2. **`-ApplyMigration -Target LOCAL|STAGING|PRODUCTION`** — execution. Environment is never inferred, always explicit. STAGING always reports `STAGING DATABASE NOT CONFIGURED` (none exists for this repo — never fabricated). LOCAL only actually runs `supabase db push` if a local Supabase stack is detected running (`supabase status`); otherwise nothing executes. **PRODUCTION never actually executes here, even after the strengthened `APPLY APPROVED PRODUCTION MIGRATION` phrase** — this orchestrator builds the complete gated workflow and then hands off to manual execution (Supabase MCP tools, `supabase db push` run directly, or the dashboard SQL editor), the same boundary held for commit/push/merge/deploy throughout every phase of this system. The connected Supabase project holds real production data; there is no context in which this script applying it automatically is the right call.

## Duplicate / foreign-key / index safety

This tool cannot query the live database, so it never claims a duplicate-data precheck passed. A detected `UNIQUE` constraint sets `Duplicate Precheck: NOT_RUN` and surfaces a loud warning at the approval screen — typing the approval phrase is the human's attestation that they verified this externally. Foreign keys and new indexes get similar informational notes (cascade behavior, orphaned-record risk, build-time locking) rather than a fabricated automated check.

## Backup gate

A CRITICAL-risk migration with destructive SQL targeting PRODUCTION is blocked outright (`PRODUCTION MIGRATION BLOCKED`) because this tool cannot verify a backup/PITR checkpoint exists — it will never claim one does.

## Deployment order

`Get-DeploymentOrder` (folded into `RELEASE_REPORT.md`) recommends EXPAND-first ordering for additive migrations, DB-first for RLS/auth changes, and explicitly flags `UNCERTAIN` rather than guessing whenever the SQL is destructive, data-modifying, or `SECURITY DEFINER` — see `AGENTS.md`'s Codex role for why an uncertain case gets a human decision, not an automated guess.

## AI usage protection

Codex is invoked at most once per distinct migration hash (`Test-DbReviewStale`) — never repeatedly for the same content. Claude is not re-run merely to check status or record an approval; those are local file/state operations. See `USAGE_POLICY.md`.
