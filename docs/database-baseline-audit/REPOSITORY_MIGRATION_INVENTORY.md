# REPOSITORY MIGRATION INVENTORY

Inventory of everything in the repository that can create, alter, or drop database objects.
Audit date: 2026-08-16. Read-only; nothing was staged or committed.

## 1. Sources of DDL

| Source | Tracked? | Role |
|---|---|---|
| `supabase/migrations/0001`–`0021` (21 files) | tracked | Clean-room numbered track — **never applied to production** |
| `supabase/migrations/2026*` (49 files) | 44 tracked + 5 untracked | Compatibility track — the lineage production actually uses |
| `supabase/certificates.sql` | tracked | Legacy loose script (certificates/participants/courses + admin_users gating) |
| `supabase/certificate_import_logs.sql` | tracked | Legacy loose script |
| `supabase/role_policies.sql` | tracked | Legacy anon-restriction / role-policy script |
| `supabase/cms-seed.sql` | tracked | Content seed (legacy) |
| `supabase/seed.sql` | **untracked** | Local seed (referenced by CLI; absent on disk in repo root list? present as untracked file) |
| `supabase/baseline/v1/schema.sql` | untracked | **Canonical frozen production snapshot** (2026-08-15), SHA-256 `0B73DC50022888B580A222318F634F4C9A5B180BC499B7DD1E857E61E98719BA`, 284,421 bytes |
| `supabase/baseline/v1/manifest.json` | untracked | Manifest for the above snapshot |
| `work/teras-admin-cms/.../supabase/migrations/0001`–`0011` + `seed.sql` | tracked | Duplicate dead-weight snapshot (do not use) |

## 2. Migration files (70 total) — classification vs remote history

Legend:
- **MATCH** = same version applied on both local file and remote `supabase_migrations.schema_migrations`.
- **VERSION-DRIFT** = same logical migration; local filename version ≠ remote recorded version.
- **LOCAL-ONLY** = local file with no remote `schema_migrations` entry.
- **REMOTE-ONLY** = remote entry with no local file (listed in §3).

### Numbered track (21, never applied to production)
`0001_extensions_and_enums`, `0002_core_auth_rbac`, `0003_content_modules`, `0004_crm_and_media`, `0005_audit_log`, `0006_functions_triggers`, `0007_rls_policies`, `0008_storage_buckets`, `0009_grants`, `0010_public_rpc`, `0011_attendance_assessment_verification`, `0012_participants_management`, `0013_training_schedules`, `0014_attendance_management`, `0015_assessment_management`, `0016_certificate_engine`, `0017_certificate_verification`, `0018_trainer_management`, `0019_company_management`, `0020_reporting_views`, `0021_automation_centre`.
→ These create `training_schedules`, `trainers`, `companies`, `venues`, `schedules`, `user_permissions`, `site_settings`, `testimonials`, `automation_*`, `enquiry_notes`, `proposal_notes`, and reporting `v_*` views — **none of which exist in production**.

### Compatibility track (49 dated files)

**MATCH (6):** `20260809064947`, `20260809064958`, `20260809065024`, `20260809072601`, `20260809072652`, `20260816100000`.

**VERSION-DRIFT (37):**
| Local file | Remote version |
|---|---|
| 20260721030247_cms_compatibility_security | 20260721030423 |
| 20260721030507_move_citext_out_of_public | 20260721030532 |
| 20260721030829_production_cms_additive_compatibility | 20260721030958 |
| 20260721054100_add_course_delivery_modes | 20260721054131 |
| 20260721054355_add_course_status_compatibility | 20260721054342 |
| 20260808150000_add_participants_ic_passport_unique_index | 20260808092720 |
| 20260808160000_add_courses_active_slug_unique | 20260808100255 |
| 20260809100000_course_schedules_additive_fields | 20260809025055 |
| 20260809100100_create_schedule_participants | 20260809025108 |
| 20260809100200_attendance_additive_fields | 20260809025120 |
| 20260809100300_assessments_additive_fields | 20260809025124 |
| 20260809100400_certificates_schedule_fk | 20260809025128 |
| 20260809100500_schedules_rls_policies | 20260809025202 |
| 20260809100550_schedules_functions_search_path | 20260809025237 |
| 20260809100600_attendance_delete_trainer_access | 20260809030048 |
| 20260809100700_assessments_schedule_participant_unique | 20260809030429 |
| 20260809101000_tighten_schedules_rls | 20260809032437 |
| 20260811090000_create_participant_skill_results | 20260811102503 |
| 20260811100000_certificate_skill_results_and_issuance_rpc | 20260811135939 |
| 20260813000000_public_upcoming_schedules_rpc | 20260813135706 |
| 20260814020000_align_certificates_participants_courses_rls | 20260813160713 |
| 20260814060000_create_enquiries_and_submit_rpc | 20260813163520 |
| 20260814090000_create_proposal_requests_and_submit_rpc | 20260813172355 |
| 20260814120000_create_sales_crm_v1 | 20260813174258 |
| 20260814150000_create_sales_crm_phase2_opportunities_quotations | 20260814020219 |
| 20260814180000_revoke_anon_execute_sales_phase2_rpcs | 20260814023631 |
| 20260814190000_sales_phase2_state_transition_guards | 20260814023616 (applied twice: also 14023816) |
| 20260814210000_course_schedules_sales_handoff_traceability | 20260814040543 |
| 20260814220000_sales_activity_training_handoff_type | 20260814040622 |
| 20260814230000_add_schedule_exam_date | 20260814063213 |
| 20260814231000_seed_training_schedule_aug_dec_2026 | 20260814063229 |
| 20260814240000_sales_opportunities_company_link | 20260814074535 |
| 20260814250000_sales_tasks | 20260814084338 |
| 20260814260000_tighten_sales_tasks_grants | 20260814085639 |
| 20260814270000_fix_lead_status_on_conversion | 20260814101415 |
| 20260814280000_backfill_lead_status_on_conversion | 20260814102138 |
| 20260815000000_participant_feedback_v1 | 20260814145109 |

