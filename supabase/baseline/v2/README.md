# TERAS Database Baseline V2

Baseline V2 is a source-only canonical snapshot of the current Production
`public` and `app` schema. It replaces Baseline V1 for new environments;
Baseline V1 remains preserved for historical audit.

## Files

- `schema.sql` is the read-only canonical schema verifier.
- `bootstrap.sql` is a guarded, new-environment-only bootstrap. It creates
  the schema and records `app.app_schema_baseline.baseline_version = 'v2'`.
- `manifest.json` records the Production source, object counts, and hashes.
- `SHA256SUMS.txt` records exact canonical LF byte hashes.

## Source and safety

The snapshot was captured read-only from Production project
`iagzkrzeuawaxvacqprk` (PostgreSQL 17.6.1.147) at origin/main
`f1ce4f5e2742a5ff3ed1f578cf88fcf20af60ee8`. It contains schema objects only:
no business rows, Auth users, passwords, credentials, or Storage files.
Supabase-managed schemas are excluded; the application-owned Auth trigger is
retained because it depends on native Supabase Auth in a fresh project.

`schema.sql` must not be run after `bootstrap.sql`; it is a verifier snapshot.
`bootstrap.sql` refuses to run if the baseline marker or TERAS application
tables already exist. A partial failure requires a fresh empty environment.

## Forward migrations

V2 is the new starting point. Do not replay historical numbered migrations,
QA/repair migrations, or V1. Future schema changes are forward-only and use
one canonical migration version across environments. The Internal Sales Lead
migration remains the first approved forward migration after V2 and is not
included in this baseline.
