# POST-BASELINE MIGRATION CHAIN

Official migration model after **Database Baseline V1**. Supersedes the historical dual-track behavior.

## The chain

**Fresh (new/empty) environment**
```
Baseline V1 bootstrap (supabase/baseline/v1/bootstrap.sql)
   → records app.app_schema_baseline marker
   → creates public + app schema exactly as production (snapshot 2026-08-16)
   → then apply ONLY post-baseline forward-only migrations
```
First valid post-baseline migration version: **`20260817000000`** (UTC). Every later migration must have a strictly greater version.

**Existing production (iagzkrzeuawaxvacqprk)**
```
Existing schema + immutable history remain (database_baseline_v1 etc.)
   → apply ONLY post-baseline forward-only migrations (>= 20260817000000)
   → NEVER re-run historical migrations or bootstrap.sql against production
```

## Naming convention
`YYYYMMDDHHMMSS_description.sql` in `supabase/migrations/`, version = UTC timestamp at authoring. Monotonic; never backdate. If a logical change corresponds to a historical production change with a different timestamp, note the mapping in the file header (see `docs/database-baseline-audit/REPOSITORY_MIGRATION_INVENTORY.md`).

## Rules
1. Never edit an applied migration or anything recorded in `supabase_migrations.schema_migrations`.
2. Never run `0001`–`0021` (see `supabase/migrations/LEGACY_MIGRATIONS.md`).
3. Never apply `supabase/baseline/v1/bootstrap.sql` to production or any populated database.
4. Every migration must pass: fresh bootstrap → `scripts/database/verify-baseline-replay.mjs` (baseline + all post-baseline migrations → schema diff) → security review → production.
5. One logical change per migration (DDL + RLS + audit trigger + Zod schema + types regen + MODULE_ACCESS entry ship together for new tables).
6. `SECURITY DEFINER` functions set explicit safe `search_path`; sensitive RPCs get explicit `REVOKE`/`GRANT`.

## Checkpoint relationship
- `database_baseline_v1` (remote `20260815150000`) is the production-side consolidation; it stays recorded and untouched.
- `supabase/baseline/v1/schema.sql` is the canonical snapshot for new environments; `bootstrap.sql` reconstructs it and stamps `app.app_schema_baseline`.
- Post-baseline migrations apply identically on top of both paths.

## References
- Policy: `docs/database-baseline-audit/MIGRATION_POLICY.md`
- Baseline proposal: `docs/database-baseline-audit/BASELINE_PROPOSAL.md`
- Agent source of truth: `docs/database/PRODUCTION_DATABASE_BASELINE.md`
