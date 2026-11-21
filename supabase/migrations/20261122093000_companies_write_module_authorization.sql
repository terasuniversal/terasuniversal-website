-- M-S5c (CRM release candidate): writing companies requires Companies edit access.
--
-- Finding (Staging read-only review, 2026-11-21): companies_admin_insert/update/delete allowed any active Admin to write
-- companies through the Data API without the Companies module.
--
-- Contract: every application writer (createCompany, updateCompany, softDeleteCompany, restoreCompany in
-- app/admin/(protected)/companies/actions.ts) is guarded by requireRole("admin") AND requireModuleAccess("companies",
-- "edit"). Each policy keeps app.is_admin() and only adds the Companies edit check. companies_staff_read is unchanged
-- (companies are read by Opportunities, Quotations, Reports and Participants pages).
-- Fail-closed on any unexpected existing definition. Idempotent, forward-only.
-- Rollback: recreate the three policies for public with app.is_admin() only.

do $ms5c$
declare
  r record;
  v_qual text;
  v_check text;
  v_roles text;
begin
  for r in
    select * from (values
      ('companies_admin_insert', 'INSERT'),
      ('companies_admin_update', 'UPDATE'),
      ('companies_admin_delete', 'DELETE')
    ) t(pol, cmd)
  loop
    select qual, with_check, roles::text into v_qual, v_check, v_roles
    from pg_policies where schemaname = 'public' and tablename = 'companies' and policyname = r.pol and cmd = r.cmd;
    if v_roles is null then
      raise exception 'ms5c: policy companies.% not found - nothing changed', r.pol;
    end if;
    if coalesce(v_qual, '') || coalesce(v_check, '') like '%has_module_access_level%' then
      continue; -- already applied
    end if;
    if v_roles <> '{public}'
       or (r.cmd = 'INSERT' and (v_qual is not null or v_check is distinct from 'app.is_admin()'))
       or (r.cmd = 'UPDATE' and (v_qual is distinct from 'app.is_admin()' or v_check is distinct from 'app.is_admin()'))
       or (r.cmd = 'DELETE' and (v_qual is distinct from 'app.is_admin()' or v_check is not null)) then
      raise exception 'ms5c: companies.% is not the reviewed definition (qual=%, check=%, roles=%) - nothing changed',
        r.pol, v_qual, v_check, v_roles;
    end if;
  end loop;

  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'companies'
               and policyname = 'companies_admin_update' and qual like '%has_module_access_level%') then
    return; -- already applied
  end if;

  drop policy companies_admin_insert on public.companies;
  create policy companies_admin_insert on public.companies
    for insert to authenticated
    with check (app.is_admin() and (select public.has_module_access_level('companies', 'edit')));

  drop policy companies_admin_update on public.companies;
  create policy companies_admin_update on public.companies
    for update to authenticated
    using (app.is_admin() and (select public.has_module_access_level('companies', 'edit')))
    with check (app.is_admin() and (select public.has_module_access_level('companies', 'edit')));

  drop policy companies_admin_delete on public.companies;
  create policy companies_admin_delete on public.companies
    for delete to authenticated
    using (app.is_admin() and (select public.has_module_access_level('companies', 'edit')));
end;
$ms5c$;
