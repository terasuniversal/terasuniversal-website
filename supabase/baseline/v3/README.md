# TERAS Database Baseline V3

Baseline V3 is a schema-only canonical bootstrap artifact for a future clean
TERAS environment. It represents the stable Production application schema
after the canonical migration chain through `20260912005428`.

## Files

- `schema.sql` is the normalized, schema-only verifier snapshot.
- `bootstrap.sql` is a guarded new-environment bootstrap and records the V3
  marker in `app.app_schema_baseline`.
- `manifest.json` records the source, scope, inventory, and safety contract.
- `SHA256SUMS.txt` records the final LF-byte hashes.

`schema.sql` must not be run after `bootstrap.sql` in the same database.
`bootstrap.sql` refuses to run when the V3 marker or core TERAS tables already
exist. A partial bootstrap requires a newly recreated disposable database.

## Source and capture method

The authoritative source was Production Supabase project
`iagzkrzeuawaxvacqprk`, captured read-only on 2026-09-12 at application main
SHA `72d6741ce4e58d52190a42dcbd2ce0a407432128`. The artifact starts from the
schema-only Baseline V2 Production snapshot and incorporates the exact five
canonical forward schema changes through `20260912005428`; live Production
catalog inventories and feature contracts were compared after normalization.

No Production or Canonical Staging DDL/DML was executed during this gate.

## Scope and exclusions

The artifact contains application schema objects: tables, columns, types,
constraints, indexes, functions/RPCs, views, triggers, RLS, policies, and
grants/revokes required by the TERAS application. It contains no business
rows, Auth users, Auth identities, passwords, tokens, Storage objects/files,
or secrets. Supabase-managed schemas remain outside the baseline; the
application-owned Auth trigger contract is retained for a fresh Supabase
environment.

Reference/seed rows such as the HRDF module-catalog entry are intentionally
not captured. Baseline V3 captures current schema truth; future reference data
must be provisioned separately.

SST capability is present, but SST remains disabled. No real SST registration
number, legal rate, classification, or effective date is configured.

## Forward migration policy

Baseline V3 is a new bootstrap artifact, not a replacement or rewrite of the
historical migration ledger. Do not replay historical migrations after a
successful V3 bootstrap. Future schema changes remain forward-only.
