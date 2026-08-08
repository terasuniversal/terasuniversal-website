# TERAS CMS — Production Baseline (2026-08-08)

This is the recoverable baseline established after the controlled production defect-fix cycle and read-only UAT pass. It marks the point the system was approved for daily operational use, before any further feature work.

## Deployment

- **Baseline commit:** `52a5f5c`
- **Production URL:** `https://www.terasuniversal.com.my`
- **Deployed via:** Vercel, auto-deploy from `origin/main`
- **Deployment status at baseline:** Ready, build succeeded, no errors

## Key modules verified

Dashboard, Reports & Analytics, Courses, Participants, Certificates (list, generate/issue lifecycle, CSV/Excel export), Attendance, Global Search, public certificate verification (`/verify`), and authentication (login, logout, session persistence, unauthorized-route redirect) were all exercised against production during this cycle and confirmed working, with no console errors observed.

## Defect status at baseline

**Defect 1 — Certificate count mismatch: FIXED.** Dashboard, Reports, and the Certificates module stat card all counted certificates with `status = "issued"`, a value from the unapplied numbered migration track; the live `status` column only ever uses `valid`/`expired`/`revoked`. All three now query `status = "valid"` and agree with each other and with the live database.

**Defect 2 — Certificate CSV/Excel export returning HTTP 503: FIXED.** The export buttons used a plain `<a href>` document navigation to the export route, which returned 503 on every top-level navigation in production while an identical `fetch()` to the same URL succeeded every time. Replaced with a client-side `fetch()` + Blob download (`ExportButtons.tsx`); both formats confirmed returning HTTP 200 via real button clicks in production.

**Defect 3 — Duplicate course creation: FIXED (two-stage).** The Courses module's create/update actions assumed a `slug` unique constraint that does not exist live (only `course_code` is unique). A first fix (commit `6b0f552`) added an app-layer existence check but used `.maybeSingle()` without `.limit(1)`; because 41+ rows already share one legacy slug, the lookup matched multiple rows, `.maybeSingle()` errored, and the error was silently discarded — the guard never fired. This was caught during verification (it briefly created one real extra course row, immediately soft-deleted, zero references). Corrected in commit `1b1dd14` (`.limit(1)` + explicit error check, matching the already-correct pattern in the certificate-import path). Verified live via source inspection of the deployed commit and a read-only query reproducing the guard's lookup. Production course count has held at 126 active rows through subsequent real UAT usage with no new duplicates.

## Controlled UAT result

**READY FOR DAILY OPERATION: YES**, as of the final verification pass on 2026-08-08 (after commit `1b1dd14` was confirmed pushed and deployed as part of `52a5f5c`).

Note: `POST_PUSH_PRODUCTION_VERIFY.md` (repo root, uncommitted) captures an earlier point in that same day's verification and records a **NO — pending one push** verdict; that was superseded within the same session once `1b1dd14` was confirmed live and re-verified. This baseline document reflects the final, superseding result.

## Current known limitations

See `KNOWN_ISSUES.md` for the full list. Summary: a large pre-existing legacy course-duplication data issue (not a code defect — prevention is fixed, historical rows are untouched by design pending explicit approval), a Node engine-version mismatch warning on every build, an unoptimized large PDF asset, and an unresolved two-schema-track decision in Supabase.

## Known legacy course duplicate issue

121 of 126 live `courses` rows are duplicates across 4 course names, traced to a one-time historical data migration/backfill that predates the current application code. 106 of those 121 rows are each referenced by exactly one certificate (`certificates.course_id`), so they cannot be safely deleted without first reassigning those certificates to a canonical row per group; the remaining 15 are fully unreferenced. A full audit and staged, approval-gated remediation plan exists at `COURSE_DATA_CLEANUP_PLAN.md` (repo root, uncommitted) — **not executed, and out of scope for this baseline.** Duplicate *prevention* going forward is fixed and verified (Defect 3); cleanup of the existing 121 rows is a separate, explicitly-deferred decision.

## Files intentionally left uncommitted

- `public/downloads/TERAS-UNIVERSAL-Company-Profile.pdf` — modified in the working tree (103.8 MB), needs optimization before it should be committed
- `supabase/seed.sql` — untracked, not part of the live schema's provenance
- `COURSE_DATA_CLEANUP_PLAN.md`, `PRODUCTION_SMOKE_TEST.md`, `POST_PUSH_PRODUCTION_VERIFY.md` — investigation/audit deliverables from this cycle, kept in the working tree for reference but not committed
- `docs/reference/` — from separate, unrelated in-progress work

## Node version warning

Every Vercel build emits: `Warning: Due to "engines": { "node": "22.x" } in your package.json file, the Node.js Version defined in your Project Settings ("24.x") will not apply, Node.js Version "22.x" will be used instead.` This is non-blocking — the build succeeds on 22.x — but the Project Settings value (24.x) and the pinned `package.json` value (22.x) disagree and should eventually be reconciled deliberately. Local development in this environment currently runs Node 24.18.0, one major version ahead of what's actually pinned and deployed.

## npm audit

`npm audit` reports **0 vulnerabilities** as of this baseline (dependency versions unchanged since the last documented audit pass in `docs/release/v1.2.1-release-notes.md`).

## Rollback notes

- **Code rollback:** revert to this baseline by deploying commit `52a5f5c` (or `git revert` any commit after it, or `git reset` a working branch to it — never force-push `main` without explicit approval). The commit is tagged `v1.2.2-production-baseline` for exactly this purpose.
- **Data rollback:** no destructive schema or bulk-data operation was performed to reach this baseline. The only production data write in this entire cycle was one soft-deleted test course row (id `854e6021-2cd9-425a-a3ed-7f0abe797d18`), which is already reversible (`UPDATE courses SET deleted_at = NULL WHERE id = '854e6021-2cd9-425a-a3ed-7f0abe797d18'`) and has zero references, if it should ever need restoring.
- **No migration was applied** as part of reaching this baseline — the live schema is unchanged from before this cycle began. Rollback never needs to touch `supabase/migrations/`.
- **Vercel:** the prior Ready production deployment remains available in the deployment history and can be promoted back via the Vercel dashboard/CLI if a rollback is ever needed without a new commit.
