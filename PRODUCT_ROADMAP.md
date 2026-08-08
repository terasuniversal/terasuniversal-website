# Product Roadmap — TERAS UNIVERSAL Admin CMS

Roadmap from the current state through Version 3.0. Every feature below is grounded in `MASTER_TODO.md`, `MASTER_ARCHITECTURE.md`, `DATABASE_AUDIT.md`, `BUG_REPORT.md`, `SECURITY_REPORT.md`, `PERFORMANCE_REPORT.md`, and `CEO_DASHBOARD_PLAN.md` — nothing here is speculative. Documentation only.

**A note on version numbers before reading further**: `package.json` currently reads `1.2.0`, and a past commit is tagged "release: TERAS Admin CMS v1.2.0 production ready." Functionally, that label doesn't match reality — per `DATABASE_AUDIT.md`/`BUG_REPORT.md`, most operations modules (Schedules, Trainers, Companies, Attendance, Assessment, the certificate engine, Automation, Reports, Audit, Users) don't work against the live database, and the single most public-facing feature (certificate verification) currently fails for every valid certificate. This roadmap treats the *current shipped state* as the starting point and **Version 1.0 as "make the already-claimed feature set actually work,"** not as a from-scratch build. If the team wants to keep the existing `1.2.0` tag as-is for external/marketing reasons, treat everything in this roadmap's "Version 1.0" as a `1.2.1`/`1.3.0`-style stabilization release instead — the content and sequencing don't change, only the label would.

Priority scale: **P0** (blocking, do first) → **P3** (nice-to-have, defer freely). Effort is relative development time for one developer already familiar with this codebase, taken directly from `MASTER_TODO.md`'s per-item estimates and rolled up.

---

## Version 1.0 — Stabilize the foundation

**Theme**: resolve the schema conflict and make the currently-claimed feature set actually functional against production. Nothing else on this roadmap is safe to build until this version ships — every later version's features either read from or extend tables that don't exist until this work lands.

| Feature | Priority | Effort | Dependencies | Business value | Technical risk |
|---|---|---|---|---|---|
| Decide schema direction (adopt-live vs. migrate-forward) | P0 | 2–4 days (decision + planning) | None | Unblocks everything else on this roadmap | Wrong call here means re-doing V1.1–V1.5 work; get explicit stakeholder sign-off, don't decide unilaterally |
| Execute schema consolidation | P0 | 1–3 weeks | Decision above | Same as above | Highest-risk item on the entire roadmap — real data (`courses`, 125 rows) is on the line; must be done on a Supabase branch first, never directly against production |
| Fix public certificate verification (`/verify`) | P0 | 2–4 hours | None — can ship independently, same day | Restores the one feature customers/employers actually touch; every day this ships late is a day genuine certificates read as fraudulent | Very low — the working RPC already exists live, this is a pointer fix |
| Fix Participants CRUD | P0 | 1–2 days | Schema decision | No participant can currently be created or edited — this blocks attendance, assessment, and certificate issuance, which all key off participant records | Low once schema direction is fixed |
| Fix Certificates CRUD (admin UI) | P0 | 3–5 days | Schema decision | Certificate generation is the core deliverable of a certification company's CMS | Medium — this module has the deepest designed feature set (templates, eligibility, verification logging), so "align vs. migrate" has the biggest complexity delta here |
| Provision Supabase Storage | P0 | 1 day | Schema decision (for policy correctness) | Every image/file upload in the CMS is currently broken | Low |
| Unify authorization (`admin_users` vs. `profiles.role`) | P0 | 2–3 days | Best sequenced with schema work (same tables) | Closes a real security gap: deactivating a staff member currently doesn't revoke their DB access to courses/participants/certificates | Medium — touches RLS on the 3 most sensitive tables; test thoroughly with a non-super-admin account before shipping |
| Decide fate of orphaned `/api/admin/login` | P1 | 1 hour (delete) or 1 day (fix) | None | Removes a live, unmonitored second authentication surface | Low |

**Recommended sequencing within V1.0**: ship the `/verify` fix same-day, independent of the rest. Make the schema decision before writing any other code in this version. Everything else in this table executes together once that decision is made, since it's one coordinated migration/RLS effort touching overlapping tables.

---

## Version 1.1 — Quick wins and hardening

