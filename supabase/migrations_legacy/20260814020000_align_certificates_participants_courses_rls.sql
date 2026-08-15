-- Fixes SECURITY_REPORT.md §2 / CLAUDE.md §6,§8,§12: certificates, participants
-- and courses were the only tables still gated exclusively by admin_users
-- membership (EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid())),
-- a second authorization model entirely independent of profiles.role/is_active.
-- Every other table (course_schedules, attendance, assessments,
-- schedule_participants, cms_*) already uses the app.is_editor()/app.is_admin()/
-- app.has_min_role() helpers. This migration brings these three tables into
-- that same model and retires the admin_users-based policies on them.
--
-- Role thresholds below are taken directly from the app-layer guards already
-- enforced in Server Actions, so RLS now matches what the app already does,
-- not a new policy:
--   courses      — select/insert/update: requireRole("editor") (courses/actions.ts
--                  createCourse/updateCourse/archiveCourse); delete: requireRole("admin")
--                  (softDeleteCourse/restoreCourse).
--   participants — select: MODULE_ACCESS "editor" (view-only for editors, per
--                  participants/actions.ts's own comment "Editors are read-only");
--                  insert/update/delete: requireRole("admin") (every mutating
--                  action in participants/actions.ts).
--   certificates — select: canViewCertificate = isEditor(r) || isTrainer(r), i.e.
--                  has_min_role('trainer'); insert/update/delete: canManageCertificate
--                  = isAdmin(r) (requireCertificate(true), used by every mutating
--                  action in certificates/actions.ts).
--
-- admin_users itself is left untouched (out of scope — a separate decision
-- tracked in SECURITY_REPORT.md §1 about the orphaned /api/admin/login route).
-- Idempotent: safe to re-run.

-- courses ---------------------------------------------------------------
drop policy if exists "Admins can manage courses" on public.courses;
drop policy if exists "Deny anonymous direct course access" on public.courses;
drop policy if exists courses_select on public.courses;
drop policy if exists courses_insert on public.courses;
drop policy if exists courses_update on public.courses;
drop policy if exists courses_delete on public.courses;

create policy courses_select on public.courses
  for select to authenticated
  using (app.has_min_role('editor'::public.user_role));

create policy courses_insert on public.courses
  for insert to authenticated
  with check (app.has_min_role('editor'::public.user_role));

create policy courses_update on public.courses
  for update to authenticated
  using (app.has_min_role('editor'::public.user_role))
  with check (app.has_min_role('editor'::public.user_role));

create policy courses_delete on public.courses
  for delete to authenticated
  using (app.is_admin());

-- participants ------------------------------------------------------------
drop policy if exists "Admins can manage participants" on public.participants;
drop policy if exists "Deny anonymous direct participant access" on public.participants;
drop policy if exists participants_select on public.participants;
drop policy if exists participants_insert on public.participants;
drop policy if exists participants_update on public.participants;
drop policy if exists participants_delete on public.participants;

create policy participants_select on public.participants
  for select to authenticated
  using (app.has_min_role('editor'::public.user_role));

create policy participants_insert on public.participants
  for insert to authenticated
  with check (app.is_admin());

create policy participants_update on public.participants
  for update to authenticated
  using (app.is_admin())
  with check (app.is_admin());

create policy participants_delete on public.participants
  for delete to authenticated
  using (app.is_admin());

-- certificates --------------------------------------------------------------
drop policy if exists "Admins can delete certificates" on public.certificates;
drop policy if exists "Admins can insert certificates" on public.certificates;
drop policy if exists "Admins can read all certificates" on public.certificates;
drop policy if exists "Admins can update certificates" on public.certificates;
drop policy if exists "Deny anonymous direct certificate access" on public.certificates;
drop policy if exists certificates_select on public.certificates;
drop policy if exists certificates_insert on public.certificates;
drop policy if exists certificates_update on public.certificates;
drop policy if exists certificates_delete on public.certificates;

create policy certificates_select on public.certificates
  for select to authenticated
  using (app.has_min_role('trainer'::public.user_role));

create policy certificates_insert on public.certificates
  for insert to authenticated
  with check (app.is_admin());

create policy certificates_update on public.certificates
  for update to authenticated
  using (app.is_admin())
  with check (app.is_admin());

create policy certificates_delete on public.certificates
  for delete to authenticated
  using (app.is_admin());
