-- =====================================================================
-- TERAS UNIVERSAL Admin CMS
-- Migration 0014 — Attendance Management
-- =====================================================================
-- Records participant attendance per training schedule. Replaces the
-- simple attendance table from 0011 with a richer, training_schedules-
-- aligned model, and adds Trainer write access (Editor stays read-only).
--
-- One attendance row per (schedule, participant). Rows are created
-- automatically when a participant is assigned to a schedule.
-- Idempotent. Builds on training_schedules + schedule_participants (0013).
-- =====================================================================

-- --- Enums -----------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'attendance_status') then
    create type attendance_status as enum ('pending', 'present', 'absent', 'late', 'medical_leave', 'excused');
  end if;
  if not exists (select 1 from pg_type where typname = 'attendance_method') then
    create type attendance_method as enum ('manual', 'qr', 'mobile');  -- qr/mobile are placeholders
  end if;
end$$;

-- --- Replace the old (0011) attendance table -------------------------
drop table if exists public.attendance cascade;

create table public.attendance (
  id               uuid primary key default gen_random_uuid(),
  attendance_id    text unique,                          -- auto ATT-000001
  schedule_id      uuid not null references public.training_schedules (id) on delete cascade,
  participant_id   uuid not null references public.participants (id) on delete cascade,
  attendance_status attendance_status not null default 'pending',
  check_in_time    timestamptz,
  check_out_time   timestamptz,
  attendance_method attendance_method not null default 'manual',
  remarks          text,
  recorded_by      uuid references public.profiles (id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  constraint uq_attendance_pair unique (schedule_id, participant_id)
);
create index if not exists idx_attendance_schedule on public.attendance (schedule_id) where deleted_at is null;
create index if not exists idx_attendance_participant on public.attendance (participant_id);
create index if not exists idx_attendance_status on public.attendance (attendance_status);

-- --- Auto attendance_id ----------------------------------------------
create sequence if not exists public.attendance_id_seq;
create or replace function app.gen_attendance_id()
returns trigger language plpgsql as $$
begin
  if new.attendance_id is null or new.attendance_id = '' then
    new.attendance_id := 'ATT-' || lpad(nextval('public.attendance_id_seq')::text, 6, '0');
  end if;
  return new;
end;
$$;
drop trigger if exists trg_attendance_id on public.attendance;
create trigger trg_attendance_id before insert on public.attendance
  for each row execute function app.gen_attendance_id();

-- --- Auto-create an attendance row on participant assignment ---------
create or replace function app.create_attendance_on_assign()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.attendance (schedule_id, participant_id, attendance_status, attendance_method)
  values (new.schedule_id, new.participant_id, 'pending', 'manual')
  on conflict (schedule_id, participant_id) do nothing;
  return new;
end;
$$;
drop trigger if exists trg_sp_create_attendance on public.schedule_participants;
create trigger trg_sp_create_attendance
  after insert on public.schedule_participants
  for each row execute function app.create_attendance_on_assign();

-- --- updated_at + audit ----------------------------------------------
drop trigger if exists trg_attendance_updated_at on public.attendance;
create trigger trg_attendance_updated_at before update on public.attendance
  for each row execute function app.set_updated_at();
drop trigger if exists trg_attendance_audit on public.attendance;
create trigger trg_attendance_audit after insert or update or delete on public.attendance
  for each row execute function app.audit_trigger();

-- --- Access helpers (Trainer can manage attendance) ------------------
create or replace function app.can_view_attendance()
returns boolean language sql stable security definer set search_path = public
as $$ select app.is_active() and (app.has_min_role('editor') or app.current_role() = 'trainer'); $$;

create or replace function app.can_manage_attendance()
returns boolean language sql stable security definer set search_path = public
as $$ select app.is_active() and (app.has_min_role('admin') or app.current_role() = 'trainer'); $$;

-- --- RLS -------------------------------------------------------------
alter table public.attendance enable row level security;
alter table public.attendance force row level security;

create policy attendance_view on public.attendance
  for select using (app.can_view_attendance());
create policy attendance_manage_insert on public.attendance
  for insert with check (app.can_manage_attendance());
create policy attendance_manage_update on public.attendance
  for update using (app.can_manage_attendance()) with check (app.can_manage_attendance());
create policy attendance_admin_delete on public.attendance
  for delete using (app.is_admin());

-- --- Grants ----------------------------------------------------------
grant select, insert, update, delete on public.attendance to authenticated;
grant usage, select on sequence public.attendance_id_seq to authenticated;

comment on table public.attendance is 'Participant attendance per training schedule. One row per (schedule, participant), auto-created on assignment. Trainer + Admin may manage; Editor read-only.';
