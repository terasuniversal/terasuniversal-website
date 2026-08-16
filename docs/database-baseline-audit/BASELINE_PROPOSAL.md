# BASELINE PROPOSAL — Safe Production Database Baseline for TERAS CRM

**Status:** proposal only. **Nothing has been executed.** No production reset, no destructive ALTER, no migration application, no commit.

## Context (one paragraph)
Production (`iagzkrzeuawaxvacqprk`) cannot be recreated from the tracked migration chain (fresh replay FAIL, 24/49 dated migrations). It was consolidated by an out-of-band `database_baseline_v1` (981 statements, applied 2026-08-15) whose canonical in-repo equivalent already exists as `supabase/baseline/v1/schema.sql` (SHA-256 `0B73DC50022888B580A222318F634F4C9A5B180BC499B7DD1E857E61E98719BA`). Since then, remote-only migrations `feedback_schedule_qr` (`20260816072507`) and `sales_won_follow_up_completion` (`20260816100000`) plus the unrecorded security pack were applied. Data is non-trivial (courses 127, participants 126, certificates 108, audit_logs ~1,072 rows).

## Requirements (must all hold)
1. Preserve all production data.
2. No production reset.
3. No rewriting of applied history.
4. Future environments reproduce current schema.
5. Forward-only migrations after the checkpoint.
6. Reduce AI-agent context (agents must not scan the whole historical chain).
7. Explicitly avoid agents recreating objects manually.

## Recommended approach: **Option B+ — Baseline V1 checkpoint + forward-only chain** (with elements of A and C)

### 1. Canonical reconstruction source = frozen snapshot
- Adopt `supabase/baseline/v1/schema.sql` as **Baseline V1** (the live, reviewed application schema for `public` + `app`).
- Re-derive it fresh at cutover (read-only `supabase db dump --linked --schema public,app --keep-comments`) so it includes the current post-snapshot state (feedback QR, sales won completion, security pack), then freeze + hash + sign in the manifest.

### 2. Baseline checkpoint migration (new environments only)
- Create ONE forward-only, idempotent baseline migration from the frozen snapshot, named e.g. `supabase/migrations/<YYYYMMDDHHMMSS>_baseline_v1.sql` (or, per repo convention, keep it under `supabase/baseline/v1/` and reference it).
- It must be written **guarded** (`IF NOT EXISTS` / `DO $$`) so that if it ever runs against production it is a no-op and cannot clobber data.
- **It is the ONLY migration a fresh environment replays**; everything after it is forward-only.
- It must NOT be added to the remote history of production (production already has `database_baseline_v1` recorded). Document this explicitly so nobody re-applies it to production.

### 3. Migration-history reconciliation (documentation-only first)
- Mark the numbered track (`0001`–`0021`) as **NON-EXECUTABLE / archived** (move to `supabase/migrations_legacy/` or annotate) so no agent or CI ever replays it.
- Keep the compatibility track files as historical evidence; reconcile their filenames to the true remote versions in a `MIGRATION_RECONCILIATION.md` map (already produced in `REPOSITORY_MIGRATION_INVENTORY.md` §2).
- Record the out-of-band security pack and remote-only migrations (`feedback_schedule_qr`, `sales_won_follow_up_completion`, photo bot) explicitly in the reconciliation doc, and optionally backfill **forward-only no-op "recording" migrations** that insert their versions into `schema_migrations` — only with approval.

### 4. Forward-only chain after checkpoint
- Every schema change = a new `supabase/migrations/<timestamp>_description.sql` on top of the baseline.
- Every change must pass: local fresh replay → diff vs baseline → security review → only then production.
- Never edit an applied migration.

### 5. Repair migrations (optional, second wave, with approval)
If we want fresh replay to reproduce production exactly WITHOUT the baseline shortcut, add forward-only, idempotent repair migrations that create the missing objects (`admin_users` compatibility table, `course_schedules` fixes, `verify_certificate_by_value`, photo/feedback tables, etc.). These are listed in `FRESH_REPLAY_REPORT.md` (24 failures). Each is small and reviewable. This is optional if Option B+ baseline is adopted.

### 6. AI-agent source of truth
- `docs/database/PRODUCTION_DATABASE_BASELINE.md` — concise, one-page "what is live" doc (produced in this audit).
- `docs/database/SCHEMA_INDEX.md` — per-table index (produced in this audit).
- Update `DATABASE_AUDIT.md` to point to the baseline and mark the numbered track frozen.

## Why not the other options
- **Option A (canonical schema + reconciliation docs only):** insufficient alone — no executable way to build a fresh environment, and agents still can't trust the chain.
- **Option C (bootstrap SQL + archive migrations):** viable, and Option B+ converges to it; we do NOT physically move/delete migration files until approved, to avoid destroying history/evidence.
- **Pure "keep applying current chain":** fails immediately (replay breaks at the first dated migration).

## Explicit non-goals / guardrails
- No `DROP`, `TRUNCATE`, `DELETE`, or destructive `ALTER` anywhere.
- No edits to already-applied production migrations.
- No changes to RBAC/Staff Module Access (documented drift only).
- Baseline restructuring requires this document's approval before execution.

## Next actions (in order, after approval)
1. Freeze the current production snapshot as Baseline V1 (re-derive + hash).
2. Build the guarded baseline checkpoint migration + manifest.
3. Apply the optional repair/reconciliation migrations (forward-only) for fresh-replay parity.
4. Archive/annotate the numbered track.
5. Commit the baseline, policy docs, and reconciliation map as one reviewed PR.
6. Add a CI job that replays the baseline + forward chain and diffs against the frozen snapshot.
