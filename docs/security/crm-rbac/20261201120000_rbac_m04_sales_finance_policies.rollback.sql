-- ROLLBACK for 20261201120000_rbac_m04_sales_finance_policies.sql (local design artefact; separate Owner approval required to run anywhere).
-- Re-creates the previous policies verbatim (captured from the Production-equivalent fixture, 2026-11-24).
set local lock_timeout = '5s';
drop policy if exists sales_lead_metadata_update on public.sales_lead_metadata;
create policy sales_lead_metadata_update on public.sales_lead_metadata as permissive for update to authenticated
  using ((app.is_admin() AND ( SELECT has_module_access_level('sales_leads'::text, 'edit'::text) AS has_module_access_level)))
  with check ((app.is_admin() AND ( SELECT has_module_access_level('sales_leads'::text, 'edit'::text) AS has_module_access_level)));

drop policy if exists sales_opportunities_insert on public.sales_opportunities;
create policy sales_opportunities_insert on public.sales_opportunities as permissive for insert to authenticated
  with check ((app.is_admin() AND (stage <> ALL (ARRAY['won'::text, 'cancelled'::text])) AND ( SELECT has_module_access_level('sales_opportunities'::text, 'edit'::text) AS has_module_access_level)));

drop policy if exists sales_opportunities_update on public.sales_opportunities;
create policy sales_opportunities_update on public.sales_opportunities as permissive for update to authenticated
  using ((app.is_admin() AND (stage <> ALL (ARRAY['won'::text, 'cancelled'::text])) AND ( SELECT app.has_any_module_access(ARRAY['sales_opportunities'::text, 'sales_quotations'::text], 'edit'::text) AS has_any_module_access)))
  with check ((app.is_admin() AND (stage <> ALL (ARRAY['won'::text, 'cancelled'::text])) AND ( SELECT app.has_any_module_access(ARRAY['sales_opportunities'::text, 'sales_quotations'::text], 'edit'::text) AS has_any_module_access)));

drop policy if exists sales_quotations_insert on public.sales_quotations;
create policy sales_quotations_insert on public.sales_quotations as permissive for insert to authenticated
  with check ((app.is_admin() AND (status <> ALL (ARRAY['accepted'::text, 'cancelled'::text])) AND ( SELECT has_module_access_level('sales_quotations'::text, 'edit'::text) AS has_module_access_level)));

drop policy if exists sales_quotations_update on public.sales_quotations;
create policy sales_quotations_update on public.sales_quotations as permissive for update to authenticated
  using ((app.is_admin() AND (status <> ALL (ARRAY['accepted'::text, 'cancelled'::text])) AND ( SELECT has_module_access_level('sales_quotations'::text, 'edit'::text) AS has_module_access_level)))
  with check ((app.is_admin() AND (status <> ALL (ARRAY['accepted'::text, 'cancelled'::text])) AND ( SELECT has_module_access_level('sales_quotations'::text, 'edit'::text) AS has_module_access_level)));

drop policy if exists sales_quotation_items_insert on public.sales_quotation_items;
create policy sales_quotation_items_insert on public.sales_quotation_items as permissive for insert to authenticated
  with check ((app.is_admin() AND ( SELECT has_module_access_level('sales_quotations'::text, 'edit'::text) AS has_module_access_level)));

drop policy if exists sales_quotation_items_update on public.sales_quotation_items;
create policy sales_quotation_items_update on public.sales_quotation_items as permissive for update to authenticated
  using ((app.is_admin() AND ( SELECT has_module_access_level('sales_quotations'::text, 'edit'::text) AS has_module_access_level)))
  with check ((app.is_admin() AND ( SELECT has_module_access_level('sales_quotations'::text, 'edit'::text) AS has_module_access_level)));

drop policy if exists sales_quotation_items_delete on public.sales_quotation_items;
create policy sales_quotation_items_delete on public.sales_quotation_items as permissive for delete to authenticated
  using ((app.is_admin() AND ( SELECT has_module_access_level('sales_quotations'::text, 'edit'::text) AS has_module_access_level)));

drop policy if exists sales_tasks_delete on public.sales_tasks;
create policy sales_tasks_delete on public.sales_tasks as permissive for delete to authenticated
  using ((app.is_admin() AND ( SELECT has_module_access_level('sales_tasks'::text, 'edit'::text) AS has_module_access_level)));

drop policy if exists sales_tasks_update on public.sales_tasks;
create policy sales_tasks_update on public.sales_tasks as permissive for update to authenticated
  using (((app.is_admin() OR (assigned_to = auth.uid()) OR (created_by = auth.uid())) AND ( SELECT has_module_access_level('sales_tasks'::text, 'edit'::text) AS has_module_access_level)))
  with check (((app.is_admin() OR (assigned_to = auth.uid()) OR (created_by = auth.uid())) AND ( SELECT has_module_access_level('sales_tasks'::text, 'edit'::text) AS has_module_access_level)));

drop policy if exists invoices_update on public.invoices;
create policy invoices_update on public.invoices as permissive for update to authenticated
  using ((app.is_admin() AND ( SELECT has_module_access_level('invoices'::text, 'edit'::text) AS has_module_access_level)))
  with check ((app.is_admin() AND ( SELECT has_module_access_level('invoices'::text, 'edit'::text) AS has_module_access_level)));
