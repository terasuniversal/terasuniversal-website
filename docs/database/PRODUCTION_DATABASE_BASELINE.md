# TERAS PRODUCTION DATABASE BASELINE

> ## SOURCE OF TRUTH AFTER BASELINE V1
> Prefer, in order:
> 1. **`docs/database/PRODUCTION_DATABASE_BASELINE.md`** (this file)
> 2. **`docs/database/SCHEMA_INDEX.md`**
> 3. **`supabase/baseline/v1/manifest.json`** (hashes + counts) and **`supabase/baseline/v1/schema.sql`** (canonical frozen snapshot)
> 4. **Post-baseline migrations** in `supabase/migrations/` (versions >= `20260817000000`)
>
> Inspect historical migrations (`0001`–`0021` and the pre-baseline `2026*` files) **only** for archaeology/debugging. Do **not** use them as the reconstruction source; fresh environments run `supabase/baseline/v1/bootstrap.sql` instead. The historical chain does **not** reproduce production (see `docs/database-baseline-audit/FRESH_REPLAY_REPORT.md`).

Source of truth for AI agents and humans. Read this **before** writing any migration or query against the database.
Last updated: 2026-08-16 (audit `docs/database-baseline-audit/`).

## Identity
- Production project ref: **`iagzkrzeuawaxvacqprk`** (TERAS Certificate Verification), region `ap-southeast-1`, PostgreSQL **17.6**.
- Staging project: **`pzgtyskhyhuxhzvyzzhe`** (TERAS Database Baseline Staging).
- Application schemas: `public` + `app`. Platform schemas (`auth`, `storage`, `realtime`, `vault`, `supabase_migrations`) are managed by Supabase — do not modify.
- CLI: `supabase` 2.114.0. Read-only access via `supabase db query --linked` / `supabase db dump --linked`.

## The critical fact
**The historical migration chain does NOT reproduce production.** A fresh replay of `supabase/migrations/` fails (24/49 dated migrations; first failure `20260721030247` → missing `public.admin_users`). Production was consolidated by an out-of-band `database_baseline_v1` migration (981 statements, applied 2026-08-15) that has **no repo file**.

**Canonical reconstruction source:** `supabase/baseline/v1/schema.sql` (frozen snapshot, SHA-256 `0B73DC50022888B580A222318F634F4C9A5B180BC499B7DD1E857E61E98719BA`). Treat it as the description of "what is live" for `public` + `app`. Post-snapshot live changes: `feedback_schedule_qr` (`20260816072507`), `sales_won_follow_up_completion` (`20260816100000`), and the security remediation pack (unrecorded). The numbered track `0001`–`0021` is **archived/non-executable** — never run it.

## Core tables (public schema unless noted)
| Table | Purpose | Key relations |
|---|---|---|
| `profiles` | Auth-profile / RBAC (role, is_active) | `id → auth.users(id)` |
| `courses` | Training courses (127 rows) | `course_schedules.course_id` |
| `participants` | Participant master (126 rows) | `schedule_id → course_schedules`; certificates; attendance |
| `certificates` | Issued certificates (108 rows) | `course_id`, `participant_id`, `schedule_id` |
| `course_schedules` | Training schedules (35 rows) | `course_id`, `schedule_participants`, `attendance`, `assessments` |
| `schedule_participants` | Schedule↔participant links (12 rows) | |
| `attendance` / `assessments` | Ops records | `schedule_id`, `participant_id` |
| `certificate_verifications` | Public verification log (42 rows) | |
| `audit_logs` | Audit trail (~1,072 rows) | written via `app.log_event` (service-only) |
| `enquiries` | Public contact enquiries | `sales_lead_metadata` (source `enquiry`) |
| `proposal_requests` | Public request-proposal | `sales_lead_metadata` (source `proposal_request`) |
| `sales_lead_metadata` | Unified lead pipeline | `source_id` polymorphic; unique `(lead_source, source_id)` |
| `sales_activity` | Append-only lead timeline | |
| `sales_opportunities` / `sales_quotations` / `sales_quotation_items` / `sales_tasks` | Sales CRM phase 2/4B | `lead_metadata_id`, `opportunity_id`, `quotation_id` |
| `companies` | Companies (small) | optional `company_id` on opportunities |
| `photos` + `photo_*` | Photo-bot (out-of-band, no repo migration) | |
| `feedback_*` / `participant_feedback` | Feedback + QR (out-of-band) | `schedule_id` |
| `media`, `media_folders`, `news_posts`, `gallery_images`, `faqs`, `downloads`, `company_profile`, `cms_content`, `cms_media` | CMS content | |
| `admin_users` | Legacy admin gating (created out-of-band; superseded by `profiles.role`) | |

