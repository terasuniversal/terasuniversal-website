# ASSESSOR_MANAGEMENT_DECISION.md

Assessor Management + Schedule Assignment — Phase 1 design decisions, grounded in
this repo's actual live state (verified this session, 2026-08-17).

## 1. Audit findings (source of truth)

- **Trainers module** (`app/admin/(protected)/trainers/**`): full CRUD structure
  (list / new / [id] / [id]/edit, actions.ts, TrainerForm.tsx). It writes to the
  `trainers` table, which is **not live** in the production database (confirmed
  by `DATABASE_AUDIT.md` and the fact that only the numbered-track migration
  `0018` creates it — never applied). The module's file shape is the reference
  for Assessors, but the Assessor module targets the real tables created by
  `20260817002000`.
- **Schedules**: live `course_schedules` carries `trainer_name` as free text
  (no trainer_id FK). Attendees go through the live `schedule_participants`
  junction. `schedules/actions.ts` guards every mutation with
  `requireRole("admin")` + `requireModuleAccess("schedules")`.
- **Assessment**: `assessments.assessor_id` is **per-participant attribution** —
  it records which staff member marked each participant result
  (`assessment/actions.ts` sets `assessor_id: profile.id`). It is NOT a schedule
  assessor assignment and is deliberately left untouched in Phase 1.
- **Attendance print V2**: already merged to `main` (landscape session sheet).
  Its `ASSESSOR VERIFICATION` block has a blank name line — Phase 1 pre-fills it
  from the assigned primary assessor; signature/date stay manual.
- **RBAC**: two layers — `lib/auth/rbac.ts` `MODULE_ACCESS` (route gate) and the
  DB `staff_module_catalog` + `public.has_module_access_level()` +
  `requireModuleAccess()` (Staff User Management Phase 1). A new module key
  must be added in BOTH places or the layers disagree.
- **Audit**: `audit_logs` + `audit_action` enum + `public.log_event` RPC.
  Vocabulary-specific events are recorded from server actions via `log_event`;
  no generic trigger is attached to the new tables (avoids double-logging).
- **Migration chain**: latest is `20260817001000_staff_first_login_password_change`.
  New migration uses `20260817002000` (forward-only, newer).

## 2. Schema

- `public.assessors` — master data (full_name required; identity/contact/org/
  qualification/notes optional; `is_active` boolean replaces soft-delete).
  Partial unique indexes on `email` and `ic_passport_no` **where is_active AND
  not null** — blocks duplicate ACTIVE assessors without over-blocking NULLs or
  blocking reactivation of a deactivated record.
- `public.schedule_assessors` — junction. `(schedule_id, assessor_id)` unique
  blocks duplicate assignment; partial unique `(schedule_id) WHERE is_primary`
  enforces at-most-one primary while the table shape supports multi-assessor
  later. No `assessor_name` text column on `course_schedules` — assignment is
  relational by design.

## 3. RLS / authorization

- Reads (`SELECT`): any active staff (`app.is_active()`) — required so the
  trainer/editor-facing Attendance print, Assessment and Schedule detail pages
  can display the assigned assessor.
- Writes: **module-aware** (PR #33 security review fix). RLS write policies are
  gated by app-schema SECURITY DEFINER helpers that are not PostgREST-exposed:
  - `app.can_manage_assessors()` = `has_module_access_level('assessors','admin')`
  - `app.can_manage_schedule_assessors()` =
    `has_module_access_level('schedules','admin') AND has_module_access('assessors')`
  - super_admin always passes; legacy admin (access_control_enabled=false)
    passes via the module catalog role floor; an explicit-access admin must
    hold the matching module permission; editor/trainer/sales are denied. This
    closes the direct-DB bypass where an explicit admin with no Assessors
    module could previously write through the authenticated Supabase client.
- **No hard delete** on `assessors`: the DELETE policy is dropped and DELETE is
  revoked from authenticated; deactivate (`is_active=false`) is the only
  lifecycle change. `schedule_assessors` DELETE remains (unassignment) and is
  module-gated.
- No anon exposure; grants to `authenticated` only.

## 4. Atomic assignment

Assign / replace / remove run inside the single `public.set_schedule_assessor`
RPC (SECURITY DEFINER, one DB transaction): the old primary assignment is
preserved if the new one fails, and the audit row commits with the change. The
RPC raises on authorization/schedule/assessor validation failures instead of
swallowing them; server actions map those to visible messages and never report
silent success. Schedule creation/update stays committed on assignment failure
and the error is surfaced (create → recovery banner on the schedule detail
page; update → error message on the edit form).

## 4. Audit trail

Server actions record: `assessor_created`, `assessor_updated`,
`assessor_activated`, `assessor_deactivated`, `assessor_assigned`,
`assessor_unassigned`, `assessor_reassigned` via `public.log_event`, with
`assessor_id`, `schedule_id` (where relevant) and actor in metadata. No
sensitive fields are logged.

## 5. Phase 2 recommendation (NOT implemented here)

When participant-level assessments are created for a schedule, default the
per-participant `assessments.assessor_id` to the schedule's assigned primary
assessor — i.e. `schedule_assessors.assessor_id` (is_primary) becomes the
suggested `assessments.assessor_id` at row creation time, while remaining
overridable per participant. This is a safe, additive change ONLY after the
assessment write path is normalized to the live `course_schedules` lineage; it
is deliberately excluded from Phase 1 so participant assessment attribution
stays untouched.
