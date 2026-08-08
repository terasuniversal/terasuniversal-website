# Bug Report — Production Readiness Pass

Assumes this system is already in production. Full-repository sweep across null/undefined handling, imports, dead files, routing/navigation, schema alignment, TypeScript correctness, hydration, Server Actions, Supabase permissions, race conditions, edge cases, memory leaks, security, performance, and responsive UI. Builds on `DATABASE_AUDIT.md`/`SECURITY_REPORT.md`/`PERFORMANCE_REPORT.md` (cited, not re-derived, where already fully covered there) and adds fresh investigation for the categories not yet specifically checked this session: hydration, memory leaks, responsive UI, and a systematic navigation/route audit. **Documentation only — nothing below was fixed.**

**Note on current state**: the Participants module's schema gap (§ Database Mismatch, previously the top finding here) was fixed earlier in this session via a live, additive migration (new columns + `companies` table) — verified applied. It is intentionally **not** listed as broken below; the fix is awaited-verification pending `MODULE_REPORT.md`. Every other module listed as schema-mismatched below is still in its pre-fix state.

Severity: **Critical** → breaks production now or is trivially exploitable. **High** → breaks under common, expected conditions. **Medium** → real but edge-case or bounded. **Low** → cosmetic/hardening.

---

## Database mismatch

