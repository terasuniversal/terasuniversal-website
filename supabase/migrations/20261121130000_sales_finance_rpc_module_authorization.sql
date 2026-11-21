-- M-S4b: module authorization for nine sales/finance RPCs and the remaining Sales CRM table policies.
--
-- Why: these SECURITY DEFINER RPCs check the role only (app.is_admin(), or super_admin for mark_lead_test), so an
-- admin whose module is View or None could accept/reject quotations, convert or classify leads, mark opportunities
-- lost, and create/issue/cancel invoices or HRDF claims through a direct PostgREST call. The Server Actions already
-- require the module (PR #227). sales_quotation_items writes were admin-only with no Quotations module check, and the
-- SELECT policies of sales_quotation_items, sales_internal_lead_sources and sales_lead_contact_overrides were
-- role-only (same gap as M-S4 F5). Verified on Custom Staging by ms4-01 (2026-11-21).
--
-- Requires M-S4 (20261121120000: app.has_any_module_access) and runs after it.
--
-- Rule applied: nothing is widened. Every RPC keeps its body, role rule and business validation byte-for-byte (the
-- original is renamed to *_unguarded and is no longer callable by any client role); a same-signature wrapper first
-- requires exactly the module(s) that the calling Server Action already requires, raising the RPC's own
-- authorization error (same message and SQLSTATE), then calls the original. super_admin and access_control_enabled =
-- false staff behave as before through public.has_module_access_level. No Finance or HRDF permission is granted to
-- anyone: create_hrdf_claim_for_invoice requires invoices edit AND hrdf_claims edit, as its Server Action does.
--
-- Module per RPC (from the Server Action guards in PR #227):
--   accept_quotation, reject_quotation          sales_quotations edit
--   convert_lead_to_opportunity, mark_lead_test  sales_leads edit
--   mark_opportunity_lost                        sales_opportunities edit
--   create_invoice_from_quotation, issue_invoice, cancel_invoice   invoices edit
--   create_hrdf_claim_for_invoice                invoices edit AND hrdf_claims edit
--
-- Policies:
--   sales_quotation_items INSERT/UPDATE/DELETE: previous app.is_admin() AND Quotations edit.
--   sales_quotation_items SELECT: same read set as sales_quotations (anyone who may see a quotation may see its lines).
--   sales_internal_lead_sources / sales_lead_contact_overrides SELECT: same read set as sales_lead_metadata, because
--     v_sales_lead_inbox (security_invoker) joins both for every Lead Inbox reader.
--
-- Fail-closed: aborts unless M-S4 is present, every RPC has exactly the expected signature and result type and no
-- *_unguarded copy exists yet, and every replaced policy has exactly the expected text, roles and count.
-- Rollback: ms4b-05-staging-rollback.sql in the M-S4b package.

do $$
declare
  r record;
  v_count int;
begin
  if to_regprocedure('app.has_any_module_access(text[],text)') is null then
    raise exception 'ms4b_precondition_failed: M-S4 (app.has_any_module_access) is not applied' using errcode = 'P0001';
  end if;

  for r in
    select * from (values
      ('public.accept_quotation(uuid)', 'void'),
      ('public.reject_quotation(uuid,text)', 'void'),
      ('public.convert_lead_to_opportunity(uuid,text,date,numeric)', 'uuid'),
      ('public.mark_opportunity_lost(uuid,text)', 'void'),
      ('public.mark_lead_test(uuid,boolean)', 'void'),
      ('public.create_invoice_from_quotation(uuid)', 'uuid'),
      ('public.issue_invoice(uuid)', 'jsonb'),
      ('public.cancel_invoice(uuid,text)', 'jsonb'),
      ('public.create_hrdf_claim_for_invoice(uuid)', 'uuid')
    ) t(sig, result)
  loop
    if to_regprocedure(r.sig) is null
       or pg_get_function_result(to_regprocedure(r.sig)) <> r.result
       or not (select prosecdef from pg_proc where oid = to_regprocedure(r.sig))
       or to_regprocedure(replace(r.sig, '(', '_unguarded(')) is not null then
      raise exception 'ms4b_precondition_failed: % is not in the expected pre-M-S4b state', r.sig using errcode = 'P0001';
    end if;
  end loop;

  for r in
    select * from (values
      ('sales_quotation_items', 'sales_quotation_items_select', 'SELECT', $q$app.has_min_role('editor'::user_role)$q$, null::text),
      ('sales_quotation_items', 'sales_quotation_items_insert', 'INSERT', null, $q$app.is_admin()$q$),
      ('sales_quotation_items', 'sales_quotation_items_update', 'UPDATE', $q$app.is_admin()$q$, $q$app.is_admin()$q$),
      ('sales_quotation_items', 'sales_quotation_items_delete', 'DELETE', $q$app.is_admin()$q$, null),
      ('sales_internal_lead_sources', 'sales_internal_lead_sources_select', 'SELECT', $q$app.has_min_role('editor'::user_role)$q$, null),
      ('sales_lead_contact_overrides', 'sales_lead_contact_overrides_select', 'SELECT', $q$app.has_min_role('editor'::user_role)$q$, null)
    ) t(tbl, pol, cmd, qual, chk)
  loop
    if not exists (
      select 1 from pg_policies p
      where p.schemaname = 'public' and p.tablename = r.tbl and p.policyname = r.pol and p.cmd = r.cmd
        and p.permissive = 'PERMISSIVE' and p.roles = array['authenticated']::name[]
        and p.qual is not distinct from r.qual and p.with_check is not distinct from r.chk
    ) then
      raise exception 'ms4b_precondition_failed: policy %.% is not the expected definition', r.tbl, r.pol
        using errcode = 'P0001';
    end if;
  end loop;

  for r in
    select * from (values ('sales_quotation_items', 4), ('sales_internal_lead_sources', 1), ('sales_lead_contact_overrides', 1)) t(tbl, n)
  loop
    select count(*) into v_count from pg_policies where schemaname = 'public' and tablename = r.tbl;
    if v_count <> r.n then
      raise exception 'ms4b_precondition_failed: % has % policies, expected %', r.tbl, v_count, r.n using errcode = 'P0001';
    end if;
  end loop;

  select count(*) into v_count
  from unnest(array['sales_leads', 'sales_opportunities', 'sales_quotations', 'invoices', 'hrdf_claims']) k
  where not exists (select 1 from public.staff_module_catalog c where c.module_key = k and c.is_active);
  if v_count <> 0 then
    raise exception 'ms4b_precondition_failed: % module key(s) missing or inactive', v_count using errcode = 'P0001';
  end if;
end;
$$;

-- ---- A. RPCs: keep the originals, add module-checking wrappers -------------------------------------------------
do $$
begin
  if to_regprocedure('public.accept_quotation_unguarded(uuid)') is null then
    alter function public.accept_quotation(uuid) rename to accept_quotation_unguarded;
  end if;
  if to_regprocedure('public.reject_quotation_unguarded(uuid,text)') is null then
    alter function public.reject_quotation(uuid, text) rename to reject_quotation_unguarded;
  end if;
  if to_regprocedure('public.convert_lead_to_opportunity_unguarded(uuid,text,date,numeric)') is null then
    alter function public.convert_lead_to_opportunity(uuid, text, date, numeric) rename to convert_lead_to_opportunity_unguarded;
  end if;
  if to_regprocedure('public.mark_opportunity_lost_unguarded(uuid,text)') is null then
    alter function public.mark_opportunity_lost(uuid, text) rename to mark_opportunity_lost_unguarded;
  end if;
  if to_regprocedure('public.mark_lead_test_unguarded(uuid,boolean)') is null then
    alter function public.mark_lead_test(uuid, boolean) rename to mark_lead_test_unguarded;
  end if;
  if to_regprocedure('public.create_invoice_from_quotation_unguarded(uuid)') is null then
    alter function public.create_invoice_from_quotation(uuid) rename to create_invoice_from_quotation_unguarded;
  end if;
  if to_regprocedure('public.issue_invoice_unguarded(uuid)') is null then
    alter function public.issue_invoice(uuid) rename to issue_invoice_unguarded;
  end if;
  if to_regprocedure('public.cancel_invoice_unguarded(uuid,text)') is null then
    alter function public.cancel_invoice(uuid, text) rename to cancel_invoice_unguarded;
  end if;
  if to_regprocedure('public.create_hrdf_claim_for_invoice_unguarded(uuid)') is null then
    alter function public.create_hrdf_claim_for_invoice(uuid) rename to create_hrdf_claim_for_invoice_unguarded;
  end if;
end;
$$;

revoke all on function public.accept_quotation_unguarded(uuid) from public, anon, authenticated, service_role;
revoke all on function public.reject_quotation_unguarded(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.convert_lead_to_opportunity_unguarded(uuid, text, date, numeric) from public, anon, authenticated, service_role;
revoke all on function public.mark_opportunity_lost_unguarded(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.mark_lead_test_unguarded(uuid, boolean) from public, anon, authenticated, service_role;
revoke all on function public.create_invoice_from_quotation_unguarded(uuid) from public, anon, authenticated, service_role;
revoke all on function public.issue_invoice_unguarded(uuid) from public, anon, authenticated, service_role;
revoke all on function public.cancel_invoice_unguarded(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.create_hrdf_claim_for_invoice_unguarded(uuid) from public, anon, authenticated, service_role;

create or replace function public.accept_quotation(p_quotation_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_module_access_level('sales_quotations', 'edit') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform public.accept_quotation_unguarded(p_quotation_id);
end;
$$;

create or replace function public.reject_quotation(p_quotation_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_module_access_level('sales_quotations', 'edit') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform public.reject_quotation_unguarded(p_quotation_id, p_reason);
end;
$$;

create or replace function public.convert_lead_to_opportunity(
  p_lead_metadata_id uuid, p_title text, p_expected_close_date date, p_estimated_value numeric
)
returns uuid language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_module_access_level('sales_leads', 'edit') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return public.convert_lead_to_opportunity_unguarded(p_lead_metadata_id, p_title, p_expected_close_date, p_estimated_value);
end;
$$;

create or replace function public.mark_opportunity_lost(p_opportunity_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_module_access_level('sales_opportunities', 'edit') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform public.mark_opportunity_lost_unguarded(p_opportunity_id, p_reason);
end;
$$;

create or replace function public.mark_lead_test(p_lead_metadata_id uuid, p_is_test boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_module_access_level('sales_leads', 'edit') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform public.mark_lead_test_unguarded(p_lead_metadata_id, p_is_test);
end;
$$;

create or replace function public.create_invoice_from_quotation(p_quotation_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_module_access_level('invoices', 'edit') then
    raise exception 'not_authorized' using errcode = 'P0001';
  end if;
  return public.create_invoice_from_quotation_unguarded(p_quotation_id);
end;
$$;

create or replace function public.issue_invoice(p_invoice_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_module_access_level('invoices', 'edit') then
    raise exception 'not_authorized' using errcode = 'P0001';
  end if;
  return public.issue_invoice_unguarded(p_invoice_id);
end;
$$;

create or replace function public.cancel_invoice(p_invoice_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_module_access_level('invoices', 'edit') then
    raise exception 'not_authorized' using errcode = 'P0001';
  end if;
  return public.cancel_invoice_unguarded(p_invoice_id, p_reason);
end;
$$;

create or replace function public.create_hrdf_claim_for_invoice(p_invoice_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
begin
  if not (public.has_module_access_level('invoices', 'edit') and public.has_module_access_level('hrdf_claims', 'edit')) then
    raise exception 'not_authorized' using errcode = 'P0001';
  end if;
  return public.create_hrdf_claim_for_invoice_unguarded(p_invoice_id);
end;
$$;

do $$
declare
  s text;
begin
  foreach s in array array[
    'public.accept_quotation(uuid)', 'public.reject_quotation(uuid,text)',
    'public.convert_lead_to_opportunity(uuid,text,date,numeric)', 'public.mark_opportunity_lost(uuid,text)',
    'public.mark_lead_test(uuid,boolean)', 'public.create_invoice_from_quotation(uuid)', 'public.issue_invoice(uuid)',
    'public.cancel_invoice(uuid,text)', 'public.create_hrdf_claim_for_invoice(uuid)']
  loop
    execute format('alter function %s owner to postgres', s);
    execute format('revoke all on function %s from public, anon, service_role', s);
    execute format('grant execute on function %s to authenticated', s);
  end loop;
end;
$$;

-- ---- B. Policies ---------------------------------------------------------------------------------------------
drop policy if exists sales_quotation_items_select on public.sales_quotation_items;
create policy sales_quotation_items_select on public.sales_quotation_items
  for select to authenticated
  using (
    app.has_min_role('editor'::public.user_role)
    and (select app.has_any_module_access(array['sales', 'sales_leads', 'sales_opportunities', 'sales_quotations',
                                                'sales_tasks', 'sales_followups', 'sales_reports', 'invoices',
                                                'schedules']::text[], 'view'))
  );

drop policy if exists sales_quotation_items_insert on public.sales_quotation_items;
create policy sales_quotation_items_insert on public.sales_quotation_items
  for insert to authenticated
  with check (
    app.is_admin()
    and (select public.has_module_access_level('sales_quotations', 'edit'))
  );

drop policy if exists sales_quotation_items_update on public.sales_quotation_items;
create policy sales_quotation_items_update on public.sales_quotation_items
  for update to authenticated
  using (
    app.is_admin()
    and (select public.has_module_access_level('sales_quotations', 'edit'))
  )
  with check (
    app.is_admin()
    and (select public.has_module_access_level('sales_quotations', 'edit'))
  );

drop policy if exists sales_quotation_items_delete on public.sales_quotation_items;
create policy sales_quotation_items_delete on public.sales_quotation_items
  for delete to authenticated
  using (
    app.is_admin()
    and (select public.has_module_access_level('sales_quotations', 'edit'))
  );

drop policy if exists sales_internal_lead_sources_select on public.sales_internal_lead_sources;
create policy sales_internal_lead_sources_select on public.sales_internal_lead_sources
  for select to authenticated
  using (
    app.has_min_role('editor'::public.user_role)
    and (select app.has_any_module_access(array['sales', 'sales_leads', 'sales_opportunities', 'sales_tasks',
                                                'sales_followups', 'sales_reports', 'marketing_contacts']::text[], 'view'))
  );

drop policy if exists sales_lead_contact_overrides_select on public.sales_lead_contact_overrides;
create policy sales_lead_contact_overrides_select on public.sales_lead_contact_overrides
  for select to authenticated
  using (
    app.has_min_role('editor'::public.user_role)
    and (select app.has_any_module_access(array['sales', 'sales_leads', 'sales_opportunities', 'sales_tasks',
                                                'sales_followups', 'sales_reports', 'marketing_contacts']::text[], 'view'))
  );

-- ---- Postconditions --------------------------------------------------------------------------------------------
do $$
declare
  s text;
begin
  foreach s in array array[
    'public.accept_quotation_unguarded(uuid)', 'public.reject_quotation_unguarded(uuid,text)',
    'public.convert_lead_to_opportunity_unguarded(uuid,text,date,numeric)', 'public.mark_opportunity_lost_unguarded(uuid,text)',
    'public.mark_lead_test_unguarded(uuid,boolean)', 'public.create_invoice_from_quotation_unguarded(uuid)',
    'public.issue_invoice_unguarded(uuid)', 'public.cancel_invoice_unguarded(uuid,text)',
    'public.create_hrdf_claim_for_invoice_unguarded(uuid)']
  loop
    if has_function_privilege('authenticated', s, 'EXECUTE') or has_function_privilege('anon', s, 'EXECUTE')
       or has_function_privilege('service_role', s, 'EXECUTE') then
      raise exception 'ms4b_postcondition_failed: % is still client-callable', s using errcode = 'P0001';
    end if;
    if not has_function_privilege('authenticated', replace(s, '_unguarded(', '('), 'EXECUTE')
       or has_function_privilege('anon', replace(s, '_unguarded(', '('), 'EXECUTE') then
      raise exception 'ms4b_postcondition_failed: wrapper grants for % are not as intended', s using errcode = 'P0001';
    end if;
  end loop;
  if (select count(*) from pg_policies where schemaname = 'public'
        and tablename in ('sales_quotation_items', 'sales_internal_lead_sources', 'sales_lead_contact_overrides')) <> 6 then
    raise exception 'ms4b_postcondition_failed: unexpected policy count' using errcode = 'P0001';
  end if;
end;
$$;