## Important views
- `v_sales_lead_inbox` — unified lead inbox (security_invoker; editor+).
- `v_certificate_eligibility` — certificate eligibility (security_invoker).
- Do **not** rely on numbered-track views (`v_top_courses`, `v_schedules_per_month`, ...) — they do not exist in production.

## Critical RPCs (all SD; explicit search_path verified)
- Public submit: `submit_public_enquiry`, `submit_proposal_request` (anon+authenticated EXECUTE; rate-limited).
- Public verify: `verify_certificate_by_value`, `verify_and_log` (anon EXECUTE).
- Delivery status: `mark_proposal_delivery_status` (**service_role ONLY**).
- Admin (SD + internal `app.is_admin()` guard): `issue_certificate_with_skill_snapshot`, `duplicate_certificate_with_skill_snapshot`, `convert_lead_to_opportunity`, `accept_quotation`, `reject_quotation`, `mark_opportunity_lost`.
- RLS helpers: `app.is_admin()`, `app.is_editor()`, `app.is_super_admin()`, `app.has_min_role()`, `app.current_role()`.
- Audit: `app.log_event(...)`, `log_event_as_service(...)` (service-only).

## Important triggers
- `trg_enquiries_create_sales_lead`, `trg_proposal_requests_create_sales_lead` → `app.create_sales_lead_metadata()` (auto-create lead on public submission).
- `certificates_before_insert`, `sync_participant_last4`, `on_auth_user_created` → `app.handle_new_user()` (profiles).

## RLS model
- Boundary = RLS. New policies use `app.is_admin()` / `app.is_editor()` / `app.has_min_role()` on `profiles.role` + `is_active`. Do **not** build a second membership gate (`admin_users` is legacy; do not extend it).
- Read (view) typically requires `editor`+; mutations of pipeline state require `admin`+; append-only activity is `editor`+.
- 8 tables FORCE RLS; others rely on platform defaults. `service_role`/`postgres` bypass RLS.
- Public tables have **no** direct anon/authenticated grants; writes go through SD RPCs.

## Role model
`super_admin > admin > editor > trainer > client > participant` (`app` schema helpers; `lib/auth/rbac.ts` `ROLE_ORDER`, lower index = more privileged). Always use `hasMinRole()`/`rank()`, never raw string comparison.

## Migration rules (summary)
1. Verify objects are live before writing code/DDL (never infer from filenames).
2. Forward-only migrations only; never edit an applied migration; no reset in prod.
3. SD functions: explicit safe `search_path`; explicit REVOKE/GRANT.
4. Every change passes fresh replay + diff vs `supabase/baseline/v1/schema.sql` before production.
5. New tables ship DDL + RLS + audit trigger + Zod schema + types regen + `MODULE_ACCESS` entry together.
6. Regenerate `lib/supabase/database.types.ts` from live schema after schema changes.
7. Record any out-of-band SQL as an idempotent migration.
8. See `docs/database-baseline-audit/MIGRATION_POLICY.md`.

## Known legacy exceptions
- `admin_users` (out-of-band), photo/feedback tables (remote-only migrations), `database_baseline_v1` (no repo file), security pack (unrecorded), `cms_content`/`cms_media` (unused), two independent status columns on `courses` (`status` text + `cms_status` enum), dual policy generations (admin_users vs profiles.role).

## Objects agents must NOT recreate manually
`profiles`, `auth.*`, `storage.*`, `supabase_vault`, `database_baseline_v1` content, and any SD function that already exists live. If an object "should" exist but isn't in the snapshot or a forward migration, it doesn't exist — do not hand-create it; file it as drift and get it into a migration.
