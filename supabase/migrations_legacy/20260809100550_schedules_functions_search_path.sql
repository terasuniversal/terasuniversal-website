-- Closes a Supabase security advisory (function_search_path_mutable, WARN)
-- raised against the three functions added in the two preceding migrations.
-- Same fix already applied to every other pre-existing app.* function in
-- this schema; these three were the only ones missing it. No behavior
-- change -- pins search_path so the functions can't be tricked by a
-- session-local search_path override.
alter function app.gen_schedule_code() set search_path = public, app;
alter function app.sync_schedule_seats() set search_path = public, app;
alter function app.sync_attendance_present() set search_path = public, app;
