# Master TODO — TERAS UNIVERSAL Admin CMS

Every unfinished feature in this repository, found by (1) cross-referencing `DATABASE_AUDIT.md`/`BUG_REPORT.md`/`SECURITY_REPORT.md`/`PERFORMANCE_REPORT.md`, and (2) a fresh pass over the actual UI for explicit "coming soon"/scaffold markers the app already declares about itself. Every item below is either a confirmed defect (cited to its source report) or a literal in-app placeholder found in this pass — nothing here is speculative. Documentation only; no files were modified.

**Estimate basis**: Complexity is relative to this codebase's existing patterns (an admin module = ~1 "Courses-sized" unit of work). Time assumes one developer already familiar with this repo, not ramp-up time. Dependencies name the other TODO items (by ID) or reports that must be resolved first.

---

## Critical

### C1 — Decide and execute the schema consolidation
**What's unfinished:** Two independently-designed database schemas exist; only one is live. Almost every operations module (Schedules, Trainers, Companies, Attendance, Assessment, Certificates, Automation, Reports, Audit, Users) was built against the schema that was never applied.
**Complexity:** Very High (architectural decision + either a large rewrite or a large forward-migration with data-safety guarantees).
**Time:** 2–4 weeks depending on which direction is chosen (`DATABASE_AUDIT.md` §10, Option A: rewrite code to match live schema, vs. Option B: migrate live DB forward — Option B is likely faster given how much UI already exists for the designed schema, but requires careful, tested data migration).
**Dependencies:** None — this blocks nearly everything else on this list. **Do this first.**
**Source:** `DATABASE_AUDIT.md` §1–§10, `BUG_REPORT.md` BUG-01.

