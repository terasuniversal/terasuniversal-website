-- Fix 0A: attendance must always reference an active enrollment in the same
-- schedule. This is a trigger rather than a foreign key because active
-- enrollment is a partial, soft-delete-aware business predicate.
--
-- Historical attendance is preserved. Existing rows are checked before the
-- trigger is installed; any incompatible row aborts this migration instead
-- of being deleted or silently repaired. Once installed, later cancellation
-- or soft deletion does not delete historical attendance, but it prevents
-- new attendance and prevents updates to that row until the enrollment is
-- active again.

do $$
begin
  if exists (
    select 1
    from public.attendance a
    where not exists (
      select 1
      from public.schedule_participants sp
      where sp.schedule_id = a.schedule_id
        and sp.participant_id = a.participant_id
        and sp.deleted_at is null
        and sp.registration_status <> 'cancelled'
    )
  ) then
    raise exception using
      errcode = '23514',
      message = 'Attendance integrity preflight failed: existing attendance row has no active schedule enrollment';
  end if;
end
$$;

create or replace function app.enforce_attendance_active_enrollment()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- FOR UPDATE makes this check serialize with cancellation, soft deletion,
  -- and schedule/participant changes on the enrollment row. If attendance
  -- wins the race, cancellation waits; if cancellation wins, this check sees
  -- the inactive row and the attendance write is rejected.
  if not exists (
    select 1
    from public.schedule_participants sp
    where sp.schedule_id = new.schedule_id
      and sp.participant_id = new.participant_id
      and sp.deleted_at is null
      and sp.registration_status <> 'cancelled'
    for update
  ) then
    raise exception using
      errcode = '23514',
      message = 'Attendance requires an active enrollment in the target schedule';
  end if;

  return new;
end
$$;

drop trigger if exists trg_attendance_active_enrollment on public.attendance;
create trigger trg_attendance_active_enrollment
  before insert or update on public.attendance
  for each row
  execute function app.enforce_attendance_active_enrollment();

-- The trigger is the only caller. Do not expose this SECURITY DEFINER helper
-- as a general-purpose RPC to authenticated users or service_role.
revoke all on function app.enforce_attendance_active_enrollment() from public, anon, authenticated, service_role;
