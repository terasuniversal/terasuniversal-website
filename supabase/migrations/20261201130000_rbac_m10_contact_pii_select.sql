-- RBAC M-10 (O-1 follow-up): staff SELECT on lead and marketing contact PII requires a module that renders it.
-- Before: enquiries, proposal_requests, marketing_contacts and marketing_contact_events were readable by ANY active
-- editor or admin (app.has_min_role('editor') only), and sales_internal_lead_sources / sales_lead_contact_overrides by
-- anyone holding one of the Sales modules INCLUDING sales_reports. So every Finance Staff (Sales Reports View) and every
-- other departmental editor could read names, emails, phone numbers and messages from public forms and marketing.
-- After (SELECT policies only; every INSERT, UPDATE and DELETE policy is untouched):
--  * enquiries, proposal_requests, sales_internal_lead_sources, sales_lead_contact_overrides: editor floor AND View on
--    sales, sales_leads, sales_opportunities, sales_tasks, sales_followups or marketing_contacts (the lead-metadata list
--    WITHOUT sales_reports). Sales Reports renders only sales_lead_metadata, opportunities and quotations (no contact
--    columns), so reports keep working; v_sales_lead_inbox is security_invoker and shows no contact columns to a
--    Sales Reports-only holder.
--  * marketing_contacts: editor floor AND (View on marketing or marketing_contacts, OR View on a Sales module and the
--    contact has been promoted to a lead, i.e. a sales_lead_metadata row with lead_source 'marketing_contact').
--  * marketing_contact_events: editor floor AND marketing_contacts View.
--  * sales_lead_metadata (no contact columns) is NOT changed: Sales Reports keeps its lead statistics.
-- Public submissions (submit_public_enquiry, submit_proposal_request, the W9 eBook RPC) are SECURITY DEFINER and not
-- affected; anon has no policy on these tables before or after; service_role bypasses RLS. No grants change.
-- Requires 20261201110000 (ordering: released after DB C). Approval: OWNER-CRM-RBAC-M10-20261125.

do $m10_requires$
begin
  if to_regprocedure('app.can_module(text,text)') is null or to_regprocedure('app.has_any_module_access(text[],text)') is null then
    raise exception 'm10_precondition_failed: app.can_module / app.has_any_module_access missing - apply DB B first; nothing changed' using errcode = 'P0001';
  end if;
end;
$m10_requires$;

set local lock_timeout = '5s';

do $m10_pre$
declare r record;
begin
  for r in
    select * from (values
      ($q$enquiries$q$, $q$enquiries_select$q$, $q$SELECT$q$, $q$authenticated$q$, $q$app.has_min_role('editor'::user_role)$q$, null),
      ($q$proposal_requests$q$, $q$proposal_requests_select$q$, $q$SELECT$q$, $q$authenticated$q$, $q$app.has_min_role('editor'::user_role)$q$, null),
      ($q$sales_internal_lead_sources$q$, $q$sales_internal_lead_sources_select$q$, $q$SELECT$q$, $q$authenticated$q$, $q$(app.has_min_role('editor'::user_role) AND ( SELECT app.has_any_module_access(ARRAY['sales'::text, 'sales_leads'::text, 'sales_opportunities'::text, 'sales_tasks'::text, 'sales_followups'::text, 'sales_reports'::text, 'marketing_contacts'::text], 'view'::text) AS has_any_module_access))$q$, null),
      ($q$sales_lead_contact_overrides$q$, $q$sales_lead_contact_overrides_select$q$, $q$SELECT$q$, $q$authenticated$q$, $q$(app.has_min_role('editor'::user_role) AND ( SELECT app.has_any_module_access(ARRAY['sales'::text, 'sales_leads'::text, 'sales_opportunities'::text, 'sales_tasks'::text, 'sales_followups'::text, 'sales_reports'::text, 'marketing_contacts'::text], 'view'::text) AS has_any_module_access))$q$, null),
      ($q$marketing_contacts$q$, $q$marketing_contacts_select$q$, $q$SELECT$q$, $q$authenticated$q$, $q$app.has_min_role('editor'::user_role)$q$, null),
      ($q$marketing_contact_events$q$, $q$marketing_contact_events_select$q$, $q$SELECT$q$, $q$authenticated$q$, $q$app.has_min_role('editor'::user_role)$q$, null)
    ) as t(tbl, pol, cmd, roles, qual, chk)
  loop
    if not exists (select 1 from pg_policies p
                   where p.schemaname = 'public' and p.tablename = r.tbl and p.policyname = r.pol and p.cmd = r.cmd
                     and array_to_string(p.roles, ',') = r.roles and p.permissive = 'PERMISSIVE'
                     and p.qual is not distinct from r.qual and p.with_check is not distinct from r.chk) then
      raise exception 'm10_precondition_failed: policy %.% is not the reviewed pre-state - nothing changed', r.tbl, r.pol using errcode = 'P0001';
    end if;
  end loop;
end;
$m10_pre$;

drop policy if exists enquiries_select on public.enquiries;
create policy enquiries_select on public.enquiries as permissive for select to authenticated
  using ((app.has_min_role('editor'::public.user_role) AND ( SELECT app.has_any_module_access(ARRAY['sales'::text, 'sales_leads'::text, 'sales_opportunities'::text, 'sales_tasks'::text, 'sales_followups'::text, 'marketing_contacts'::text], 'view'::text) AS has_any_module_access)));