### C2 — Fix public certificate verification
**What's unfinished:** `/verify` and `/verify/[token]` call a Supabase RPC (`verify_and_log`) that doesn't exist in production. Every verification attempt — the one customer-facing feature on this domain — returns "not found," including for genuine certificates.
**Complexity:** Low once C1's direction is chosen (the live, working RPC — `verify_certificate_by_value` — already exists; this is a matter of pointing the two pages at it with the right signature/return shape).
**Time:** 2–4 hours.
**Dependencies:** Ideally sequenced after C1 (so it's fixed once, against the final schema, not twice), but **can be hotfixed immediately** independent of C1 since the live RPC already exists today — this is the single highest-value, lowest-effort fix available and should not wait for the full consolidation.
**Source:** `BUG_REPORT.md` BUG-04/11.

### C3 — Wire up the 5 CMS modules whose list pages are still literal placeholders
**What's unfinished:** `app/admin/(protected)/{news,gallery,faq,downloads,company}/page.tsx` all render `<ScaffoldPage>` — a static "module scaffolded, data layer ready, see Courses for the pattern" card — instead of an actual list/table. This is despite each module's `actions.ts` (create/update/archive) and `new`/`[id]` form pages being **fully implemented and schema-correct** (confirmed live-functional per `DATABASE_AUDIT.md`). A staff member clicking "News" in the sidebar today sees a "not built yet" message even though they could create/edit a post if they somehow already knew the direct URL.
**Complexity:** Low — the pattern to copy (`app/admin/(protected)/courses/page.tsx`: table, search, filter, pagination) already exists and works against these same live tables.
**Time:** ~half a day per module (5 modules × ~3–4 hours) = 2–3 days total.
**Dependencies:** None — these 5 modules are schema-correct today, this can be done in parallel with C1 and is not blocked by it.
**Source:** newly identified this pass (`components/admin/ScaffoldPage.tsx` usage grep) — not previously flagged in any prior report.

### C4 — Fix Participants CRUD
**What's unfinished:** Every create/update through the Participants admin form writes columns (`ic_passport_no`, `nationality`, `gender`, `date_of_birth`, `emergency_contact_name`/`_phone`, `registration_date`, `company_id`) that don't exist on the live table, and writes `status` values that violate the live 2-value CHECK constraint. No participant can be created or edited today.
**Complexity:** Medium (align form fields + action payload to live columns, or add the missing columns via a forward migration — same decision as C1).
**Time:** 1–2 days once C1's direction is settled.
**Dependencies:** C1.
**Source:** `BUG_REPORT.md` BUG-02.

### C5 — Fix Certificates CRUD (admin UI + legacy API route)
**What's unfinished:** Both write columns (`certificate_number`, `holder_name`, `issue_date`, `verification_token`, `template_id`, `schedule_id`, etc.) that don't exist on the live table.
**Complexity:** Medium-High — this module has the deepest designed feature set (templates, eligibility view, verification logging) of anything in the unapplied schema, so "align to live" vs. "migrate live forward" has the biggest complexity delta here.
**Time:** 3–5 days once C1's direction is settled.
**Dependencies:** C1.
**Source:** `BUG_REPORT.md` BUG-03.

### C6 — Provision Supabase Storage
**What's unfinished:** No buckets exist in the live project at all. Every image/file upload path (`ImageUpload.tsx` and anything using Storage) fails outright.
**Complexity:** Low-Medium (bucket creation is simple; getting the RLS policies right depends on C1's authorization-model decision).
**Time:** 1 day, once C1's RLS direction is settled (policies should check whichever model wins, not the unapplied migration's `profiles.role` assumption as-is if that's not the winning model).
**Dependencies:** C1 (for policy correctness), otherwise independent.
**Source:** `SECURITY_REPORT.md` §8, `BUG_REPORT.md` BUG-26.

---

## High

### H1 — Rebuild Schedules, Trainers, Companies, Attendance, Assessment, Certificates, Automation, Reports, Audit, Users against the resolved schema
**What's unfinished:** The bulk of the designed operations feature set. Fully built UI, forms, and Server Actions exist for all of these; none function against the live database.
**Complexity:** High in aggregate (10 modules), Medium per module — this is mechanical alignment work once C1 is resolved, not new design.
**Time:** 1–2 weeks total, parallelizable across modules once the schema direction is fixed.
**Dependencies:** C1. Certificates specifically also depends on C5.
**Source:** `BUG_REPORT.md` BUG-01, `DATABASE_AUDIT.md` §9.

### H2 — Fix the 3 broken Search categories
**What's unfinished:** Global search silently returns zero results for schedules, trainers, and certificate-number lookups (queries non-existent tables/columns), with no error surfaced.
**Complexity:** Low.
**Time:** 2–3 hours, but only sensible to do *after* C1/H1 since it should point at whichever tables end up canonical.
**Dependencies:** C1.
**Source:** `BUG_REPORT.md` BUG-07.

### H3 — Unify authorization: `admin_users` vs. `profiles.role`
**What's unfinished:** `certificates`/`participants`/`courses` RLS is gated by a completely separate binary membership table, disconnected from the `profiles.role`/`is_active` system the rest of the app uses. Deactivating a user doesn't revoke their access to these three tables.
**Complexity:** Medium (either a sync trigger or a full RLS policy rewrite for 3 tables + dropping the parallel model).
**Time:** 2–3 days.
**Dependencies:** Best sequenced with C1 (same tables, same migration work), but independently valuable even before C1 lands.
**Source:** `SECURITY_REPORT.md` §2, `BUG_REPORT.md` BUG-24.

### H4 — Replace in-memory rate limiting with a shared store
**What's unfinished:** `login`, `reset-password`, `request-proposal`, `newsletter` all use a per-instance in-memory `Map`, which doesn't work across serverless function instances.
**Complexity:** Low-Medium (needs a shared store — Redis/Upstash/a Supabase table — plus updating 4 call sites).
**Time:** 1 day.
**Dependencies:** None — fully independent, can be done any time.
**Source:** `SECURITY_REPORT.md` §12, `PERFORMANCE_REPORT.md`/`BUG_REPORT.md` cross-refs.

### H5 — Wire `certificateSchema` into certificate Server Actions
**What's unfinished:** The Zod schema exists, is well-formed, and is imported nowhere.
**Complexity:** Low.
**Time:** 2–3 hours.
**Dependencies:** Best done alongside C5 (same file, same effort window).
**Source:** `BUG_REPORT.md` BUG-14/16.

### H6 — Decide the fate of `/api/admin/login`
**What's unfinished:** A second, UI-unreferenced login route that checks a different authorization table and returns raw session tokens in JSON.
**Complexity:** Low (delete) or Medium (bring to parity with the real login path).
**Time:** 1 hour (delete) or 1 day (fix).
**Dependencies:** None.
**Source:** `SECURITY_REPORT.md` §1/§4, `BUG_REPORT.md` BUG-21/22.

### H7 — Bulk PDF/OCR certificate import: finish wiring or remove
**What's unfinished:** `lib/bulkCertificates.js` fully implements PDF text extraction (`pdfjs-dist`) and OCR fallback (`tesseract.js`) for scanned certificates, and `docs/bulk-pdf-import.md` documents a `/admin/certificates/import` page using it — but that route doesn't exist and the library is imported nowhere. This looks like a feature that was substantially built and then never connected to a route, rather than never started.
**Complexity:** Medium to finish (the hard parsing/OCR logic is already written — this is "build the `/admin/certificates/import` page + review table UI around the existing library"), Low to remove (delete the module + its two large dependencies + the stale doc).
**Time:** 2–3 days to finish; 1 hour to remove.
**Dependencies:** C5 (should target the final certificate schema, not the currently-broken one) if finishing; none if removing.
**Source:** newly identified this pass (`docs/bulk-pdf-import.md` cross-referenced against `lib/bulkCertificates.js` import graph); dead-code angle also in `BUG_REPORT.md` BUG-30 / `PERFORMANCE_REPORT.md` §7.

---

## Medium

### M1 — Certificate auto-issue from Assessment results
**What's unfinished:** The Assessment schedule detail page has an explicit `EmptyState` card: *"Certificate Generator — Auto-issue for competent participants — coming soon."*
**Complexity:** Medium (needs C5 resolved first — this reads from the certificate-eligibility logic).
**Time:** 2–3 days.
**Dependencies:** C5, H1 (assessment module).
**Source:** in-app placeholder, `app/admin/(protected)/assessment/[scheduleId]/page.tsx:103`.

### M2 — Cross-module Participant History view
**What's unfinished:** Same page, second placeholder card: *"Per-participant results — coming soon."*
**Complexity:** Medium (aggregation view across attendance/assessment/certificates for one participant).
**Time:** 2 days.
**Dependencies:** H1 (attendance, assessment, certificates modules functional).
**Source:** in-app placeholder, same file, line 104.

### M3 — Training History / course-outcomes view
**What's unfinished:** Same page, third placeholder: *"Course outcomes — coming soon."*
**Complexity:** Medium.
**Time:** 1–2 days.
**Dependencies:** H1.
**Source:** in-app placeholder, same file, line 105.

### M4 — Competency analytics / Reporting Dashboard on Assessment detail
**What's unfinished:** Same page, fourth placeholder: *"Competency analytics — coming soon."*
**Complexity:** Medium-High (real aggregate reporting, likely wants the designed `v_*` views from the unapplied schema — see H1/Reports).
**Time:** 3–4 days.
**Dependencies:** H1 (Reports module + reporting views resolved).
**Source:** in-app placeholder, same file, line 106.

### M5 — Attendance ↔ Assessment integration link
**What's unfinished:** Attendance schedule detail page: *"Assessment integration — coming soon."*
**Complexity:** Low-Medium (both modules exist once H1 lands; this is cross-linking + a shared eligibility read, similar to M1's dependency shape).
**Time:** 1 day.
**Dependencies:** H1.
**Source:** in-app placeholder, `app/admin/(protected)/attendance/[scheduleId]/page.tsx:107`.

### M6 — Attendance ↔ Certificate integration link
**What's unfinished:** Same page: *"Certificate integration — coming soon."*
**Complexity:** Low-Medium.
**Time:** 1 day.
**Dependencies:** C5, H1.
**Source:** in-app placeholder, same file, line 108.

### M7 — QR check-in for Attendance
**What's unfinished:** Same page: *"QR check-in — coming soon."* (The designed schema's `attendance_method` enum already has a `qr` value reserved as a placeholder for this — see `0014_attendance_management.sql`.)
**Complexity:** Medium-High (new capture UI, likely a dedicated mobile-friendly scan page, plus a public-safe check-in endpoint).
**Time:** 3–5 days.
**Dependencies:** H1 (attendance module functional first).
**Source:** in-app placeholder, same file, line 109.

### M8 — Link Attendance module from Schedule detail page
**What's unfinished:** `schedules/[id]/page.tsx` still shows an *"Attendance module — coming soon"* placeholder card, even though a working Attendance module exists elsewhere in the app — this specific page just never got the cross-link added.
**Complexity:** Low (likely just a missing `<Link>` + a summary count, not new functionality).
**Time:** 2–3 hours.
**Dependencies:** H1 (so the linked module actually has live data to show).
**Source:** in-app placeholder, `app/admin/(protected)/schedules/[id]/page.tsx:87`.

### M9 — Email delivery (Automation Centre + Certificate detail)
**What's unfinished:** "✉ Email Queue (soon)" (disabled, Automation Centre) and "✉ Email (soon)" (disabled, Certificate detail) — no email-sending integration for certificates/notifications beyond the existing Resend usage for public-form confirmations.
**Complexity:** Medium (Resend is already integrated for two other flows — this is extending that integration, not introducing a new vendor).
**Time:** 3–4 days (template design, queue/retry handling, opt-out considerations).
**Dependencies:** C5 (certificates), H1 (automation module).
**Source:** in-app placeholders, `app/admin/(protected)/automation/page.tsx:94`, `app/admin/(protected)/certificates/[id]/page.tsx:79`.

### M10 — Manual backup / export
**What's unfinished:** Backups page explicitly disables its one action with the message: *"Manual export is intentionally not enabled from the browser. It requires a protected server job and retention policy before it can safely handle production data."* — this is a deliberately-gated, not-yet-built feature, not a bug.
**Complexity:** High (server-side job infrastructure, retention policy, secure storage of exports, access control on the exports themselves).
**Time:** 1 week+.
**Dependencies:** C1 (backup strategy should target the final schema).
**Source:** in-app placeholder, `app/admin/(protected)/backups/page.tsx:35` — this one is self-documenting about why it's gated; treat that reasoning as still valid, don't rush this one.

### M11 — Real PDF generation for exports (currently print-to-PDF placeholders)
**What's unfinished:** Certificate Register, Company Profile Report, and Assessment report exports are explicitly commented as *"the PDF placeholder — print to PDF"* — they render a printable HTML page and rely on the browser's print dialog rather than generating a real PDF server-side.
**Complexity:** Medium (introduce a server-side PDF renderer — e.g. `@react-pdf/renderer` or a headless-browser print step — for these three export routes).
**Time:** 2–3 days.
**Dependencies:** None functionally, but low priority until the underlying modules (H1) are live and there's real data to export.
**Source:** in-app comments, `app/admin/(protected)/certificates/export/route.ts:9`, `companies/export/route.ts:9`, `assessment/[scheduleId]/export/route.ts:9`.

---

## Low

### L1 — Add `remotePatterns` for `next/image` to support Storage-hosted images
**Complexity:** Low. **Time:** 1 hour. **Dependencies:** C6 (Storage provisioned). **Source:** `PERFORMANCE_REPORT.md` §9.

### L2 — Add covering indexes for the ~15 functionally-relevant unindexed foreign keys
**Complexity:** Low. **Time:** half a day (write + review + apply one migration). **Dependencies:** Best done alongside C1/H1's migration work, not urgent before then given current row counts. **Source:** `PERFORMANCE_REPORT.md` §3.

### L3 — Regenerate `lib/supabase/database.types.ts` for real
**Complexity:** Low (one CLI command) but high-value. **Time:** 1 hour + a pass removing now-unnecessary `as any` casts (1–2 days for the cast cleanup). **Dependencies:** C1 (regenerate against the final schema, not twice). **Source:** `BUG_REPORT.md` BUG-35/36.

### L4 — Tighten CSP (`script-src` drop `unsafe-inline`/`unsafe-eval`)
**Complexity:** Medium (likely needs a nonce-based approach to keep Google Tag Manager working). **Time:** 1 day + testing. **Dependencies:** None. **Source:** `SECURITY_REPORT.md` §13.

### L5 — Delete or finish the two orphaned components
**What's unfinished:** `components/PrintButton.js`, `components/ProposalForm.js` — unreferenced anywhere.
**Complexity:** Low. **Time:** 1 hour (delete) — investigate first whether either represents an abandoned start on M9/M11-adjacent work before deleting. **Dependencies:** None. **Source:** `BUG_REPORT.md` BUG-31.

### L6 — Remove the committed duplicate app snapshot
**What's unfinished:** `work/teras-admin-cms/teras-admin-cms/` (59 tracked files) duplicates an old version of the admin app.
**Complexity:** Low. **Time:** 1 hour. **Dependencies:** None. **Source:** `BUG_REPORT.md` BUG-33.

### L7 — Extract the search-sanitization helper
**What's unfinished:** The same `.replace(/[%_,()]/g, " ")` expression is copy-pasted 3 times and missing from 13 more call sites that need it.
**Complexity:** Low. **Time:** half a day (extract + apply to all 16 sites). **Dependencies:** None. **Source:** `BUG_REPORT.md` BUG-29/32.

---

## Recommended implementation order

1. **C2 (fix `/verify`)** — do this today, independent of everything else. Highest-visibility public bug, lowest effort, zero dependencies.
2. **C1 (schema consolidation decision)** — the moment this is decided, a large fraction of the rest of this list becomes mechanical execution rather than open design work. Nothing else large-scale should start before this is decided, even if individual pieces (C3, C6, H4, H6, L4–L7) can proceed in parallel.
3. **In parallel with step 2 (no schema dependency):** C3 (5 CMS list pages — cheapest, highest-visible-value item on this whole list), H4 (rate limiting), H6 (login route decision), L4–L7 (cleanup).
4. **Once C1 lands:** C4, C5, C6, H1, H2, H3, H5 — execute together as one coordinated migration/rewrite effort, since they touch overlapping tables and RLS policies. Certificates (C5) and its dependents (H5, M1, M6, M9, M11) form a natural sub-sequence within this.
5. **Once H1 lands:** M1–M8 (the assessment/attendance/schedule cross-module integration placeholders) — these were explicitly designed as follow-ons to the base modules and now have real data to integrate against.
6. **Anytime, lowest priority:** M9 (email), M10 (backups — deliberately gated, don't rush), M11 (real PDF export), L1–L3 (image/index/types cleanup).

**Do not attempt M1–M11 before C1/H1 land** — every one of them either reads from or extends a module that currently doesn't function against the live database; building on top of that would mean rebuilding twice.
