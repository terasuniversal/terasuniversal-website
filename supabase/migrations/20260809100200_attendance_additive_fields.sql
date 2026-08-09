-- Additive: bring the live attendance table (created empty by
-- 20260721030829_production_cms_additive_compatibility.sql) up to what the
-- admin Attendance module needs, without creating a second attendance table.

alter table public.attendance
  add column if not exists attendance_status text,
  add column if not exists check_in_time timestamptz,
  add column if not exists check_out_time timestamptz,
  add column if not exists deleted_at timestamptz;

update public.attendance set attendance_status = case when present then 'present' else 'absent' end
where attendance_status is null;

alter table public.attendance alter column attendance_status set default 'absent';
alter table public.attendance alter column attendance_status set not null;

alter table public.attendance drop constraint if exists attendance_status_check;
alter table public.attendance add constraint attendance_status_check
  check (attendance_status in ('present', 'absent', 'late', 'excused'));

-- present stays as a real, writable column kept in sync by trigger rather
-- than converted to a generated column -- avoids the DROP+ADD Postgres
-- requires for generated-column conversion, per this migration's brief.
create or replace function app.sync_attendance_present() returns trigger
language plpgsql as $$
begin
  new.present := (new.attendance_status = 'present');
  return new;
end;
$$;

drop trigger if exists trg_attendance_sync_present on public.attendance;
create trigger trg_attendance_sync_present
  before insert or update on public.attendance
  for each row execute function app.sync_attendance_present();

-- Correct the uniqueness scope: the live constraint (participant_id,
-- session_date) omits schedule_id, so the same participant could not have
-- independent attendance on the same calendar date across two different
-- schedules. Exact live constraint name verified before dropping:
-- attendance_participant_id_session_date_key.
alter table public.attendance drop constraint if exists attendance_participant_id_session_date_key;
alter table public.attendance add constraint attendance_schedule_participant_session_key
  unique (schedule_id, participant_id, session_date);

create index if not exists attendance_schedule_idx
  on public.attendance (schedule_id) where deleted_at is null;
create index if not exists attendance_participant_idx
  on public.attendance (participant_id) where deleted_at is null;

drop trigger if exists trg_attendance_updated_at on public.attendance;
create trigger trg_attendance_updated_at
  before update on public.attendance
  for each row execute function app.set_updated_at();

drop trigger if exists trg_attendance_audit on public.attendance;
create trigger trg_attendance_audit
  after insert or update or delete on public.attendance
  for each row execute function app.audit_trigger();
