-- A Won sale is a resolved commercial outcome. Clear its operational
-- follow-up in the same transaction as quotation acceptance, while retaining
-- the append-only activity history that records the original scheduling.

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

  select opportunity_id, status into v_opportunity_id, v_status
  from public.sales_quotations
  where id = p_quotation_id;
  if v_opportunity_id is null then
    raise exception 'quotation_not_found' using errcode = 'P0001';
  end if;
  if v_status is distinct from 'sent' then
    raise exception 'invalid_transition: only a sent quotation can be accepted (current status: %)', v_status using errcode = 'P0001';
  end if;

  select lead_metadata_id, stage into v_lead_metadata_id, v_opportunity_stage
  from public.sales_opportunities
  where id = v_opportunity_id;
  if v_opportunity_stage in ('won', 'lost') then
    raise exception 'invalid_transition: opportunity is already resolved (current stage: %)', v_opportunity_stage using errcode = 'P0001';
  end if;

  update public.sales_quotations
  set status = 'accepted', accepted_at = v_now, updated_at = v_now
  where id = p_quotation_id;
  update public.sales_opportunities
  set stage = 'won', won_at = v_now, updated_at = v_now
  where id = v_opportunity_id;
  update public.sales_lead_metadata
  set status = 'won', won_at = v_now, follow_up_at = null, updated_at = v_now
  where id = v_lead_metadata_id;

  insert into public.sales_activity (lead_metadata_id, opportunity_id, quotation_id, type, note, actor_id) values
    (v_lead_metadata_id, v_opportunity_id, p_quotation_id, 'quotation_accepted', 'Quotation accepted', auth.uid()),
    (v_lead_metadata_id, v_opportunity_id, null, 'opportunity_won', 'Opportunity won', auth.uid()),
    (v_lead_metadata_id, null, null, 'won', 'Lead won (quotation accepted); pending sales follow-up cleared', auth.uid());
end;
$$;

-- One-time repair of historic inconsistent records. Only the current
-- operational date is cleared; no sales_activity or commercial row is
-- deleted or overwritten.
with stale_won_followups as (
  update public.sales_lead_metadata m
  set follow_up_at = null, updated_at = now()
  where m.follow_up_at is not null
    and (
      m.status = 'won'
      or exists (
        select 1
        from public.sales_opportunities o
        where o.lead_metadata_id = m.id
          and o.stage = 'won'
      )
    )
  returning m.id
)
insert into public.sales_activity (lead_metadata_id, type, note, actor_id)
select id, 'won', 'Historic pending sales follow-up cleared after Won outcome', null
from stale_won_followups;
