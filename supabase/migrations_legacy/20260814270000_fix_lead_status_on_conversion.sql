-- Hotfix — Lead -> Opportunity status sync (RPC fix only; the retroactive
-- backfill for already-affected rows is a separate migration,
-- 20260814280000, held for explicit confirmation before being applied —
-- see that file's own header).
--
-- Root cause (confirmed live, found during Phase 4C Sales Reports
-- verification): convert_lead_to_opportunity() creates the new
-- sales_opportunities row with stage='qualified', but never updates the
-- source sales_lead_metadata.status. A converted lead can therefore still
-- read status='new' indefinitely, even after its opportunity has
-- progressed to quotation/won/etc.
--
-- Fix: add one UPDATE statement to the existing RPC body, in the same
-- implicit transaction as the opportunity INSERT (a single PL/pgSQL
-- function body is one transaction) -- not a second RPC call, not an
-- app-layer follow-up query. 'qualified' is chosen because it's the exact
-- value the RPC already uses for the new opportunity's own initial stage,
-- and is already a valid sales_lead_metadata.status value (no new status
-- invented). Duplicate-conversion protection (the "opportunity_already_exists"
-- check) and the existing opportunity_created activity log are both
-- unchanged -- this migration only inserts the one new UPDATE line. No
-- second activity event is added: opportunity_created already documents
-- this exact transition, so a status_changed entry would be redundant
-- noise for the same fact.
--
-- Idempotent: CREATE OR REPLACE is safe to re-run; it does not alter the
-- function's existing grants (confirmed live: only service_role/
-- authenticated/postgres have EXECUTE, no anon -- unchanged by this
-- migration since no GRANT/REVOKE statement is needed).

create or replace function public.convert_lead_to_opportunity(p_lead_metadata_id uuid, p_title text, p_expected_close_date date, p_estimated_value numeric)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_opportunity_id uuid;
  v_lead record;
begin
  if not app.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select * into v_lead from public.v_sales_lead_inbox where lead_metadata_id = p_lead_metadata_id;
  if v_lead is null then
    raise exception 'lead_not_found' using errcode = 'P0001';
  end if;

  if exists (select 1 from public.sales_opportunities where lead_metadata_id = p_lead_metadata_id) then
    raise exception 'opportunity_already_exists' using errcode = 'P0001';
  end if;

  insert into public.sales_opportunities (
    lead_metadata_id, company_name, contact_person, contact_email, contact_phone,
    title, programme, stage, created_by
  )
  values (
    p_lead_metadata_id, v_lead.company, v_lead.contact_name, v_lead.email, v_lead.phone,
    trim(p_title), v_lead.subject, 'qualified', auth.uid()
  )
  returning id into v_opportunity_id;

  update public.sales_opportunities
  set expected_close_date = p_expected_close_date,
      estimated_value = p_estimated_value
  where id = v_opportunity_id;

  -- The fix: keep the source lead's own status in sync with the fact that
  -- it has just become an opportunity, in the same transaction as the
  -- insert above.
  update public.sales_lead_metadata
  set status = 'qualified', updated_at = now()
  where id = p_lead_metadata_id;

  insert into public.sales_activity (lead_metadata_id, opportunity_id, type, note, actor_id)
  values (p_lead_metadata_id, v_opportunity_id, 'opportunity_created', 'Converted to opportunity', auth.uid());

  return v_opportunity_id;
end;
$function$;
