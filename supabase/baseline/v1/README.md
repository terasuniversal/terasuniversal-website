# TERAS Database Baseline V1 — Canonical Production Snapshot

**Status:** Baseline V1 candidate — verified current production schema (2026-08-16).

## What this directory contains
- `schema.sql` — frozen, read-only snapshot of the production application schema (`public` + `app`).
- `manifest.json` — machine-readable manifest (counts, hashes, exceptions).
- `manifest.template.json` — template for future re-derivations.
- `SHA256SUMS.txt` — checksums for `schema.sql`.
- `bootstrap.sql` — **NEW-ENVIRONMENT-ONLY** guarded bootstrap (see below).
- `README.md` — this file.

## Source
- Production project ref: **`iagzkrzeuawaxvacqprk`** (TERAS Certificate Verification), Postgres 17.6.
- Generation: `supabase db dump --linked --project-ref iagzkrzeuawaxvacqprk --schema public --schema app --keep-comments`
- Captured: **2026-08-16** (UTC), baseline cutover.
- Post-processing (deterministic, mirrors the prior snapshot convention):
  1. Removed nondeterministic `\restrict`/`\unrestrict` pg_dump comment lines.
  2. Added `CREATE SCHEMA IF NOT EXISTS "extensions"` + `CREATE EXTENSION IF NOT EXISTS "citext" WITH SCHEMA "extensions"` (required before `profiles.email extensions.citext`).
  3. Restored the global default-privilege revoke from Security Remediation Pack 1 Rev A: `ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;` (not emitted by pg_dump).
  4. Appended the application-owned `auth.users` trigger `on_auth_user_created -> app.handle_new_user()` (schema-filtered pg_dump omits it; requires native Supabase Auth in fresh environments).

## Old (2026-08-15) vs New (2026-08-16) snapshot diff
Old SHA-256: `0B73DC50022888B580A222318F634F4C9A5B180BC499B7DD1E857E61E98719BA` (284,421 bytes, 2026-08-15T04:18Z).
New SHA-256: `D6E90DD4CB4E8F6E4B98EAC2AACAA49BA662E16929C4D21DD9282B6326C8B497` (293,915 bytes).

Differences = the two post-snapshot forward migrations applied to production since Aug 15, plus the pg_trgm declaration (see below):
| Change | Source migration |
|---|---|
| Tables `feedback_schedule_links`, `feedback_schedule_lookup_attempts` (new) | `20260816072507 feedback_schedule_qr` |
| Function `resolve_schedule_feedback_participant` (new) | `20260816072507 feedback_schedule_qr` |
| Index `feedback_schedule_lookup_attempts_retention_idx` (new) | `20260816072507 feedback_schedule_qr` |
| Function `public.accept_quotation` (body replaced) | `20260816100000 sales_won_follow_up_completion` |

No other drift. New snapshot cross-validated against live catalog on the same day: 49 base tables + 2 views, 48 triggers (49 in snapshot incl. the appended auth trigger), 109 RLS policies, 78 functions (45 app-owned in dump + pg_trgm extension functions), 7 extensions. `bootstrap.sql` also idempotently declares `pg_trgm` (installed in `public` in production) so a fresh environment matches the platform default exactly.

## Known intentional omissions from `schema.sql`
- **Platform schemas** (`auth`, `storage`, `realtime`, `vault`, `supabase_migrations`) are not dumped; they are Supabase-managed.
- **Extensions** `citext` and `pg_trgm` are declared in the snapshot (idempotent `CREATE EXTENSION IF NOT EXISTS`); the remaining platform extensions (`pgcrypto`, `uuid-ossp`, `pg_stat_statements`, `supabase_vault`, `plpgsql`) are Supabase defaults.
- **Extension-owned functions** (e.g., pg_trgm `similarity`, `gtrgm_*`) are recreated by their extension, not the dump.

## Baseline marker (`app.app_schema_baseline`)
Created by `bootstrap.sql` on a new environment **only after the schema applies successfully**:
- `id` uuid PK, `baseline_version` text, `applied_at` timestamptz, `schema_hash` text, `notes` text.
- The marker is **not** part of production's schema (`schema.sql` does not include it); it exists solely to record that a new environment was bootstrapped and to make re-bootstrap fail fast.
- Guard behavior: `bootstrap.sql` raises `baseline_marker_exists` if the marker is present, and `non_empty_database` if any TERAS application table already exists. It never runs against production.

## Known cosmetic quirks (preserved from production)
A small number of function bodies/comments in production contain mojibake em-dashes/bullets (e.g. `'Opportunity lost â€" '`, `'Thank you â€" your feedback...'`). These bytes exist **in the live production database** and are preserved verbatim in `schema.sql`/`bootstrap.sql` for fidelity. Do not "fix" them in the baseline.

## Guardrails
- `schema.sql` is a **description of production state**, not a migration to run on production.
- **Do NOT apply `schema.sql` or `bootstrap.sql` to production** (`iagzkrzeuawaxvacqprk` already has `database_baseline_v1` recorded and live data).
- `bootstrap.sql` is **NEW-ENVIRONMENT-ONLY** and refuses to run on a non-empty database (see `bootstrap.sql` header + Phase 4 doc).
- To regenerate a snapshot at a future cutover: run the generation command above, apply the 4 post-processing steps, re-hash, update `manifest.json` and `SHA256SUMS.txt`, and document the object-level diff here.

## References
- Audit: `docs/database-baseline-audit/`
- Agent source of truth: `docs/database/PRODUCTION_DATABASE_BASELINE.md`, `docs/database/SCHEMA_INDEX.md`
