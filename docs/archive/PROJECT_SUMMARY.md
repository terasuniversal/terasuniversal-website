# TERAS UNIVERSAL Website — Project Summary

This document is a comprehensive, as-built analysis of the codebase at `C:\WEBSITE\terasuniversal-website`, current as of 2026-08-06. It is documentation only — no application code was modified to produce it.

---

## 1. Overview

The repository holds one Next.js 15 (App Router) application with two distinct halves sharing a single Vercel deployment:

- **Public marketing site** — plain JavaScript pages/components under `app/*.js`, `components/*.js`, `data/*.js`. Presents TERAS UNIVERSAL's training programmes, largely from hard-coded arrays, with some pages migrated to read live data through `lib/public-content.ts`.
- **Admin CMS** (`/admin`) — a role-gated, TypeScript back office built on Supabase (Postgres + Auth + Storage + Row Level Security) that manages courses, schedules, participants, attendance, assessments, certificates, trainers, companies, website content, reporting, and system administration.

**Stack:** Next.js 15.5 (App Router, React 19), Supabase (`@supabase/ssr`, `@supabase/supabase-js`), Zod for validation, Resend for transactional email, `pdfjs-dist`/`tesseract.js` for certificate PDF/OCR handling, deployed on Vercel. Node 22 engine.

**Scope lock (per `DELIVERABLE.md`):** Contact Enquiries and Proposal Requests have database tables and RLS but **no admin UI** — intentionally excluded. Website Settings (`site_settings`) exists similarly unsurfaced.

---

## 2. Folder Structure

```
app/
├── (public pages, .js)          about, calendar, contact, faq, gallery, industries/[slug],
│                                 insights/[slug], request-proposal, resources, search,
│                                 services, stories, training/[slug]
├── api/
│   ├── admin/                   certificates, login (legacy/orphaned), reset-password
│   └── newsletter, request-proposal
├── admin/
│   ├── login/, no-access/, reset-password/     unauthenticated-reachable
│   ├── cert-pdf/[id]/                          print-only certificate PDF view
│   ├── layout.tsx, admin.css                   .teras-admin CSS scope
│   └── (protected)/                             requires requireStaff() + per-module role
│       ├── dashboard, reports, courses, trainers, schedules, participants, companies,
│       │   attendance, assessment, certificates, news, gallery, faq, downloads, company,
│       │   media, automation, audit, backups, system, search, users
│       └── layout.tsx (sidebar + topbar shell)
└── verify/, verify/[token]       public certificate verification, no auth

components/
├── (public, .js)                 Footer, MegaNav, MobileNav, TrainingCalendar, ProposalWizard, ...
└── admin/ (.tsx)                 Sidebar, Topbar, NavScrim, ScaffoldPage, ImageUpload, Charts,
                                   CertificateDocument, ui/index.tsx (shared primitives)

lib/
├── supabase/                     server.ts, client.ts, middleware.ts, database.types.ts
├── auth/                         rbac.ts, session.ts
├── validation/schemas.ts         Zod schemas, one per entity
├── admin-nav.ts                  role-filtered sidebar config
├── public-content.ts             cached CMS reads for the public site
└── certificates.js, bulkCertificates.js, certificate-html.ts, zip.ts, successMetrics.js

data/                              legacy hard-coded content arrays (courseCatalog, faq, industries, ...)
supabase/
├── migrations/                   0001–0021 (clean-room schema) + 6 later timestamped
│                                 compatibility migrations (see §5.5)
├── seed.sql, cms-seed.sql
└── certificates.sql, certificate_import_logs.sql, role_policies.sql   (legacy prod schema reference)

docs/
├── uat/                          11 operator manuals (per module + troubleshooting + UAT report)
├── release/                      go-live checklist, v1.2.0 release notes
└── admin-crm-audit.md, bulk-pdf-import.md

middleware.ts                     root middleware, matches /admin/:path* only
```

Module-specific deep-dive docs also live at the repo root: `CERTIFICATE_ENGINE.md`, `PARTICIPANT_MANAGEMENT.md`, `TRAINER_MANAGEMENT.md`, `TRAINING_SCHEDULE.md`, `REPORTING_ANALYTICS.md`, `COMPANY_MANAGEMENT.md`, `AUTOMATION_CENTRE.md`, `PUBLIC_VERIFICATION.md`, `ASSESSMENT.md`, `DELIVERABLE.md` (original architecture spec).

---

## 3. Authentication & Authorization Flow

