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

Dependency chain (staging only, each step with its own gates): S0 → P1 `20260911115407` → P2 `20260911133000` (rename, once) → P3 `20260912005428` (constraints, once) → P4 `20260917160558_quotation_training_snapshot_v1` → this file. P4 is a 4-line additive `alter table public.sales_quotations add column training_details jsonb not null default '{}'`; it is already applied on the canonical staging project but is NOT in this branch's `supabase/migrations` (it lives on the sales V1 release branches, e.g. `release/sales-v1-candidate-20260918`), so how it enters the chain is an owner decision. The file refuses to run before P3 or P4 and refuses to run as any role other than `postgres`.

`training_details` is a legacy snapshot that the quotation and invoice PDFs still render. The application no longer writes it, so create leaves the default and replace leaves the stored value; a revision copies it.

Rules while a draft:
- Do not apply it to Staging or Production, and do not move it into `supabase/migrations/`, without explicit owner approval and the staging checklist.
- Owner decisions embedded in the SQL: D4 (inputs limited to 2 decimals), D5 (negative line totals rejected), D6 (no extra send validation), D8 (a created quotation moves any unresolved opportunity to `quotation`).
- Validated only on throwaway local databases (Docker `postgres:17.6`): Baseline V2 + P1 + P2 + P3 + this file, and Baseline V3 + this file. Run the behaviour suite `supabase/tests/quotation_atomic_rpcs_behavior_test.sql` against such a database; it ends in ROLLBACK and inserts `auth.users` fixtures, so it must never be pointed at a shared database.
- Course snapshots (D9): the RPCs VALIDATE name/HRDF/package keys against `course_commercial_profiles` exactly as the application resolves them, and reject mismatches; they do not resolve (compute) the snapshots themselves.
- Customer fields omitted from the header fall back to the company, then the opportunity (as `createQuotation` does for unsubmitted fields); fields supplied, even empty, are used as sent.
- Also validated locally: `supabase/tests/quotation_atomic_rpcs_isolation_test.sql` (every RPC refuses REPEATABLE READ). Both test files are for disposable databases only.
- Forward-only: stop using the RPCs by revoking EXECUTE and reverting the application; keep the ledger table.

## `20261104090000_harden_anon_function_execute_grants.sql`

Status: **DRAFT — NOT APPLIED — OWNER APPROVAL REQUIRED (security hardening for the canonical staging project)**

Read-only inspection found 69 SECURITY DEFINER functions in `public`/`app` executable by `anon` on the canonical staging project (`eokiaehnvzbggmacifcf`), against 11 intended-public ones on the baseline staging project. Supabase's default privileges grant `anon` on function creation and `revoke ... from public` does not remove them. The draft revokes `anon` on every non-listed SECURITY DEFINER function, revokes `authenticated` on 14 service-only payment-callback/logging functions (the app calls them with the service-role client), and makes four `app.*` trigger/sequence helpers owner-only. It also removes the explicit `anon` default privilege for functions that `postgres` creates in `public`, so the repo's standard `revoke all on function ... from public` is enough for future functions (the built-in PUBLIC default is global and untouched, so every new function must still revoke PUBLIC and the public site's functions must grant `anon` on purpose). It refuses to run unless each listed function exists exactly once (SECURITY DEFINER, owned by `postgres`). It never revokes `service_role`.

Deliberately NOT changed: `public.log_event` / `app.log_event` (admin actions call it with the signed-in user's client; revoking `authenticated` would silently stop those audit lines — a separate owner decision), non-SECURITY-DEFINER functions, and authenticated grants on staff RPCs.

Rules while a draft: do not apply it to any shared database or move it into `supabase/migrations/` without explicit owner approval and a captured ACL snapshot (see the file header). Validated only on a throwaway Docker database (Baseline V3 plus a simulation of the canonical drift) with `supabase/tests/harden_anon_function_execute_grants_test.sql`; that test is for disposable databases only. Staging smoke tests after applying: sandbox payment callbacks, public registration, public enquiry and proposal forms, certificate verification, feedback links, admin invoice and quotation flows.
