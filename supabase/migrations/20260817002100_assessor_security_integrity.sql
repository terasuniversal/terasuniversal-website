-- TERAS UNIVERSAL — Assessor security + data-integrity fixes (PR #33 review)
--
-- Forward-only migration layered on 20260817002000 (never applied to
-- production). Fixes the four review findings:
--
--   1. CLOSE THE DIRECT-DB MODULE-ACCESS BYPASS
--      The prior write policies used app.is_admin() (role floor only), so an
--      explicit-access admin (access_control_enabled=true) with NO Assessors
--      module could still write assessors / schedule_assessors directly via
--      the authenticated Supabase client, bypassing requireModuleAccess().
--      Writes are now gated by module-aware helpers:
--        * assessor master writes     -> has_module_access_level('assessors', 'admin')
--        * schedule assignment writes -> has_module_access_level('schedules', 'admin')
--                                        AND has_module_access('assessors')
--      Legacy (access_control_enabled=false) admin keeps the role-default
--      fallback (catalog min_role). super_admin always passes. editor/trainer/
--      sales are denied. RLS is the enforcement boundary; app guards remain
--      defense-in-depth.
--
--   2. REMOVE HARD-DELETE CAPABILITY ON ASSESSORS
--      The assessors_delete policy is dropped and DELETE is revoked from
--      authenticated. Deactivate (is_active=false) is the only supported
--      lifecycle change for assessor records. schedule_assessors DELETE stays
--      (unassignment), now gated by the module-aware helper.
--
--   3. ATOMIC REASSIGNMENT
--      Assignment (assign / replace / remove) now runs in a single DB
--      transaction inside public.set_schedule_assessor(...): the old primary
--      is preserved if the new one cannot be inserted, and the change + audit
--      row commit or roll back together. Returns a status jsonb; raises on
--      invalid input instead of swallowing it.
--
--   4. ERROR PROPAGATION
--      The RPC raises on schedule-not-found / assessor-missing-or-inactive /
--      authorization failure; server actions map those to visible messages.
--
-- No destructive DROP of data. DDL is idempotent/guarded.

-- ---------------------------------------------------------------------------
-- 1. Module-aware authorization helpers (app schema = not PostgREST-exposed;
--    SECURITY DEFINER; safe search_path). Default PUBLIC execute is retained
--    like the other app.* RLS helpers (app.is_admin_or_trainer, etc.).
-- ---------------------------------------------------------------------------
create or replace function app.can_manage_assessors()
returns boolean
language sql
stable
security definer
set search_path = 'public'
as $$
  select public.has_module_access_level('assessors', 'admin');
$$;

create or replace function app.can_manage_schedule_assessors()
returns boolean
language sql
stable
security definer
set search_path = 'public'
as $$
  select public.has_module_access_level('schedules', 'admin')
     and public.has_module_access('assessors');
$$;

-- RLS policy expressions are evaluated under the querying role, which must
-- hold EXECUTE on these helpers. The baseline's
-- `ALTER DEFAULT PRIVILEGES ... REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC`
-- strips the default PUBLIC grant from newly-created functions, so an
-- explicit grant is required here (app schema = not PostgREST-exposed; the
-- helpers only report the caller's own module access).
revoke all on function app.can_manage_assessors() from public;
revoke all on function app.can_manage_schedule_assessors() from public;
grant execute on function app.can_manage_assessors() to authenticated;
grant execute on function app.can_manage_schedule_assessors() to authenticated;

-- ---------------------------------------------------------------------------
-- 2. assessors write policies: module-aware; no DELETE path.
-- ---------------------------------------------------------------------------
drop policy if exists assessors_insert on public.assessors;
create policy assessors_insert on public.assessors
  for insert to authenticated with check (app.can_manage_assessors());

drop policy if exists assessors_update on public.assessors;
create policy assessors_update on public.assessors
  for update to authenticated using (app.can_manage_assessors()) with check (app.can_manage_assessors());

-- No assessors_delete policy: assessor records are deactivated, never deleted.
drop policy if exists assessors_delete on public.assessors;

revoke delete on public.assessors from authenticated;

-- schedule_assessors write policies: module-aware (DELETE kept for
-- unassignment, which the atomic RPC performs inside its transaction).
drop policy if exists schedule_assessors_insert on public.schedule_assessors;
create policy schedule_assessors_insert on public.schedule_assessors
  for insert to authenticated with check (app.can_manage_schedule_assessors());

drop policy if exists schedule_assessors_update on public.schedule_assessors;
create policy schedule_assessors_update on public.schedule_assessors
  for update to authenticated using (app.can_manage_schedule_assessors()) with check (app.can_manage_schedule_assessors());

drop policy if exists schedule_assessors_delete on public.schedule_assessors;
create policy schedule_assessors_delete on public.schedule_assessors
  for delete to authenticated using (app.can_manage_schedule_assessors());

-- ---------------------------------------------------------------------------
-- 3. Atomic assignment RPC
-- ---------------------------------------------------------------------------
-- assign / replace / remove as ONE transaction:
--   * p_assessor_id = NULL      -> remove  (status 'removed')
--   * same assessor already set -> no-op   (status 'unchanged')
--   * new assessor              -> replace (status 'reassigned') or assign
--                                  (status 'assigned') when nothing was set
-- On any validation/constraint failure the whole call rolls back, so the old
-- assignment is preserved. The audit row commits with the change.
create or replace function public.set_schedule_assessor(
  p_schedule_id uuid,
  p_assessor_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_prev       uuid;
  v_prev_name  text;
  v_target     public.assessors%rowtype;
  v_action     public.audit_action;
  v_email      text;
  v_summary    text;
  v_meta       jsonb;
begin
  if not app.can_manage_schedule_assessors() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_schedule_id is null then
    raise exception 'invalid_schedule' using errcode = 'P0001';
  end if;

  perform 1 from public.course_schedules
  where id = p_schedule_id and deleted_at is null;
  if not found then
    raise exception 'schedule_not_found' using errcode = 'P0001';
  end if;

  select sa.assessor_id, a.full_name into v_prev, v_prev_name
  from public.schedule_assessors sa
  left join public.assessors a on a.id = sa.assessor_id
  where sa.schedule_id = p_schedule_id and sa.is_primary
  limit 1;

  -- REMOVE
  if p_assessor_id is null then
    if v_prev is null then
      return jsonb_build_object('status', 'removed', 'schedule_id', p_schedule_id,
        'assessor_id', null, 'previous_assessor_id', null, 'full_name', null);
    end if;
    delete from public.schedule_assessors where schedule_id = p_schedule_id;
    v_action := 'assessor_unassigned';
    v_summary := 'Assessor ' || coalesce(v_prev_name, '') || ' unassigned from schedule';
    v_meta := jsonb_build_object('schedule_id', p_schedule_id, 'assessor_id', v_prev);
    insert into public.audit_logs (actor_id, actor_email, action, entity_type, entity_id, summary, metadata)
    values (auth.uid(), (select email from public.profiles where id = auth.uid()),
            v_action, 'schedule_assessors', p_schedule_id::text, v_summary, v_meta);
    return jsonb_build_object('status', 'removed', 'schedule_id', p_schedule_id,
      'assessor_id', null, 'previous_assessor_id', v_prev, 'previous_full_name', v_prev_name, 'full_name', null);
  end if;

  -- UNCHANGED
  if v_prev = p_assessor_id then
    return jsonb_build_object('status', 'unchanged', 'schedule_id', p_schedule_id,
      'assessor_id', p_assessor_id, 'previous_assessor_id', v_prev, 'previous_full_name', v_prev_name, 'full_name', v_prev_name);
  end if;

  -- target must exist and be active
  select * into v_target from public.assessors where id = p_assessor_id and is_active;
  if not found then
    raise exception 'assessor_not_found_or_inactive' using errcode = 'P0001';
  end if;

  -- ASSIGN / REPLACE (one transaction; the delete below is rolled back if the
  -- insert violates a constraint, so the old assignment is preserved).
  delete from public.schedule_assessors where schedule_id = p_schedule_id;
  insert into public.schedule_assessors (schedule_id, assessor_id, is_primary, assigned_by)
  values (p_schedule_id, p_assessor_id, true, auth.uid());

  v_action := case when v_prev is null then 'assessor_assigned' else 'assessor_reassigned' end;
  v_summary := 'Assessor ' || v_target.full_name || ' ' ||
    case when v_prev is null then 'assigned to' else 'reassigned on' end || ' schedule';
  v_meta := jsonb_build_object('schedule_id', p_schedule_id, 'assessor_id', p_assessor_id,
    'previous_assessor_id', v_prev);
  insert into public.audit_logs (actor_id, actor_email, action, entity_type, entity_id, summary, metadata)
  values (auth.uid(), (select email from public.profiles where id = auth.uid()),
          v_action, 'schedule_assessors', p_schedule_id::text, v_summary, v_meta);

  return jsonb_build_object('status', v_action, 'schedule_id', p_schedule_id,
    'assessor_id', p_assessor_id, 'previous_assessor_id', v_prev,
    'previous_full_name', v_prev_name, 'full_name', v_target.full_name);
end;
$$;

revoke all on function public.set_schedule_assessor(uuid, uuid) from public;
grant execute on function public.set_schedule_assessor(uuid, uuid) to authenticated;
