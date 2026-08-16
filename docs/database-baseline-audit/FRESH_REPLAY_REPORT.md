# FRESH REPLAY REPORT

Empirical result of replaying the repository migration chain from zero.
Audit date: 2026-08-16. Production was **not touched**. Replay ran in an isolated local Supabase stack (`supabase db start` + `supabase db reset`, Docker) using a throwaway project directory with the repo's `supabase/migrations/*.sql` copied verbatim.

## Result: **FAIL**

- Numbered track `0001`–`0021`: **applies cleanly from zero** (self-consistent among themselves, but this is NOT the schema production runs).
- Compatibility track (`2026*`): **24 of 49 dated migrations FAIL** against the clean numbered-track base.

## First failure

- Migration: `20260721030247_cms_compatibility_security.sql`
- Error: `ERROR: relation "public.admin_users" does not exist (SQLSTATE 42P01)`
- Missing dependency: `public.admin_users` — referenced by 3 tracked migrations (`20260721030247`, `20260811100000`, `20260814020000`) but **created by no tracked migration**. In production it was created out-of-band (legacy `certificates.sql` / dashboard SQL).

## Complete failure map (ordered; per-file first error on a clean base)

| # | Migration | First error | Root cause class |
|---|---|---|---|
| 1 | `20260721030247_cms_compatibility_security` | relation `public.admin_users` does not exist | Missing dependency (out-of-band table) |
| 2 | `20260721030829_production_cms_additive_compatibility` | column `course_name` does not exist | Numbered-track `courses` shape ≠ compatibility expectation |
| 3 | `20260721054355_add_course_status_compatibility` | COALESCE types `content_status` and `text` cannot be matched | Cross-track type mismatch (`cms_status` enum vs text `status`) |
| 4 | `20260724120000_provision_admin_content_modules` | policy `downloads_public_read` for table `downloads` already exists | Duplicate policy from numbered `0003` |
| 5 | `20260809065024_create_v_certificate_eligibility` | column `registration_status` does not exist | Dependency on legacy `certificates` columns |
| 6 | `20260809072652_v_certificate_eligibility_generation_gate` | column `registration_status` does not exist | Same |
| 7 | `20260809100000_course_schedules_additive_fields` | relation `public.course_schedules` does not exist | `course_schedules` only created by failing `20260721030829` |
| 8 | `20260809100100_create_schedule_participants` | column `deleted_at` does not exist | Legacy `participants` shape missing |
| 9 | `20260809100200_attendance_additive_fields` | column `present` does not exist | Legacy `attendance` shape missing |
| 10 | `20260809100400_certificates_schedule_fk` | constraint `certificates_schedule_id_fkey` already exists | Duplicate FK vs numbered `0016` |
| 11 | `20260809100500_schedules_rls_policies` | relation `public.course_schedules` does not exist | Cascade from #2 |
| 12 | `20260809100550_schedules_functions_search_path` | function `app.gen_schedule_code()` does not exist | Numbered-track function absent in compatibility lineage |
| 13 | `20260809101000_tighten_schedules_rls` | relation `public.course_schedules` does not exist | Cascade |
| 14 | `20260811090000_create_participant_skill_results` | relation `public.course_schedules` does not exist | Cascade |
| 15 | `20260811100000_certificate_skill_results_and_issuance_rpc` | relation `public.participant_skill_results` does not exist | Cascade from #14 |
| 16 | `20260813000000_public_upcoming_schedules_rpc` | relation `public.course_schedules` does not exist | Cascade |
| 17 | `20260814090000_create_proposal_requests_and_submit_rpc` | column `email_sent` of relation `proposal_requests` does not exist | `proposal_requests` pre-created by numbered `0004` (no `email_sent`) |
| 18 | `20260814165048_staff_user_management_phase1` | relation `public.sales_tasks` does not exist | Ordering/dependency (untracked RBAC migration references later-created table) |
| 19 | `20260814210000_course_schedules_sales_handoff_traceability` | relation `public.course_schedules` does not exist | Cascade |
| 20 | `20260814230000_add_schedule_exam_date` | relation `public.course_schedules` does not exist | Cascade |
| 21 | `20260814231000_seed_training_schedule_aug_dec_2026` | column `course_code` of relation `courses` does not exist | Legacy `courses` column missing |
| 22 | `20260815000000_participant_feedback_v1` | relation `public.course_schedules` does not exist | Cascade |
| 23 | `20260815120000_security_remediation_pack1` | function `public.verify_certificate_by_value(text)` does not exist | Legacy RPC absent from repo |
| 24 | `20260815140000_proposal_delivery_status_security` | column `email_sent` of relation `proposal_requests` does not exist | Cascade from #17 |

**Passed on the replay base (25):** `20260721030507`, `20260721054100`, `20260808150000`, `20260808160000`, `20260809064947`, `20260809064958`, `20260809072601`, `20260809100300`, `20260809100600`, `20260809100700`, `20260812120000`, `20260814020000`, `20260814060000`, `20260814120000`, `20260814150000`, `20260814180000`, `20260814190000`, `20260814220000`, `20260814240000`, `20260814250000`, `20260814260000`, `20260814270000`, `20260814280000`, `20260815130000`, `20260816100000`.
*(Some "pass" results reflect partial state left by earlier failed files and are not authoritative for a true CLI run — the CLI would stop at the first failure and never reach them.)*

## Root-cause taxonomy of replay failures
1. **Objects referenced but never created in the chain** — `admin_users`, `course_schedules` (indirectly), `verify_certificate_by_value`, legacy columns (`registration_status`, `deleted_at`, `present`, `course_code`, `email_sent`).
2. **Cross-track collisions** — numbered track (`0001`–`0021`) + compatibility track define overlapping tables/types/policies with incompatible shapes.
3. **Ordering/dependency errors** — `20260814165048` references `sales_tasks` created later in filename order; `database_baseline_v1` has no repo file so its consolidated schema cannot be replayed.
4. **Duplicate constraints/policies** from running both tracks.

## Replay comparison matrix

| Aspect | PRODUCTION | FRESH REPLAY (this run) | REPOSITORY INTENT (tracked files) |
|---|---|---|---|
| Migration count | 67 recorded | 21 applied (0001–0021) then FAIL | 70 files |
| Base table count | 49 | 44 (numbered track) | ~62 (both tracks combined) |
| `course_schedules` | present (35 rows) | absent | created only by failing migration |
| `admin_users` | present | absent | absent |
| `photos`/`feedback_*` | present | absent | absent |
| `verify_certificate_by_value` | present | absent | absent (only `verify_certificate_by_token`) |
| `trainers`/`training_schedules`/`venues` | absent | present | present (numbered) |
| RLS forced | 8 | 0 (numbered uses FORCE, compatibility doesn't) | mixed |
| RLS policies | 109 | differs | differs |

## Conclusion
A fresh replay of the tracked chain **cannot reproduce production** and stops at the first dated migration. The only faithful reconstruction source available in-repo is the frozen snapshot `supabase/baseline/v1/schema.sql` (the same content applied to production as out-of-band `database_baseline_v1`, 981 statements), **plus** the post-snapshot changes recorded as remote-only migrations `feedback_schedule_qr` (`20260816072507`) and `sales_won_follow_up_completion` (`20260816100000`).

No workaround patches were applied to the migrations themselves. The throwaway replay project (temp dir) is documented here and was not committed.