drop policy if exists proposal_requests_select on public.proposal_requests;
create policy proposal_requests_select on public.proposal_requests as permissive for select to authenticated
  using ((app.has_min_role('editor'::public.user_role) AND ( SELECT app.has_any_module_access(ARRAY['sales'::text, 'sales_leads'::text, 'sales_opportunities'::text, 'sales_tasks'::text, 'sales_followups'::text, 'marketing_contacts'::text], 'view'::text) AS has_any_module_access)));

drop policy if exists sales_internal_lead_sources_select on public.sales_internal_lead_sources;
create policy sales_internal_lead_sources_select on public.sales_internal_lead_sources as permissive for select to authenticated
  using ((app.has_min_role('editor'::public.user_role) AND ( SELECT app.has_any_module_access(ARRAY['sales'::text, 'sales_leads'::text, 'sales_opportunities'::text, 'sales_tasks'::text, 'sales_followups'::text, 'marketing_contacts'::text], 'view'::text) AS has_any_module_access)));

drop policy if exists sales_lead_contact_overrides_select on public.sales_lead_contact_overrides;
create policy sales_lead_contact_overrides_select on public.sales_lead_contact_overrides as permissive for select to authenticated
  using ((app.has_min_role('editor'::public.user_role) AND ( SELECT app.has_any_module_access(ARRAY['sales'::text, 'sales_leads'::text, 'sales_opportunities'::text, 'sales_tasks'::text, 'sales_followups'::text, 'marketing_contacts'::text], 'view'::text) AS has_any_module_access)));

drop policy if exists marketing_contacts_select on public.marketing_contacts;
create policy marketing_contacts_select on public.marketing_contacts as permissive for select to authenticated
  using ((app.has_min_role('editor'::public.user_role) AND (( SELECT app.has_any_module_access(ARRAY['marketing'::text, 'marketing_contacts'::text], 'view'::text) AS has_any_module_access) OR (( SELECT app.has_any_module_access(ARRAY['sales'::text, 'sales_leads'::text, 'sales_opportunities'::text, 'sales_tasks'::text, 'sales_followups'::text], 'view'::text) AS has_any_module_access) AND (EXISTS ( SELECT 1 FROM public.sales_lead_metadata m WHERE ((m.lead_source = 'marketing_contact'::text) AND (m.source_id = marketing_contacts.id))))))));

drop policy if exists marketing_contact_events_select on public.marketing_contact_events;
create policy marketing_contact_events_select on public.marketing_contact_events as permissive for select to authenticated
  using ((app.has_min_role('editor'::public.user_role) AND ( SELECT app.has_any_module_access(ARRAY['marketing_contacts'::text], 'view'::text) AS has_any_module_access)));

do $m10_post$
declare r record;
begin
  for r in
    select * from (values
      ($q$enquiries$q$, $q$enquiries_select$q$, $q$SELECT$q$, $q$authenticated$q$, $q$has_any_module_access$q$),
      ($q$proposal_requests$q$, $q$proposal_requests_select$q$, $q$SELECT$q$, $q$authenticated$q$, $q$has_any_module_access$q$),
      ($q$sales_internal_lead_sources$q$, $q$sales_internal_lead_sources_select$q$, $q$SELECT$q$, $q$authenticated$q$, $q$has_any_module_access$q$),
      ($q$sales_lead_contact_overrides$q$, $q$sales_lead_contact_overrides_select$q$, $q$SELECT$q$, $q$authenticated$q$, $q$has_any_module_access$q$),
      ($q$marketing_contacts$q$, $q$marketing_contacts_select$q$, $q$SELECT$q$, $q$authenticated$q$, $q$sales_lead_metadata$q$),
      ($q$marketing_contact_events$q$, $q$marketing_contact_events_select$q$, $q$SELECT$q$, $q$authenticated$q$, $q$has_any_module_access$q$)
    ) as t(tbl, pol, cmd, roles, token)
  loop
    if not exists (select 1 from pg_policies p
                   where p.schemaname = 'public' and p.tablename = r.tbl and p.policyname = r.pol and p.cmd = r.cmd
                     and array_to_string(p.roles, ',') = r.roles
                     and position(r.token in coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '')) > 0) then
      raise exception 'm10_postcondition_failed: policy %.% is not as intended', r.tbl, r.pol using errcode = 'P0001';
    end if;
  end loop;
  -- Each table keeps RLS and exactly one SELECT-capable policy (no other policy can re-open the rows), and no new rule
  -- mentions sales_reports.
  for r in select * from unnest(array['enquiries', 'proposal_requests', 'marketing_contacts', 'marketing_contact_events', 'sales_internal_lead_sources', 'sales_lead_contact_overrides']) as u(tbl) loop
    if not (select relrowsecurity from pg_class where oid = ('public.' || r.tbl)::regclass)
       or (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = r.tbl and p.cmd in ('SELECT', 'ALL')) <> 1
       or exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = r.tbl and p.cmd = 'SELECT' and p.qual like '%sales_reports%') then
      raise exception 'm10_postcondition_failed: % has RLS off, more than one SELECT policy, or a sales_reports rule', r.tbl using errcode = 'P0001';
    end if;
  end loop;
end;
$m10_post$;
