# SYSTEM_AUDIT.md — TERAS UNIVERSAL Training Management System

Complete functional audit of every admin module, cross-checked against the **live, connected Supabase project** (not migration-file assumptions). Builds directly on `CLAUDE.md` and `PROJECT_SUMMARY.md` as instructed, and on this session's prior live-verified reports (`DATABASE_AUDIT.md`, `BUG_REPORT.md`, `SECURITY_REPORT.md`, `PERFORMANCE_REPORT.md`) — those reports have full evidence and are cited by name rather than re-derived in full here, to keep this document focused on the audit's specific deliverable: per-module functional status and a triaged issue list. **No code was modified, no commits made, no migrations generated.** This is the report only — fix phase has not started.

---

# 1. Executive Summary

The system has one root cause behind nearly every module-level finding below: **two independently-designed database schemas exist in this repo's history, and only one is applied to the live Supabase project.** Most admin operations modules (Schedules, Trainers, Companies, Attendance, Assessment, the certificate engine, Automation, Reports, Audit) were built against the schema that was never deployed. The live database instead runs an older, additive "compatibility" schema layered on a pre-existing legacy certificate-verification system.

Of 22 modules audited: **1 fully working**, **10 partially working**, **10 broken or effectively non-functional**, plus the public-facing certificate verification flow (outside the module list but arguably the most important single feature on the site) is **broken**. This is not 20 separate bugs — it is one architectural decision, deferred, with 20 downstream symptoms. Making V1.0 real means resolving that one decision first; nearly everything else on the fix list becomes mechanical alignment work once it's made.

Two items don't fit that pattern and should not wait for the schema decision:
- **Public certificate verification** (`/verify`) can be fixed today, independent of everything else — the working RPC it should call already exists live.
- **5 CMS modules' list pages** (News, Gallery, FAQ, Downloads, Company) are already schema-correct at the data layer but show a static "coming soon" placeholder instead of a real list UI — a small, independent fix.

Module status legend: ✅ Fully working · 🟡 Partially working · ❌ Broken · ⚪ UI only · ⚫ Not implemented.

| Module | Status | Module | Status |
|---|---|---|---|
| Dashboard | ❌ | Media | 🟡 |
| Participants | ❌ | Downloads | 🟡 |
| Courses | ✅ | Reports | ❌ |
| Certificates | 🟡 | Search | 🟡 |
| Attendance | ❌ | Automation | ❌ |
| Assessment | ❌ | Backups | ⚪ |
| Schedules | ❌ | Audit | ❌ |
| Companies | ❌ | System | 🟡 |
| Trainers | ❌ | News | 🟡 |
| Users | 🟡 | Gallery | 🟡 |
| — | — | FAQ | 🟡 |
| — | — | Company Profile | 🟡 |

---

# 2. Working Modules ✅

## Courses — ✅ Fully working

The reference implementation; every other module is meant to copy this pattern.

| Check | Status | Notes |
|---|---|---|
| List page | ✅ | Real table, server-rendered |
| Pagination | ✅ | `Pagination` component used |
| Search | ✅ | Title search via `.ilike`/`.or` |
| Sorting | ✅ | `sort_order` + status |
| Filter | ✅ | Category, status |
| Create | ✅ | `courses/new/page.tsx` + `createCourse` |
| Edit | ✅ | `courses/[id]/page.tsx` + `updateCourse` |
| Delete (soft) | ✅ | `deleted_at` set via `archiveCourse` |
| Restore | ✅ | Restore action confirmed present |
| Validation | ✅ | `courseSchema` (Zod), `safeParse` before every write |
| Server Actions | ✅ | `courses/actions.ts`, all guarded via `requireRole` |
| Zod schema | ✅ | `courseSchema` in `lib/validation/schemas.ts` |
| Supabase query | ✅ | Targets live columns (`title`, `slug`, `status`, `delivery_modes`, etc. — the compatibility-migration-added columns) |
| Permissions | ✅ | Editor read/write, admin delete/publish |
| Role protection | ✅ | `requireRole("editor")` at minimum |
| Navigation | ✅ | Sidebar entry, links resolve |
| Loading state | 🟡 | No route-level `loading.tsx` anywhere in the app (see UI Findings §9) — page blocks until data resolves rather than showing a skeleton |
| Empty state | ✅ | `EmptyState` component |
| Error state | 🟡 | Shared `app/admin/(protected)/error.tsx` catches unhandled errors; no per-field inline error beyond Zod field errors |
| Success notification | 🟡 | No toast — success is communicated by redirect-to-list after save (a valid pattern, but worth naming explicitly since "notification" implies something more) |