**LOCAL-ONLY (6):**
- `20260724120000_provision_admin_content_modules.sql` — objects exist live (applied out-of-band, unrecorded).
- `20260812120000_standard_scaffold_certificate_template.sql` — **untracked**; local only.
- `20260814165048_staff_user_management_phase1.sql` — **untracked**; RBAC/Staff Module Access (out of audit scope for changes).
- `20260815120000_security_remediation_pack1.sql` — **untracked**; applied out-of-band, **no schema_migrations entry**.
- `20260815130000_security_remediation_pack1_revision_a.sql` — **untracked**; applied out-of-band, no entry.
- `20260815140000_proposal_delivery_status_security.sql` — tracked (added by commit `d2a1e7a`); applied out-of-band, no entry.

## 3. REMOTE-ONLY migrations (in production history, no local file)

| Remote version | Name | Notes |
|---|---|---|
| 20260719110806 | create_participants_and_courses | Legacy founding migrations |
| 20260719110821 | add_database_sync_and_indexes | |
| 20260719110838 | backfill_participants_and_courses | |
| 20260719111616 | harden_certificate_verification_security | |
| 20260720023036 | extend_certificates_for_teras_admin | |
| 20260720024127 | replace_broad_client_deny_with_role_policies | Also loose `role_policies.sql` |
| 20260720024249 | restrict_legacy_certificate_rpc | |
| 20260720034355 | add_certificate_import_logs | Also loose `certificate_import_logs.sql` |
| 20260805024446 | fix_courses_cms_fields | **No repo file** (known gap, DATABASE_AUDIT §11) |
| 20260806094646 | fix_participants_module_foundation | |
| 20260806095641 | fix_courses_create_course_name_not_null | |
| 20260806100248 | fix_certificates_module_foundation | |
| 20260806100326 | fix_certificates_add_deleted_at | |
| 20260808005349 | add_log_event_rpc | `app.log_event` |
| 20260808012612 | add_verify_and_log_rpc | `public.verify_and_log` |
| 20260810074847 | teras_photo_bot_initial_hybrid_schema | photos + related |
| 20260810075027 | harden_teras_photo_next_id_search_path | |
| 20260811040654 | photo_ai_analysis | |
| 20260811140352 | fix_certificate_rpc_search_path_extensions | |
| 20260811140749 | fix_duplicate_certificate_rpc_ambiguous_id | |
| 20260813163603 | tighten_enquiries_table_grants | |
| 20260815150000 | **database_baseline_v1** | **981 statements — production consolidation, no repo file** |
| 20260816072507 | feedback_schedule_qr | 16 statements |
| 20260816100000 | sales_won_follow_up_completion | 2 statements (local file EXISTS, MATCH) |

## 4. Objects created by the numbered track that production lacks
`trainers`, `training_schedules`, `venues`, `schedules`, `user_permissions`, `site_settings`, `testimonials`, `automation_runs`, `automation_templates`, `enquiry_notes`, `proposal_notes`, `v_participants_per_month`, `v_schedules_per_month`, `v_certificates_per_month`, `v_attendance_breakdown`, `v_attendance_trend`, `v_assessment_passfail`, `v_top_companies`, `v_top_courses`, `v_trainer_workload`, plus `verify_certificate_by_token`, `gen_*`/`can_*`/`has_*` helper functions.

## 5. Notable cross-track collisions (numbered vs compatibility)
- `public.enquiries`, `public.proposal_requests` created by BOTH `0004` (numbered) and the compatibility track.
- `public.downloads` policy `downloads_public_read` created by numbered `0003` collides with compatibility `20260724120000` (replay: policy already exists).
- `courses`/`participants`/`certificates` exist in both tracks with **different shapes** (numbered has `course_name`/`ic_passport_no`; compatibility adds `course_name`/`ic_passport_no` differently — replay: `column "course_name" does not exist`).
- `course_schedules` is created only by `20260721030829` (compatibility) which itself fails to replay.

## 6. Machine-readable outputs
- Repo migration inventory: `repo-migrations.json` (this directory).
- Production schema: `production-schema.json` (this directory).
- Drift report: `drift-report.json` (this directory).
