-- New table: the genuinely missing many-to-many junction between
-- course_schedules and participants (per SCHEDULES_ARCHITECTURE_DECISION.md).
-- participants.schedule_id remains untouched as a legacy/unused compatibility
-- column (0 of 126 live rows use it as of this migration) -- not migrated,
-- not removed here.

create table if not exists public.schedule_participants (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references public.course_schedules (id) on delete cascade,
  participant_id uuid not null references public.participants (id) on delete cascade,
  registration_status text not null default 'registered'
    check (registration_status in ('registered', 'confirmed', 'cancelled', 'completed')),
  enrolled_at timestamptz not null default now(),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- One active enrollment per participant per schedule: excludes both
-- soft-deleted rows and cancelled registrations, so a participant may be
-- re-enrolled in the same schedule after a cancellation.
create unique index if not exists schedule_participants_active_unique
  on public.schedule_participants (schedule_id, participant_id)
  where deleted_at is null and registration_status <> 'cancelled';

create index if not exists schedule_participants_schedule_idx
  on public.schedule_participants (schedule_id) where deleted_at is null;
create index if not exists schedule_participants_participant_idx
  on public.schedule_participants (participant_id) where deleted_at is null;

drop trigger if exists trg_schedule_participants_updated_at on public.schedule_participants;
create trigger trg_schedule_participants_updated_at
  before update on public.schedule_participants
  for each row execute function app.set_updated_at();

drop trigger if exists trg_schedule_participants_audit on public.schedule_participants;
create trigger trg_schedule_participants_audit
  after insert or update or delete on public.schedule_participants
  for each row execute function app.audit_trigger();

-- course_schedules.seats_taken becomes a trigger-maintained mirror of active
-- enrollment count -- never incremented/decremented by application code,
-- always fully recomputed on every relevant write, so it cannot drift.
create or replace function app.sync_schedule_seats() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    update public.course_schedules set seats_taken = (
      select count(*) from public.schedule_participants
      where schedule_id = old.schedule_id and deleted_at is null and registration_status <> 'cancelled'
    ) where id = old.schedule_id;
    return old;
  end if;

  update public.course_schedules set seats_taken = (
    select count(*) from public.schedule_participants
    where schedule_id = new.schedule_id and deleted_at is null and registration_status <> 'cancelled'
  ) where id = new.schedule_id;

  if tg_op = 'UPDATE' and old.schedule_id is distinct from new.schedule_id then
    update public.course_schedules set seats_taken = (
      select count(*) from public.schedule_participants
      where schedule_id = old.schedule_id and deleted_at is null and registration_status <> 'cancelled'
    ) where id = old.schedule_id;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_schedule_participants_sync_seats on public.schedule_participants;
create trigger trg_schedule_participants_sync_seats
  after insert or update or delete on public.schedule_participants
  for each row execute function app.sync_schedule_seats();
