# TERAS Database Baseline V1

Status: design artifact only. This document does not authorize a production schema change, migration-history repair, migration application, reset, deployment, data export, or generation of Baseline V1 SQL.

## 1. Decision and authority

At the approved cutover point:

```text
Reviewed live production application schema = TERAS Database Baseline V1
```

Baseline V1 is the single authoritative fresh-environment reconstruction source. Historical migrations remain immutable evidence of how TERAS evolved; they are not the active reconstruction chain.

The cutover requires a frozen live schema snapshot, a reviewed object/security inventory, a completed manifest, and a successful fresh-environment test. It must never be inferred from migration filenames alone.

## 2. Intended repository structure and active chain

The following is a future implementation target. Do not create, move, or apply any of these artifacts during this design-only work.

```text
supabase/
  migrations_legacy/              # Immutable historical SQL archive; not executable
  baseline/
    v1/
      schema.sql                  # Byte-identical archive copy of active Baseline V1 SQL
      reference-seed.sql          # Optional, separately approved deterministic configuration seed
      manifest.json               # Completed from manifest.template.json at cutover
  migrations/                     # Active executable chain after cutover
```

The active chain will be:

```text
<one remote-version no-op marker per frozen remote migration version>
-> <new timestamp>_teras_database_baseline_v1.sql
-> <new timestamp>_staff_user_management_phase1.sql
-> future approved migrations
-> reviewed reference/configuration seeds
```

The Baseline V1 migration must contain the full reviewed application-owned schema required for a blank TERAS environment. It is not an empty marker. `schema.sql` is an archive copy of the same exact bytes, not an independently maintained schema source.

## 3. Canonical SQL and hashing rule

Baseline SQL has one canonical generation flow:

1. Generate one canonical UTF-8 schema file by approved read-only methods.
2. Normalize the final release file to LF line endings.
3. Remove nondeterministic dump metadata only where it is safe, preserving SQL semantics, grants, comments, and security/business invariants.
4. Review and approve that canonical file.
5. Copy its exact bytes to both `supabase/baseline/v1/schema.sql` and the active Baseline V1 migration.
6. Calculate SHA-256 over the raw bytes of both files.
7. Require the raw hashes to match before approval.

The raw SHA-256 is authoritative for release equality. A separately documented normalized hash may be recorded only for diagnostics when comparing independently generated dumps; it must not replace the raw release hash. The manifest records encoding, line endings, generator/version, snapshot timestamp, and both raw hashes.

## 4. Application-owned schema and extension inventory

Baseline V1 must capture every reviewed application-owned object required by a blank TERAS environment, where present:

- application schemas: `public`, `app`, and `extensions` only if confirmed by the live snapshot;
- supported extension declarations, but not unsafe ownership statements or extension-owned object definitions;
- types, enums, domains, tables, columns, defaults, generated columns, identity columns, and sequence ownership;
- primary keys, foreign keys, unique constraints, checks, indexes, and sequence definitions;
- views, materialized views, view options (`security_invoker` and `security_barrier`), functions, procedures, triggers, and event triggers;
- function ACLs, `SECURITY DEFINER`/`SECURITY INVOKER`, locked `search_path`, and security-relevant volatility;
- RLS enabled/forced state, policies, table/view/function/sequence grants, and default privileges;
- comments encoding security, operational, or business invariants.

The baseline does not include production sequence counters or current `setval` values. A fresh environment initializes sequences from their declared start/identity configuration.

Extensions require a live inventory with: extension name, installed version, extension schema, TERAS dependency, ownership handling, and whether extension-created objects are excluded from application-owned SQL. Current repository history identifies `pgcrypto`, `citext`, and `pg_trgm` as candidates only; the live snapshot decides what is required. In particular, a repository migration places `citext` in an `extensions` schema, so that schema must be explicitly confirmed or excluded by evidence.

Do not hard-code platform ownership statements. Preserve the intended privileges through explicit, reviewed grants and default-privilege policy.

## 5. Supabase-managed exclusions and Auth/profile dependency

Do not manually recreate Supabase platform internals, including:

- `auth.*`, `realtime.*`, `vault.*`, `storage.*`, and `supabase_migrations.*` internals;
- platform-managed roles and internal schemas;
- `storage.objects`, uploaded objects, and file contents.

`auth.*` remains Supabase-managed. Application-owned dependencies on Auth remain in the baseline, including:

```text
public.profiles.id -> auth.users(id) ON DELETE CASCADE
```

