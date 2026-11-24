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

### Post-baseline VERSION-DRIFT (MCP `apply_migration` records the apply time; recorded 2026-11-23)
Applied with `apply_migration`, so each ledger records the platform-assigned apply time, not the filename version.
Per the migration policy the applied files are never edited and `schema_migrations` is never rewritten; the mapping lives here.
The stored statement md5 equals the md5 of the file content (without the final newline) in every listed environment.

| Local file | Staging (eokiaehn) | Production (iagzkrzeu) | Statement md5 |
|---|---|---|---|
| 20261123100000_fpay1_p2_cancel_finalize_guards | 20261123100405 | 20261123111548 | `7b0f86ad1cf00c249ad1515e83c2c4e8` |
| 20261128120000_marketing_contact_number_execute_grant | 20261123023212 | 20261123131951 (applied after the 2026-11-23 record; see 2a) | `34842b55152f0e9a12d4f80952692d86` |

### 2a. Sales & Finance VERSION-DRIFT reconciliation (CLOSEOUT-01, re-verified 2026-11-24)
Local draft prepared under OWNER-CRM-CLOSEOUT-01-20261124. Evidence: read-only `SELECT version, name, md5(array_to_string(statements, E'\n'))`
from `supabase_migrations.schema_migrations` on Production `iagzkrzeuawaxvacqprk` (171 rows, last `20261124015814`) and
Staging `eokiaehnvzbggmacifcf` (73 rows, last `20261123145928`), compared against `supabase/migrations/*.sql` at `main` `4a37c51d`.
No migration file was renamed, rewritten, deleted or re-applied, and no remote ledger was edited.

"Matches file md5" is checked two ways because `apply_migration` sometimes stores the file without its final newline:
**exact** = md5 of the whole file; **trimmed** = md5 without trailing newline(s).

| Workstream | Local file | Staging version | Production version | Ledger statement md5 (Prod vs Staging) | Matches file md5 | Status |
|---|---|---|---|---|---|---|
| G1 | 20261129120000_manual_payment_idempotency_reference | 20261123145928 | 20261124015814 | `15b36920…` (same) | trimmed | VERSION-DRIFT, content identical |
| F-PAY-1 P2 | 20261123100000_fpay1_p2_cancel_finalize_guards | 20261123100405 | 20261123111548 | `7b0f86ad…` (same) | exact | VERSION-DRIFT, content identical |
| MC-1 | 20261128120000_marketing_contact_number_execute_grant | 20261123023212 | 20261123131951 | `34842b55…` (same) | trimmed | VERSION-DRIFT, content identical |
| A1 | 20261127120000_anon_content_staff_select_to_authenticated | 20261123015709 | 20261123130437 | `88105cf9…` (same) | trimmed | VERSION-DRIFT, content identical |
| R1 (content writes) | 20261126120000_crm_content_write_module_authorization | 20261123010449 | 20261123122337 | `141bc8e2…` (same) | trimmed | VERSION-DRIFT, content identical |
| MS7 finance/HRDF RPC | 20261123090000_finance_hrdf_rpc_module_authorization | not in ledger (Staging has `20261123005755 r0s_staging_finance_hrdf_rpc_module_authorization`, md5 `dca13228…`) | 20261123090000 | Prod `dcb024e4…` = file exact; Staging row differs | Prod exact | MATCH (Prod); Staging used a differently named, different-content equivalent: NOT VERIFIED as equivalent |
| Sales/Finance RLS and RPC hardening (9 files 20261121120000 to 20261123080000) | sales_crm_module_rls_hardening, sales_finance_rpc_module_authorization, invoices_update_module_authorization, crm_table_privilege_hardening, finance_read_module_authorization, companies_write_module_authorization, audit_logs_read_module_authorization, quotation_invoice_summary_rpc, revoke_client_execute_unused_finance_rpcs | same versions | same versions | same | exact | MATCH |
| sales_activity insert authz | 20261119180000_sales_activity_insert_authorization | 20261119180000 | 20261119180000 | `06690081…` (same) | exact | MATCH |
| Lead contact edit (5 files) | 20261119032250 to 20261119032421 | 20261108130040 to 20261108142533 | 20261119032250 to 20261119032421 | differs Prod vs Staging | Prod only | MATCH (Prod); VERSION-DRIFT and content differs (Staging) |
| Registration RPC revoke | no repo file `revoke_public_execute_registration_rpcs` | 20261121110735 | 20261121112628 | same `a665b62b…` | n/a | REMOTE-ONLY in both; VERSION-DRIFT between them |
| Receipts v1 | 20260919230000_receipts_v1 (+ `20260919233000_..._staging_compatibility_repair`) | 20260919230000 | 20260919230000 | differs (Prod `54999d4f…`, Staging `e7e3d41a…`) | neither | Version MATCH; content divergent between environments and file: NOT VERIFIED which text was applied (functional equivalence shown only by G3 UAT) |
| Quotation training snapshot | no repo file with this name | 20260917160558 | 20260917160558 | differs | n/a | REMOTE-ONLY; content divergent |
| Invoice v1, ToyyibPay 2a to 2e | 20260824160000 to 20260826100000 | not in Staging ledger (Staging ledger starts 20260911) | 20260824101552 to 20260826111303 | n/a | not checked | VERSION-DRIFT (Prod), pre-existing |

