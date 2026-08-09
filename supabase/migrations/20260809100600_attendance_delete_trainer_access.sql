-- Discovered while wiring the Attendance UI: "reset" (undo a mis-entered
-- attendance row for a session date) is a normal part of the Trainer's own
-- attendance-taking workflow, not an elevated action -- a trainer can
-- already destroy a row's semantic content via UPDATE, so restricting
-- DELETE to editor+ only would lock out a legitimate Trainer flow (Phase 7
-- explicitly warns against this). Widening to match attendance_insert/update.
drop policy if exists attendance_delete on public.attendance;
create policy attendance_delete on public.attendance
  for delete to authenticated using (app.has_min_role('trainer'::public.user_role));