**One caveat even here**: `courses.status` and `courses.cms_status` are two parallel live columns from two migration generations; the app only ever writes `status`, so `cms_status` is permanently stuck at its default. Not functionally broken, but worth cleanup (`BUG_REPORT.md` BUG-10).

---

# 3. Partially Working Modules 🟡

## Certificates — 🟡 Partially working (three divergent code paths)

| Path | Status |
|---|---|
| Admin UI (`app/admin/(protected)/certificates/**`) | ❌ Broken — writes `certificate_number`, `template_id`, `schedule_id`, none exist live |
| Legacy API (`/api/admin/certificates`) | ✅ Works — matches live legacy column names exactly |
| Public verification (`/verify`, `/verify/[token]`) | ❌ Broken — calls `verify_and_log` RPC, doesn't exist live; every genuine certificate returns "not found" |

Certificate Register export, QR verification, and PDF generation are all downstream of the broken paths above — see §4/§5.

## News, Gallery, FAQ, Downloads, Company Profile — 🟡 Partially working (identical pattern across all 5)

| Check | Status | Notes |
|---|---|---|
| List page | ❌ | Renders `<ScaffoldPage>` — a static "module scaffolded, see Courses" card, not a real table |
| Create / Edit | ✅ | Fully implemented, schema-correct against live tables |
| Delete (soft) | ✅ | `archive*` actions exist and work |
| Validation | ✅ | Zod schemas present (News/FAQ) or inline validation (Gallery/Company) |
| Server Actions | ✅ | Guarded, functional |
| Supabase query | ✅ | Live tables (`news_posts`, `gallery_images`, `faqs`, `downloads`, `company_profile`) all exist and match |
| Navigation | 🟡 | Sidebar link resolves, but lands on the placeholder |

**A staff member cannot reach a working feature without knowing the direct `/admin/news/new`-style URL.** This is the single cheapest, highest-visibility fix on the whole list (`MASTER_TODO.md` C3).

## Media Library — 🟡 Partially working

Read-only browser against the live `media` table works. No dedicated uploader (`ImageUpload.tsx` is used from within other forms, not this module directly). Uploads themselves fail regardless — Storage has zero buckets provisioned live.

## Search — 🟡 Partially working

5 of 8 categories (courses, participants, companies, news, downloads) return correct results. 3 (schedules, trainers, certificate-number) silently return zero results because they query non-existent tables/columns — the Supabase client returns `{ data: null, error }` rather than throwing, so the page doesn't crash, it just quietly omits those categories.

## Users — 🟡 Partially working

List/view works (`profiles` table is live). No write UI exists — role assignment and activation/deactivation cannot be done from the app; changes would require direct SQL. Effectively read-only despite the underlying table being fully live.

## System — 🟡 Partially working

Queries `profiles` and `media` (live, work) and `automation_runs` (not live, fails) — the health-check page itself likely shows a mix of real and error/empty data depending on which query.

---

# 4. Broken Modules ❌

Every module below fails because it queries a table or column that does not exist in the live database. Full column-by-column evidence: `DATABASE_AUDIT.md` §5, `BUG_REPORT.md` BUG-01–03/06.

