-- Discovered while wiring the Assessment UI: unlike attendance (which is
-- legitimately per session_date, so multiple rows per participant are
-- correct) or schedule_participants (where cancel+re-enroll is a real
-- flow), assessments has always been a single editable record per
-- participant per schedule in the app's own UI/lock model -- there is no
-- multi-attempt/versioning concept anywhere in the code. A plain (not
-- partial) unique constraint lets the roster-driven save action upsert
-- cleanly via onConflict, matching the "edit in place" UX that already
-- exists (locked toggles editability, it doesn't create a new attempt).
alter table public.assessments
  add constraint assessments_schedule_participant_key unique (schedule_id, participant_id);