**Step 1 — Route entry.** Root `middleware.ts` matches only `/admin/:path*`; the public site is never touched. It delegates to `updateSession()` in `lib/supabase/middleware.ts`, which builds a cookie-bound Supabase SSR client and calls `supabase.auth.getUser()` (always revalidated against Supabase, never trusts the cookie blindly). Unauthenticated users hitting any protected admin path are redirected to `/admin/login?next=<path>`; an already-authenticated user hitting `/admin/login` is redirected to `/admin/dashboard`. `/admin/reset-password` is explicitly whitelisted so the password-recovery link works while "unauthenticated." If Supabase env vars are missing, the same redirect fires (fails closed).

**Step 2 — Login.** `app/admin/login/page.tsx` (client component, `useActionState`) submits to the server action `loginAction` in `app/admin/login/actions.ts`. It Zod-validates the form, calls `signInWithPassword()` via the SSR server client (sets the auth cookie), re-fetches the user, and reads `profiles.is_active` / `role`. An inactive account is immediately signed back out with an error. On success it stamps `last_login_at`, logs the event via the `log_event` RPC, and redirects — Trainers go to `/admin/attendance`, everyone else to `next` (if `/admin/...`) or `/admin/dashboard`.

**Step 3 — Role source of truth.** `public.profiles` is a 1:1 mirror of `auth.users`, auto-populated on signup by the `app.handle_new_user()` trigger (defaults `role='editor'`, `is_active=true`). `lib/auth/session.ts`'s `getCurrentProfile()` (React `cache`-wrapped, one DB hit per request) is the single read path used by every guard.

**Step 4 — Guards.** `requireRole(min)` and `requireStaff()` (staff = `super_admin/admin/editor/trainer`, excludes `client/participant`) are the general-purpose gates: not signed in → `/admin/login`; inactive → `/admin/login?error=inactive`; under-privileged → `/admin/no-access`. Attendance, Assessment, and Certificates have bespoke guards (`requireAttendance`, `requireAssessment`, `requireCertificate`) because Trainers sit *below* Editor in the strict hierarchy but still need explicit view/manage rights in exactly those three modules.

**Step 5 — Role hierarchy & module map.** `lib/auth/rbac.ts` defines `ROLE_ORDER = [super_admin, admin, editor, trainer, client, participant]` (lower index = more privileged; compare via `hasMinRole()`, never string equality) and `MODULE_ACCESS`, a route-key → minimum-role map that both the sidebar (`lib/admin-nav.ts`) and individual pages consult. Capability helpers (`canViewAttendance`, `canManageCertificate`, etc.) express the finer view-vs-manage split within a module.

**Step 6 — Password reset.** `app/api/admin/reset-password/route.js` is a public, IP-throttled (60s, in-memory) endpoint that calls `resetPasswordForEmail()` and always returns a generic success response (never reveals account existence). The emailed link lands on `/admin/reset-password`, a client component using the **browser** Supabase client (only other consumer of `lib/supabase/client.ts`) to call `auth.updateUser({ password })` against the short-lived recovery session.

**Defense in depth.** `MODULE_ACCESS`/route guards are explicitly the UI-side mirror of Postgres RLS (`supabase/migrations/0007_rls_policies.sql`), which is the actual enforcement boundary — every table's policies re-check role via `SECURITY DEFINER` helpers (`app.is_editor()`, `app.is_admin()`, `app.is_super_admin()`, `app.has_min_role()`), so a bypassed app-level guard still can't read/write unauthorized rows.

**Known issue:** `app/api/admin/login/route.js` implements a second, unrelated login flow against a legacy `admin_users` table using a plain (non-SSR) Supabase client. It is not called from the login page or anywhere else in the app and appears to be orphaned from an earlier auth design — worth confirming and removing rather than treating as live.

---

## 4. Supabase Integration

### 4.1 Two parallel schema tracks

The repo contains **two schema design efforts that must be reconciled before further work**:

