# TERAS Database Baseline V1 — Final Post-Blocker Candidate Snapshot

## Snapshot identity

- Production ref: `iagzkrzeuawaxvacqprk`
- Production application SHA: `f4c2387559da1208468251f0d1236b8d930bc363`
- UTC: `2026-08-15T04:18:21.761Z`
- MYT: `2026-08-15T12:18:25.725+08:00`
- Supabase CLI: `2.114.0`; PostgreSQL: `17.6`
- Method: read-only `supabase db dump --linked --project-ref iagzkrzeuawaxvacqprk --schema public,app --keep-comments`, plus read-only PostgreSQL catalog inspection.

No production DDL, DML, migration application, migration-history repair, Auth, Storage, grant, RLS, policy, or function change was performed during this refresh.

## Remote migration-history evidence

- Entries: `64`
- Frozen maximum version: `20260814145109`
- Canonical format: ascending version strings, one LF-terminated line per version.
- Canonical remote-version SHA-256: `3c7622bca65bd1c4f64416b2e4c5e4379e533c0821e1dc45b668b1d56715e9bb`

Security Remediation Pack 1, Revision A, and the proposal-delivery blocker remediation were intentionally executed through controlled SQL and have no `schema_migrations` entries. Migration history was not changed.

## Canonical candidate schema

- File: `supabase/baseline/v1/schema.sql`
- Raw SHA-256: `0b73dc50022888b580a222318f634f4c9a5b180bc499b7dd1e857e61e98719ba`
- UTF-8 without BOM; LF line endings.
- Dump scope: application-owned `public`, `app`.
- The dump already contains `public.profiles.id -> auth.users(id) ON DELETE CASCADE`. Only nondeterministic pg_dump `\\restrict`/`\\unrestrict` comments were removed, and the exact catalog definition for the omitted `auth.users` trigger `on_auth_user_created -> app.handle_new_user()` was appended. The prior candidate hash `b2267ba41070301de21578570283d5c361087f7c5f333f4a113945e58d9b817b` is superseded because it included a redundant second `profiles_id_fkey`; production was not changed.
- The subsequent candidate hash `cbfb5f1d556ab4f2310bcda3f283b6e3c2871e2fdf909a08ec765803fc3b8484` is superseded because fresh reconstruction exposed a missing `citext` declaration. `CREATE EXTENSION IF NOT EXISTS citext WITH SCHEMA extensions` now appears before `profiles.email extensions.citext`; production was not changed.
- The candidate hash `2f4e08412d1e0bd012f0785edbdf155afdc309c13f9d2831ed327ced7aa4f6bb` is superseded because a fresh reconstruction exposed the missing global `ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC` state from Security Remediation Pack 1 Revision A. The canonical artifact now includes that exact future-function hardening; production was not changed.
- The dump contains no business rows, `auth.users` rows, `storage.objects` rows, migration-history rows, secrets, connection strings, service-role keys, or sequence current values.

## Current application inventory

| Object | Count |
| --- | ---: |
| Tables | 47 |
| Explicit application types | 6 |
| Views | 2 |
| Materialized views | 0 |
| Application function identities/signatures | 46 |
| Procedures | 0 |
| Triggers | 48 |
| Policies | 109 |
| Indexes | 171 |
| Sequences | 8 |
| Identity columns | 2 |
| RLS-enabled tables | 47 |
| FORCE-RLS tables | 8 |

Six global event triggers were observed separately; they are platform/global evidence and are not included in the `public,app` dump.

### Canonical object-counting method

The prior `77` routine count included broader live catalog evidence, including extension-owned routines in `public` (notably the production `pg_trgm` installation). The prior `63` type count used a different catalog filter. Neither is an appropriate count for the application-owned baseline artifact.

Baseline V1 now counts application-owned executable function identities/signatures in `public` and `app`: ordinary and trigger functions are included, overloads count separately, and procedures, aggregates, window functions, and extension-owned routines are excluded. This produces `46` functions: `31` ordinary and `15` trigger functions; there are `0` procedures, aggregates, or window functions.

