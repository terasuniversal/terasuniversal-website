-- Final production gate finding (Phase 2): none of the four cascade RPCs
-- checked the CURRENT status/stage before transitioning. Confirmed live
-- via direct testing against a disposable test lead/opportunity/quotation
-- (created and cleaned up in the same gate-audit session):
--   - accept_quotation() accepted a DRAFT quotation directly (should only
--     be callable on a 'sent' quotation).
--   - reject_quotation() then rejected that ALREADY-ACCEPTED quotation
--     (status flipped accepted -> rejected with no guard at all).
--   - mark_opportunity_lost() marked an ALREADY-WON opportunity as lost,
--     leaving both won_at and lost_at populated on the same row --
--     a genuinely contradictory, unrecoverable-by-inspection state.
--   - accept_quotation() only ever checked the QUOTATION's own status --
--     accepting a second, unrelated quotation flipped an already-LOST
--     opportunity straight back to won, leaving lost_reason/lost_at still
--     populated alongside the new won_at. Fixed by also checking the
--     opportunity's stage before proceeding.
--
-- Fix: minimal status/stage guards added directly in each function body
-- (not a general workflow-engine table/trigger -- these four functions
-- are already the sole entry points for these specific transitions, so a
-- guard clause in each is the smallest correct fix). CREATE OR REPLACE is
-- idempotent; no data migration is needed since the three test-only bad
-- rows produced during discovery were disposable and already deleted.
--
-- Idempotent: safe to re-run.

create or replace function public.accept_quotation(p_quotation_id uuid)
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_opportunity_id uuid;
  v_lead_metadata_id uuid;
  v_status text;
  v_opportunity_stage text;
  v_now timestamptz := now();
begin
  if not app.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select opportunity_id, status into v_opportunity_id, v_status from public.sales_quotations where id = p_quotation_id;
  if v_opportunity_id is null then
    raise exception 'quotation_not_found' using errcode = 'P0001';
  end if;
  if v_status is distinct from 'sent' then
    raise exception 'invalid_transition: only a sent quotation can be accepted (current status: %)', v_status using errcode = 'P0001';
  end if;

  select lead_metadata_id, stage into v_lead_metadata_id, v_opportunity_stage from public.sales_opportunities where id = v_opportunity_id;
  if v_opportunity_stage in ('won', 'lost') then
    raise exception 'invalid_transition: opportunity is already resolved (current stage: %)', v_opportunity_stage using errcode = 'P0001';
  end if;

  update public.sales_quotations set status = 'accepted', accepted_at = v_now, updated_at = v_now where id = p_quotation_id;
  update public.sales_opportunities set stage = 'won', won_at = v_now, updated_at = v_now where id = v_opportunity_id;
  update public.sales_lead_metadata set status = 'won', won_at = v_now, updated_at = v_now where id = v_lead_metadata_id;

  insert into public.sales_activity (lead_metadata_id, opportunity_id, quotation_id, type, note, actor_id) values
    (v_lead_metadata_id, v_opportunity_id, p_quotation_id, 'quotation_accepted', 'Quotation accepted', auth.uid()),
    (v_lead_metadata_id, v_opportunity_id, null, 'opportunity_won', 'Opportunity won', auth.uid()),
    (v_lead_metadata_id, null, null, 'won', 'Lead won (quotation accepted)', auth.uid());
end;
$$;

create or replace function public.reject_quotation(p_quotation_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_opportunity_id uuid;
  v_lead_metadata_id uuid;
  v_status text;
begin
  if not app.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'reason_required' using errcode = 'P0001';
  end if;

  select opportunity_id, status into v_opportunity_id, v_status from public.sales_quotations where id = p_quotation_id;
  if v_opportunity_id is null then
    raise exception 'quotation_not_found' using errcode = 'P0001';
  end if;
  if v_status is distinct from 'sent' then
    raise exception 'invalid_transition: only a sent quotation can be rejected (current status: %)', v_status using errcode = 'P0001';
  end if;

  select lead_metadata_id into v_lead_metadata_id from public.sales_opportunities where id = v_opportunity_id;

  update public.sales_quotations
  set status = 'rejected', rejected_at = now(), rejection_reason = trim(p_reason), updated_at = now()
  where id = p_quotation_id;

  insert into public.sales_activity (lead_metadata_id, opportunity_id, quotation_id, type, note, actor_id)
  values (v_lead_metadata_id, v_opportunity_id, p_quotation_id, 'quotation_rejected', 'Rejected — ' || trim(p_reason), auth.uid());
end;
$$;

create or replace function public.mark_opportunity_lost(p_opportunity_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_lead_metadata_id uuid;
  v_stage text;
  v_now timestamptz := now();
begin
  if not app.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_reason is null or p_reason not in ('price', 'no_budget', 'no_response', 'timing', 'competitor', 'requirement_changed', 'duplicate', 'other') then
    raise exception 'invalid_reason' using errcode = 'P0001';
  end if;

  select lead_metadata_id, stage into v_lead_metadata_id, v_stage from public.sales_opportunities where id = p_opportunity_id;
  if v_lead_metadata_id is null then
    raise exception 'opportunity_not_found' using errcode = 'P0001';
  end if;
  if v_stage in ('won', 'lost') then
    raise exception 'invalid_transition: opportunity is already resolved (current stage: %)', v_stage using errcode = 'P0001';
  end if;

  update public.sales_opportunities
  set stage = 'lost', lost_at = v_now, lost_reason = p_reason, updated_at = v_now
  where id = p_opportunity_id;

  update public.sales_lead_metadata
  set status = 'lost', lost_reason = p_reason, updated_at = v_now
  where id = v_lead_metadata_id;

  insert into public.sales_activity (lead_metadata_id, opportunity_id, type, note, actor_id) values
    (v_lead_metadata_id, p_opportunity_id, 'opportunity_lost', 'Opportunity lost — ' || p_reason, auth.uid()),
    (v_lead_metadata_id, null, 'lost', 'Lead lost (opportunity lost)', auth.uid());
end;
$$;
