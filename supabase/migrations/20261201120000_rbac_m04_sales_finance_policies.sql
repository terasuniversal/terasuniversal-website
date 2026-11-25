-- RBAC M-04 (H2): Sales and Finance write policies use app.can_module instead of the admin role.
-- Before: the 11 policies below required app.is_admin() AND the module level, so a departmental Editor with explicit
-- Custom Module Access could never perform Sales/Finance duties; departmental staff had to be made admin (H2).
-- After: app.can_module(module, level) - active account, valid catalog module and level, explicit grant at or above the
-- level, AND (admin role OR editor with access_control_enabled). An Editor on Role Default Access (fallback) gains
-- nothing. Business conditions (stage/status guards) are kept verbatim.
-- sales_tasks: an Editor may update only tasks assigned to or created by them (existing branch kept verbatim);
-- managing anyone else's tasks requires the admin role (as before) or sales_tasks at Admin level. Deleting tasks keeps
-- the previous admin rule and additionally allows sales_tasks at Admin level - Sales Staff (Edit) cannot delete tasks.
-- Requires 20261201110000 (app.can_module). Approval: OWNER-CRM-RBAC-DEV-20261124 (local; not applied anywhere).

set local lock_timeout = '5s';

do $m04_pre$
declare r record;
begin
  for r in
    select * from (values
      ($q$sales_lead_metadata$q$, $q$sales_lead_metadata_update$q$, $q$UPDATE$q$, $q$authenticated$q$, $q$(app.is_admin() AND ( SELECT has_module_access_level('sales_leads'::text, 'edit'::text) AS has_module_access_level))$q$, $q$(app.is_admin() AND ( SELECT has_module_access_level('sales_leads'::text, 'edit'::text) AS has_module_access_level))$q$),
      ($q$sales_opportunities$q$, $q$sales_opportunities_insert$q$, $q$INSERT$q$, $q$authenticated$q$, null, $q$(app.is_admin() AND (stage <> ALL (ARRAY['won'::text, 'cancelled'::text])) AND ( SELECT has_module_access_level('sales_opportunities'::text, 'edit'::text) AS has_module_access_level))$q$),
      ($q$sales_opportunities$q$, $q$sales_opportunities_update$q$, $q$UPDATE$q$, $q$authenticated$q$, $q$(app.is_admin() AND (stage <> ALL (ARRAY['won'::text, 'cancelled'::text])) AND ( SELECT app.has_any_module_access(ARRAY['sales_opportunities'::text, 'sales_quotations'::text], 'edit'::text) AS has_any_module_access))$q$, $q$(app.is_admin() AND (stage <> ALL (ARRAY['won'::text, 'cancelled'::text])) AND ( SELECT app.has_any_module_access(ARRAY['sales_opportunities'::text, 'sales_quotations'::text], 'edit'::text) AS has_any_module_access))$q$),
      ($q$sales_quotations$q$, $q$sales_quotations_insert$q$, $q$INSERT$q$, $q$authenticated$q$, null, $q$(app.is_admin() AND (status <> ALL (ARRAY['accepted'::text, 'cancelled'::text])) AND ( SELECT has_module_access_level('sales_quotations'::text, 'edit'::text) AS has_module_access_level))$q$),
      ($q$sales_quotations$q$, $q$sales_quotations_update$q$, $q$UPDATE$q$, $q$authenticated$q$, $q$(app.is_admin() AND (status <> ALL (ARRAY['accepted'::text, 'cancelled'::text])) AND ( SELECT has_module_access_level('sales_quotations'::text, 'edit'::text) AS has_module_access_level))$q$, $q$(app.is_admin() AND (status <> ALL (ARRAY['accepted'::text, 'cancelled'::text])) AND ( SELECT has_module_access_level('sales_quotations'::text, 'edit'::text) AS has_module_access_level))$q$),
      ($q$sales_quotation_items$q$, $q$sales_quotation_items_insert$q$, $q$INSERT$q$, $q$authenticated$q$, null, $q$(app.is_admin() AND ( SELECT has_module_access_level('sales_quotations'::text, 'edit'::text) AS has_module_access_level))$q$),
      ($q$sales_quotation_items$q$, $q$sales_quotation_items_update$q$, $q$UPDATE$q$, $q$authenticated$q$, $q$(app.is_admin() AND ( SELECT has_module_access_level('sales_quotations'::text, 'edit'::text) AS has_module_access_level))$q$, $q$(app.is_admin() AND ( SELECT has_module_access_level('sales_quotations'::text, 'edit'::text) AS has_module_access_level))$q$),
      ($q$sales_quotation_items$q$, $q$sales_quotation_items_delete$q$, $q$DELETE$q$, $q$authenticated$q$, $q$(app.is_admin() AND ( SELECT has_module_access_level('sales_quotations'::text, 'edit'::text) AS has_module_access_level))$q$, null),
      ($q$sales_tasks$q$, $q$sales_tasks_delete$q$, $q$DELETE$q$, $q$authenticated$q$, $q$(app.is_admin() AND ( SELECT has_module_access_level('sales_tasks'::text, 'edit'::text) AS has_module_access_level))$q$, null),
      ($q$sales_tasks$q$, $q$sales_tasks_update$q$, $q$UPDATE$q$, $q$authenticated$q$, $q$((app.is_admin() OR (assigned_to = auth.uid()) OR (created_by = auth.uid())) AND ( SELECT has_module_access_level('sales_tasks'::text, 'edit'::text) AS has_module_access_level))$q$, $q$((app.is_admin() OR (assigned_to = auth.uid()) OR (created_by = auth.uid())) AND ( SELECT has_module_access_level('sales_tasks'::text, 'edit'::text) AS has_module_access_level))$q$),
      ($q$invoices$q$, $q$invoices_update$q$, $q$UPDATE$q$, $q$authenticated$q$, $q$(app.is_admin() AND ( SELECT has_module_access_level('invoices'::text, 'edit'::text) AS has_module_access_level))$q$, $q$(app.is_admin() AND ( SELECT has_module_access_level('invoices'::text, 'edit'::text) AS has_module_access_level))$q$)
    ) as t(tbl, pol, cmd, roles, qual, chk)
  loop
    if not exists (select 1 from pg_policies p
                   where p.schemaname = 'public' and p.tablename = r.tbl and p.policyname = r.pol and p.cmd = r.cmd
                     and array_to_string(p.roles, ',') = r.roles and p.permissive = 'PERMISSIVE'
                     and p.qual is not distinct from r.qual and p.with_check is not distinct from r.chk) then
      raise exception 'm04_precondition_failed: policy %.% is not the reviewed pre-state - nothing changed', r.tbl, r.pol using errcode = 'P0001';
    end if;
  end loop;