Baseline V1 types now mean explicitly managed, non-array, non-relation types in `public` and `app`. The fresh catalog has `110` total types: `49` automatic relation composite row types and `55` automatic array types, leaving six explicitly declared enum types. These automatic types are not independently managed baseline objects. The canonical type count is therefore `6`.

Use the same read-only query for both a fresh target and production catalog evidence:

```sql
WITH application_routines AS (
  SELECT p.oid
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname IN ('public', 'app')
    AND p.prokind = 'f'
    AND NOT EXISTS (
      SELECT 1 FROM pg_depend d
      WHERE d.classid = 'pg_proc'::regclass
        AND d.objid = p.oid
        AND d.refclassid = 'pg_extension'::regclass
        AND d.deptype = 'e'
    )
), application_types AS (
  SELECT t.oid
  FROM pg_type t
  JOIN pg_namespace n ON n.oid = t.typnamespace
  WHERE n.nspname IN ('public', 'app')
    AND t.typrelid = 0
    AND t.typcategory <> 'A'
    AND t.typtype IN ('b', 'd', 'e', 'r', 'm')
    AND NOT EXISTS (
      SELECT 1 FROM pg_depend d
      WHERE d.classid = 'pg_type'::regclass
        AND d.objid = t.oid
        AND d.refclassid = 'pg_extension'::regclass
        AND d.deptype = 'e'
    )
)
SELECT
  (SELECT count(*) FROM application_routines) AS functions,
  (SELECT count(*) FROM application_types) AS types;
```

On the fresh reconstruction this returns `46` functions and `6` types. This is evidence reconciliation only: schema, production, staging, and application code were not changed.

## Final blocker verification

All previously confirmed baseline blockers are resolved in the live catalog:

- legacy certificate lookup, public audit wrappers, and app audit logger are denied to ordinary client roles;
- direct authenticated/anon `audit_logs` insertion is denied and `audit_insert` is absent;
- service-only audit logging remains service-role executable;
- `postgres` future public-schema table/sequence/function defaults are restricted;
- `mark_proposal_delivery_status` is denied to `anon` and `authenticated`, allowed to `service_role`, and has `search_path=pg_catalog, public`.

Current privileged-routine evidence: 33 `SECURITY DEFINER` functions; 5 effective `PUBLIC EXECUTE`; 14 anon-executable; and 26 authenticated-executable. These counts are restricted to `SECURITY DEFINER` functions in `public` and `app`.

## Extensions and Storage

Observed extensions: `citext` 1.6 (`extensions`), `pgcrypto` 1.3 (`extensions`), `pg_trgm` 1.6 (`public`), `uuid-ossp` 1.1 (`extensions`), `pg_stat_statements` 1.11 (`extensions`), `supabase_vault` 0.3.1 (`vault`), and `plpgsql` 1.0 (`pg_catalog`). `citext` is declared because the candidate directly uses `extensions.citext`; `gen_random_uuid()` resolves from PostgreSQL `pg_catalog`, and no direct `pgcrypto`, `pg_trgm`, or `uuid-ossp` extension object is referenced by the candidate. Platform-managed extension objects remain excluded from Baseline V1 SQL.

Storage evidence is configuration only: private bucket `teras-photos` (25 MiB, JPEG/PNG/WebP/HEIC/HEIF), zero observed `storage.objects` policies, and no exported objects. The `media` versus `teras-photos` mismatch remains a separate Storage configuration task.

## Remaining backlog and next gate

No active High finding remains. The remaining feedback-RPC allowlist review, search-path hardening, Auth leaked-password configuration, photo-table product decision, Storage configuration, and `pg_trgm` placement are documented in `database-baseline-v1-security-findings.md` for controlled follow-up.

This is a final candidate snapshot suitable for final Baseline V1 freeze review. It is not an active Baseline V1 migration, does not authorize marker creation or history repair, and does not authorize production adoption. The mandatory next gate is a final review followed by a complete fresh-environment reconstruction from the eventual marker chain, byte-identical baseline migration, approved reference configuration, and post-baseline migrations.
