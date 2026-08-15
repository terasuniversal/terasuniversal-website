-- =====================================================================
-- TERAS UNIVERSAL Admin CMS
-- Migration 0013 — Training Schedule Management
-- =====================================================================
-- Canonical scheduling table for the Training Schedule module, plus a
-- many-to-many participant assignment table.
--
--   training_schedules   — one training session
--   schedule_participants — assignment (unique per (schedule, participant)
--                           → prevents duplicate registration)
--
-- A trigger keeps registered_participants in sync and auto-flips status
-- between 'open' and 'full'. RLS: Editor read-only; Admin write.
-- Idempotent. Builds on courses (0003) + participants (0004/0012).
-- =====================================================================

-- --- Status enum -----------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'training_status') then
    create type training_status as enum ('draft', 'open', 'full', 'completed', 'cancelled', 'archived');
  end if;
end$$;

-- --- training_schedules ----------------------------------------------
create table if not exists public.training_schedules (
  id                     uuid primary key default gen_random_uuid(),
  schedule_id            text unique,                 -- auto TS-000001
  course_id              uuid references public.courses (id) on delete set null,
  course_name            text,                        -- snapshot (survives course rename/delete)
  trainer                text,
  venue                  text,
  training_mode          text,                        -- Public / In-house / Onsite / Online / Hybrid
  start_date             date not null,
  end_date               date not null,
  start_time             time,
  end_time               time,
  max_participants       integer not null default 0,
  registered_participants integer not null default 0,
  status                 training_status not null default 'draft',
  remarks                text,
  created_by             uuid references public.profiles (id),
  updated_by             uuid references public.profiles (id),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  deleted_at             timestamptz,
  constraint chk_ts_dates check (end_date >= start_date),
  constraint chk_ts_capacity check (max_participants >= 0)
);

-- seats remaining (never negative), computed.
alter table public.training_schedules
  add column if not exists seats_remaining integer
  generated always as (greatest(max_participants - registered_participants, 0)) stored;

create index if not exists idx_ts_status on public.training_schedules (status) where deleted_at is null;
create index if not exists idx_ts_start on public.training_schedules (start_date) where deleted_at is null;
create index if not exists idx_ts_course on public.training_schedules (course_id);
create index if not exists idx_ts_trainer on public.training_schedules (trainer);
create index if not exists idx_ts_search on public.training_schedules using gin (
  to_tsvector('simple',
    coalesce(schedule_id,'') || ' ' || coalesce(course_name,'') || ' ' ||
    coalesce(trainer,'') || ' ' || coalesce(venue,''))
);

-- --- Auto schedule_id (race-safe) ------------------------------------
create sequence if not exists public.training_schedule_id_seq;

create or replace function app.gen_schedule_id()
returns trigger language plpgsql as $$
begin
  if new.schedule_id is null or new.schedule_id = '' then
    new.schedule_id := 'TS-' || lpad(nextval('public.training_schedule_id_seq')::text, 6, '0');
  end if;
  return new;
end;
$$;
drop trigger if exists trg_ts_id on public.training_schedules;
create trigger trg_ts_id before insert on public.training_schedules
  for each row execute function app.gen_schedule_id();

-- --- schedule_participants (assignment) ------------------------------
create table if not exists public.schedule_participants (
  id             uuid primary key default gen_random_uuid(),
  schedule_id    uuid not null references public.training_schedules (id) on delete cascade,
  participant_id uuid not null references public.participants (id) on delete cascade,
  assigned_at    timestamptz not null default now(),
  assigned_by    uuid references public.profiles (id),
  constraint uq_schedule_participant unique (schedule_id, participant_id)  -- no duplicate registration
);
create index if not exists idx_sp_schedule on public.schedule_participants (schedule_id);
create index if not exists idx_sp_participant on public.schedule_participants (participant_id);

-- --- Seat sync + auto status ----------------------------------------
create or replace function app.sync_schedule_seats()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sched uuid := coalesce(new.schedule_id, old.schedule_id);
  v_count integer;
begin
  select count(*) into v_count from public.schedule_participants where schedule_id = v_sched;
  update public.training_schedules ts
     set registered_participants = v_count,
         status = case
           -- never override terminal / manual states
           when ts.status in ('draft', 'completed', 'cancelled', 'archived') then ts.status
           when ts.max_participants > 0 and v_count >= ts.max_participants then 'full'::training_status
           else 'open'::training_status
         end
   where ts.id = v_sched;
  return null;
end;
$$;
drop trigger if exists trg_sp_sync on public.schedule_participants;
create trigger trg_sp_sync
  after insert or delete on public.schedule_participants
  for each row execute function app.sync_schedule_seats();

-- --- updated_at + actor + audit triggers -----------------------------
drop trigger if exists trg_ts_updated_at on public.training_schedules;
create trigger trg_ts_updated_at before update on public.training_schedules
  for each row execute function app.set_updated_at();
drop trigger if exists trg_ts_stamp on public.training_schedules;
create trigger trg_ts_stamp before insert or update on public.training_schedules
  for each row execute function app.stamp_actor();
drop trigger if exists trg_ts_audit on public.training_schedules;
create trigger trg_ts_audit after insert or update or delete on public.training_schedules
  for each row execute function app.audit_trigger();
drop trigger if exists trg_sp_audit on public.schedule_participants;
create trigger trg_sp_audit after insert or delete on public.schedule_participants
  for each row execute function app.audit_trigger();

-- --- RLS -------------------------------------------------------------
alter table public.training_schedules enable row level security;
alter table public.training_schedules force row level security;
alter table public.schedule_participants enable row level security;
alter table public.schedule_participants force row level security;

-- Public website may read non-draft, non-deleted sessions (for "upcoming courses").
create policy ts_public_read on public.training_schedules
  for select using (status in ('open','full','completed') and deleted_at is null);
create policy ts_staff_read on public.training_schedules
  for select using (app.is_editor());
create policy ts_admin_insert on public.training_schedules
  for insert with check (app.is_admin());
create policy ts_admin_update on public.training_schedules
  for update using (app.is_admin()) with check (app.is_admin());
create policy ts_super_delete on public.training_schedules
  for delete using (app.is_super_admin());

-- Assignment table: staff read; admin assign/remove.
create policy sp_staff_read on public.schedule_participants
  for select using (app.is_editor());
create policy sp_admin_insert on public.schedule_participants
  for insert with check (app.is_admin());
create policy sp_admin_delete on public.schedule_participants
  for delete using (app.is_admin());

-- --- Grants ----------------------------------------------------------
grant select on public.training_schedules to anon, authenticated;
grant insert, update, delete on public.training_schedules to authenticated;
grant select, insert, delete on public.schedule_participants to authenticated;
grant usage, select on sequence public.training_schedule_id_seq to authenticated;

comment on table public.training_schedules is 'Training sessions. schedule_id auto-generated TS-000001. Canonical scheduling table for the Training Schedule module.';
comment on table public.schedule_participants is 'Participant assignments (many-to-many). Unique per (schedule, participant) prevents duplicate registration.';
