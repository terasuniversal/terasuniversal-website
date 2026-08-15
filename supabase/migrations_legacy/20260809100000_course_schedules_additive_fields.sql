-- Additive, idempotent: minimum missing columns on the live canonical
-- course_schedules table (per SCHEDULES_ARCHITECTURE_DECISION.md). Does not
-- create training_schedules. Does not touch trainer_name/capacity/seats_taken/
-- notes/status/is_published -- those already represent the concepts the admin
-- app needs; the application code is adapted to them instead.

create sequence if not exists public.schedule_code_seq;

alter table public.course_schedules
  add column if not exists schedule_code text,
  add column if not exists training_mode text,
  add column if not exists start_time time,
  add column if not exists end_time time;

create or replace function app.gen_schedule_code() returns trigger
language plpgsql as $$
begin
  if new.schedule_code is null or new.schedule_code = '' then
    new.schedule_code := 'SCH-' || lpad(nextval('public.schedule_code_seq')::text, 6, '0');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_course_schedules_code on public.course_schedules;
create trigger trg_course_schedules_code
  before insert on public.course_schedules
  for each row execute function app.gen_schedule_code();

create unique index if not exists course_schedules_schedule_code_key
  on public.course_schedules (schedule_code) where schedule_code is not null;

-- course_schedules currently has no updated_at/audit triggers at all
-- (verified live) -- bring it in line with every other staff-mutable table.
drop trigger if exists trg_course_schedules_updated_at on public.course_schedules;
create trigger trg_course_schedules_updated_at
  before update on public.course_schedules
  for each row execute function app.set_updated_at();

drop trigger if exists trg_course_schedules_audit on public.course_schedules;
create trigger trg_course_schedules_audit
  after insert or update or delete on public.course_schedules
  for each row execute function app.audit_trigger();

create index if not exists course_schedules_status_idx
  on public.course_schedules (status) where deleted_at is null;
