-- M-S5d (CRM release candidate): reading audit logs requires a module that displays them.
--
-- Finding (Staging read-only review, 2026-11-21): audit_staff_read was app.is_admin() only, so any active Admin could
-- read every audit row (actor emails, staff changes, finance events) through the Data API without the Audit module.
--
-- Contract: the application readers of public.audit_logs are the Audit Log (audit), Automation Centre (automation),
-- Backup Manager (backups) and Reports (reports) pages (verified 2026-11-21). The policy keeps app.is_admin() and adds
-- "holds one of those modules (view)". Audit rows are written only by SECURITY DEFINER triggers/functions, which
-- bypass RLS, so auditing itself is unaffected. Requires app.has_any_module_access (M-S4).
-- Fail-closed on any unexpected existing definition. Idempotent, forward-only.
-- Rollback: recreate audit_staff_read for public using (app.is_admin()).

do $ms5d$
declare
  v_qual text;
  v_roles text;
begin
  if to_regprocedure('app.has_any_module_access(text[],text)') is null then
    raise exception 'ms5d: app.has_any_module_access (M-S4) is missing - nothing changed';
  end if;
  select qual, roles::text into v_qual, v_roles
  from pg_policies where schemaname = 'public' and tablename = 'audit_logs' and policyname = 'audit_staff_read' and cmd = 'SELECT';
  if v_qual is null then
    raise exception 'ms5d: policy audit_logs.audit_staff_read not found - nothing changed';
  end if;
  if v_qual like '%has_any_module_access%' then
    return; -- already applied
  end if;
  if v_qual <> 'app.is_admin()' or v_roles <> '{public}' then
    raise exception 'ms5d: audit_staff_read is not the reviewed definition (qual=%, roles=%) - nothing changed', v_qual, v_roles;
  end if;

  drop policy audit_staff_read on public.audit_logs;
  create policy audit_staff_read on public.audit_logs
    for select to authenticated
    using (app.is_admin() and (select app.has_any_module_access(array['audit', 'automation', 'backups', 'reports']::text[], 'view')));
end;
$ms5d$;
