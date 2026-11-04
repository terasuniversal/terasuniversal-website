# Post-Baseline Draft Migrations

SQL files here are preserved as unmodified drafts, intentionally outside the active migration chain (`supabase/migrations/`). None represent applied production history or Baseline V1 schema. None may be applied without an explicit, separate decision.

## `20260812120000_standard_scaffold_certificate_template.sql`

Status: **DEFERRED — BUSINESS SIGN-OFF REQUIRED**

Adds the shared "Standard Scaffold Certificate" template (`config.design_variant = 'standard_scaffold_certificate'`), rendered by the existing generic certificate renderer and binding it to the 3 courses confirmed live as of 2026-08-12. Per-programme content is supplied at render time by `lib/standard-scaffold-programmes.ts`, not stored on the template row.

Rules while deferred:
- This migration must not be applied to any database (local, staging, or production).
- No production DB changes of any kind on its behalf.
- No template activation — the generic certificate renderer must not be wired to select this `design_variant` until sign-off.
- No course mapping activation beyond what's already recorded in the source file's own `course_id` fields.
- No deployment should be made solely to introduce this feature.

Programme status (from `lib/standard-scaffold-programmes.ts`'s own `content_status` field — not reassessed here):

| Programme | Level | `content_status` | Live course row |
|---|---|---|---|
| TERAS BASIC SCAFFOLD ERECTION PROGRAMME | Basic | verified | yes |
| TERAS INTERMEDIATE SCAFFOLD ERECTION PROGRAMME | Intermediate | verified | yes |
| TERAS ADVANCED SCAFFOLD ERECTION PROGRAMME | Advanced | verified | yes |
| TERAS BASIC SCAFFOLD INSPECTION PROGRAMME | Basic | verified | no — `course_id: null` |
| TERAS INTERMEDIATE SCAFFOLD INSPECTION PROGRAMME | Intermediate | verified | no — `course_id: null` |
| TERAS ADVANCED SCAFFOLD INSPECTION PROGRAMME | Advanced | verified | no — `course_id: null` |
| TERAS SCAFFOLD AWARENESS PROGRAMME | Awareness | **draft** | no — `course_id: null` |

6 of 7 programmes are `verified` (per the source file's header: copied/derived from the TERAS UNIVERSAL Training Course Catalogue 2026 spec sheets). Only Scaffold Awareness is `draft` (no spec sheet exists anywhere in the repo for it; placeholder text, not business-approved). The source file defines no "unknown" status — every programme is one of these two, so none are reported as unknown here.

The 4 inspection/awareness programmes with `course_id: null` have no corresponding `courses` row yet; the migration only binds the 3 erection programmes that do. Re-running the migration (it's idempotent) after those course rows exist would still require the same sign-off gate below — creating the course rows is not itself sign-off for the certificate feature.

Current production and `main` work correctly without this feature. It does not block, and is not blocked by, anything else in the certificate system.

## `20260913090000_quotation_atomic_rpcs.sql`

Status: **DRAFT — NOT APPLIED — OWNER APPROVAL REQUIRED (P0 quotation integrity, step M4)**

Adds the idempotency ledger `public.sales_quotation_requests`, seven internal helpers in schema `app`, and four SECURITY DEFINER RPCs (`create_quotation_with_items`, `replace_quotation_draft`, `create_quotation_revision`, `mark_quotation_sent`). The application does not call them yet.

Dependency chain (staging only, each step with its own gates): S0 → P1 `20260911115407` → P2 `20260911133000` (rename, once) → P3 `20260912005428` (constraints, once) → this file. The file refuses to run before P3 and refuses to run as any role other than `postgres`.

Rules while a draft:
- Do not apply it to Staging or Production, and do not move it into `supabase/migrations/`, without explicit owner approval and the staging checklist.
- Owner decisions embedded in the SQL: D4 (inputs limited to 2 decimals), D5 (negative line totals rejected), D6 (no extra send validation), D8 (a created quotation moves any unresolved opportunity to `quotation`).
- Validated only on throwaway local databases (Docker `postgres:17.6`): Baseline V2 + P1 + P2 + P3 + this file, and Baseline V3 + this file. Run the behaviour suite `supabase/tests/quotation_atomic_rpcs_behavior_test.sql` against such a database; it ends in ROLLBACK and inserts `auth.users` fixtures, so it must never be pointed at a shared database.
- Forward-only: stop using the RPCs by revoking EXECUTE and reverting the application; keep the ledger table.