The application-owned function/trigger that creates or synchronizes profiles from `auth.users` must be captured and reviewed as an application dependency. A fresh environment uses native Supabase Auth and supported Auth/Admin APIs to create disposable users, then proves the profile FK and trigger/synchronization path work. It must never recreate or seed `auth.users` manually.

## 6. Storage configuration

Storage internals and uploaded objects are excluded from Baseline V1. Separately, TERAS must later create a reviewed application Storage configuration artifact or post-baseline migration containing only:

- approved bucket definitions;
- public/private visibility configuration;
- approved Storage RLS policies; and
- required object-path conventions.

That configuration is application configuration, not production file data. It must be applied and tested separately in fresh environments, including the permissions required for any supported upload/upsert workflow. This task does not create that artifact.

## 7. Mandatory security approval matrix

Before baseline approval, every application-owned object must have an explicit reviewed entry in the security evidence package.

| Object class | Required review |
| --- | --- |
| Tables | RLS enabled, FORCE RLS, SELECT/INSERT/UPDATE/DELETE policies, policy roles, `USING`, and `WITH CHECK` |
| Grants | `PUBLIC`, `anon`, `authenticated`, `service_role`, and every other relevant role for schemas, tables, views, sequences, and functions |
| Functions/procedures | Definer/invoker, `EXECUTE` grants, `PUBLIC`/`anon`/`authenticated`/`service_role` access, `search_path`, schema-qualified references, and security-relevant volatility |
| Views/materialized views | `security_invoker`, `security_barrier`, owner/definer implications, and grants |
| Default privileges | schema, table, sequence, and function defaults |

Any unexpected `PUBLIC` or `anon` execution path to a privileged function blocks baseline approval. Every `SECURITY DEFINER` function requires a specific justification, locked search path, explicit execution allow-list, and negative test. Baseline approval must use the live final definition, not an inference from historical migration text.

## 8. Legacy history markers and version ordering

Only versions in the frozen export of linked production `supabase_migrations.schema_migrations` may receive active no-op marker files. Exactly one marker is required for each such remote version.

Each marker filename must begin with the exact remote version string. There may be no duplicate version prefixes, no marker for a local-only historical version, and no schema, data, RLS, grant, function, or business-rule logic in a marker. The marker must state that original SQL provenance is unavailable, the marker is comments-only, and current schema is represented by Baseline V1.

Original local SQL remains in the immutable legacy archive. After approved cutover, the active migration directory contains no old local-only historical SQL.

Marker creation may happen only after all of the following are retained as evidence:

1. remote migration-history export;
2. SHA-256 of the ordered remote version list and export;
3. filename/version collision check; and
4. freeze of the maximum remote version.

The Baseline V1 version is selected only after that freeze. It must be greater than every frozen remote version, conflict with no existing version, sort before every post-baseline migration, and remain immutable after adoption. Do not select the timestamp in this design phase.

## 9. Data exclusion and reference seeds

Baseline schema contains no production business rows, profiles, Auth users, uploaded files, or sequence counters.

Reference seed data is eligible only when all conditions are true: deterministic, source-controlled, non-personal, non-customer, approved as configuration, idempotent, safe to rerun, and required for application operation. It runs after migrations and has its own approval, hash, and rerun test.

Default classification until a separate decision says otherwise:

- courses: operational;
- certificate templates: operational/configuration unknown;
- training schedules: operational;
- participants, companies, leads, enquiries, quotations, tasks, attendance, assessments, certificates, and audit logs: production data;
- Storage bucket definitions: application configuration handled separately from uploaded objects.

## 10. Unapplied drafts and post-baseline order

The following drafts remain outside Baseline V1:

- `20260814165048_staff_user_management_phase1.sql` remains unapplied. After baseline adoption, review its SQL against Baseline V1 and create new post-baseline migration(s); do not simply rename the old file. Prefer a split only where it improves dependency and review clarity: (A) staff profile/schema/catalog foundation, then (B) module RLS/functions/policies/security hardening. The review must cover profile columns, department type, module catalog/access, audit event values, function ACLs, RLS, and last-active-Super-Admin protection.
- `20260812120000_standard_scaffold_certificate_template.sql` remains unapplied because its live effects are absent. It requires separate product approval and a new post-baseline migration if later required.

Neither draft may be silently absorbed into Baseline V1.

## 11. Future read-only snapshot method

The future snapshot must use an approved read-only Supabase-supported schema dump, such as the `supabase db dump --linked` schema-dump class of operation, plus read-only PostgreSQL catalog inspection.

The catalog inspection must capture RLS/policies, ACLs, default privileges, function security, view options, sequence ownership, identity metadata, extension placement, comments, triggers, and event triggers. The dump output is review input, not automatically approved baseline SQL.

