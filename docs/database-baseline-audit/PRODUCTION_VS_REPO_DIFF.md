# PRODUCTION vs REPO DIFF

Read-only comparison: current production schema/catalog vs the repository's migration intent.
Audit date: 2026-08-16. Production project `iagzkrzeuawaxvacqprk`.

## Classification legend
1. **PRODUCTION-ONLY** — exists in production, missing from tracked migrations.
2. **REPO-ONLY** — created by a tracked migration, absent from production.
3. **DEFINITION DRIFT** — same object, different definition.
4. **MIGRATION VERSION DRIFT** — same logical migration, different timestamp/version.
5. **OUT-OF-BAND** — production object created via non-migration SQL.
6. **SECURITY DRIFT** — RLS/grant/SECURITY DEFINER/search_path differs.
7. **DATA-DEPENDENT** — cannot be recreated safely without existing data.
8. **BENIGN / EXPECTED** — intentional, documented.

---

## Migration-history reconciliation (remote `schema_migrations` = 67 entries)

| Class | Count | Detail |
|---|---|---|
| MATCH (same version both sides) | 6 | `20260809064947`, `20260809064958`, `20260809065024`, `20260809072601`, `20260809072652`, `20260816100000` |
| MIGRATION VERSION DRIFT | 37 | Same logical migration; different timestamp (see `REPOSITORY_MIGRATION_INVENTORY.md` §2) |
| LOCAL-ONLY files (no remote entry) | 6 | incl. security pack 1/1a + proposal-delivery (applied out-of-band, unrecorded) |
| REMOTE-ONLY migrations (no local file) | 23 | incl. `database_baseline_v1` (981 stmts), photo bot, feedback QR, legacy founding |
| Remote entries total | 67 | Frozen max version `20260816100000` |

**Example (OUT-OF-BAND + VERSION DRIFT):** `20260724120000_provision_admin_content_modules.sql` has no remote entry, yet every table it defines (`media`, `media_folders`, `downloads`, `news_*`, `gallery_*`, `faq_*`, `company_profile`) exists in production — it was applied via the dashboard SQL editor, not tracked.

## Table-level diff

### PRODUCTION-ONLY tables (12) — no tracked migration creates them
| Table | Source in production | Risk | Severity |
|---|---|---|---|
| `admin_users` | Legacy loose `certificates.sql`/dashboard SQL | Referenced by 3 tracked migrations but never created in-repo → replay break | HIGH |
| `certificate_import_logs` | Loose `certificate_import_logs.sql` + remote `20260820034355` | Repo cannot recreate | MEDIUM |
| `photos`, `photo_categories`, `photo_events`, `photo_usages`, `photo_usage_types`, `photo_activity_log`, `photo_id_sequences`, `photo_ai_analysis` | Remote-only migrations (photo bot) | Repo cannot recreate; no local files | HIGH |
| `feedback_schedule_links`, `feedback_schedule_lookup_attempts` | Remote-only `feedback_schedule_qr` | Repo cannot recreate | HIGH |

