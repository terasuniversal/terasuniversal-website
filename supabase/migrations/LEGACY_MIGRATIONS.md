# LEGACY MIGRATIONS — 0001–0021 (numbered track)

> **Status: LEGACY / HISTORICAL / NON-CANONICAL FOR FRESH REPLAY AFTER BASELINE V1.**
> Do **not** use the `0001`–`0021` files as the reconstruction source. Do **not** delete or rename them.

## Why they remain
The numbered track (`0001_extensions_and_enums.sql` … `0021_automation_centre.sql`) is **immutable historical evidence** of how the clean-room TERAS schema was originally designed. They are preserved for archaeology and review.

## Why they must not be the reconstruction source after Baseline V1
- They describe a **clean-room design that was never applied to production**. Production instead runs the legacy + compatibility lineage, which was later consolidated by an out-of-band `database_baseline_v1` migration (2026-08-15).
- **Fresh replay from the raw chain FAILS**: the first dated migration (`20260721030247_cms_compatibility_security.sql`) fails because `public.admin_users` is missing, and 24 of 49 dated migrations fail on a clean base. Mixing the numbered track back into a replay adds more collisions (duplicate policies, duplicate constraints, incompatible column shapes). See `docs/database-baseline-audit/FRESH_REPLAY_REPORT.md`.
- After **Baseline V1**, the frozen production snapshot (`supabase/baseline/v1/schema.sql` / `bootstrap.sql`) is the reconstruction source for new environments, and **only post-baseline forward-only migrations** may run on top.

## Production history is immutable
The production migration history (`supabase_migrations.schema_migrations`, 67 entries) and the live production schema must **never** be rewritten, squashed, or replayed from these files.

## How developers / agents should initialize a fresh environment
1. Create a brand-new empty Supabase environment.
2. Run `supabase/baseline/v1/bootstrap.sql` (NEW-ENVIRONMENT-ONLY; it refuses to run on a populated database and records the `app.app_schema_baseline` marker on success).
3. Apply only **post-baseline forward-only migrations** (first valid version: `20260817000000`).
4. Never run `0001`–`0021` or the historical compatibility migrations in a new environment.

## Related
- Baseline docs: `docs/database/PRODUCTION_DATABASE_BASELINE.md`, `docs/database/SCHEMA_INDEX.md`
- Migration policy: `docs/database-baseline-audit/MIGRATION_POLICY.md`
- Audit: `docs/database-baseline-audit/`
