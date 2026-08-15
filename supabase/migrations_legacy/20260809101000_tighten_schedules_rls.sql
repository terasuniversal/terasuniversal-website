-- Narrow RLS hardening: close the gap found in the pre-deployment review
-- where write policies on course_schedules/schedule_participants/attendance/
-- assessments admitted the Editor role via app.is_editor()/has_min_role
-- ('trainer'), while the application's own guards (requireRole("admin") for
-- Schedules; canManageAttendance/canManageAssessment = isAdmin||isTrainer,
-- which excludes Editor) never intended to grant Editor write access.
--
-- SELECT policies are untouched -- already correct (trainer and above).
-- No table/column/constraint/index/data changes.

-- app.is_admin_or_trainer(): the app's Attendance/Assessment write rule is
-- "admin-or-above, OR exactly trainer" -- a non-contiguous set that skips
-- Editor in the middle of the role hierarchy, which the existing
-- has_min_role() single-threshold helper cannot express. Mirrors the exact
-- style/security posture of the existing app.* helpers (language sql,
-- security definer, search_path=public) rather than inventing a new pattern.
create or replace function app.is_admin_or_trainer() returns boolean
language sql security definer set search_path = public as $$
  select app.is_active() and (app.is_admin() or app.current_role() = 'trainer'::public.user_role);
$$;

-- course_schedules: writes are admin+ only (matches schedules/actions.ts's
-- requireRole("admin") on every mutation).
drop policy if exists course_schedules_insert on public.course_schedules;
create policy course_schedules_insert on public.course_schedules
  for insert to authenticated with check (app.is_admin());
drop policy if exists course_schedules_update on public.course_schedules;
create policy course_schedules_update on public.course_schedules
  for update to authenticated using (app.is_admin()) with check (app.is_admin());
drop policy if exists course_schedules_delete on public.course_schedules;
create policy course_schedules_delete on public.course_schedules
  for delete to authenticated using (app.is_admin());

-- schedule_participants: same admin+ only rule (assignParticipants /
-- removeParticipant both call requireRole("admin")).
drop policy if exists schedule_participants_insert on public.schedule_participants;
create policy schedule_participants_insert on public.schedule_participants
  for insert to authenticated with check (app.is_admin());
drop policy if exists schedule_participants_update on public.schedule_participants;
create policy schedule_participants_update on public.schedule_participants
  for update to authenticated using (app.is_admin()) with check (app.is_admin());
drop policy if exists schedule_participants_delete on public.schedule_participants;
create policy schedule_participants_delete on public.schedule_participants
  for delete to authenticated using (app.is_admin());

-- attendance: writes are admin+trainer, Editor excluded (matches
-- canManageAttendance = isAdmin(r) || isTrainer(r) exactly).
drop policy if exists attendance_insert on public.attendance;
create policy attendance_insert on public.attendance
  for insert to authenticated with check (app.is_admin_or_trainer());
drop policy if exists attendance_update on public.attendance;
create policy attendance_update on public.attendance
  for update to authenticated using (app.is_admin_or_trainer()) with check (app.is_admin_or_trainer());
drop policy if exists attendance_delete on public.attendance;
create policy attendance_delete on public.attendance
  for delete to authenticated using (app.is_admin_or_trainer());

-- assessments: INSERT/UPDATE are admin+trainer (matches canManageAssessment
-- exactly). DELETE: no deleteAssessment action exists anywhere in the app
-- (verified this session -- grep found zero .delete() calls in the
-- assessment module), so there is no live app rule to match; keeping DELETE
-- at admin+ only is the conservative choice, consistent with every other
-- delete-without-an-explicit-broader-rule in this hardening pass.
drop policy if exists assessments_insert on public.assessments;
create policy assessments_insert on public.assessments
  for insert to authenticated with check (app.is_admin_or_trainer());
drop policy if exists assessments_update on public.assessments;
create policy assessments_update on public.assessments
  for update to authenticated using (app.is_admin_or_trainer()) with check (app.is_admin_or_trainer());
drop policy if exists assessments_delete on public.assessments;
create policy assessments_delete on public.assessments
  for delete to authenticated using (app.is_admin());
