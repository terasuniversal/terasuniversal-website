-- RBAC M-07 (M2-min, D-14): participant rows readable only for legitimate operational modules.
-- Before: participants_select = has_min_role('editor') - every active editor/admin (Sales, Finance, Management) could
-- read every participant row, including IC/passport, phone and address columns, through PostgREST.
-- After: editor floor (unchanged - Trainers are NOT newly admitted) AND View on one of the operational modules that
-- render participant data: participants, schedules, attendance, assessment, certificates, companies, feedback,
-- feedback_responses. 'reports' is deliberately NOT in the list: the Reports module gets the minimum columns it shows
-- (id, participant_id, full_name, company, status, created_at) through public.get_report_participants(), and the
-- participant total through public.get_report_participant_count(). Both are SECURITY DEFINER with a fixed
-- search_path, gated by the same rule the Reports page uses (editor floor AND reports View), EXECUTE authenticated only.
-- Narrowing for table reads; the two RPCs expose strictly fewer columns than the previous table policy did.
-- Approval: OWNER-CRM-RBAC-DEV-20261124 (local development; not applied anywhere).

set local lock_timeout = '5s';

do $m07_pre$
declare r record;
begin
  for r in
    select * from (values
      ($q$participants$q$, $q$participants_select$q$, $q$SELECT$q$, $q$authenticated$q$, $q$app.has_min_role('editor'::user_role)$q$, null)
    ) as t(tbl, pol, cmd, roles, qual, chk)
  loop
    if not exists (select 1 from pg_policies p
                   where p.schemaname = 'public' and p.tablename = r.tbl and p.policyname = r.pol and p.cmd = r.cmd
                     and array_to_string(p.roles, ',') = r.roles and p.permissive = 'PERMISSIVE'
                     and p.qual is not distinct from r.qual and p.with_check is not distinct from r.chk) then
      raise exception 'm07_precondition_failed: policy %.% is not the reviewed pre-state - nothing changed', r.tbl, r.pol using errcode = 'P0001';
    end if;
  end loop;
end;
$m07_pre$;

drop policy if exists participants_select on public.participants;
create policy participants_select on public.participants as permissive for select to authenticated
  using ((app.has_min_role('editor'::public.user_role) AND ( SELECT app.has_any_module_access(ARRAY['participants'::text, 'schedules'::text, 'attendance'::text, 'assessment'::text, 'certificates'::text, 'companies'::text, 'feedback'::text, 'feedback_responses'::text], 'view'::text) AS has_any_module_access)));

create or replace function public.get_report_participants(p_limit integer default null)
returns table (id uuid, participant_id text, full_name text, company text, status text, created_at timestamptz)
language sql stable security definer set search_path to 'pg_catalog', 'public'
as $f$
  select p.id, p.participant_id, p.full_name, p.company, p.status, p.created_at
  from public.participants p
  where p.deleted_at is null
    and app.has_min_role('editor'::public.user_role)
    and public.has_module_access_level('reports', 'view')
  order by p.created_at desc
  limit case when p_limit is null then null else greatest(least(p_limit, 10000), 0) end;
$f$;

create or replace function public.get_report_participant_count()
returns bigint
language sql stable security definer set search_path to 'pg_catalog', 'public'
as $f$
  select case when app.has_min_role('editor'::public.user_role) and public.has_module_access_level('reports', 'view')
              then (select count(*) from public.participants p where p.deleted_at is null) else null end;
$f$;

revoke all on function public.get_report_participants(integer) from public, anon, service_role;
revoke all on function public.get_report_participant_count() from public, anon, service_role;
grant execute on function public.get_report_participants(integer) to authenticated;
grant execute on function public.get_report_participant_count() to authenticated;

do $m07_post$
declare r record;
begin
  for r in
    select * from (values
      ($q$participants$q$, $q$participants_select$q$, $q$SELECT$q$, $q$authenticated$q$, $q$has_any_module_access$q$)
    ) as t(tbl, pol, cmd, roles, token)
  loop
    if not exists (select 1 from pg_policies p
                   where p.schemaname = 'public' and p.tablename = r.tbl and p.policyname = r.pol and p.cmd = r.cmd
                     and array_to_string(p.roles, ',') = r.roles
                     and position(r.token in coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '')) > 0) then
      raise exception 'm07_postcondition_failed: policy %.% is not as intended', r.tbl, r.pol using errcode = 'P0001';
    end if;
  end loop;
  if has_function_privilege('anon', 'public.get_report_participants(integer)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.get_report_participants(integer)', 'EXECUTE')
     or has_function_privilege('anon', 'public.get_report_participant_count()', 'EXECUTE') then
    raise exception 'm07_postcondition_failed: report RPC privileges are not as intended' using errcode = 'P0001';
  end if;
end;
$m07_post$;