**CRITICAL** — Schedules, Trainers, Companies*, Attendance, Assessment, Certificates (admin UI), Automation, Reports, Audit, Users, Dashboard all query tables/columns absent from the live database. Full table-by-table evidence: `DATABASE_AUDIT.md` §5, `BUG_REPORT.md`'s prior pass (superseded content now folded into this file). *Companies' table now exists (added this session for Participants' FK), but the Companies **module's own CRUD** still targets a schema shape not yet reconciled with what was actually created — verify in that module's own turn, don't assume it's fixed by proxy.

**CRITICAL** — Public certificate verification (`/verify`, `/verify/[token]`) calls `supabase.rpc("verify_and_log", ...)`, which does not exist live; the live, working RPC is `verify_certificate_by_value`. Every genuine certificate currently returns "not found." Zero dependencies to fix — should not wait for the schema-consolidation work on other modules.

---

## Broken imports / Unused files

**MEDIUM** — `lib/bulkCertificates.js` imports `pdfjs-dist` and `tesseract.js`; a repo-wide search for any import of this module or its exports found none. Not "broken" in the sense of a missing package — it resolves fine — but it's dead code pulling in two large dependencies for zero callers.

**LOW** — `components/PrintButton.js`, `components/ProposalForm.js` — no references anywhere in the codebase.

**LOW** — `lib/certificates.js`, `lib/supabase.js` (loose root files) coexist with `lib/certificate-html.ts` and `lib/supabase/` (the directory). Not confirmed dead in this pass — flagged for a targeted check, since duplicate-named legacy/current pairs are exactly the pattern that produced other dead code already found.

**MEDIUM** — `work/teras-admin-cms/teras-admin-cms/` — 59 files, a **committed** duplicate snapshot of an earlier app version. Not an import-graph bug (nothing imports from it), but it's a live source of false-positive matches in any future repo-wide search — confirmed to have produced noise during this session's own audits more than once.

---

## Wrong routes / Broken navigation / Broken links

**Checked**: `lib/admin-nav.ts` (the sidebar's source of truth) against the actual `app/admin/(protected)/**` route folders. **No broken `href` values found** — every nav entry's `href` resolves to a real route folder, and `minRole` values are consistent with `MODULE_ACCESS` in `lib/auth/rbac.ts`. This is a clean result worth stating plainly rather than searching harder for a problem that isn't there.

**LOW** — `lib/admin-nav.ts`'s `cert-templates` entry (`/admin/certificates/templates`) has no corresponding top-level nav grouping distinction from `certificates` — cosmetic, not a routing bug; both resolve correctly.

**MEDIUM** — Several detail pages link to modules that are themselves broken (e.g. participant detail page links to `/admin/certificates/{id}` for a certificate that, per the admin certificates module's own schema mismatch, may not be reachable in a working state). Not a "broken link" in the 404 sense — the route exists — but it's a link into a currently-non-functional destination. Will self-resolve as each linked module is fixed in its own turn.

---

## Null / Undefined handling

**HIGH** — `app/verify/page.tsx:33`/`app/verify/[token]/page.tsx:26` destructure only `{ data }` from the `verify_and_log` RPC call, discarding `error` entirely. When the RPC doesn't exist, this isn't surfaced as an error anywhere — `data` is silently `null`/`undefined` and treated identically to "certificate not found." This is the single most consequential null-handling bug in the codebase given it's the public verification flow (cross-ref Database Mismatch above).

**MEDIUM** — `app/admin/(protected)/participants/[id]/page.tsx`'s cross-module `Promise.all` (training history, certificates, attendance, assessments) never checks `{ error }` on any of its 4 supplementary queries — a genuinely failed query (wrong schema, RLS denial) is visually indistinguishable from "this participant has no records," since both render the same `EmptyState`. Same pattern likely repeats in every other detail page that does cross-module lookups (trainers, companies, schedules) — not individually re-verified here, flagged as a systemic pattern.

**LOW** — `Detail` components across multiple pages (`{value || "—"}`) will render `"—"` for a falsy-but-valid value of `0` (e.g. a numeric field that's legitimately zero) — currently low-impact since no such field is displayed this way today, but worth being aware of if a numeric stat is ever added to one of these `dl`-based detail grids.

---

## Incorrect TypeScript

**CRITICAL (systemic)** — `lib/supabase/database.types.ts` is a hand-written partial stub (4 tables typed, everything else `any` via index signature); `lib/supabase/server.ts` additionally casts the whole client `as any`. Every query against any of the ~25 untyped tables passes `tsc --noEmit` regardless of whether the table/columns actually exist. This is not a stylistic complaint — it is the specific mechanism by which every "Database mismatch" bug above ships without a compiler warning. Full detail: `BUG_REPORT.md`'s prior pass (`BUG-35`/`BUG-36`), preserved here as still-current.

**LOW** — Several `as never` casts around `.rpc("log_event", {...})` calls (e.g. `participants/import/importActions.ts`, `automation/actions.ts`) paper over the same missing-types problem for RPC calls specifically, not just table queries.

---

## Hydration issues

**Checked**: every `useEffect`/browser-API usage in public-facing client components (`TrainingGallery.js`, `Analytics.js`, `MobileNav.js` pattern, admin `Topbar.tsx`/`ImageUpload.tsx`). **No hydration mismatch found** — no component reads `Date.now()`, `Math.random()`, or `typeof window` in a way that would produce different server vs. client markup on first render; date/locale formatting (`toLocaleDateString("en-MY")`) happens only in Server Components (evaluated once, server-side, before the client ever sees it) or inside `useEffect`/event handlers (post-hydration, not part of the initial render diff). This is a clean result.

**LOW** — `Topbar.tsx`'s initials computation (`profile.full_name.split(" ").map(s => s[0])...`) runs identically on server and client since `profile` comes from a server-fetched prop, not client state — no mismatch risk, noted only because it's exactly the *shape* of logic that commonly causes hydration bugs elsewhere; worth keeping an eye on if this pattern is ever moved to run client-side only.

---

## Server Action bugs

**CRITICAL** — `certificates/actions.ts` has no Zod validation (`certificateSchema` exists, unused) — full detail `SECURITY_REPORT.md` §5/§6.

**HIGH** — `certificates/actions.ts`'s `generateCertificate` does check-then-insert with no unique constraint on `(schedule_id, participant_id)` — a real, exploitable-by-double-click race condition. Full detail: prior `BUG_REPORT.md` pass, `BUG-15`.

**MEDIUM** — `automation/actions.ts`'s `getAutomationSettings()` has no guard of its own (relies on callers guarding first) — the one inconsistency across 18 audited `"use server"` files.

**LOW** — `duplicateCertificate` doesn't set `verification_url` on the copy — produces an unscannable QR until manually regenerated.

---

## Supabase permission bugs

**CRITICAL** — `courses`/`participants`/`certificates` RLS is gated by `admin_users` membership (binary, no role granularity), completely disconnected from `profiles.role`/`is_active`. Deactivating a staff member doesn't revoke their DB access to these 3 tables. Full detail: `SECURITY_REPORT.md` §2. **Note**: the `companies` table added this session for the Participants fix correctly uses the `profiles.role`-based model (`app.is_editor()`/`app.is_admin()`) from the start — it does not inherit this problem, since it's a new table with no legacy policy to preserve.

**HIGH** — 13 list/export endpoints build `.or()` filters from unsanitized `?q=` input — filter-injection within the querying user's own RLS-bounded access. Full detail: `SECURITY_REPORT.md` §2 / prior `BUG_REPORT.md` `BUG-29`.

**MEDIUM** — No live table has `FORCE ROW LEVEL SECURITY` set. Corrected assessment from earlier in this session still holds: low real-world impact since `anon`/`authenticated` don't have `BYPASSRLS` regardless — but worth setting for defense-in-depth and to match the audit-trigger-bearing tables added this session (which also don't set `FORCE` — consistent with existing live tables, not a new regression, but also not a fix).

---

## Race conditions

**HIGH** — Certificate generation (above). **MEDIUM** — `assignParticipants` capacity check is client-side only; concurrent assignments from two admins could both pass a stale client-side capacity check before either write lands (no server-side re-check at write time). Full detail: prior `BUG_REPORT.md` `BUG-19`.

---

## Edge cases

**MEDIUM** — Date-range filters that hardcode `-31` as the last day of a month (`attendance/page.tsx`, `schedules/page.tsx`, `schedules/export/route.ts`) produce an invalid date string (`2026-02-31`) for any month with fewer than 31 days, silently returning zero results with the query error unchecked. Full detail: prior `BUG_REPORT.md` `BUG-08`.

**LOW** — CSV export escaping (`participants/export/route.ts` and siblings) correctly quotes commas/quotes/newlines but does not defend against formula injection (a value starting with `=`, `+`, `-`, `@` being interpreted as a formula by Excel/Sheets on open) — low severity since export is staff-only and source data is staff-entered, not public input, but worth a one-line prefix-escape (`'` before the value) if this data ever includes anything copy-pasted from an external source.

---

## Memory leaks

**Checked**: every `addEventListener`/`setInterval`/`setTimeout` call site in `components/` (`TrainingGallery.js`, `Analytics.js`). **No leaks found** — both components correctly return a cleanup function from `useEffect` that removes the listener and (in `TrainingGallery.js`'s case) restores `document.body.style.overflow`. This is a clean result across the only two files in the codebase that manage listeners manually.

---

## Security issues

Full detail: `SECURITY_REPORT.md` (16 categories, unchanged since that pass — none of this session's fix work has touched the flagged items yet). Headline items, unchanged: `admin_users`/`profiles.role` authorization split (Critical); `/api/admin/login` returns raw session tokens, no rate limit (High); Storage has zero buckets provisioned (High); CSP allows `unsafe-inline`/`unsafe-eval` (High); in-memory rate limiting doesn't work across serverless instances (High).

---

## Performance bottlenecks

Full detail: `PERFORMANCE_REPORT.md` (unchanged). Headline items: ~30 unindexed live foreign keys (High, structural); unbounded `.limit(100000)` fetch on every participant CSV-import preview (High — **note**: this exact code path is part of the Participants module now being fixed; worth re-checking whether it's addressed by the time `MODULE_REPORT.md` for Participants is written, since it's the same module); accidentally-serialized `Promise.all` on the trainer profile page (High); N+1 in bulk certificate generation (Medium).

---

## Responsive UI issues

**Checked**: admin form components (`ParticipantForm.tsx`, `CompanyForm.tsx`, `ScheduleForm.tsx`, `TrainerForm.tsx`) and list-page toolbars for fixed-width constraints that could break on small viewports.

**MEDIUM** — Several list-page filter toolbars use fixed pixel `maxWidth`/`minWidth` on `<select>`/search-input elements inside a `ta-toolbar` flex row (e.g. `participants/page.tsx`: `maxWidth: 260` on search, `maxWidth: 180` on the company filter) with no responsive breakpoint — on narrow viewports these will either overflow the container or wrap awkwardly depending on the flex-wrap behavior of `.ta-toolbar` (not independently verified in a live browser this pass — flagged from static review, recommend a real viewport check before ranking higher).

**MEDIUM** — `ParticipantForm.tsx` and similar forms set `style={{ maxWidth: 820 }}` on the `<form>` with `ta-field-row` presumably a 2-column grid/flex layout — not verified whether `ta-field-row` collapses to 1 column below a breakpoint in `admin.css` (not read as part of this pass; the class exists and is used consistently, but its responsive behavior wasn't confirmed).

**LOW** — Public site consistently uses `next/image` with explicit `width`/`height` (correct pattern, prevents layout shift) — no responsive-image issues found on the public side in this pass.

**Recommendation**: this category needs an actual browser check (resize to 375px/768px on a few key admin pages) before any of the "Medium" items above are treated as confirmed — static review can identify *candidates* but not confirm actual breakage, and this session has not launched a browser against the running app.

---

## Summary table

| Category | Critical | High | Medium | Low |
|---|---|---|---|---|
| Database mismatch | 2 | — | — | — |
| Broken imports/unused files | — | — | 2 | 2 |
| Routes/navigation/links | — | — | 1 | 1 |
| Null/undefined | — | 1 | 1 | 1 |
| TypeScript | 1 | — | — | 1 |
| Hydration | — | — | — | 1 (non-issue, noted) |
| Server Actions | 1 | 1 | 1 | 1 |
| Supabase permissions | 1 | 1 | 1 | — |
| Race conditions | — | 1 | 1 | — |
| Edge cases | — | — | 1 | 1 |
| Memory leaks | — | — | — | 0 (clean) |
| Security (full list in `SECURITY_REPORT.md`) | 1 | 4 | — | — |
| Performance (full list in `PERFORMANCE_REPORT.md`) | — | 3 | 1 | — |
| Responsive UI | — | — | 2 | 1 |

Nothing in this report was fixed. Waiting for approval before any further action.
