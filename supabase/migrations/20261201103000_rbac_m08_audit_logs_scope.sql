-- RBAC M-08 (M3-min, D-14): the ordinary Reports grant no longer opens the security audit log.
-- Before: audit_staff_read = is_admin() AND any View of [audit, automation, backups, reports].
-- After: is_admin() AND any View of [audit, automation, backups] - the modules whose pages are the audit log itself,
-- the Automation run log and the Backups log. The Reports page "recent activity" panel simply returns no rows for a
-- reports-only holder (RLS filtering, no error). Narrowing only; the audit trigger and log_event writers are unchanged.
-- Approval: OWNER-CRM-RBAC-DEV-20261124 (local development; not applied anywhere).

set local lock_timeout = '5s';

do $m08_pre$
declare r record;
begin
  for r in
    select * from (values
      ($q$audit_logs$q$, $q$audit_staff_read$q$, $q$SELECT$q$, $q$authenticated$q$, $q$(app.is_admin() AND ( SELECT app.has_any_module_access(ARRAY['audit'::text, 'automation'::text, 'backups'::text, 'reports'::text], 'view'::text) AS has_any_module_access))$q$, null)
    ) as t(tbl, pol, cmd, roles, qual, chk)
  loop
    if not exists (select 1 from pg_policies p
                   where p.schemaname = 'public' and p.tablename = r.tbl and p.policyname = r.pol and p.cmd = r.cmd
                     and array_to_string(p.roles, ',') = r.roles and p.permissive = 'PERMISSIVE'
                     and p.qual is not distinct from r.qual and p.with_check is not distinct from r.chk) then
      raise exception 'm08_precondition_failed: policy %.% is not the reviewed pre-state - nothing changed', r.tbl, r.pol using errcode = 'P0001';
    end if;
  end loop;
end;
$m08_pre$;

drop policy if exists audit_staff_read on public.audit_logs;
create policy audit_staff_read on public.audit_logs as permissive for select to authenticated
  using ((app.is_admin() AND ( SELECT app.has_any_module_access(ARRAY['audit'::text, 'automation'::text, 'backups'::text], 'view'::text) AS has_any_module_access)));

do $m08_post$
declare r record;
begin
  for r in
    select * from (values
      ($q$audit_logs$q$, $q$audit_staff_read$q$, $q$SELECT$q$, $q$authenticated$q$, $q$'backups'::text], 'view'$q$)
    ) as t(tbl, pol, cmd, roles, token)
  loop
    if not exists (select 1 from pg_policies p
                   where p.schemaname = 'public' and p.tablename = r.tbl and p.policyname = r.pol and p.cmd = r.cmd
                     and array_to_string(p.roles, ',') = r.roles
                     and position(r.token in coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '')) > 0) then
      raise exception 'm08_postcondition_failed: policy %.% is not as intended', r.tbl, r.pol using errcode = 'P0001';
    end if;
  end loop;
end;
$m08_post$;
