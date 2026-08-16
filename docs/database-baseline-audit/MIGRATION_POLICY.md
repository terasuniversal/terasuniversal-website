# TERAS DATABASE MIGRATION POLICY (post-baseline)

Applies after Baseline V1 is adopted (see `BASELINE_PROPOSAL.md`). Until then, this is the target policy to converge to.

## Principles
1. **Production is never reset** for normal development.
2. **Every production schema change is a new forward-only migration** under `supabase/migrations/` with a monotonic version timestamp.
3. **Never edit an already-applied migration.** If a fix is needed, add a new migration.
4. **Never rely on manual dashboard SQL** without recording it. Any out-of-band change must be captured as a migration in the same change, and (where safe) recorded in `schema_migrations` via a no-op migration.
5. **Every `SECURITY DEFINER` function must set an explicit safe `search_path`** (`SET search_path = 'public'`, or `pg_catalog, public` when pg_catalog objects are referenced). No exception.
6. **Sensitive RPCs get explicit `REVOKE ... FROM PUBLIC, anon` + minimal `GRANT EXECUTE`.** Default grants are denied by default.
7. **Schema changes must pass local/staging replay before production.** CI replays the baseline + forward chain from zero and diffs against the frozen snapshot (`supabase/baseline/v1/schema.sql`).
8. **Migrations document rollback/mitigation** when the change is not trivially reversible.
9. **Data migrations must be idempotent or guarded** (guards on email/identity keys, `ON CONFLICT DO NOTHING`, `WHERE NOT EXISTS`, explicit windowing).
10. **One migration, one logical change.** DDL, RLS, and audit-trigger changes for a new table ship together in the same migration; unrelated changes do not.

## Working rules for agents and humans
- Before writing any query or migration, confirm the object is **live** (query the linked project or read `docs/database/PRODUCTION_DATABASE_BASELINE.md`), never infer from filenames.
- Do **not** create a second implementation of a table/feature that already exists under another name (`course_schedules`/`training_schedules`/`schedules` was exactly this failure — do not repeat).
- New tables require, in one migration: DDL, RLS policies via `app.is_*`/`app.has_min_role`, audit trigger, Zod schema in `lib/validation/schemas.ts`, `MODULE_ACCESS` entry if staff-facing, and regeneration of `lib/supabase/database.types.ts`.
- `SECURITY DEFINER` + app-layer guards must agree; prefer RLS as the boundary, use SD only where the role model genuinely requires it, and keep `search_path` explicit.
- Do not interpolate raw user input into PostgREST filter strings; sanitize (`[%_,()]`).
- Do not add `as any` casts on new Supabase queries; type against the generated `Database`.

## Migration lifecycle
1. Author migration + tests in a feature branch.
2. `supabase db reset` on local → must apply cleanly on the baseline + forward chain.
3. Security review (SD/search_path/grants/RLS) per `docs/database-baseline-audit/SECURITY_FINDINGS.md` checklist.
4. Push to production via `supabase db push --linked` (forward-only), or deploy in a reviewed PR.
5. Verify live: `supabase migration list` shows the new version; smoke-test the affected flows.
6. Update `docs/database/PRODUCTION_DATABASE_BASELINE.md` and `SCHEMA_INDEX.md` if tables/columns changed.

## Prohibited
- `git add .` / `-A` / `-p` for schema work; explicit paths only.
- `DROP`/`TRUNCATE`/destructive `ALTER` without explicit backup + approval.
- Editing a migration that is present in `supabase_migrations.schema_migrations`.
- Running the numbered `0001`–`0021` track (archived, non-executable).
- Re-applying `baseline_v1` to production (it is new-environments-only).

## Recording out-of-band changes (forward-only recording pattern)
For an already-applied manual change `X` (no history entry), add a migration named `<timestamp>_record_<x>.sql` containing the original statements made **idempotent** (`IF NOT EXISTS`, `OR REPLACE`, `ON CONFLICT`), so applying it to production is a no-op and fresh environments can replay it. Never "re-run" raw destructive SQL to record it.

## Version naming
`YYYYMMDDHHMMSS_description.sql` (UTC), strictly increasing. Do not backdate. If a logical change maps to a historical production version with a different timestamp, note the mapping in the file header comment (see `REPOSITORY_MIGRATION_INVENTORY.md` §2 for the existing map).
