-- Replace the ALL-scoped-to-editor policies on course_schedules / attendance
-- / assessments (verified live: every command including SELECT required
-- app.is_editor(), which excludes the Trainer role entirely) with
-- command-split policies: SELECT open to any active staff member (trainer
-- and above), write scoped per module to match this app's existing
-- app-layer guards (requireAttendance/requireAssessment admit Trainer
-- write; Schedules CRUD itself stays editor+). schedule_participants gets
-- the same read/write split as course_schedules.
--
-- Note: Postgres CREATE POLICY accepts exactly one command per policy (no
-- "for insert, update, delete" comma list) -- each command below is its own
-- policy statement.

drop policy if exists course_schedules_staff_all on public.course_schedules;
create policy course_schedules_select on public.course_schedules
  for select to authenticated using (app.has_min_role('trainer'::public.user_role));
create policy course_schedules_insert on public.course_schedules
  for insert to authenticated with check (app.is_editor());
create policy course_schedules_update on public.course_schedules
  for update to authenticated using (app.is_editor()) with check (app.is_editor());
create policy course_schedules_delete on public.course_schedules
  for delete to authenticated using (app.is_editor());

alter table public.schedule_participants enable row level security;
grant select, insert, update, delete on public.schedule_participants to authenticated;
revoke all on public.schedule_participants from anon;

create policy schedule_participants_select on public.schedule_participants
  for select to authenticated using (app.has_min_role('trainer'::public.user_role));
create policy schedule_participants_insert on public.schedule_participants
  for insert to authenticated with check (app.is_editor());
create policy schedule_participants_update on public.schedule_participants
  for update to authenticated using (app.is_editor()) with check (app.is_editor());
create policy schedule_participants_delete on public.schedule_participants
  for delete to authenticated using (app.is_editor());

drop policy if exists attendance_staff_all on public.attendance;
create policy attendance_select on public.attendance
  for select to authenticated using (app.has_min_role('trainer'::public.user_role));
create policy attendance_insert on public.attendance
  for insert to authenticated with check (app.has_min_role('trainer'::public.user_role));
create policy attendance_update on public.attendance
  for update to authenticated using (app.has_min_role('trainer'::public.user_role)) with check (app.has_min_role('trainer'::public.user_role));
create policy attendance_delete on public.attendance
  for delete to authenticated using (app.is_editor());

drop policy if exists assessments_staff_all on public.assessments;
create policy assessments_select on public.assessments
  for select to authenticated using (app.has_min_role('trainer'::public.user_role));
create policy assessments_insert on public.assessments
  for insert to authenticated with check (app.has_min_role('trainer'::public.user_role));
create policy assessments_update on public.assessments
  for update to authenticated using (app.has_min_role('trainer'::public.user_role)) with check (app.has_min_role('trainer'::public.user_role));
create policy assessments_delete on public.assessments
  for delete to authenticated using (app.is_editor());