1. **Clean-room track — `supabase/migrations/0001`–`0021`.** An enum-driven RBAC design (`profiles` + `user_role` enum) built from scratch: extensions/enums → core auth/RBAC → content modules → CRM/media → audit log → functions/triggers → RLS → storage → grants → public RPC wrappers → attendance/assessment/verification → participants management → training schedules → attendance management → assessment management → certificate engine → certificate verification → trainer management → company management → reporting views → automation centre.
2. **Compatibility track — six timestamped migrations dated 2026-07-21/24.** Written against the *actual pre-existing production database* (documented by standalone `supabase/certificates.sql`, `certificate_import_logs.sql`, `role_policies.sql`, which define a legacy `admin_users` membership table and `certificates`/`participants`/`courses` with different column names — `course_code`, `certificate_no`, `identity_no`, etc.). These migrations additively layer the clean-room's `profiles`/RBAC shape, CMS presentation columns, a parallel `course_schedules` table, and the full website-content module set onto that legacy schema, without touching legacy certificate data. `citext` is also relocated out of `public` into an `extensions` schema per Supabase's security linter.

`seed.sql` and `cms-seed.sql` are duplicate CMS content seeds feeding either track. **Before extending the schema, confirm with the team which track is authoritative in the live Supabase project** — the migration filenames alone don't make this obvious.

### 4.2 Tables (by domain)

- **Auth/RBAC:** `profiles`, `user_permissions`
- **Website content:** `courses`, `trainers`, `venues`, `schedules` (legacy scheduling, superseded by `training_schedules`), `downloads`, `news_categories`, `news_posts`, `gallery_categories`, `gallery_images`, `faq_categories`, `faqs`, `testimonials`, `company_profile` (singleton), `site_settings`
- **Media:** `media_folders`, `media`
- **CRM (no admin UI):** `enquiries`, `enquiry_notes`, `proposal_requests`, `proposal_notes`
- **Training operations:** `participants`, `certificates`, `certificate_templates`, `certificate_verifications`, `attendance`, `assessments`, `training_schedules`, `schedule_participants`, `companies`
- **Automation/system:** `automation_runs`, `automation_templates`
- **Audit:** `audit_logs` (append-only)
- **Reporting views** (`security_invoker`): `v_participants_per_month`, `v_schedules_per_month`, `v_certificates_per_month`, `v_attendance_breakdown`, `v_attendance_trend`, `v_assessment_passfail`, `v_top_companies`, `v_top_courses`, `v_trainer_workload`, `v_certificate_eligibility`

### 4.3 Row Level Security

Every table has RLS **enabled and forced** — even the owning role is subject to it; only `service_role` bypasses. Three reusable shapes, applied via `DO` blocks:

- **Content tables** (courses, downloads, news, gallery, faqs, testimonials): public `SELECT` limited to `status='published' AND deleted_at IS NULL`; staff (`app.is_editor()`) read everything and can insert/update; `app.is_admin()` required to delete.
- **Taxonomy tables** (categories): public read-all, editors manage-all.
- **Inbound CRM**: `anon`/`authenticated` may `INSERT` (public forms); only staff can `SELECT`/`UPDATE`; admin deletes.

Higher-privilege operational tables (participants, training_schedules, companies, trainers) become editor-read/admin-write; `assessments` adds a super-admin-only unlock policy; `automation_*`/`audit_logs` are admin-only and insert-only (no update/delete policies — audit log is genuinely append-only). All checks route through `SECURITY DEFINER` helper functions rather than inline subqueries, to avoid RLS recursion.

### 4.4 Storage

Three buckets (`0008_storage_buckets.sql`): `media` (public read, editor write, admin delete), `downloads` (same shape), `private` (no anon access at all — editor read/write, admin delete).

### 4.5 Key Postgres functions

`app.current_role()` / `app.is_active()` / `app.has_min_role()` / `app.is_admin()` / `app.is_editor()` / `app.is_super_admin()` — role checks; `app.has_permission()` — role default + `user_permissions` override; `app.handle_new_user()` — provisions `profiles` on signup; `app.set_updated_at()` / `app.stamp_actor()` — generic triggers; `app.audit_trigger()` — infers create/update/delete/publish from row diffs and writes `audit_logs`; `app.slugify()`; `app.log_event()` / `app.global_search()` (+ public RPC wrappers) — audit logging and the admin command-palette search; `public.verify_certificate()` / `verify_certificate_by_token()` / `verify_and_log()` — anon-callable, safe-fields-only certificate verification, the latter logging every attempt; ID generators (`app.gen_participant_id`, `gen_certificate_number`, etc.) — sequence-based, race-safe, configurable prefix via `app.automation_setting()`.

### 4.6 Client architecture (`lib/supabase/`)

