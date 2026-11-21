-- M-S4: enforce CRM module access (None / View / Edit) in RLS and in two lead-creation RPCs.
--
-- Why: after M-S2 only sales_activity INSERT and sales_lead_attributions INSERT/UPDATE checked module access. Every
-- other Sales CRM policy checked the role alone, so a direct PostgREST call could bypass the module model that the
-- Server Actions enforce (PR #227):
--   B1  sales_tasks INSERT/UPDATE/DELETE: any editor (INSERT) or assignee/creator (UPDATE) could write tasks with
--       Tasks = View or None.
--   B2  sales_opportunities / sales_quotations INSERT/UPDATE and sales_lead_metadata UPDATE: any admin could write
--       with the module at View.
--   F4  create_internal_sales_lead and promote_marketing_contact_to_sales (SECURITY DEFINER) checked the role only.
--   F5  every Sales CRM SELECT policy checked the role only, so an editor with no CRM module could read it all.
--
-- Rule applied: each new expression is the previous expression AND a module condition. Nothing is widened; role
-- floors, stage/status guards and assignee rules are kept verbatim. super_admin keeps full access and staff with
-- access_control_enabled = false keep their role-default access, both through public.has_module_access_level.
--
-- Read sets (SELECT, "view"): every module whose pages or actions read the table, directly, through an embedded
-- select, through v_sales_lead_inbox (security_invoker) or through INSERT/UPDATE ... RETURNING. They were derived from
-- the PR #227 code (requireModuleAccess guard of each reading route); the M-S4 contract test re-derives and checks them.
-- Write sets ("edit"): the module of every Server Action that writes the table directly.
--
-- What is NOT affected: SECURITY DEFINER RPCs owned by postgres and service_role (BYPASSRLS) do not evaluate these
-- policies. Views other than v_sales_lead_inbox are not changed.
--
-- F4 technique: the existing function bodies are kept byte-for-byte by renaming them to *_unguarded (EXECUTE revoked
-- from every client role) and adding a same-signature SECURITY DEFINER wrapper that checks module edit access and then
-- calls the original. promote_marketing_contact_to_sales deliberately requires marketing_contacts edit only (locked
-- business decision documented in app/admin/(protected)/marketing/contacts/actions.ts), not sales_leads.
-- Future migrations that change these RPCs must replace *_unguarded, not the wrapper.
--
-- Fail-closed: the first block aborts unless every policy being replaced has exactly the expected text, roles and
-- count, and every module key used here exists and is active in staff_module_catalog.
--
-- Rollback: see ms4-05-staging-rollback.sql in the M-S4 package (re-creates the previous policies verbatim, drops the
-- wrappers and renames *_unguarded back).

do $$
declare
  r record;
  v_count int;
begin
  for r in
    select * from (values
      ('sales_lead_metadata', 'sales_lead_metadata_select', 'SELECT', $q$app.has_min_role('editor'::user_role)$q$, null::text),
      ('sales_lead_metadata', 'sales_lead_metadata_update', 'UPDATE', $q$app.is_admin()$q$, $q$app.is_admin()$q$),
      ('sales_opportunities', 'sales_opportunities_select', 'SELECT', $q$app.has_min_role('editor'::user_role)$q$, null),
      ('sales_opportunities', 'sales_opportunities_insert', 'INSERT', null, $q$(app.is_admin() AND (stage <> ALL (ARRAY['won'::text, 'cancelled'::text])))$q$),
      ('sales_opportunities', 'sales_opportunities_update', 'UPDATE', $q$(app.is_admin() AND (stage <> ALL (ARRAY['won'::text, 'cancelled'::text])))$q$, $q$(app.is_admin() AND (stage <> ALL (ARRAY['won'::text, 'cancelled'::text])))$q$),
      ('sales_quotations', 'sales_quotations_select', 'SELECT', $q$app.has_min_role('editor'::user_role)$q$, null),
      ('sales_quotations', 'sales_quotations_insert', 'INSERT', null, $q$(app.is_admin() AND (status <> ALL (ARRAY['accepted'::text, 'cancelled'::text])))$q$),
      ('sales_quotations', 'sales_quotations_update', 'UPDATE', $q$(app.is_admin() AND (status <> ALL (ARRAY['accepted'::text, 'cancelled'::text])))$q$, $q$(app.is_admin() AND (status <> ALL (ARRAY['accepted'::text, 'cancelled'::text])))$q$),
      ('sales_tasks', 'sales_tasks_select', 'SELECT', $q$app.has_min_role('editor'::user_role)$q$, null),
      ('sales_tasks', 'sales_tasks_insert', 'INSERT', null, $q$app.has_min_role('editor'::user_role)$q$),
      ('sales_tasks', 'sales_tasks_update', 'UPDATE', $q$(app.is_admin() OR (assigned_to = auth.uid()) OR (created_by = auth.uid()))$q$, $q$(app.is_admin() OR (assigned_to = auth.uid()) OR (created_by = auth.uid()))$q$),
      ('sales_tasks', 'sales_tasks_delete', 'DELETE', $q$app.is_admin()$q$, null),
      ('sales_activity', 'sales_activity_select', 'SELECT', $q$app.has_min_role('editor'::user_role)$q$, null),
      ('sales_lead_attributions', 'sales_lead_attributions_select', 'SELECT', $q$app.has_min_role('editor'::user_role)$q$, null)
    ) t(tbl, pol, cmd, qual, chk)
  loop
    if not exists (
      select 1 from pg_policies p
      where p.schemaname = 'public' and p.tablename = r.tbl and p.policyname = r.pol and p.cmd = r.cmd
        and p.permissive = 'PERMISSIVE' and p.roles = array['authenticated']::name[]
        and p.qual is not distinct from r.qual and p.with_check is not distinct from r.chk
    ) then
      raise exception 'ms4_precondition_failed: policy %.% is not the expected pre-M-S4 definition', r.tbl, r.pol
        using errcode = 'P0001';
    end if;
  end loop;

  for r in
    select * from (values ('sales_lead_metadata', 2), ('sales_opportunities', 3), ('sales_quotations', 3), ('sales_tasks', 4))
      t(tbl, n)
  loop
    select count(*) into v_count from pg_policies where schemaname = 'public' and tablename = r.tbl;
    if v_count <> r.n then
      raise exception 'ms4_precondition_failed: % has % policies, expected %', r.tbl, v_count, r.n using errcode = 'P0001';
    end if;
  end loop;

  select count(*) into v_count
  from unnest(array['sales', 'sales_leads', 'sales_opportunities', 'sales_quotations', 'sales_tasks', 'sales_followups',
                    'sales_reports', 'companies', 'invoices', 'schedules', 'marketing_contacts', 'marketing_campaigns']) k
  where not exists (select 1 from public.staff_module_catalog c where c.module_key = k and c.is_active);
  if v_count <> 0 then
    raise exception 'ms4_precondition_failed: % module key(s) missing or inactive in staff_module_catalog', v_count
      using errcode = 'P0001';
  end if;

  if to_regprocedure('public.has_module_access_level(text,text)') is null
     or to_regprocedure('app.has_min_role(public.user_role)') is null
     or to_regprocedure('app.is_admin()') is null
     or to_regprocedure('public.create_internal_sales_lead(text,text,text,text,text,text,text,uuid,text)') is null
     or to_regprocedure('public.promote_marketing_contact_to_sales(uuid)') is null then
    raise exception 'ms4_precondition_failed: a required function is missing' using errcode = 'P0001';
  end if;
end;
$$;

-- True when the caller has at least p_level on any of p_modules. Invoker: it only combines the existing
-- SECURITY DEFINER public.has_module_access_level, so it grants nothing by itself.
create or replace function app.has_any_module_access(p_modules text[], p_level text default 'view')
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(bool_or(public.has_module_access_level(m, p_level)), false) from unnest(p_modules) as m;
$$;

revoke all on function app.has_any_module_access(text[], text) from public, anon, service_role;
grant execute on function app.has_any_module_access(text[], text) to authenticated;

-- ---- F5: SELECT ------------------------------------------------------------------------------------------------
drop policy if exists sales_lead_metadata_select on public.sales_lead_metadata;
create policy sales_lead_metadata_select on public.sales_lead_metadata
  for select to authenticated
  using (
    app.has_min_role('editor'::public.user_role)
    and (select app.has_any_module_access(array['sales', 'sales_leads', 'sales_opportunities', 'sales_tasks',
                                                'sales_followups', 'sales_reports', 'marketing_contacts']::text[], 'view'))
  );

drop policy if exists sales_opportunities_select on public.sales_opportunities;
create policy sales_opportunities_select on public.sales_opportunities
  for select to authenticated
  using (
    app.has_min_role('editor'::public.user_role)
    and (select app.has_any_module_access(array['sales', 'sales_leads', 'sales_opportunities', 'sales_quotations',
                                                'sales_tasks', 'sales_followups', 'sales_reports', 'companies',
                                                'invoices', 'schedules']::text[], 'view'))
  );

drop policy if exists sales_quotations_select on public.sales_quotations;
create policy sales_quotations_select on public.sales_quotations
  for select to authenticated
  using (
    app.has_min_role('editor'::public.user_role)
    and (select app.has_any_module_access(array['sales', 'sales_leads', 'sales_opportunities', 'sales_quotations',
                                                'sales_tasks', 'sales_followups', 'sales_reports', 'invoices',
                                                'schedules']::text[], 'view'))
  );

drop policy if exists sales_tasks_select on public.sales_tasks;
create policy sales_tasks_select on public.sales_tasks
  for select to authenticated
  using (
    app.has_min_role('editor'::public.user_role)
    and (select app.has_any_module_access(array['sales', 'sales_leads', 'sales_opportunities', 'sales_quotations',
                                                'sales_tasks', 'sales_reports']::text[], 'view'))
  );

drop policy if exists sales_activity_select on public.sales_activity;
create policy sales_activity_select on public.sales_activity
  for select to authenticated
  using (
    app.has_min_role('editor'::public.user_role)
    and (select app.has_any_module_access(array['sales', 'sales_leads', 'sales_opportunities', 'sales_quotations',
                                                'sales_tasks', 'sales_followups', 'sales_reports', 'companies',
                                                'invoices', 'schedules', 'marketing_contacts']::text[], 'view'))
  );

drop policy if exists sales_lead_attributions_select on public.sales_lead_attributions;
create policy sales_lead_attributions_select on public.sales_lead_attributions
  for select to authenticated
  using (
    app.has_min_role('editor'::public.user_role)
    and (select app.has_any_module_access(array['sales', 'sales_leads', 'sales_reports', 'marketing_contacts',
                                                'marketing_campaigns']::text[], 'view'))
  );

-- ---- B1: sales_tasks writes ------------------------------------------------------------------------------------
drop policy if exists sales_tasks_insert on public.sales_tasks;
create policy sales_tasks_insert on public.sales_tasks
  for insert to authenticated
  with check (
    app.has_min_role('editor'::public.user_role)
    and (select public.has_module_access_level('sales_tasks', 'edit'))
  );

drop policy if exists sales_tasks_update on public.sales_tasks;
create policy sales_tasks_update on public.sales_tasks
  for update to authenticated
  using (
    (app.is_admin() or assigned_to = auth.uid() or created_by = auth.uid())
    and (select public.has_module_access_level('sales_tasks', 'edit'))
  )
  with check (
    (app.is_admin() or assigned_to = auth.uid() or created_by = auth.uid())
    and (select public.has_module_access_level('sales_tasks', 'edit'))
  );

drop policy if exists sales_tasks_delete on public.sales_tasks;
create policy sales_tasks_delete on public.sales_tasks
  for delete to authenticated
  using (
    app.is_admin()
    and (select public.has_module_access_level('sales_tasks', 'edit'))
  );

-- ---- B2: opportunities, quotations, lead metadata writes -------------------------------------------------------
drop policy if exists sales_opportunities_insert on public.sales_opportunities;
create policy sales_opportunities_insert on public.sales_opportunities
  for insert to authenticated
  with check (
    app.is_admin() and stage <> all (array['won'::text, 'cancelled'::text])
    and (select public.has_module_access_level('sales_opportunities', 'edit'))
  );

-- Quotation actions move the opportunity to stage "quotation", so Quotations edit may update it as well.
drop policy if exists sales_opportunities_update on public.sales_opportunities;
create policy sales_opportunities_update on public.sales_opportunities
  for update to authenticated
  using (
    app.is_admin() and stage <> all (array['won'::text, 'cancelled'::text])
    and (select app.has_any_module_access(array['sales_opportunities', 'sales_quotations']::text[], 'edit'))
  )
  with check (
    app.is_admin() and stage <> all (array['won'::text, 'cancelled'::text])
    and (select app.has_any_module_access(array['sales_opportunities', 'sales_quotations']::text[], 'edit'))
  );

drop policy if exists sales_quotations_insert on public.sales_quotations;
create policy sales_quotations_insert on public.sales_quotations
  for insert to authenticated
  with check (
    app.is_admin() and status <> all (array['accepted'::text, 'cancelled'::text])
    and (select public.has_module_access_level('sales_quotations', 'edit'))
  );

drop policy if exists sales_quotations_update on public.sales_quotations;
create policy sales_quotations_update on public.sales_quotations
  for update to authenticated
  using (
    app.is_admin() and status <> all (array['accepted'::text, 'cancelled'::text])
    and (select public.has_module_access_level('sales_quotations', 'edit'))
  )
  with check (
    app.is_admin() and status <> all (array['accepted'::text, 'cancelled'::text])
    and (select public.has_module_access_level('sales_quotations', 'edit'))
  );

drop policy if exists sales_lead_metadata_update on public.sales_lead_metadata;
create policy sales_lead_metadata_update on public.sales_lead_metadata
  for update to authenticated
  using (
    app.is_admin()
    and (select public.has_module_access_level('sales_leads', 'edit'))
  )
  with check (
    app.is_admin()
    and (select public.has_module_access_level('sales_leads', 'edit'))
  );

-- ---- F4: lead-creation RPCs ------------------------------------------------------------------------------------
do $$
begin
  if to_regprocedure('public.create_internal_sales_lead_unguarded(text,text,text,text,text,text,text,uuid,text)') is null then
    alter function public.create_internal_sales_lead(text, text, text, text, text, text, text, uuid, text)
      rename to create_internal_sales_lead_unguarded;
  end if;
  if to_regprocedure('public.promote_marketing_contact_to_sales_unguarded(uuid)') is null then
    alter function public.promote_marketing_contact_to_sales(uuid) rename to promote_marketing_contact_to_sales_unguarded;
  end if;
end;
$$;

revoke all on function public.create_internal_sales_lead_unguarded(text, text, text, text, text, text, text, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.promote_marketing_contact_to_sales_unguarded(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.create_internal_sales_lead(
  p_contact_name text,
  p_email text default null,
  p_phone text default null,
  p_company_name text default null,
  p_course_interest text default null,
  p_notes text default null,
  p_source_channel text default null,
  p_campaign_id uuid default null,
  p_attribution_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.has_module_access_level('sales_leads', 'edit') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return public.create_internal_sales_lead_unguarded(
    p_contact_name, p_email, p_phone, p_company_name, p_course_interest, p_notes, p_source_channel, p_campaign_id,
    p_attribution_notes
  );
end;
$$;

create or replace function public.promote_marketing_contact_to_sales(p_contact_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.has_module_access_level('marketing_contacts', 'edit') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return public.promote_marketing_contact_to_sales_unguarded(p_contact_id);
end;
$$;

alter function public.create_internal_sales_lead(text, text, text, text, text, text, text, uuid, text) owner to postgres;
alter function public.promote_marketing_contact_to_sales(uuid) owner to postgres;
revoke all on function public.create_internal_sales_lead(text, text, text, text, text, text, text, uuid, text)
  from public, anon, service_role;
revoke all on function public.promote_marketing_contact_to_sales(uuid) from public, anon, service_role;
grant execute on function public.create_internal_sales_lead(text, text, text, text, text, text, text, uuid, text)
  to authenticated;
grant execute on function public.promote_marketing_contact_to_sales(uuid) to authenticated;

do $$
begin
  if has_function_privilege('authenticated', 'public.create_internal_sales_lead_unguarded(text,text,text,text,text,text,text,uuid,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.promote_marketing_contact_to_sales_unguarded(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.create_internal_sales_lead(text,text,text,text,text,text,text,uuid,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.promote_marketing_contact_to_sales(uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.create_internal_sales_lead(text,text,text,text,text,text,text,uuid,text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.promote_marketing_contact_to_sales(uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'app.has_any_module_access(text[],text)', 'EXECUTE') then
    raise exception 'ms4_postcondition_failed: function privileges are not as intended' using errcode = 'P0001';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public'
        and tablename in ('sales_lead_metadata', 'sales_opportunities', 'sales_quotations', 'sales_tasks')) <> 12 then
    raise exception 'ms4_postcondition_failed: unexpected policy count' using errcode = 'P0001';
  end if;
end;
$$;