Baseline generation must not use `supabase db pull` or `supabase migration squash --linked`. `db pull` may create migration/history interactions; linked squash does not solve TERAS's uncertain provenance, data migrations, backfills, or security drift. No snapshot command is authorized by this document.

## 12. Fresh-environment gate

Before production adoption, a disposable Supabase environment must pass all of the following with disposable records only:

1. **Migration:** exact no-op marker chain, full baseline from zero, and approved post-baseline migrations.
2. **Extensions:** required extensions are available and their schema placement is correct.
3. **Auth:** supported disposable Auth-user creation, `profiles` FK, and profile trigger/synchronization path.
4. **Structure:** tables, constraints, indexes, views, materialized views, functions, procedures, triggers, and event triggers.
5. **Sequences:** first insert succeeds for every important identity/sequence-backed table.
6. **Security:** RLS matrix, anonymous denial, authenticated allow/deny, `PUBLIC` function-execution review, security-definer, direct-table, RPC, and view negative tests.
7. **Storage:** bucket configuration and Storage RLS work; no production uploaded object is copied.
8. **Seeds:** deterministic execution, rerun, and idempotence proof.
9. **Application:** `npx tsc --noEmit`, lint, build, login smoke, Admin smoke, Sales-flow smoke, unauthorized direct URL denial, and unauthorized mutation denial.
10. **Supabase:** database/security advisors reviewed; any exception is documented and approved.

## 13. Production adoption hard gates

Production Baseline V1 SQL is never replayed. Before the future history-only adoption, all of the following are mandatory:

1. production schema freeze;
2. verified schema backup and restore test;
3. migration-history export and SHA-256;
4. exact remote-version-list export and SHA-256;
5. approved Baseline V1 SQL with matching raw archive/migration hashes;
6. immutable Git commit and Git tag/release identifier;
7. full fresh-environment PASS;
8. security, product, and operations sign-off;
9. confirmation that no newer remote migration exists than the frozen version list;
10. maintenance window and documented recovery procedure;
11. reviewed exact future migration-repair command; and
12. post-repair migration-list verification plan.

Only after those gates may the history entry be marked through the reviewed future command form:

```text
supabase migration repair <baseline-version> --status applied
```

That operation changes migration history only; it does not execute Baseline V1 SQL.

## 14. Recovery and correction

If an incorrect Baseline V1 history entry is marked applied, do not automatically touch schema. Compare the retained evidence, perform controlled history repair only after review, verify the migration list afterward, and document the incident and corrected state.

History repair does not roll back schema SQL. Retain the backup, history export, hashes, completed manifest, Git tag, fresh-environment proof, and exact repair-command record.

## 15. Governance after cutover

Protect ownership and review for `supabase/migrations/`, `supabase/baseline/`, and `supabase/migrations_legacy/`. Every future database change follows:

```text
create
-> review
-> commit
-> fresh/staging test
-> apply
-> verify
-> migration-list verification
-> rollout evidence
```

Required controls are duplicate-version and monotonic-version CI checks, baseline checksum verification, SQL lint, security/RLS review gates, advisor review where relevant, migration-list release verification, and rollout-evidence retention.

Production raw SQL may not change schema, RLS, grants, RPCs, or business rules without canonical migration coverage. An emergency change requires an incident reference, exact SQL capture, immediate canonical follow-up migration, post-change schema verification, and migration-history reconciliation before the next normal release.

## 16. Required approvals before implementation

Implementation requires high-risk approval of the live schema snapshot, completed manifest/security matrix, extension and Storage configuration inventory, legacy archive/marker mapping, reference-seed classification, fresh-environment evidence, recovery evidence, history-only adoption operation, and the first genuine post-baseline migration.
## Git freeze preparation state

The active chain prepared for review is exactly:

```text
64 frozen remote-version comments-only markers
-> 20260815150000_database_baseline_v1.sql (byte-identical to `supabase/baseline/v1/schema.sql`)
-> future reviewed forward-only migrations
```

The legacy SQL archive is `supabase/migrations_legacy/`; it is evidence only and is not an executable reconstruction chain. Staff User Management and Standard Scaffold drafts are preserved under `supabase/post_baseline_drafts/` with `REQUIRES_NEW_POST_BASELINE_VERSION` status. Production must never replay Baseline V1 SQL. Active-chain reconstruction passed in a disposable local Supabase environment. Baseline V1 Git freeze is READY. Production migration-history adoption remains NOT_APPROVED until the separate history-adoption gate is completed.