- **`server.ts`** — `createSupabaseServerClient()` (async, cookie-bound via `@supabase/ssr`) is the dominant pattern, used in nearly every server component/action/route handler so RLS runs as the logged-in user. Also exports `createSupabaseServiceClient()` (plain `createClient` + `SUPABASE_SERVICE_ROLE_KEY`, session persistence disabled) for trusted server-only paths that must bypass RLS.
- **`client.ts`** — `"use client"` browser client, used in exactly two places, most notably the password-reset page which needs the short-lived recovery session client-side.
- **`middleware.ts`** — the request-scoped client used by root `middleware.ts` to refresh sessions and gate `/admin/**`.
- **`database.types.ts`** — a **hand-curated, partial** type snapshot (not full `supabase gen types` output); `server.ts` casts the client `as any` at the boundary to bridge gaps between shipped migrations and this lagging type file. Regenerate via the Supabase CLI (see `README.md`/`DELIVERABLE.md` §7) before relying on it for a new module.

---

## 5. Admin CMS Modules

Access levels below are the route-level minimum from `MODULE_ACCESS`; several modules further split *view* vs *manage* rights inside their own `actions.ts` (noted where relevant).

| Module | Route | Min role | Status |
|---|---|---|---|
| Dashboard | `/admin/dashboard` | staff (any) | KPI overview; trainers auto-redirected to Attendance |
| Reports & Analytics | `/admin/reports` | editor | Charts (participants, schedules, certs, attendance/pass-fail, top companies/courses, trainer workload) + CSV export |
| Courses | `/admin/courses` | editor (delete/publish → admin) | **Reference implementation** — full CRUD, preview, Zod-validated (`courseSchema`) |
| Trainers | `/admin/trainers` | editor read / admin write | Full CRUD + CSV export |
| Training Schedule | `/admin/schedules` | editor read / admin write | CRUD + trainer double-booking check + participant assignment + calendar view + export |
| Schedule (legacy alias) | `/admin/schedule` | — | Redirects to `/admin/schedules` |
| Participants | `/admin/participants` | editor read / admin write | CRUD + CSV export/import |
| Companies | `/admin/companies` | editor read / admin write | Client-company records CRUD + export |
| Attendance | `/admin/attendance` | trainer (view: editor or trainer; manage: admin or trainer) | Per-schedule marking + CSV export/import |
| Assessment | `/admin/assessment` | trainer (same split as attendance) | Per-schedule competency/pass-fail results + export |
| Certificates | `/admin/certificates` | editor view / admin manage | Issue/revoke, eligibility-based bulk generation, templates CRUD, ZIP download, public verify links |
| News | `/admin/news` | editor | List page is a `ScaffoldPage` placeholder; create/edit/`actions.ts` are fully implemented |
| Gallery | `/admin/gallery` | editor | Same pattern as News — list UI pending, CRUD works |
| FAQ | `/admin/faq` | editor | Same pattern — list UI pending, CRUD works |
| Downloads | `/admin/downloads` | editor | Same pattern — list UI pending, CRUD works |
| Company Profile | `/admin/company` | editor | Singleton; page is a stub `ScaffoldPage`, but `saveCompanyProfile` action works |
| Media Library | `/admin/media` | editor | Read-only browser; no dedicated uploader — uploads happen via URL fields in other forms |
| Automation Centre | `/admin/automation` | admin | System settings (ID prefixes, timezone), email templates, run-history log |
| Audit Log | `/admin/audit` | admin | Read-only, paginated/searchable `audit_logs` |
| Backups | `/admin/backups` | admin | Read-only view of backup-related audit entries (provider-managed, no in-app trigger) |
| System Health | `/admin/system` | admin | DB connectivity, storage usage, automation status, failed-job count |
| Global Search | `/admin/search` | editor | Cross-entity search (courses, participants, companies, schedules, certs, trainers, news, downloads, media) |
| Users & Roles | `/admin/users` | super_admin | Read-only staff directory — role/activation editing not yet built |

**Other routes:**
- `/admin/cert-pdf/[id]` — print-only certificate PDF view outside the sidebar shell, auto-triggers `window.print()`.
- `/api/admin/certificates` — editor+ REST endpoint creating certificate+participant+course together (Malay-language messages).
- `/api/admin/reset-password` — public, throttled reset-request endpoint.
- `/api/admin/login` — **legacy/orphaned**, see §3.
- `/verify`, `/verify/[token]` — fully public certificate verification (certificate-number lookup and QR-token lookup), calls `verify_and_log` RPC, renders only safe fields, `noindex`.