**Theme**: cheap, high-visibility fixes that don't require the deep schema work — most can actually ship in parallel with V1.0, but are grouped here as the release that follows it, so V1.0 stays laser-focused on the one thing that matters (making the core work).

| Feature | Priority | Effort | Dependencies | Business value | Technical risk |
|---|---|---|---|---|---|
| Finish 5 CMS list pages (News, Gallery, FAQ, Downloads, Company) | P1 | 2–3 days total | None — schema-correct already | These modules' create/edit forms already work; staff currently can't reach them without knowing a direct URL, because the list page is a static placeholder | Very low — copy the existing Courses pattern |
| Fix Global Search (3 of 8 categories silently broken) | P1 | 2–3 hours | V1.0 schema decision | Staff searching for a schedule/trainer/certificate get zero results with no error — erodes trust in the whole search feature | Low |
| Replace in-memory rate limiting with a shared store | P1 | 1 day | None | Real abuse protection on login/reset-password/public forms, not just the appearance of it | Low |
| Wire `certificateSchema` into certificate actions | P1 | 2–3 hours | V1.0 certificates fix | Closes the one validation gap in an otherwise Zod-everywhere codebase | Low |
| Fix publish-date reset bug (courses/news) | P2 | Half a day | None | Editing an already-published item currently resets its publish date, corrupting "latest" sort order on the public site | Low |
| Fix timezone-dependent attendance check-in times | P2 | Half a day | V1.0/V1.5 attendance module | Attendance times are systematically wrong by the server/venue timezone offset | Low |
| Add server-side schedule capacity enforcement | P2 | Half a day | V1.0/V1.5 schedules module | Prevents over-booking a session past its stated capacity via direct action calls | Low |
| Fix duplicate-certificate QR link | P2 | 1–2 hours | V1.0 certificates fix | "Duplicate certificate" currently produces an unscannable QR code until manually regenerated | Low |
| Add unique constraint to prevent duplicate certificate generation | P2 | 1–2 hours | V1.0 certificates fix | Closes a race condition that can issue two certificates for one participant | Low |
| `next/image` `remotePatterns` for Storage | P2 | 1 hour | V1.0 Storage provisioning | Enables automatic image optimization for all Storage-hosted media | Very low |
| Add covering indexes for hot foreign keys | P2 | Half a day | Best bundled with V1.0's migration work | Prevents query slowdowns as `attendance`/`assessments`/`participants` accumulate real data | Low |
| Extract shared search-sanitization helper; apply to remaining 13 unsanitized filter endpoints | P2 | Half a day | None | Closes a real filter-injection gap across 13 admin list/export pages | Low |
| Tighten CSP (drop `unsafe-inline`/`unsafe-eval` where possible) | P3 | 1 day + testing | None | Meaningfully strengthens XSS defense-in-depth sitewide | Medium — may require reworking how Google Tag Manager is loaded (nonce-based) |
| Delete dead code (`lib/bulkCertificates.js`'s unused deps if not finishing it — see V1.5; `PrintButton.js`, `ProposalForm.js`; committed duplicate app snapshot in `work/`) | P3 | 1 day | Decision on bulk-import feature (V1.5) | Repo hygiene, smaller install size, removes false-positive noise from future audits | Very low |

---

## Version 1.5 — Complete the operations core

**Theme**: rebuild every remaining operations module against the now-consolidated schema. This is where the CMS becomes the full training-operations system it was designed to be, not just a content manager with a broken back office bolted on.

| Feature | Priority | Effort | Dependencies | Business value | Technical risk |
|---|---|---|---|---|---|
| Training Schedules module (full CRUD + capacity + calendar) | P0 | 3–4 days | V1.0 schema | Core scheduling is the operational backbone every other module (attendance, assessment, certificates) keys off | Low-medium, mechanical alignment work |
| Trainers module (full CRUD) | P1 | 2–3 days | V1.0 schema | Trainer records + workload visibility | Low |
| Companies module (full CRUD) | P1 | 2–3 days | V1.0 schema | Corporate client management — the entities that actually send participants | Low |
| Attendance module (full functionality, not just the placeholder) | P0 | 3–4 days | V1.0 schema, Schedules module | Legally/contractually relevant record-keeping for a training company | Low-medium |
| Assessment module (full functionality) | P0 | 3–4 days | V1.0 schema, Attendance module | Competency results are the basis for certificate eligibility | Low-medium |
| Automation Centre (system settings, templates, run history) | P2 | 3–4 days | V1.0 schema | Configurability (ID prefixes, timezone, formats) and import/bulk-operation history | Low |
| Reports & Analytics (wire the 9 reporting views live) | P1 | 3–5 days | V1.0 schema | Restores the Reports page's already-correct front-end logic to actual data | Low-medium — the views themselves are already designed, just need to be created live |
| Audit Log (live, functional) | P2 | 1–2 days | V1.0 schema | Compliance/accountability trail for privileged actions | Low |
| Users & Roles — build the currently-missing write UI (role assignment, activation/deactivation) | P1 | 2–3 days | V1.0 auth unification | Today this page is read-only; a super_admin can't actually manage staff roles from the UI | Low — mostly a form around an already-designed table |
| Finish or remove bulk PDF/OCR certificate import | P2 | 2–3 days (finish) / 1 hour (remove) | V1.0 certificates fix | The parsing/OCR engine is already fully built (`lib/bulkCertificates.js`) — finishing this is materially cheaper than it looks, and it's a genuine differentiator for a certification company processing legacy paper/scanned certificates | Low-medium — OCR accuracy on real scanned documents should be piloted before full rollout |
| Cross-module integration: certificate auto-issue from competent assessment results | P2 | 2–3 days | Assessment + Certificates modules | Removes a manual step for the highest-volume operational task | Low |
| Cross-module integration: participant/training history views | P2 | 3 days total | Attendance + Assessment + Certificates modules | Staff-facing 360° view of one participant's or one course's history | Low |
| Cross-module integration: attendance↔assessment↔certificate linking | P2 | 2 days | Above modules | Removes manual cross-referencing between three related records | Low |

**Recommended sequencing within V1.5**: Schedules first (everything else keys off it), then Attendance and Assessment in parallel, then Reports/Audit/Users, then the cross-module integration items, then the bulk-import decision last (it's valuable but self-contained and not a dependency for anything else).

---

## Version 2.0 — Executive and automation layer

**Theme**: the operations core is solid; this version is about visibility (reporting, dashboards) and reducing manual staff work (email, PDF, QR, backups) — the layer a growing business needs once day-to-day operations are no longer the bottleneck.

| Feature | Priority | Effort | Dependencies | Business value | Technical risk |
|---|---|---|---|---|---|
| CEO Dashboard (full build per `CEO_DASHBOARD_PLAN.md`) | P1 | 1–2 weeks | V1.5 Reports module, reporting views live | Executive-level visibility into business health at a glance — the requested deliverable this session's `CEO_DASHBOARD_PLAN.md` already specs in full | Low-medium — mostly composition of already-existing views; the "new query" items (utilization, repeat-participant rate) are small bespoke aggregations |
| Real PDF export pipeline (replace print-to-PDF placeholders) | P2 | 2–3 days | V1.5 Certificates/Companies/Assessment modules | Professional, server-generated PDFs for certificate registers, company reports, assessment reports, instead of relying on a browser's print dialog | Low-medium — introduces a new rendering dependency (`@react-pdf/renderer` or headless-browser print) |
| Email delivery integration (certificates, notifications) | P2 | 3–4 days | V1.5 Certificates + Automation modules | Automates a currently-manual "email the certificate to the client" step; extends the already-integrated Resend usage | Low — Resend is already proven in this codebase for two other flows |
| QR check-in for attendance | P2 | 3–5 days | V1.5 Attendance module | Faster, lower-friction attendance capture at in-person sessions; the schema already reserves an `attendance_method = 'qr'` value for this | Medium — needs a mobile-friendly capture UI and a public-safe check-in endpoint; get the security model reviewed before shipping (who can check someone else in, replay protection on the QR payload) |
| Manual backup / export infrastructure | P3 | 1 week+ | V1.0 schema (target the final schema) | Currently deliberately disabled with an explicit in-app note explaining why (needs a protected server job + retention policy) — this is the version to actually build that, not before | Medium-high — handling production data exports safely (access control on the exports themselves, retention/deletion policy) needs real design, not a quick feature |
| Introduce automated test coverage (Jest/Vitest) | P1 | Ongoing, start with 1–2 weeks for critical-path coverage | None, but most valuable once V1.0/V1.5's schema is stable (no point testing against a schema about to be replaced) | Every future release currently relies on manual verification or a full audit pass to catch regressions — this is the single highest-leverage technical-debt item on the whole roadmap for long-term velocity | Low to start, but requires ongoing discipline to keep coverage meaningful |
| Introduce ESLint (replace the syntax-only `npm run lint`) | P2 | 2–3 days initial setup + gradual cleanup | None | Catches a class of bug/style issue currently invisible to CI | Low |

---

## Version 3.0 — Scale and expansion

**Theme**: capabilities that go beyond "run the current business well" into new revenue/product surface area — none of these are corrections to existing gaps, they're genuine expansion, and none should start before V1.0–V2.0 are stable.

| Feature | Priority | Effort | Dependencies | Business value | Technical risk |
|---|---|---|---|---|---|
| Revenue/invoicing module | P1 | 2–3 weeks | V1.5 Companies + Schedules modules | Closes the single biggest data gap identified in `CEO_DASHBOARD_PLAN.md` — today revenue can only ever be *estimated* (fee × participants); real billing data unlocks accurate financial reporting and, potentially, online payment collection | Medium-high — this is genuinely new domain modeling (invoices, payment status, possibly a payment gateway integration), not an extension of existing tables |
| Client/company self-service portal | P2 | 2–3 weeks | V1.5 Companies module, V1.0 auth (the `client` role already exists in the schema's role enum but has no UI) | Lets a corporate client log in and see their own participants' certificates/attendance without a staff request — reduces support overhead and adds a retention feature | Medium — needs its own RLS policy set scoping a `client`-role user to only their own company's data, and a distinct, simpler UI shell |
| Participant self-service certificate portal | P3 | 1–2 weeks | Client portal (shares infrastructure) | Individual participants can retrieve/re-download their own certificate without contacting staff | Low-medium once the client portal's auth pattern exists |
| Staging/branch-based deployment workflow (Supabase branching) | P1 | 3–5 days | None, but most valuable once schema churn has settled | Every future migration can be tested against a real branch before touching production — directly reduces the risk class that caused this codebase's core problem in the first place | Low — Supabase branching is already available via the MCP tooling this session used, just not yet part of the team's workflow |
| Formal internationalization (the admin UI already mixes English/Malay strings ad hoc) | P3 | 1–2 weeks | None | Consistent, maintainable bilingual (or multi-language) support instead of scattered hard-coded Malay strings in specific routes | Low-medium |
| Public API / webhooks for third-party integrations (e.g. HR systems verifying certificates programmatically) | P3 | 1–2 weeks | V1.0 certificate verification fix | Opens B2B integration opportunities beyond the existing human-facing `/verify` page | Medium — needs its own auth (API keys), rate limiting, and versioning strategy, distinct from the cookie-based staff auth used everywhere else |
| Advanced analytics / BI export (beyond the CEO dashboard's built-in charts) | P3 | 1–2 weeks | V2.0 CEO Dashboard | Scheduled exports/data warehouse feed for deeper analysis than an in-app dashboard supports | Low-medium |

---

## Recommended release order

```
V1.0 → V1.1 → V1.5 → V2.0 → V3.0
```

This is a **strict dependency chain, not a suggestion** — every version after 1.0 either reads from or extends tables/modules that don't function until 1.0's schema work lands. Building V1.5's Attendance module against today's live schema, for example, would mean building it twice: once now (against a schema about to change) and once again after the consolidation. The one exception explicitly worth pulling forward: **the `/verify` RPC fix (V1.0) should ship the same day it's identified**, independent of everything else in this roadmap — it's a customer-facing, zero-dependency, few-hour fix, and there's no reason a genuine certificate should read as invalid for even one extra release cycle while the rest of V1.0 is in progress.

Within that chain, `MASTER_ARCHITECTURE.md`'s development-phases Gantt chart shows the same sequencing at a finer grain (which items can run in parallel once the schema decision is made). This roadmap's version boundaries are a coarser, release-planning view of that same dependency graph — use the Gantt chart when scheduling sprints, use this document when communicating scope to stakeholders or planning release announcements.

**One sequencing judgment call worth flagging explicitly**: automated test coverage (V2.0) is placed *after* the schema-stabilizing work (V1.0/V1.5) rather than before, even though "add tests before building more" is the usual instinct. That's deliberate here — writing tests against a schema that's about to be replaced would mean rewriting the tests too. Once V1.5 ships, test coverage should be treated as a standing requirement for every subsequent change, not a one-time V2.0 checkbox.