end;
$m04_pre$;

drop policy if exists sales_lead_metadata_update on public.sales_lead_metadata;
create policy sales_lead_metadata_update on public.sales_lead_metadata as permissive for update to authenticated
  using (( SELECT app.can_module('sales_leads'::text, 'edit'::text) AS can_module))
  with check (( SELECT app.can_module('sales_leads'::text, 'edit'::text) AS can_module));

drop policy if exists sales_opportunities_insert on public.sales_opportunities;
create policy sales_opportunities_insert on public.sales_opportunities as permissive for insert to authenticated
  with check ((( SELECT app.can_module('sales_opportunities'::text, 'edit'::text) AS can_module) AND (stage <> ALL (ARRAY['won'::text, 'cancelled'::text]))));

drop policy if exists sales_opportunities_update on public.sales_opportunities;
create policy sales_opportunities_update on public.sales_opportunities as permissive for update to authenticated
  using (((( SELECT app.can_module('sales_opportunities'::text, 'edit'::text) AS can_module) OR ( SELECT app.can_module('sales_quotations'::text, 'edit'::text) AS can_module)) AND (stage <> ALL (ARRAY['won'::text, 'cancelled'::text]))))
  with check (((( SELECT app.can_module('sales_opportunities'::text, 'edit'::text) AS can_module) OR ( SELECT app.can_module('sales_quotations'::text, 'edit'::text) AS can_module)) AND (stage <> ALL (ARRAY['won'::text, 'cancelled'::text]))));

drop policy if exists sales_quotations_insert on public.sales_quotations;
create policy sales_quotations_insert on public.sales_quotations as permissive for insert to authenticated
  with check ((( SELECT app.can_module('sales_quotations'::text, 'edit'::text) AS can_module) AND (status <> ALL (ARRAY['accepted'::text, 'cancelled'::text]))));

drop policy if exists sales_quotations_update on public.sales_quotations;
create policy sales_quotations_update on public.sales_quotations as permissive for update to authenticated
  using ((( SELECT app.can_module('sales_quotations'::text, 'edit'::text) AS can_module) AND (status <> ALL (ARRAY['accepted'::text, 'cancelled'::text]))))
  with check ((( SELECT app.can_module('sales_quotations'::text, 'edit'::text) AS can_module) AND (status <> ALL (ARRAY['accepted'::text, 'cancelled'::text]))));

drop policy if exists sales_quotation_items_insert on public.sales_quotation_items;
create policy sales_quotation_items_insert on public.sales_quotation_items as permissive for insert to authenticated
  with check (( SELECT app.can_module('sales_quotations'::text, 'edit'::text) AS can_module));