**Every fully-built module** (Courses, Schedules, Participants, Companies, Trainers, Certificates, News/Gallery/FAQ/Downloads at the data layer) follows the same file shape inside `app/admin/(protected)/<module>/`: `page.tsx` (list), `new/page.tsx` + `[id]/page.tsx` (create/edit, usually sharing a `<Module>Form.tsx`), `actions.ts` (server actions, each `requireRole`-guarded and Zod-validated). **Courses is the canonical reference** to copy when building or extending a module; `components/admin/ScaffoldPage.tsx` marks modules whose list UI isn't built yet even though the data layer/actions are complete.

---

## 6. Coding Standards & Conventions

- **Language split is strict and load-bearing.** Public site = `.js`, no type annotations. Admin = `.ts`/`.tsx` throughout, with imported types from `database.types.ts`. `npm run lint` (`scripts/lint.mjs`) only runs `node --check` (syntax only) over `.js` files and silently skips TypeScript — there is **no ESLint config anywhere** in the repo. `npm run typecheck` (`tsc --noEmit`) is the only real static check and only covers the TS side.
- **Styling: plain custom CSS, no Tailwind.** No `tailwind.config.*`/`postcss.config.*` exists. Public styles live in `app/globals.css` (BEM-ish class names, `--navy`/`--blue`/`--gold` custom properties). Admin styles live in `app/admin/admin.css`, scoped under a single `.teras-admin` root class so they never leak onto the public site, with a consistent `ta-` class prefix (`ta-card`, `ta-btn`, `ta-table`, `ta-badge-pill`, `ta-field`) and its own `--ta-*` variables. Inline `style={{...}}` is used freely alongside the class system in both halves.
- **Mutations go through Server Actions, not Route Handlers.** Every CRUD module has a colocated `actions.ts` (`"use server"`) exporting one function per mutation, bound to forms via `useActionState` (create) or `Action.bind(null, id)` (edit/delete). Route handlers (`app/api/**`) are reserved for things that aren't plain form submissions: CSV import/export, webhooks, throttled public endpoints, PDF/REST integrations.
- **Validation: centralized Zod, `safeParse` only.** `lib/validation/schemas.ts` holds one `<entity>Schema` per domain object (+ inferred `<Entity>Input` type), with shared helpers (`slug` regex, `stringArray` for newline-separated lists). Actions call `schema.safeParse(...)` and return `{ errors: fieldErrors(parsed.error) }` (never throw on validation failure); forms read `state.errors` into a shared `<Field error>` primitive, with a top-level `state.message` alert for DB-level errors (e.g. Postgres `23505` unique-violation → friendly slug message).
- **Naming:** PascalCase components, literal `actions.ts` filename per route folder, `[id]` dynamic segments, `(protected)` route group for auth-gated pages. Shared admin UI primitives (`StatCard`, `Badge`, `Card`, `EmptyState`, `PageHead`, `Pagination`, `Field`) live in one barrel file, `components/admin/ui/index.tsx` — no CSS-in-JS, no CSS Modules.
- **Comments are sparse and purpose-driven** — short `/** */` blocks on non-obvious exports explaining *why*, not what; no per-file header banners.
- **Error handling is redirect-based for auth** (`lib/auth/session.ts` guards always `redirect()`, never throw) and **`{ data, error }`-based for Supabase calls** (no try/catch; known Postgres error codes are special-cased for friendlier messages, otherwise the raw message is surfaced).

---

## 7. Notable Gaps / Follow-ups for Future Work

- Two parallel Supabase schema tracks (clean-room 0001–0021 vs. the 2026-07 compatibility patch set) coexist in `supabase/migrations/` — confirm which is live before adding new migrations.
- `lib/supabase/database.types.ts` is hand-curated and lags the schema (`server.ts` casts `as any` to bridge the gap) — regenerate with the Supabase CLI before depending on it heavily.
- `app/api/admin/login/route.js` appears to be orphaned legacy code (separate `admin_users`-based auth flow, unreferenced by the UI).
- News, Gallery, FAQ, Downloads, and Company Profile modules have working data layers/actions but placeholder (`ScaffoldPage`) list/detail UI — the pattern to finish them already exists in Courses.
- Media Library has no dedicated upload flow; uploads currently happen via raw URL fields in other forms.
- Users & Roles (`/admin/users`) is read-only — role assignment/deactivation UI is not yet built.
- No automated test suite exists (no Jest/Vitest config); verification relies on `npm run build` and `npm run typecheck`.