(Views `v_certificate_eligibility` and `v_sales_lead_inbox` are also production-only *as views* from the repo's perspective — both are created by tracked migrations, so they are NOT counted here; see views.)

### REPO-ONLY tables (13) — created by tracked migrations, absent from production
`venues`, `schedules`, `training_schedules`, `schedule_participants`(numbered version), `trainers`, `companies`(numbered version), `user_permissions`, `site_settings`, `testimonials`, `automation_runs`, `automation_templates`, `enquiry_notes`, `proposal_notes`, `staff_module_access`, `staff_module_catalog`.
→ All come from the **numbered track (0001–0021)** and the untracked **staff_user_management_phase1**. These are the clean-room design never applied to production. **BENIGN / EXPECTED** only if the numbered track is declared non-executable; otherwise HIGH (confusing dual schema).

### REPO-ONLY views (10)
`v_participants_per_month`, `v_schedules_per_month`, `v_certificates_per_month`, `v_attendance_breakdown`, `v_attendance_trend`, `v_assessment_passfail`, `v_top_companies`, `v_top_courses`, `v_trainer_workload` (numbered track) — not in production. **BENIGN/EXPECTED** if numbered track archived.

## Function/RPC diff

### PRODUCTION-ONLY functions (application-owned; pg_trgm extension helpers excluded)
| Function | Notes |
|---|---|
| `public.verify_certificate_by_value(text)` | Legacy public verification RPC (remotely applied `restrict_legacy_certificate_rpc`); anon restricted |
| `public.verify_and_log(text,text,text,text)` | Remote-only `add_verify_and_log_rpc` |
| `app.log_event(...)` / `public.log_event(...)` | Remote-only `add_log_event_rpc`; audit logging |
| `public.certificates_before_insert()` | Trigger function for certificate numbering |
| `public.sync_participant_last4()` | Trigger function (participants.identity_last4) |
| `public.teras_photo_next_id(...)` | Photo bot; PUBLIC-executable |
| `public.resolve_schedule_feedback_participant(...)` | Feedback QR |
| `public.get_public_upcoming_schedules(...)` | Remote-only RPC |
| `public.log_event_as_service(...)` | Service logging helper |

### REPO-ONLY functions (21)
`gen_certificate_number`, `gen_verification_code`, `gen_schedule_id`, `gen_assessment_id`, `gen_attendance_id`, `gen_trainer_id`, `can_manage_assessment`, `can_manage_attendance`, `can_view_assessment`, `can_view_attendance`, `create_assessment_on_attendance`, `create_attendance_on_assign`, `has_module_access`, `has_permission`, `protect_last_super_admin`, `verify_certificate_by_token`, `automation_setting`, `global_search`, `slugify`, `stamp_automation_actor`, `time`.
→ All from the numbered track. **BENIGN/EXPECTED** if numbered track archived.

## View diff
- Production views (2): `v_certificate_eligibility`, `v_sales_lead_inbox` — both `security_invoker=true`, both created by tracked migrations. Present in repo. **MATCH.**
- Repo-only views (10): listed above (numbered track).

## Security drift (see SECURITY_FINDINGS.md for details)
- `mark_proposal_delivery_status` — SD, `search_path=pg_catalog, public`, EXECUTE only `service_role`/`postgres`. Consistent between prod and `20260815140000`. **MATCH.**
- `submit_proposal_request` / `submit_public_enquiry` — SD, anon+authenticated EXECUTE. **MATCH.**
- `app.has_min_role`/`is_admin`/`is_editor` — SD, authenticated EXECUTE (needed by RLS policies). **EXPECTED.**
- Admin sales/certificate RPCs (`convert_lead_to_opportunity`, `accept_quotation`, `issue_certificate_with_skill_snapshot`, ...) — SD, authenticated EXECUTE, internal `is_admin` guard. **SECURITY DRIFT (mitigated):** bypass RLS by design; relies on in-body role checks. Repo migrations (`20260814190000` etc.) reflect the same design. Flag for review, not a live hole.
- `feedback_*` RPCs — SD with `search_path=""` (empty = safe), anon+authenticated EXECUTE. **SECURITY DRIFT (positive):** empty search_path is the recommended pattern; repo migration `20260815000000` matches.

## Data-dependent objects
`certificates_before_insert`, `sync_participant_last4`, sequence state (`audit_logs_id_seq`=1282, `participant_id_seq`=168, `certificate_number_seq`=31, `schedule_code_seq`=20, `sales_opportunity_seq`=12, `sales_quotation_seq`=10) — sequence `last_value` and table data are **data-dependent**: a fresh rebuild can recreate DDL but not current `last_value`/row state. Data migration must be idempotent and guarded.

## Severity summary
| Class | HIGH | MEDIUM | LOW |
|---|---|---|---|
| Missing-dependency objects (`admin_users`, photo, feedback) | 12 tables + ~9 fns | – | – |
| Dual-schema (numbered vs compatibility) | 1 (cross-track) | – | 21 numbered files marked not-applied |
| Version drift | – | 37 | – |
| Unrecorded out-of-band migrations | 1 (`database_baseline_v1`), 4 security-pack | – | – |
| SD-bypasses-RLS RPCs | – | 5 | – |