drop policy if exists sales_quotation_items_update on public.sales_quotation_items;
create policy sales_quotation_items_update on public.sales_quotation_items as permissive for update to authenticated
  using (( SELECT app.can_module('sales_quotations'::text, 'edit'::text) AS can_module))
  with check (( SELECT app.can_module('sales_quotations'::text, 'edit'::text) AS can_module));

drop policy if exists sales_quotation_items_delete on public.sales_quotation_items;
create policy sales_quotation_items_delete on public.sales_quotation_items as permissive for delete to authenticated
  using (( SELECT app.can_module('sales_quotations'::text, 'edit'::text) AS can_module));

drop policy if exists sales_tasks_delete on public.sales_tasks;
create policy sales_tasks_delete on public.sales_tasks as permissive for delete to authenticated
  using (((app.is_admin() AND ( SELECT public.has_module_access_level('sales_tasks'::text, 'edit'::text) AS has_module_access_level)) OR ( SELECT app.can_module('sales_tasks'::text, 'admin'::text) AS can_module)));

drop policy if exists sales_tasks_update on public.sales_tasks;
create policy sales_tasks_update on public.sales_tasks as permissive for update to authenticated
  using ((((app.is_admin() OR (assigned_to = auth.uid()) OR (created_by = auth.uid())) AND ( SELECT public.has_module_access_level('sales_tasks'::text, 'edit'::text) AS has_module_access_level)) OR ( SELECT app.can_module('sales_tasks'::text, 'admin'::text) AS can_module)))
  with check ((((app.is_admin() OR (assigned_to = auth.uid()) OR (created_by = auth.uid())) AND ( SELECT public.has_module_access_level('sales_tasks'::text, 'edit'::text) AS has_module_access_level)) OR ( SELECT app.can_module('sales_tasks'::text, 'admin'::text) AS can_module)));

drop policy if exists invoices_update on public.invoices;
create policy invoices_update on public.invoices as permissive for update to authenticated
  using (( SELECT app.can_module('invoices'::text, 'edit'::text) AS can_module))
  with check (( SELECT app.can_module('invoices'::text, 'edit'::text) AS can_module));

do $m04_post$
declare r record;
begin
  for r in
    select * from (values
      ($q$sales_lead_metadata$q$, $q$sales_lead_metadata_update$q$, $q$UPDATE$q$, $q$authenticated$q$, $q$can_module('sales_leads'$q$),
      ($q$sales_opportunities$q$, $q$sales_opportunities_insert$q$, $q$INSERT$q$, $q$authenticated$q$, $q$can_module('sales_opportunities'$q$),
      ($q$sales_opportunities$q$, $q$sales_opportunities_update$q$, $q$UPDATE$q$, $q$authenticated$q$, $q$can_module('sales_quotations'$q$),
      ($q$sales_quotations$q$, $q$sales_quotations_insert$q$, $q$INSERT$q$, $q$authenticated$q$, $q$can_module('sales_quotations'$q$),
      ($q$sales_quotations$q$, $q$sales_quotations_update$q$, $q$UPDATE$q$, $q$authenticated$q$, $q$can_module('sales_quotations'$q$),
      ($q$sales_quotation_items$q$, $q$sales_quotation_items_insert$q$, $q$INSERT$q$, $q$authenticated$q$, $q$can_module('sales_quotations'$q$),
      ($q$sales_quotation_items$q$, $q$sales_quotation_items_update$q$, $q$UPDATE$q$, $q$authenticated$q$, $q$can_module('sales_quotations'$q$),
      ($q$sales_quotation_items$q$, $q$sales_quotation_items_delete$q$, $q$DELETE$q$, $q$authenticated$q$, $q$can_module('sales_quotations'$q$),
      ($q$sales_tasks$q$, $q$sales_tasks_delete$q$, $q$DELETE$q$, $q$authenticated$q$, $q$can_module('sales_tasks'$q$),
      ($q$sales_tasks$q$, $q$sales_tasks_update$q$, $q$UPDATE$q$, $q$authenticated$q$, $q$can_module('sales_tasks'$q$),
      ($q$invoices$q$, $q$invoices_update$q$, $q$UPDATE$q$, $q$authenticated$q$, $q$can_module('invoices'$q$)
    ) as t(tbl, pol, cmd, roles, token)
  loop
    if not exists (select 1 from pg_policies p
                   where p.schemaname = 'public' and p.tablename = r.tbl and p.policyname = r.pol and p.cmd = r.cmd
                     and array_to_string(p.roles, ',') = r.roles
                     and position(r.token in coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '')) > 0) then
      raise exception 'm04_postcondition_failed: policy %.% is not as intended', r.tbl, r.pol using errcode = 'P0001';
    end if;
  end loop;
end;
$m04_post$;
