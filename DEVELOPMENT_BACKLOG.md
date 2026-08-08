# Development Backlog — TERAS UNIVERSAL Admin CMS

Every remaining task from `MASTER_TODO.md`/`PRODUCT_ROADMAP.md`, broken into Epic → Feature → Story → Task → Subtask. Documentation only — no files were modified to produce this.

**Granularity note**: Epics 1–9 (the V1.0/V1.1 critical path in `PRODUCT_ROADMAP.md`) are broken down to full Task/Subtask detail since they're immediately actionable. Epics 10–14 (V1.5–V3.0) are broken down to Story level only — re-decompose each Story into Tasks/Subtasks during its own sprint planning, once the epics ahead of it have actually shipped and any schema/design assumptions are re-verified against the then-current live state, per `CLAUDE.md` §11/§20's rule on not trusting stale schema assumptions.

**Sprint numbering** assumes 1-week sprints starting from project resumption; "Sprint 1" is whichever sprint the team actually starts this backlog in. Hours are for one developer already familiar with this codebase.

---

## EPIC-01: Schema Consolidation
*Priority: P0 · Depends on: nothing · Blocks: almost everything else in this backlog*

### FEATURE-01.1: Decide canonical schema direction

**STORY-01.1.1** — As the engineering team, we need to decide whether to adopt the live legacy schema or migrate it forward to the designed schema, so all subsequent work targets one target.
- **Acceptance criteria**: written decision doc citing `DATABASE_AUDIT.md` §10's two options; stakeholder sign-off recorded; decision communicated to anyone else touching this repo.
- TASK: Re-verify live schema state via Supabase MCP tools (don't trust a stale `DATABASE_AUDIT.md` read if time has passed) — **2h**
  - SUBTASK: `list_tables`, `list_migrations` against the connected project — **0.5h**
  - SUBTASK: Diff against `DATABASE_AUDIT.md`'s last-recorded state, note any drift — **1h**
  - SUBTASK: Update `DATABASE_AUDIT.md` if drift found — **0.5h**
- TASK: Evaluate Option A (adopt live) vs. Option B (migrate forward) against current business priorities — **4h**
  - SUBTASK: Estimate rewrite cost for each already-built module under Option A — **2h**
  - SUBTASK: Estimate migration/backfill cost for each missing table under Option B — **2h**
- TASK: Get sign-off and document the decision — **2h**
- **Estimated hours**: 8h · **Priority**: P0 · **Dependencies**: none · **Suggested sprint**: Sprint 1

### FEATURE-01.2: Execute the chosen schema path

**STORY-01.2.1** — As a developer, I need a Supabase branch to test the consolidation migration(s) safely, so production data (125 live `courses` rows) is never at risk.
- **Acceptance criteria**: branch created via `mcp__claude_ai_Supabase__create_branch`; consolidation migration(s) applied and verified on the branch before touching production.
- TASK: Create Supabase branch — **1h**
- TASK: Write guarded, idempotent migration(s) for the chosen direction — **3–5 days**
  - SUBTASK: `create table if not exists`/`add column if not exists` for every new/changed object — included above
  - SUBTASK: RLS policies checking `profiles.role`/`is_active` via `app.*` helpers (not a second auth mechanism — see EPIC-06) — included above
  - SUBTASK: Audit triggers on every staff-mutable new/changed table — included above
- TASK: Apply to branch, run full manual QA pass against every affected module — **1 day**
- TASK: Apply to production, monitor — **0.5 day**
- **Estimated hours**: ~48h (6 days) · **Priority**: P0 · **Dependencies**: FEATURE-01.1 · **Suggested sprint**: Sprint 1–2

**STORY-01.2.2** — As a developer, I need `lib/supabase/database.types.ts` regenerated against the final schema, so TypeScript actually catches table/column mismatches going forward.
- **Acceptance criteria**: `npx supabase gen types` run against the consolidated project; `as any` casts removed from `lib/supabase/server.ts` and query call sites; `npm run typecheck` passes with real types, not fallback `any`.
- TASK: Regenerate types file — **1h**
- TASK: Remove `as any` cast in `lib/supabase/server.ts` — **0.5h**
- TASK: Sweep and remove now-unnecessary `as any` casts at query call sites — **1–2 days**
- **Estimated hours**: ~14h · **Priority**: P1 · **Dependencies**: STORY-01.2.1 · **Suggested sprint**: Sprint 2

---

## EPIC-02: Public Certificate Verification Fix
*Priority: P0 · Depends on: nothing (can ship before EPIC-01) · Blocks: nothing*

### FEATURE-02.1: Point `/verify` at a working RPC

**STORY-02.1.1** — As a member of the public, I need to verify a genuine TERAS certificate and get a correct result, so the certification actually means something.
- **Acceptance criteria**: `/verify` and `/verify/[token]` return correct results for a known-valid, known-revoked, and known-nonexistent certificate; `error` from the RPC call is checked and logged, never silently discarded.
- TASK: Repoint `app/verify/page.tsx:33` and `app/verify/[token]/page.tsx:26` at `verify_certificate_by_value` (the live RPC) with its actual signature — **2h**
  - SUBTASK: Adjust the query-param/token handling to match the live RPC's single `search_value` argument — **1h**
  - SUBTASK: Map the live RPC's return columns to `VerificationResult`'s expected shape — **1h**
- TASK: Add explicit error handling instead of discarding `{ error }` — **1h**
- TASK: Manually verify against 3 test cases (valid/revoked/nonexistent) — **1h**
- **Estimated hours**: 4h · **Priority**: P0 · **Dependencies**: none · **Suggested sprint**: Sprint 1 (day 1, ship independently)

---

## EPIC-03: Participants Module Fix
*Priority: P0 · Depends on: EPIC-01*

### FEATURE-03.1: Align Participants CRUD to live schema

**STORY-03.1.1** — As an admin, I need to create and edit participant records without the form being silently rejected.
- **Acceptance criteria**: create/update through `app/admin/(protected)/participants/actions.ts` succeeds against the live table; `status` values sent match the live constraint; every form field maps to a real column.
- TASK: Audit every field `participants/actions.ts` writes against the final live column set — **2h**
- TASK: Update `ParticipantForm.tsx` field set to match — **3h**
- TASK: Update `participantSchema`/`participantImportRowSchema` in `lib/validation/schemas.ts` — **2h**
- TASK: Update `status` value set and any UI copy referencing removed statuses — **2h**
- TASK: Manual QA: create, edit, soft-delete, CSV import — **3h**
- **Estimated hours**: 12h · **Priority**: P0 · **Dependencies**: EPIC-01 · **Suggested sprint**: Sprint 2

---

## EPIC-04: Certificates Module Fix
*Priority: P0 · Depends on: EPIC-01*

### FEATURE-04.1: Align Certificates admin UI to live schema

**STORY-04.1.1** — As an admin, I need to generate, view, and manage certificates through the primary admin UI (not just the legacy API route).
- **Acceptance criteria**: `certificates/actions.ts` writes only columns that exist live; certificate list/detail pages render real data; bulk generation works for a real schedule.
- TASK: Audit every field written/read against the final live column set — **3h**
- TASK: Update `certificates/actions.ts` (`generateCertificate`, `bulkGenerate`, `duplicateCertificate`, `revokeCertificate`, etc.) — **1 day**
- TASK: Update certificate list/detail/generate pages' field references — **1 day**
- TASK: Manual QA against a real schedule with eligible participants — **3h**
- **Estimated hours**: ~20h · **Priority**: P0 · **Dependencies**: EPIC-01 · **Suggested sprint**: Sprint 2–3

### FEATURE-04.2: Certificate validation and integrity

**STORY-04.2.1** — As an admin, I need certificate creation to reject malformed input, so bad data can't reach the database.
- **Acceptance criteria**: `certificateSchema.safeParse()` runs before every insert/update in `certificates/actions.ts` and `/api/admin/certificates/route.js`.
- TASK: Import and wire `certificateSchema` into both files — **3h**
- TASK: Manual QA: submit malformed input, confirm rejection with a clear message — **1h**
- **Estimated hours**: 4h · **Priority**: P1 · **Dependencies**: FEATURE-04.1 · **Suggested sprint**: Sprint 3

**STORY-04.2.2** — As the business, I need it to be impossible to generate two certificates for the same participant/schedule.
- **Acceptance criteria**: a unique constraint on `certificates(schedule_id, participant_id)` exists; a duplicate-click no longer produces two live certificates.
- TASK: Write migration adding the unique constraint — **1h**
- TASK: Update `generateCertificate` to rely on insert failure/upsert rather than a check-then-insert race — **2h**
- **Estimated hours**: 3h · **Priority**: P1 · **Dependencies**: FEATURE-04.1 · **Suggested sprint**: Sprint 3

**STORY-04.2.3** — As a recipient, I need a duplicated certificate's QR code to actually resolve.
- **Acceptance criteria**: `duplicateCertificate` sets `verification_url` the same way `generateCertificate` does.
- TASK: Add the missing `verification_url` update to `duplicateCertificate` — **1h**
- **Estimated hours**: 1h · **Priority**: P2 · **Dependencies**: FEATURE-04.1 · **Suggested sprint**: Sprint 3

---

## EPIC-05: Storage Provisioning
*Priority: P0 · Depends on: EPIC-01 (for policy correctness), otherwise independent*

### FEATURE-05.1: Provision Supabase Storage buckets

**STORY-05.1.1** — As an admin, I need to upload images/files through the CMS without the upload silently failing.
- **Acceptance criteria**: `media`, `downloads`, `private` buckets exist live with `file_size_limit`/`allowed_mime_types` set; storage RLS policies match the final EPIC-06 authorization model; `ImageUpload.tsx` succeeds end-to-end.
- TASK: Create the 3 buckets with size/MIME limits — **2h**
- TASK: Write storage RLS policies (re-derived from EPIC-01/06's model, not copy-pasted from the unapplied migration as-is) — **4h**
- TASK: Manual QA: upload as editor, confirm reject as unauthenticated — **1h**
- **Estimated hours**: 7h · **Priority**: P0 · **Dependencies**: EPIC-01, EPIC-06 · **Suggested sprint**: Sprint 2

### FEATURE-05.2: Server-side upload validation

**STORY-05.2.1** — As the business, I need file-type/size limits enforced server-side, not just in the browser.
- **Acceptance criteria**: a direct API call with an oversized/wrong-type file is rejected by Storage itself, independent of `ImageUpload.tsx`'s client-side checks.
- TASK: Confirm bucket-level limits reject correctly (covered by FEATURE-05.1's bucket config) — **1h**
- TASK: Add a `metadata->>'mimetype'` check to the storage RLS policy — **2h**
- **Estimated hours**: 3h · **Priority**: P1 · **Dependencies**: FEATURE-05.1 · **Suggested sprint**: Sprint 2

---

## EPIC-06: Authorization Unification
*Priority: P0 · Depends on: best sequenced with EPIC-01 (same tables)*

### FEATURE-06.1: Single authorization model for `courses`/`participants`/`certificates`

**STORY-06.1.1** — As a super_admin, I need deactivating a staff member to actually revoke their database access, not just their access to the app's own guarded pages.
- **Acceptance criteria**: a `profiles.is_active = false` user can no longer read/write `courses`/`participants`/`certificates` via any client, even if still present in `admin_users`.
- TASK: Decide: sync `admin_users` to `profiles` automatically, or drop `admin_users`-based RLS entirely in favor of `profiles.role` — **2h decision**
- TASK: Write and apply the chosen migration — **4h**
- TASK: Manual QA: deactivate a test staff account, confirm both app-level and direct-query access are blocked — **2h**
- **Estimated hours**: 8h · **Priority**: P0 · **Dependencies**: EPIC-01 · **Suggested sprint**: Sprint 1–2

### FEATURE-06.2: Retire the orphaned login route

**STORY-06.2.1** — As the security owner, I need there to be exactly one login path, so there's one place to audit and one place to rate-limit.
- **Acceptance criteria**: `/api/admin/login` is either deleted or rewritten to match the primary path's cookie-session/rate-limiting/authorization-source standard; decision documented.
- TASK: Confirm zero external dependents (search logs/analytics for hits, if available) — **1h**
- TASK: Delete the route, or rewrite it to parity — **1h (delete) / 6h (rewrite)**
- **Estimated hours**: 2–7h · **Priority**: P1 · **Dependencies**: none · **Suggested sprint**: Sprint 1

---

## EPIC-07: CMS List Pages Completion
*Priority: P1 · Depends on: none — can start Sprint 1*

### FEATURE-07.1: Replace `<ScaffoldPage>` with real list UIs

**STORY-07.1.1** through **STORY-07.1.5** — As an admin, I need to see and manage {News / Gallery / FAQ / Downloads / Company Profile} from its list page, matching how Courses already works, so I don't need to know a direct URL to reach a feature that already exists.
- **Acceptance criteria** (each): list page shows a real table/grid with search + filter + pagination; existing create/edit/archive actions remain unchanged and now reachable from the list UI.
- TASK (per module): build `page.tsx` copying the Courses pattern — **3h**
- TASK (per module): wire search/filter/pagination to the existing table's real columns — **2h**
- TASK (per module): manual QA — **1h**
- **Estimated hours**: 6h × 5 modules = 30h · **Priority**: P1 · **Dependencies**: none · **Suggested sprint**: Sprint 1–2 (parallelizable across modules/developers)

---

## EPIC-08: Search Module Fix
*Priority: P1 · Depends on: EPIC-01*

### FEATURE-08.1: Fix the 3 broken search categories

**STORY-08.1.1** — As staff, I need Global Search to actually search schedules, trainers, and certificates, not silently return nothing.
- **Acceptance criteria**: all 8 search categories return correct results for a known matching term; no category fails silently.
- TASK: Repoint the 3 broken lookups (`training_schedules`, `trainers`, `certificates.certificate_number`) at the final live table/column names — **2h**
- TASK: Add a "category unavailable" fallback state for any future schema drift, so this doesn't silently regress again — **2h**
- TASK: Manual QA across all 8 categories — **1h**
- **Estimated hours**: 5h · **Priority**: P1 · **Dependencies**: EPIC-01 · **Suggested sprint**: Sprint 2

---

## EPIC-09: Rate Limiting Infrastructure
*Priority: P1 · Depends on: none*

### FEATURE-09.1: Shared-store rate limiting

**STORY-09.1.1** — As the security owner, I need rate limiting to actually work across serverless instances.
- **Acceptance criteria**: `login`, `reset-password`, `request-proposal`, `newsletter` all throttle correctly under repeated requests from the same IP, verified across multiple deployment instances (not just locally).
- TASK: Choose and provision a shared store (Redis/Upstash, or a Supabase table) — **3h**
- TASK: Replace the 4 in-memory `Map`-based throttles with the shared store — **1 day**
- TASK: Add the same throttle to the admin login path (currently has none) — **2h**
- TASK: Load-test / verify across instances — **2h**
- **Estimated hours**: ~15h · **Priority**: P1 · **Dependencies**: none · **Suggested sprint**: Sprint 1–2

---

## EPIC-10: Operations Core Rebuild
*Priority: P0/P1 (mixed, see below) · Depends on: EPIC-01, EPIC-06 · Decomposed to Story level — break down further per-module at its own sprint's planning session*

- **STORY-10.1**: Rebuild Training Schedules module (full CRUD, capacity tracking, calendar view, trainer double-booking check) against the final schema. *P0, ~3–4 days.*
- **STORY-10.2**: Rebuild Attendance module (marking, CSV import/export) against the final schema; fix the timezone check-in bug in the same pass. *P0, ~3–4 days.*
- **STORY-10.3**: Rebuild Assessment module (results entry, competency/pass-fail, lock/unlock) against the final schema. *P0, ~3–4 days.*
- **STORY-10.4**: Rebuild Trainers module (full CRUD, workload visibility). *P1, ~2–3 days.*
- **STORY-10.5**: Rebuild Companies module (full CRUD, participant/certificate aggregation). *P1, ~2–3 days.*
- **STORY-10.6**: Rebuild Reports & Analytics — create the 9 `v_*` reporting views live, reconnect the already-correct front-end logic. *P1, ~3–5 days.*
- **STORY-10.7**: Rebuild Audit Log (live, paginated, searchable). *P2, ~1–2 days.*
- **STORY-10.8**: Rebuild Automation Centre (settings, templates, run history). *P2, ~3–4 days.*
- **STORY-10.9**: Build the currently-missing Users & Roles write UI (role assignment, activation/deactivation — today read-only). *P1, ~2–3 days.*
- **STORY-10.10**: Finish or remove the bulk PDF/OCR certificate import feature (`lib/bulkCertificates.js` is fully built, never wired to a route). *P2, ~2–3 days (finish) / 1h (remove).*
- **STORY-10.11–10.13**: Cross-module integration — certificate auto-issue from competent assessments; participant/training history views; attendance↔assessment↔certificate linking. *P2 each, ~2–3 days each.*

**Suggested sprint**: Sprint 3–6 (largest epic in the backlog; sequence Schedules → Attendance/Assessment in parallel → Reports/Audit/Users → Automation → cross-module integration → bulk-import decision, per `MASTER_TODO.md`'s recommended order).

---

## EPIC-11: Security & Performance Hardening
*Priority: P1/P2/P3 (mixed) · Depends on: mostly none, decomposed to Story level*

- **STORY-11.1**: Fix accidentally-serialized `Promise.all` on the trainer profile page (nested `await` inside the array literal). *P1, ~3h.*
- **STORY-11.2**: Replace the unbounded `.limit(100000)` participant-IC fetch in CSV import with a targeted batch query. *P1, ~4h.*
- **STORY-11.3**: Add covering indexes for ~15 functionally-relevant unindexed foreign keys. *P2, ~4h.*
- **STORY-11.4**: `next/image` `remotePatterns` for Supabase Storage. *P2, ~1h.*
- **STORY-11.5**: Tighten CSP (`script-src` drop `unsafe-inline`/`unsafe-eval`, likely via nonce-based GTM loading). *P2, ~1 day + testing.*
- **STORY-11.6**: Extract the shared search-sanitization helper and apply it to the 13 currently-unsanitized filter endpoints. *P1, ~4h.*
- **STORY-11.7**: N+1 fix for bulk certificate generation (batch eligibility/existing-cert checks instead of per-participant loop). *P2, ~1 day.*
- **STORY-11.8**: Fix publish-date reset bug (courses/news — only set `published_at` on the draft→published transition). *P2, ~4h.*
- **STORY-11.9**: Add server-side schedule capacity enforcement (currently client-only). *P2, ~4h.*
- **STORY-11.10**: Delete dead code — `lib/bulkCertificates.js`'s unused deps (if EPIC-10/STORY-10.10 decides to remove rather than finish), `PrintButton.js`, `ProposalForm.js`, committed `work/` duplicate app snapshot. *P3, ~1 day.*
- **STORY-11.11**: Introduce ESLint. *P2, ~2–3 days.*
- **STORY-11.12**: Introduce automated test coverage (Jest/Vitest), starting with critical-path (auth, RBAC, certificate generation). *P1, ongoing, ~1–2 weeks for initial critical-path coverage.*

**Suggested sprint**: interleave with Epics 1–10 rather than batching at the end — most of these are small and low-risk, and several (11.1, 11.2, 11.6, 11.8, 11.9) directly touch modules already being rebuilt in Epics 3/4/10.

---

## EPIC-12: CEO Dashboard & Reporting
*Priority: P1 · Depends on: EPIC-10/STORY-10.6 (reporting views live) · Decomposed to Story level, full plan in `CEO_DASHBOARD_PLAN.md`*

- **STORY-12.1**: KPI strip (8 tiles, existing `v_*`-view-backed metrics). *~3 days.*
- **STORY-12.2**: Growth summary widget (normalized MoM/YoY sparklines). *~2 days.*
- **STORY-12.3**: Trend charts tier (revenue-estimate, sessions, certificates, attendance, registrations, pass/fail). *~4 days.*
- **STORY-12.4**: Rankings & breakdowns tier (top companies, top courses, trainer workload, industry mix, delivery mode, company status). *~3 days.*
- **STORY-12.5**: Operational alerts tier (certificates expiring in 90 days, low-attendance sessions). *~2 days.*
- **STORY-12.6**: New bespoke queries not covered by existing views (capacity utilization, repeat-participant rate, industry mix, new-vs-returning companies). *~3 days.*

**Suggested sprint**: Sprint 7–9 (V2.0 window per `PRODUCT_ROADMAP.md`).

---

## EPIC-13: Automation & Communication Layer
*Priority: P2 · Depends on: EPIC-04, EPIC-10 · Decomposed to Story level*

- **STORY-13.1**: Email delivery for certificates/notifications (extend existing Resend integration). *~3–4 days.*
- **STORY-13.2**: Real PDF export pipeline (replace print-to-PDF placeholders for certificate register, company report, assessment report). *~2–3 days.*
- **STORY-13.3**: QR check-in for attendance (capture UI + public-safe check-in endpoint + security review of the QR payload). *~3–5 days.*
- **STORY-13.4**: Manual backup / export infrastructure (protected server job + retention policy — deliberately deferred, design this properly rather than rushing it). *~1 week+.*

**Suggested sprint**: Sprint 8–11 (V2.0 window).

---

## EPIC-14: Version 3.0 Expansion
*Priority: P1–P3 (mixed) · Depends on: EPIC-10, EPIC-12 · Decomposed to Story level only — this is explicitly the furthest-out work; re-scope before committing sprint numbers*

- **STORY-14.1**: Revenue/invoicing module — new domain modeling, closes the "no billing table exists" gap. *~2–3 weeks, P1.*
- **STORY-14.2**: Client/company self-service portal (uses the schema's existing but unused `client` role). *~2–3 weeks, P2.*
- **STORY-14.3**: Participant self-service certificate portal (shares infra with 14.2). *~1–2 weeks, P3.*
- **STORY-14.4**: Staging/branch-based deployment workflow (formalize Supabase branching into the team's regular process). *~3–5 days, P1 — cheap and valuable, don't leave this to last.*
- **STORY-14.5**: Formal internationalization (replace ad hoc Malay strings with a real i18n setup). *~1–2 weeks, P3.*
- **STORY-14.6**: Public API/webhooks for third-party certificate verification. *~1–2 weeks, P3.*
- **STORY-14.7**: Advanced analytics/BI export beyond the in-app CEO dashboard. *~1–2 weeks, P3.*

**Suggested sprint**: Sprint 12+ (V3.0 window) — do not schedule specific sprints for these yet; re-plan once Epics 1–13 have shipped and the business's actual priorities at that point are known.

---

## Summary table

| Epic | Priority | Total est. hours | Depends on | Suggested sprint |
|---|---|---|---|---|
| 01 — Schema Consolidation | P0 | ~56h | — | 1–2 |
| 02 — `/verify` Fix | P0 | 4h | — | 1 |
| 03 — Participants Fix | P0 | 12h | 01 | 2 |
| 04 — Certificates Fix | P0 | ~28h | 01 | 2–3 |
| 05 — Storage Provisioning | P0 | 10h | 01, 06 | 2 |
| 06 — Authorization Unification | P0 | 10–15h | 01 | 1–2 |
| 07 — CMS List Pages | P1 | 30h | — | 1–2 |
| 08 — Search Fix | P1 | 5h | 01 | 2 |
| 09 — Rate Limiting | P1 | ~15h | — | 1–2 |
| 10 — Operations Core Rebuild | P0/P1 | ~25–30 days | 01, 06 | 3–6 |
| 11 — Security/Perf Hardening | P1–P3 | ~7–9 days | mostly none | interleaved |
| 12 — CEO Dashboard | P1 | ~17 days | 10.6 | 7–9 |
| 13 — Automation/Comms | P2 | ~2.5–3 weeks | 04, 10 | 8–11 |
| 14 — V3.0 Expansion | P1–P3 | ~10–14 weeks | 10, 12 | 12+ |
