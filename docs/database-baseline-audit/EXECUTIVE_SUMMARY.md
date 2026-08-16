# TERAS Database Baseline Audit — Executive Summary

**Audit date:** 2026-08-16
**Production project:** `iagzkrzeuawaxvacqprk` (TERAS Certificate Verification, Postgres 17.6, ap-southeast-1)
**Staging project:** `pzgtyskhyhuxhzvyzzhe` (TERAS Database Baseline Staging)
**Repo branch / SHA at audit start:** `feat/public-training-ux` @ `d2a1e7a290d98e6c364c181e68f7cb613393fb19`
**Mode:** read-only. Production was **not modified**. No commit was created.

---

## Headline result

**The raw repository migration chain does NOT faithfully recreate the current production database.**

- **Fresh replay from zero: FAIL.** The numbered track (`0001`–`0021`) applies cleanly, but the compatibility track that production actually runs on does not: the first dated migration (`20260721030247_cms_compatibility_security`) fails on missing `public.admin_users`, and **24 of 49 dated migrations fail** against a clean replay base.
- **The repo and production disagree at the migration-history level.** Only **6** local migration versions match the remote-applied versions exactly. **37** logical migrations exist under both sides but with **different version timestamps** (MIGRATION VERSION DRIFT). **23** remote migrations have **no local file** (out-of-band / unrecorded). **6** local files have **no remote entry**.
- **Production was consolidated by an out-of-band baseline migration** `20260815150000 database_baseline_v1` (981 statements), which was applied to production on 2026-08-15 **but is not present as a file anywhere in the repo's `supabase/migrations/`**. Its canonical reconstruction source already exists in-repo as `supabase/baseline/v1/schema.sql` (SHA-256 `0B73DC50...E98719BA`), produced by an earlier snapshot pass (2026-08-15).
- **Two schema tracks coexist in the repo**: the numbered clean-room track (`0001`–`0021`, never applied to production) and the legacy+compatibility track (`2026*`, the one production actually uses). The numbered track's object set is largely **absent from production** (13 repo-only tables), while many production objects were **never created by any tracked migration** (12 production-only tables).
- **Data is non-trivial and must be preserved:** `audit_logs` ~1,072 rows, `courses` 127, `participants` 126, `certificates` 108, `attendance` 99, `certificate_verifications` 42, `course_schedules` 35, `sales_activity` 21, plus smaller tables.

## Root causes of divergence

1. Production schema was built via **unrecorded out-of-band SQL** (dashboard SQL editor, loose root scripts `supabase/certificates.sql`, `supabase/role_policies.sql`, `supabase/certificate_import_logs.sql`) before migrations were tracked.
2. Migrations were applied to production with **timestamps that differ from the repo filenames** (a documented historical pattern, see `DATABASE_AUDIT.md` §11).
3. A **`database_baseline_v1` consolidation** was applied to production out-of-band (981 statements) and never committed as a migration file.
4. Later feature work (`feedback_schedule_qr`, `sales_won_follow_up_completion`) was applied as remote-only migrations with no local files; the **security remediation pack** was applied with **no schema_migrations entry at all**.
5. The numbered `0001`–`0021` track is a different design that would **collide** with the compatibility track if both ever run (confirmed in replay: duplicate policies, missing columns, duplicate constraints).

## Security posture (summary)

- 34 SECURITY DEFINER functions, **all with an explicit `search_path`** (good).
- No SD function is PUBLIC-executable except pg_trgm extension helpers and `public.teras_photo_next_id`.
- Public-facing SD RPCs (`submit_proposal_request`, `submit_public_enquiry`, `verify_and_log`, `feedback_*`, `get_public_upcoming_schedules`) are anon-executable by design and mostly `security_invoker`-free but constrained.
- Admin SD RPCs (`issue_certificate_with_skill_snapshot`, `convert_lead_to_opportunity`, `accept_quotation`, `reject_quotation`, `mark_opportunity_lost`) are **authenticated-executable SECURITY DEFINER** and rely on **internal `app.is_admin()` guards** rather than RLS — a deviation from the "RLS is the boundary" rule that is currently correct but fragile.
- 49 relations have RLS enabled; **8 are FORCE RLS**. 109 policies.

## Recommended strategy

**Option B+ (recommended):** adopt the frozen production snapshot `supabase/baseline/v1/schema.sql` as the canonical **Baseline V1 reconstruction source**, move forward-only. Concretely:

1. Record the baseline as a single forward-only, idempotent **baseline checkpoint** intended for *new* environments only (never re-applied to production).
2. Keep the existing `database_baseline_v1` history entry in production untouched.
3. Archive/annotate the historical migrations (numbered track marked non-executable; compatibility track reconciled to actual versions).
4. After the checkpoint, **all** future changes are forward-only migrations on top, with every one passing fresh replay + security review.
5. Update `lib/supabase/database.types.ts` from the live schema, and point `DATABASE_AUDIT.md` / agent docs at the new baseline.

Full detail in `BASELINE_PROPOSAL.md`, `MIGRATION_POLICY.md`, `FRESH_REPLAY_REPORT.md`, `PRODUCTION_VS_REPO_DIFF.md`, `SECURITY_FINDINGS.md`, and the two agent-facing docs under `docs/database/`.

## Immediate next actions (after approval)

1. Review this audit (no commit made).
2. Approve Baseline V1 as canonical; generate `supabase/baseline/v1/baseline.sql` from the verified snapshot (forward-only, new-environments-only).
3. Apply the minimal reconciliation migrations that make a fresh replay reproduce production (each forward-only, idempotent, tested).
4. Commit the baseline + policy docs + migration archive plan as a single reviewed PR.
5. Re-run fresh replay in CI and diff the result against production before and after every change.
