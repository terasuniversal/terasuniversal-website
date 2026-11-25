-- ROLLBACK for 20261201130000_rbac_m10_contact_pii_select.sql (local design artefact; separate Owner approval required to run anywhere).
-- Re-creates the previous policies verbatim (captured from the Production-equivalent fixture, 2026-11-24).
set local lock_timeout = '5s';
drop policy if exists enquiries_select on public.enquiries;
create policy enquiries_select on public.enquiries as permissive for select to authenticated
  using (app.has_min_role('editor'::user_role));

drop policy if exists proposal_requests_select on public.proposal_requests;
create policy proposal_requests_select on public.proposal_requests as permissive for select to authenticated
  using (app.has_min_role('editor'::user_role));

drop policy if exists sales_internal_lead_sources_select on public.sales_internal_lead_sources;
create policy sales_internal_lead_sources_select on public.sales_internal_lead_sources as permissive for select to authenticated
  using ((app.has_min_role('editor'::user_role) AND ( SELECT app.has_any_module_access(ARRAY['sales'::text, 'sales_leads'::text, 'sales_opportunities'::text, 'sales_tasks'::text, 'sales_followups'::text, 'sales_reports'::text, 'marketing_contacts'::text], 'view'::text) AS has_any_module_access)));

drop policy if exists sales_lead_contact_overrides_select on public.sales_lead_contact_overrides;
create policy sales_lead_contact_overrides_select on public.sales_lead_contact_overrides as permissive for select to authenticated
  using ((app.has_min_role('editor'::user_role) AND ( SELECT app.has_any_module_access(ARRAY['sales'::text, 'sales_leads'::text, 'sales_opportunities'::text, 'sales_tasks'::text, 'sales_followups'::text, 'sales_reports'::text, 'marketing_contacts'::text], 'view'::text) AS has_any_module_access)));

drop policy if exists marketing_contacts_select on public.marketing_contacts;
create policy marketing_contacts_select on public.marketing_contacts as permissive for select to authenticated
  using (app.has_min_role('editor'::user_role));

drop policy if exists marketing_contact_events_select on public.marketing_contact_events;
create policy marketing_contact_events_select on public.marketing_contact_events as permissive for select to authenticated
  using (app.has_min_role('editor'::user_role));
