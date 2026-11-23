# CRM RLS hardening: R2 and R3 design (DRAFT, NOT APPLIED)

Read-only evidence: Staging `eokiaehnvzbggmacifcf` and Production `iagzkrzeuawaxvacqprk`, 2026-11-22.

Same rule as M-S4 and R1: the new expression is the previous expression **AND** a module condition. Nothing is widened. super_admin and Role Default staff (`access_control_enabled = false`) keep their access through `public.has_module_access_level`. Only Custom staff change.

## Production impact (who changes)

Production profiles: 1 super_admin (Role Default, no change), **3 active admins with Custom access**, 1 inactive admin, 1 inactive editor. R2 and R3 change behaviour **only for those 3 admins** (and any future Custom staff).

## R2: admin-role-only writes (risk: MEDIUM, already live in Production)

These policies check `app.is_admin()` only, so a Custom admin can write them directly without the module grant.

| Table | Ops (current gate) | Proposed module (edit unless noted) | App writer guard today |
|---|---|---|---|
| participants | I/U/D `is_admin()` | `participants` | participants actions (view only, F1-F5) |
| course_schedules | I/U/D `is_admin()` | `schedules` | schedules actions (`schedules:edit`) |
| schedule_participants | I/U/D `is_admin()` | `schedules` | schedules actions |
| course_commercial_profiles | I/U/D `is_admin()` | `courses` | courses actions (admin path) |
| certificate_templates | ALL `is_admin()` | split; writes `certificate_templates` (admin) | certificates/templates actions |
| legacy_course_map, legacy_import_batches, legacy_participant_staging | I/U/D + SELECT `is_admin()` | `legacy_import` (admin) | legacy-import actions (`legacy_import:edit`) |
| courses, downloads, faqs, gallery_images, media, news_posts | DELETE `is_admin()` | own module (edit) | archive actions |
| assessments, participant_skill_results | DELETE `is_admin()` | `assessment` | assessment actions |
| certificate_import_logs | INSERT `is_admin()` and created_by | `certificates` | legacy certificate import |

Before writing R2:
1. Confirm with the Owner whether **Custom admins in Production rely on any of these writes without the module grant** (read-only: compare the 3 admins' grants with recent `audit_logs` writes on these tables).
2. `participants` is written by trainer flows only through SECURITY DEFINER RPCs. Re-verify that no trainer path writes `participants` directly.
3. Pair R2 with R4 (Server Actions to `requireModuleAccess(m, "edit")`), or users get a raw RLS error instead of a clean "no access" message.

## R3: role-only reads (PII) (risk: HIGH for regression, HIGH for confidentiality)

| Table | Current SELECT | Data | Read by modules (derived from app guards) | Proposed SELECT condition |
|---|---|---|---|---|
| participants | `has_min_role('editor')` | name, IC/passport, contact | participants, attendance*, assessment*, schedules, companies, certificates*, legacy_import, reports, feedback | `has_any_module_access(['participants','schedules','attendance','assessment','certificates','companies','legacy_import','reports','feedback','feedback_responses'],'view')` |
| marketing_contacts / _events | `has_min_role('editor')` | contact PII | marketing_contacts, sales_leads, sales_tasks, marketing | `['marketing_contacts','marketing','sales_leads','sales_tasks']` |
| enquiries, proposal_requests | `has_min_role('editor')` | enquiry PII | sales_leads, sales_opportunities, sales_quotations, sales_tasks, schedules, companies | `['sales','sales_leads','sales_opportunities','sales_quotations','sales_tasks','schedules','companies']` |
| companies | `is_editor()` | client company data | companies, sales_opportunities, sales_quotations, invoices, schedules, sales_tasks, reports | `['companies','sales_opportunities','sales_quotations','sales_tasks','invoices','schedules','reports']` |
| course_commercial_profiles | `has_min_role('editor')` | pricing | sales_quotations, courses | `['sales_quotations','courses']` |
| participant_feedback | `has_min_role('editor')` | respondent feedback | feedback*, schedules, certificates | `['feedback','feedback_responses','feedback_issues','feedback_actions','schedules']` |
| invoice_items | `has_min_role('editor')` (invoices itself is module-gated) | financial lines | invoices, hrdf_claims | `['invoices','hrdf_claims']` |

\* also reached through `requireAttendance` / `requireAssessment` / `requireCertificate` guards, which resolve to the attendance, assessment and certificates modules.

**Keep unchanged in R3:**
- `courses`, `course_schedules`, `schedule_participants`: read by about 15 modules and by trainers (`has_min_role('trainer')`). They hold no personal identity data beyond enrolment links. Trainer access is an assignment model, not a module model, so it needs its own design (R6).
- Public published-content reads (`*_public_read`, `company_profile_public_read`).

R3 must re-derive each read set from the code in its contract test (as M-S4 does), and must be tested per persona before apply. A missing module in a read set breaks a page silently (empty list).

## Recommended order (risk-ranked)

1. **R0-S** (Staging alignment): Staging only; separate decision (see report). Not a prerequisite for R1.
2. **R1** (prepared): content/CMS/marketing/feedback writes. Low risk; Production has 0 active editors.
3. **R2 + R4 together**: admin-only writes plus Server Actions at edit level. Medium risk; affects the 3 Production Custom admins.
4. **R3**: PII reads, one table group per migration (participants first, then marketing_contacts, then enquiries/proposal_requests/companies). High regression risk; needs UI regression per module.
5. **R5**: RPCs `feedback_generate_links`, `feedback_reopen`, `legacy_import_*` and `legacy_merge_*` gain module checks.
6. **R6**: trainer assignment model (attendance, assessments, skill results, certificate/schedule reads). Separate design.

Not in CRM scope: public registration RPCs (`finalize_public_registration_crm`, `verify_public_registration_manual_payment`). They are owned by the website/PKG-1 track (F-1 OFF).

## Persona tests for every wave (Staging, rolled-back transactions, separate approval)

| Persona | Must be allowed | Must be denied |
|---|---|---|
| super_admin | everything | — |
| admin Role Default | everything allowed today | — |
| admin Custom sales-only (Production pattern) | Sales by grant | R1/R2 writes, R3 PII reads without grant |
| editor Custom Sales view-only (UAT 151d54b3) | Sales reads | all R1 writes, participants/marketing_contacts reads |
| editor Custom news:edit | news writes | courses/faq writes |
| editor Role Default | content writes as today | — |
| trainer | attendance/assessment as today | content writes |
| inactive | — | everything |
| anon (public site) | published content | staff tables |
