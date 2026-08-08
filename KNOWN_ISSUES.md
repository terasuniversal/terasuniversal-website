# Known Issues

Confirmed, unresolved issues as of the production baseline (`52a5f5c`, 2026-08-08). Issues fixed during the preceding defect cycle (certificate count mismatch, certificate CSV/Excel export 503, duplicate-course creation) are **not** listed here — see `docs/release/PRODUCTION_BASELINE_2026-08-08.md` for what was fixed and how it was verified.

## 1. Legacy duplicated course catalog rows

121 of 126 live `courses` rows are duplicates spread across 4 course names (`BASIC SCAFFOLDING INSPECTOR COURSE (TUBULAR)`, `BASIC ERECTOR SCAFFOLDING COURSE`, `INTERMEDIATE ERECTOR SCAFFOLDING COURSE`, `ADVANCED ERECTOR SCAFFOLDING COURSE`), traced to a one-time historical data migration/backfill, not current application code. 106 of those rows are each referenced by exactly one certificate (`certificates.course_id`) and cannot be safely deleted without first reassigning those certificates to one canonical row per group; 15 are fully unreferenced. Duplicate *creation* is now prevented going forward (fixed and verified); the *existing* 121 rows remain untouched pending an explicit, separate, approval-gated cleanup. Full audit and staged remediation plan: `COURSE_DATA_CLEANUP_PLAN.md`. **Not scheduled — requires explicit approval before any execution.**

## 2. Node 22.x (pinned) vs. local/Vercel-default Node 24 mismatch

`package.json` pins `"engines": { "node": "22.x" }`, but the Vercel Project Settings default is 24.x and this development environment runs Node 24.18.0 locally. Every Vercel build emits a non-blocking warning and falls back to 22.x, which is what's actually deployed. Builds succeed either way, but the three values (pinned, project setting, local) disagree and should be reconciled deliberately rather than left to keep diverging.

## 3. Company-profile PDF needs optimization

`public/downloads/TERAS-UNIVERSAL-Company-Profile.pdf` is 103.8 MB in its current working-tree version (vs. 3.7 MB in the last committed version) and has been kept out of version control specifically because of its size. It needs to be compressed/optimized before it can be committed and served from the public downloads page.

## 4. Supabase schema consolidation decision outstanding

The repository contains two independently-designed schema tracks: a numbered "clean-room" track (`supabase/migrations/0001`–`0021`) that was never applied to the live database, and the legacy + compatibility track that is what's actually live. Application code is split between the two in places, and `lib/supabase/database.types.ts` is a hand-curated, partial type file with `as any` casts bridging the gap — meaning TypeScript does not currently protect against querying a table/column that doesn't exist live. See `DATABASE_AUDIT.md` for the full comparison and `DATABASE_AUDIT.md` §10 for the proposed (not yet decided or executed) migration strategy options.

## 5. Dashboard "Latest Participants" widget

The Dashboard's "Latest Participants" card has been observed showing "No participants recorded yet" despite the participants table holding live records, including some created the same day. Not part of the three defects addressed in this cycle; not yet root-caused.

## 6. Reports monthly charts show no data

"Participants per Month" and "Training Sessions per Month" on the Reports & Analytics page show "No data yet" despite participant records existing with real creation dates. These charts read from `v_participants_per_month` / `v_schedules_per_month`, reporting views defined only in the unapplied numbered migration track — plausible root cause is that these views don't exist against the live schema, but this has not been directly confirmed or fixed.

## 7. `category` field never populated

The live `courses.category` column exists and is a real, nullable text field (not a schema/UI mismatch), but is `NULL` on all 126 rows — it has simply never been written by any historical import or the current admin UI in practice. Not a bug in the field's existence or wiring; a data-completeness gap.
