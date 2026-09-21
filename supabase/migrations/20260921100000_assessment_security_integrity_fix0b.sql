-- Fix 0B: make Assessment lock, unlock, and active-enrollment rules
-- independent of the application mutation paths.
--
-- Historical assessment rows are preserved. The preflight aborts this
-- migration instead of deleting or repairing incompatible data.

do $$
begin
  if exists (
    select 1
    from public.assessments a
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
      message = 'Assessment integrity preflight failed: existing assessment row has no active schedule enrollment';
  end if;

  if exists (
    select 1
    from public.assessments
    where (locked = false and (locked_at is not null or locked_by is not null))
       or (locked = true and (locked_at is null or locked_by is null))
  ) then
    raise exception using
      errcode = '23514',
      message = 'Assessment integrity preflight failed: existing lock metadata is inconsistent';
  end if;
end
$$;

create or replace function app.enforce_assessment_security_integrity()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
begin
  -- Active enrollment is a business predicate, not a simple foreign key.
  -- FOR UPDATE serializes this check with cancellation and soft deletion.
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
      message = 'Assessment requires an active enrollment in the target schedule';
  end if;

  if tg_op = 'UPDATE' and old.locked then
    -- A locked row is immutable to Admin/Trainer. The only permitted update
    -- is an explicit Super Admin unlock, and that statement may change only
    -- the lock fields. Content must be edited in a later unlocked statement.
    if not app.is_super_admin() then
      raise exception using
        errcode = '42501',
        message = 'Locked assessment may only be changed by an explicit Super Admin unlock';
    end if;

    if new.id is distinct from old.id
       or new.schedule_id is distinct from old.schedule_id
       or new.participant_id is distinct from old.participant_id
       or new.assessment_type is distinct from old.assessment_type
       or new.score is distinct from old.score
       or new.max_score is distinct from old.max_score
       or new.result is distinct from old.result
       or new.assessed_at is distinct from old.assessed_at
       or new.remarks is distinct from old.remarks
       or new.theory_score is distinct from old.theory_score
       or new.practical_score is distinct from old.practical_score
       or new.competency_status is distinct from old.competency_status
       or new.theory_result is distinct from old.theory_result
       or new.practical_result is distinct from old.practical_result
       or new.assessor_id is distinct from old.assessor_id
       or new.deleted_at is distinct from old.deleted_at
       or new.legacy_batch_id is distinct from old.legacy_batch_id
       or new.created_at is distinct from old.created_at then
      raise exception using
        errcode = '42501',
        message = 'Unlocking an assessment cannot modify assessment content';
    end if;

    if new.locked = false and (new.locked_at is not null or new.locked_by is not null) then
      raise exception using
        errcode = '23514',
        message = 'Unlocked assessment cannot retain lock metadata';
    end if;
  end if;

  return new;
end
$$;

revoke all on function app.enforce_assessment_security_integrity() from public, anon, authenticated, service_role;

drop trigger if exists trg_assessment_security_integrity on public.assessments;
create trigger trg_assessment_security_integrity
  before insert or update on public.assessments
  for each row
  execute function app.enforce_assessment_security_integrity();

-- Defense in depth: normal Admin/Trainer updates can target only rows whose
-- OLD state is unlocked. The trigger additionally protects transitions and
-- validates active enrollment. Super Admin receives a separate policy so the
-- explicit lock-only unlock statement can pass RLS.
drop policy if exists assessments_update on public.assessments;
drop policy if exists assessments_manage_update on public.assessments;
drop policy if exists assessments_super_update on public.assessments;
drop policy if exists assessments_update_unlocked on public.assessments;
drop policy if exists assessments_update_super_admin on public.assessments;

create policy assessments_update_unlocked on public.assessments
  for update to authenticated
  using (app.is_admin_or_trainer() and locked = false)
  with check (app.is_admin_or_trainer());

create policy assessments_update_super_admin on public.assessments
  for update to authenticated
  using (app.is_super_admin())
  with check (app.is_super_admin());