Staging-only ledger rows relevant to Finance (not in Production): `payment_receiving_accounts`, ten `public_registration_*` rows (2026-11-22/23),
`ebook_lead_capture` and `ebook_private_bucket` (W9, HOLD), and the certificate C5b1/lifecycle series (creates role `certificate_lifecycle_executor`,
which explains the `has_module_access_level` ACL difference; see CLOSEOUT-01 security review section 6).

Full machine comparison by name (139 dated repo files): MATCH in both ledgers 27; MATCH Prod / absent Staging 23; VERSION-DRIFT in both 9;
MATCH Prod / VERSION-DRIFT Staging 5; VERSION-DRIFT Prod / absent Staging 64; absent from both 11.
Table: `crm-prod-readiness-prep/closeout-01/evidence/ledgers/drift_table.md`.

### 2b. DRIFT-2: `receipts_v1` content comparison (CLOSEOUT-02, re-verified 2026-11-24)
Read-only. Ledgers re-checked unchanged since 2a: Production 171 rows (last `20261124015814`, name-list md5 `544db0bd…`),
Staging 73 rows (last `20261123145928`, name-list md5 `8dfa2e6a…`). Repository files at `main` `a71d679b` (no migration change since `4a37c51d`).

Normalisation used for every source: remove `--` comments, remove all whitespace, remove `;`, concatenate statements in order, md5.

| Migration | Source | Statements | Raw text md5 / file sha256 | Normalised md5 |
|---|---|---|---|---|
| `20260919230000 receipts_v1` | Production ledger | 19 | `54999d4f…` | `49da7b4e27679c5c26114f08bc464a2a` |
| | Staging ledger | 19 | `e7e3d41a…` | `49da7b4e27679c5c26114f08bc464a2a` |
| | Repository file | — | sha256 `bb3ea73ac49b99c4…8f31` (12,941 chars) | `49da7b4e27679c5c26114f08bc464a2a` |
| `20260919233000 receipts_v1_staging_compatibility_repair` | Production ledger | 7 | `6ac9812a…` | `832f06c99ad5a28b228884e2a5c99e8f` |
| | Staging ledger | 7 | `8ebf65b3…` | `832f06c99ad5a28b228884e2a5c99e8f` |
| | Repository file | — | sha256 `7f3835a13ddb1eb7…900f` (3,274 chars) | `832f06c99ad5a28b228884e2a5c99e8f` |

Per statement: 11 of 19 (`receipts_v1`) and 3 of 7 (repair) are byte-identical between environments; the others differ only in
comments/whitespace (all 26 identical after normalisation).

Live objects compared (identical in both environments): `public.receipts` columns, 11 constraints (incl. unique `receipt_no`,
unique `invoice_payment_id`), indexes, trigger `trg_void_receipt_on_refunded_payment`, functions `generate_receipt_for_payment`
(EXECUTE `authenticated`), `generate_receipt_for_payment_unguarded`, `next_receipt_number`, `void_receipt_on_refunded_payment`
(EXECUTE `postgres` only), RLS policies, table grants (`authenticated: SELECT` only). Sequence `sales_receipt_seq` exists in both
(values differ: data only).

**Classification:** formatting-only historical variation of the text recorded by `apply_migration`. No active functional,
security or financial-integrity discrepancy. **No action** beyond documentation. Recommendation: compare future migrations by
normalised md5, not raw md5. Full report: `crm-prod-readiness-prep/closeout-02/DRIFT-2_RECEIPTS_V1_INVESTIGATION.md`.

### 2c. Remaining unverified discrepancies (carried forward)
- `finance_hrdf_rpc_module_authorization`: Production applied the repository file (exact md5); Staging applied a differently named,
  different-content migration `20261123005755 r0s_staging_finance_hrdf_rpc_module_authorization`. Functional equivalence of the
  resulting HRDF RPC definitions/ACLs between environments is **NOT VERIFIED** (candidate for the same normalised/object comparison).
- Lead contact edit (5 files): Staging versions `20261108…` with statement md5 different from Production; **NOT VERIFIED** whether
  only formatting differs.
- `quotation_training_snapshot_v1` (`20260917160558`): remote-only in both ledgers with different statement md5; **NOT VERIFIED**.
- Staging-only rows (`payment_receiving_accounts`, ten `public_registration_*`, eBook W9-era `ebook_lead_capture`/`ebook_private_bucket`,
  certificate C5b1 series) are expected environment differences, not drift of a shared migration.

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