| Module | Queries (don't exist live) | List/CRUD result |
|---|---|---|
| Dashboard | `training_schedules`, `assessments` (6 of 8 dashboard queries) | Widgets error or show nothing for most tiles |
| Participants | writes `ic_passport_no`, `nationality`, `gender`, `company_id`, invalid `status` values | **Cannot create or edit a single participant** — every submit is rejected |
| Attendance | `attendance_status`, `check_in_time`/`check_out_time`, `training_schedules` join | List/detail fail; separately, even where reachable, check-in times are timezone-wrong (server-local, not venue-local) |
| Assessment | `theory_score`, `practical_score`, `competency_status`, `training_schedules` join | List/detail fail |
| Schedules | `training_schedules` (table doesn't exist at all) | Entire module non-functional |
| Companies | `companies` (table doesn't exist at all) | Entire module non-functional |
| Trainers | `trainers` (table doesn't exist at all) | Entire module non-functional |
| Reports | 9 `v_*` views, `training_schedules`, `companies`, `audit_logs` | No data source at all; front-end calculation logic is itself correct but has nothing to calculate from |
| Automation | `automation_runs`, `automation_templates` | Entire module non-functional |
| Audit | `audit_logs` (table doesn't exist at all) | Entire module non-functional |

**Note**: in every case, the page-level code (guards, forms, Zod schemas, UI) is generally well-written — these are not sloppy modules, they are complete modules pointed at the wrong schema.

---

# 5. Missing Features

- **Backups** (⚪ UI only): the one action on this page is deliberately `disabled`, with an in-app note explaining it needs a protected server job + retention policy before it can safely handle production exports. Correctly gated, not a bug — just genuinely not built yet.
- **Users role-management write UI** (part of §3 above): view exists, management (assign role, activate/deactivate) does not.
- **QR check-in for Attendance**: explicit in-app "coming soon" placeholder on the Attendance schedule-detail page. Schema already reserves an `attendance_method = 'qr'` enum value for this.
- **Email integration**: Resend is integrated for two flows (proposal-request confirmation, newsletter signup) but **not** for certificate delivery or any admin notification — "Email (soon)"/"Email Queue (soon)" buttons are explicitly disabled in the Certificates and Automation modules.
- **Real PDF generation**: Certificate Register, Company Profile Report, and Assessment Report exports are explicitly commented in the code as "PDF placeholder — print to PDF" — they render printable HTML and rely on the browser's print dialog, not server-generated PDFs.
- **Bulk PDF/OCR certificate import**: `lib/bulkCertificates.js` fully implements this (PDF text extraction + OCR fallback) and `docs/bulk-pdf-import.md` documents a `/admin/certificates/import` page — but that route doesn't exist and the library is imported nowhere. Substantially built, never connected.
- **Cross-module integration placeholders**: Certificate auto-issue from competent assessments, participant/training history views, competency analytics — all explicit "coming soon" cards on the Assessment schedule-detail page.

---

# 6. Security Findings

Full detail and live evidence: `SECURITY_REPORT.md` (16 categories). Summary of what matters most for the V1.0 fix phase:

| Finding | Severity | File/Area |
|---|---|---|
| `courses`/`participants`/`certificates` RLS gated by binary `admin_users` membership, disconnected from `profiles.role`/`is_active` | Critical | Live RLS policies (`SECURITY_REPORT.md` §2) |
| `/api/admin/login` returns raw session tokens in JSON, no rate limit, checks a different auth table than the real login path | High | `app/api/admin/login/route.js` |
| Middleware doesn't cover `/api/**` at all — every API route self-guards with no fallback net | High | `middleware.ts` |
| Storage: zero buckets provisioned; upload validation is client-side only when it does run | High | Storage / `ImageUpload.tsx` |
| In-memory per-IP rate limiting doesn't work across serverless instances | High | `login`, `reset-password`, `request-proposal`, `newsletter` |
| CSP allows `unsafe-inline`/`unsafe-eval` in `script-src` | High | `next.config.mjs` |
| Filter-injection via unsanitized `.or()` interpolation on 13 endpoints | High | list/export pages across 8 modules |
| `certificateSchema` defined, never imported — certificate writes unvalidated | Critical (functional) / High (security) | `certificates/actions.ts`, `/api/admin/certificates` |
| `FORCE ROW LEVEL SECURITY` not set on any live table | Low (corrected — `anon`/`authenticated` don't have `BYPASSRLS` regardless) | all tables |

---

# 7. Performance Findings

Full detail: `PERFORMANCE_REPORT.md`. Summary:

| Finding | Severity | File/Area |
|---|---|---|
| ~30 live foreign keys with no covering index (notably `attendance.schedule_id`, `assessments.schedule_id`/`participant_id`) | High (structural, not urgent yet) | live schema |
| Unbounded `.limit(100000)` fetch on every CSV import preview | High | `participants/import/importActions.ts:46` |
| Nested `await` inside a `Promise.all([...])` array silently serializes 3 queries into 4 sequential round-trips | High | `trainers/[id]/page.tsx:28-31` |
| N+1 pattern in bulk certificate generation (~5 round-trips per participant) | Medium | `certificates/actions.ts` `bulkGenerate` |
| `next/image` has no `remotePatterns` — cannot serve Storage-hosted images at all | Medium | `next.config.mjs` |
| Dashboard fires 8 independent round-trips per load (correctly parallelized, just numerous) | Low | `dashboard/page.tsx` |
| `pdfjs-dist`/`tesseract.js` pulled in by code that's never imported | Medium (install size only, not runtime) | `lib/bulkCertificates.js` |

---

# 8. Database Findings

Full detail: `DATABASE_AUDIT.md`. Summary:

- **Live migration history**: 14 applied migrations (legacy + compatibility lineage). **Numbered lineage (`0001`–`0021`, 27 files) never applied.**
- **21 live tables**, `courses` the only one with real data (125 rows) — everything else empty.
- **Column-name mismatches** throughout `courses`/`participants`/`certificates` between what the app writes and what's live (`certificate_no` vs `certificate_number`, `participant_code` vs `participant_id`, `organization` vs `company_id`, etc.) — full table in `DATABASE_AUDIT.md` §5.
- **Repo/live drift in migration history itself**: 5 of 6 compatibility-migration filenames don't byte-match their live timestamps; one live migration has no corresponding repo file; one repo file has no corresponding live migration entry.
- **`lib/supabase/database.types.ts`** is a hand-written partial stub (4 tables typed, everything else falls back to `any`) — `npm run typecheck` currently cannot catch any of the mismatches above.

---

# 9. UI Findings

- **No route-level `loading.tsx` exists anywhere under `app/admin/`.** Every page is `force-dynamic`, so navigation blocks on the full server-side data fetch before anything renders — no skeleton/spinner during that wait. One shared `app/admin/(protected)/error.tsx` exists for the whole protected route group (reasonable, but means no module gets a more specific error UI without adding its own).
- **Success notifications are implicit (redirect-to-list), not explicit (no toast/banner system found anywhere in `components/admin`).** Consistent across every module, so not "broken," but worth naming as a deliberate pattern rather than an oversight if a future request asks for one.
- **5 modules' list pages are literal placeholder cards** (`<ScaffoldPage>`) despite working CRUD underneath — see §3/§5. This is the single most visible "the CMS looks unfinished" signal a staff member would hit, independent of any database issue.
- **Pagination is inconsistently present**: confirmed in Courses, Trainers, Schedules, Participants, Companies, Attendance, Assessment, Certificates, Users, Audit. Absent from Dashboard/Reports/Search/Automation/Backups/System (reasonably, none of these are paginated list views) and from News/Gallery/FAQ/Downloads/Media (because their list pages don't exist yet — see above).
- Empty states (`EmptyState` component) are used consistently across every module that has a working list view — a genuine strength of this codebase's UI layer, not a finding to fix.

---

# 10. Recommended Fix Order

This section states the order only — no fixes are implemented per your instruction to wait for approval.

1. **Fix public certificate verification (`/verify`)** — zero dependencies, few hours, highest-visibility public-facing bug. Should not wait for anything else below.
2. **Decide the schema direction** (adopt the live legacy schema vs. migrate it forward to the designed schema) — this is the one decision that determines the shape of nearly every fix below it. Full option analysis: `DATABASE_AUDIT.md` §10.
3. **In parallel with #2 (no schema dependency)**: finish the 5 `ScaffoldPage` list pages; replace in-memory rate limiting with a shared store; decide the fate of `/api/admin/login`.
4. **Once #2 is decided, execute together as one coordinated effort** (same tables, overlapping RLS work): Participants CRUD fix, Certificates admin-UI fix, Storage provisioning, `admin_users`/`profiles.role` authorization unification.
5. **Then**: rebuild Schedules, Trainers, Companies, Attendance, Assessment, Automation, Reports, Audit, Users against the now-settled schema — these can be parallelized across developers once #4 lands.
6. **Then**: the cross-module integration placeholders (certificate auto-issue, history views, QR check-in, email delivery, real PDF export) and the bulk PDF/OCR import decision (finish or remove).
7. **Throughout, opportunistically**: the Performance and Security findings in §6/§7 that don't depend on the schema decision (index additions, filter-sanitization, CSP tightening, the `Promise.all` bug, the unbounded import fetch) — small, low-risk, can be picked up alongside whichever module they live in.

Full task-level breakdown with hour estimates, dependencies, and sprint suggestions: `DEVELOPMENT_BACKLOG.md`. Version-boundary framing of this same order: `PRODUCT_ROADMAP.md` (V1.0 = steps 1–4 above).

---

**SYSTEM AUDIT COMPLETE. READY FOR FIX PHASE.**
