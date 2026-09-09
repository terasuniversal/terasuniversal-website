-- Sales Revenue Integrity Hardening
-- EDIT_ONLY_NO_APPLY: this migration is intentionally prepared as a file only.
--
-- Business invariants:
--   * an Opportunity has at most one accepted quotation;
--   * acceptance serializes on the Opportunity row;
--   * accepted commercial fields cannot be changed by direct table updates;
--   * accepted/Won records can leave the ROI chain only through the governed
--     reverse_won_opportunity() RPC;
--   * quotation revisions remain historical rows and are never rewritten.
--
-- The unique index deliberately fails the migration if existing production data
-- already contains duplicate accepted quotations. No data is silently selected,
-- deleted, or repaired by this migration. Run the read-only preflight audit first.

alter table public.sales_quotations
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancellation_reason text;

alter table public.sales_opportunities
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancellation_reason text;

alter table public.sales_quotations
  drop constraint if exists sales_quotations_status_check;
alter table public.sales_quotations
  add constraint sales_quotations_status_check
  check (status in ('draft', 'sent', 'accepted', 'rejected', 'expired', 'superseded', 'cancelled'));

alter table public.sales_opportunities
  drop constraint if exists sales_opportunities_stage_check;
alter table public.sales_opportunities
  add constraint sales_opportunities_stage_check
  check (stage in ('new', 'qualified', 'quotation', 'negotiation', 'won', 'lost', 'archived', 'cancelled'));

create unique index if not exists sales_quotations_one_accepted_per_opportunity_uidx
  on public.sales_quotations (opportunity_id)
  where status = 'accepted';

-- The marker is only defence-in-depth. RLS below is the security boundary for
-- authenticated direct table writes; SECURITY DEFINER RPCs bypass that RLS and
-- set this transaction-local marker to authorize their own terminal updates.
create or replace function app.guard_sales_revenue_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public, app
as $$
declare
  v_transition text := current_setting('app.sales_revenue_transition', true);
begin
  if tg_table_name = 'sales_quotations' and tg_op = 'INSERT' then
    if new.status = 'accepted' and (v_transition is distinct from 'accept' or current_user <> 'postgres') then
      raise exception 'quotation_acceptance_requires_governed_rpc' using errcode = 'P0001';
    end if;
    if new.status = 'cancelled' and (v_transition is distinct from 'reverse' or current_user <> 'postgres') then
      raise exception 'quotation_cancellation_requires_governed_rpc' using errcode = 'P0001';
    end if;
  elsif tg_table_name = 'sales_quotations' and tg_op = 'UPDATE' then
    if old.status = 'accepted' then
      if new.opportunity_id is distinct from old.opportunity_id
         or new.total is distinct from old.total
         or new.accepted_at is distinct from old.accepted_at then
        raise exception 'accepted_quotation_immutable' using errcode = 'P0001';
      end if;

      if new.status is distinct from old.status
         and not (new.status = 'cancelled' and v_transition = 'reverse' and current_user = 'postgres') then
        raise exception 'accepted_quotation_transition_requires_governed_rpc' using errcode = 'P0001';
      end if;
    elsif new.status = 'accepted' and (v_transition is distinct from 'accept' or current_user <> 'postgres') then
      raise exception 'quotation_acceptance_requires_governed_rpc' using errcode = 'P0001';
    elsif new.status = 'cancelled' and (v_transition is distinct from 'reverse' or current_user <> 'postgres') then
      raise exception 'quotation_cancellation_requires_governed_rpc' using errcode = 'P0001';
    end if;
  end if;

  if tg_table_name = 'sales_opportunities' and tg_op = 'INSERT' then
    if new.stage = 'won' and (v_transition is distinct from 'accept' or current_user <> 'postgres') then
      raise exception 'opportunity_won_requires_governed_rpc' using errcode = 'P0001';
    end if;
    if new.stage = 'cancelled' and (v_transition is distinct from 'reverse' or current_user <> 'postgres') then
      raise exception 'opportunity_cancellation_requires_governed_rpc' using errcode = 'P0001';
    end if;
  elsif tg_table_name = 'sales_opportunities' and tg_op = 'UPDATE' then
    if new.stage = 'won' and old.stage is distinct from 'won'
       and (v_transition is distinct from 'accept' or current_user <> 'postgres') then
      raise exception 'opportunity_won_requires_governed_rpc' using errcode = 'P0001';
    end if;

    if old.stage = 'won' and new.stage is distinct from old.stage
       and not (new.stage = 'cancelled' and v_transition = 'reverse' and current_user = 'postgres') then
      raise exception 'won_opportunity_transition_requires_governed_rpc' using errcode = 'P0001';
    end if;

    if old.stage = 'won' and new.won_at is distinct from old.won_at then
      raise exception 'won_at_is_immutable' using errcode = 'P0001';
    end if;

    if new.stage = 'cancelled' and (v_transition is distinct from 'reverse' or current_user <> 'postgres') then
      raise exception 'opportunity_cancellation_requires_governed_rpc' using errcode = 'P0001';
    end if;
    if old.stage = 'cancelled' and new.stage is distinct from old.stage then
      raise exception 'cancelled_opportunity_is_terminal' using errcode = 'P0001';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_sales_quotation_revenue_mutation on public.sales_quotations;
create trigger trg_guard_sales_quotation_revenue_mutation
before insert or update on public.sales_quotations
for each row execute function app.guard_sales_revenue_mutation();

drop trigger if exists trg_guard_sales_opportunity_revenue_mutation on public.sales_opportunities;
create trigger trg_guard_sales_opportunity_revenue_mutation
before insert or update on public.sales_opportunities
for each row execute function app.guard_sales_revenue_mutation();

-- Preserve the existing admin draft/edit/send paths, while making terminal
-- state changes available only through SECURITY DEFINER governed RPCs.
drop policy if exists sales_quotations_insert on public.sales_quotations;
create policy sales_quotations_insert on public.sales_quotations
  for insert to authenticated
  with check (app.is_admin() and status not in ('accepted', 'cancelled'));

drop policy if exists sales_quotations_update on public.sales_quotations;
create policy sales_quotations_update on public.sales_quotations
  for update to authenticated
  using (app.is_admin() and status not in ('accepted', 'cancelled'))
  with check (app.is_admin() and status not in ('accepted', 'cancelled'));

drop policy if exists sales_opportunities_insert on public.sales_opportunities;
create policy sales_opportunities_insert on public.sales_opportunities
  for insert to authenticated
  with check (app.is_admin() and stage not in ('won', 'cancelled'));

drop policy if exists sales_opportunities_update on public.sales_opportunities;
create policy sales_opportunities_update on public.sales_opportunities
  for update to authenticated
  using (app.is_admin() and stage not in ('won', 'cancelled'))
  with check (app.is_admin() and stage not in ('won', 'cancelled'));

-- Acceptance serializes on the Opportunity row. The second concurrent
-- acceptance waits, then observes stage='won' and fails before it can create a
-- second accepted quotation. The quotation row is locked after the Opportunity
-- lock so both competing quotation requests use the same lock order.
create or replace function public.accept_quotation(p_quotation_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, app
as $$
declare
  v_opportunity_id uuid;
  v_locked_opportunity_id uuid;
  v_lead_metadata_id uuid;
  v_status text;
  v_opportunity_stage text;
  v_now timestamptz := now();
begin
  if not app.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select opportunity_id into v_opportunity_id
  from public.sales_quotations
  where id = p_quotation_id;
  if v_opportunity_id is null then
    raise exception 'quotation_not_found' using errcode = 'P0001';
  end if;

  select lead_metadata_id, stage into v_lead_metadata_id, v_opportunity_stage
  from public.sales_opportunities
  where id = v_opportunity_id
  for update;
  if v_lead_metadata_id is null then
    raise exception 'opportunity_not_found' using errcode = 'P0001';
  end if;
  if v_opportunity_stage in ('won', 'lost', 'cancelled') then
    raise exception 'invalid_transition: opportunity is already resolved (current stage: %)', v_opportunity_stage using errcode = 'P0001';
  end if;

  select opportunity_id, status into v_locked_opportunity_id, v_status
  from public.sales_quotations
  where id = p_quotation_id
  for update;
  if v_locked_opportunity_id is distinct from v_opportunity_id then
    raise exception 'quotation_opportunity_changed_during_acceptance' using errcode = 'P0001',
      detail = 'The quotation relationship changed while acceptance was being prepared; retry after reloading the quotation.';
  end if;
  if v_status is distinct from 'sent' then
    raise exception 'invalid_transition: only a sent quotation can be accepted (current status: %)', v_status using errcode = 'P0001';
  end if;

  perform set_config('app.sales_revenue_transition', 'accept', true);
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

revoke all on function public.accept_quotation(uuid) from public;
grant execute on function public.accept_quotation(uuid) to authenticated;

-- Minimal governed reversal. This is not an accounting system: it records the
-- business reversal, changes both commercial records to a terminal cancelled
-- state, and makes the ROI chain ineligible because performance only counts
-- stage='won' plus status='accepted'. The original totals and activity remain.
create or replace function public.reverse_won_opportunity(p_opportunity_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, app
as $$
declare
  v_lead_metadata_id uuid;
  v_stage text;
  v_quotation_id uuid;
  v_invoice_status text;
  v_now timestamptz := now();
begin
  if not app.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'reason_required' using errcode = 'P0001';
  end if;

  select lead_metadata_id, stage into v_lead_metadata_id, v_stage
  from public.sales_opportunities
  where id = p_opportunity_id
  for update;
  if v_lead_metadata_id is null then
    raise exception 'opportunity_not_found' using errcode = 'P0001';
  end if;
  if v_stage is distinct from 'won' then
    raise exception 'invalid_transition: only a won opportunity can be reversed (current stage: %)', v_stage using errcode = 'P0001';
  end if;

  -- Resolve and lock the canonical accepted quotation before checking any
  -- downstream rows. The unique index makes this a single-row invariant;
  -- the lock also keeps the relationship stable for the rest of the RPC.
  select id into v_quotation_id
  from public.sales_quotations
  where opportunity_id = p_opportunity_id and status = 'accepted'
  order by accepted_at desc nulls last, revision_no desc, id desc
  limit 1
  for update;
  if v_quotation_id is null then
    raise exception 'accepted_quotation_not_found' using errcode = 'P0001';
  end if;

  -- This scope does not cancel accounting or operational records. Once a
  -- downstream dependency exists, the commercial reversal must be handled by
  -- a later governed workflow instead of silently orphaning it.
  if exists (
    select 1
    from public.invoice_payments ip
    join public.invoices i on i.id = ip.invoice_id
    where i.opportunity_id = p_opportunity_id
      and ip.status in ('pending', 'successful')
  ) then
    raise exception 'payment_dependency_exists' using errcode = 'P0001',
      detail = 'A payment record exists for this opportunity; reversal requires a governed financial workflow.';
  end if;

  select status into v_invoice_status
  from public.invoices
  where opportunity_id = p_opportunity_id
    and status <> 'cancelled'
  order by created_at asc
  limit 1;
  if v_invoice_status is not null then
    raise exception 'invoice_dependency_exists' using errcode = 'P0001',
      detail = 'Cancel or reconcile the invoice through a governed financial workflow before reversing the opportunity.';
  end if;

  if exists (
    select 1
    from public.course_schedules cs
    where (cs.source_opportunity_id = p_opportunity_id
      or cs.source_quotation_id = v_quotation_id)
      and cs.deleted_at is null
      and cs.status <> 'cancelled'
  ) then
    raise exception 'training_handoff_dependency_exists' using errcode = 'P0001',
      detail = 'A training handoff exists for this opportunity; reverse the operational workflow first.';
  end if;

  if exists (
    select 1
    from public.schedule_participants sp
    join public.course_schedules cs on cs.id = sp.schedule_id
    where (cs.source_opportunity_id = p_opportunity_id
      or cs.source_quotation_id = v_quotation_id)
      and cs.deleted_at is null
      and sp.deleted_at is null
      and sp.registration_status <> 'cancelled'
  ) then
    raise exception 'registration_dependency_exists' using errcode = 'P0001',
      detail = 'An active training registration exists for this opportunity; reversal requires an operational workflow.';
  end if;

  perform set_config('app.sales_revenue_transition', 'reverse', true);
  update public.sales_quotations
  set status = 'cancelled', cancelled_at = v_now, cancellation_reason = trim(p_reason), updated_at = v_now
  where id = v_quotation_id;
  update public.sales_opportunities
  set stage = 'cancelled', cancelled_at = v_now, cancellation_reason = trim(p_reason), updated_at = v_now
  where id = p_opportunity_id;

  insert into public.sales_activity (lead_metadata_id, opportunity_id, quotation_id, type, note, actor_id) values
    (v_lead_metadata_id, p_opportunity_id, v_quotation_id, 'quotation_cancelled', 'Accepted quotation cancelled: ' || trim(p_reason), auth.uid()),
    (v_lead_metadata_id, p_opportunity_id, null, 'opportunity_reversed', 'Won opportunity reversed: ' || trim(p_reason), auth.uid());
end;
$$;

revoke all on function public.reverse_won_opportunity(uuid, text) from public;
grant execute on function public.reverse_won_opportunity(uuid, text) to authenticated;

alter table public.sales_activity drop constraint if exists sales_activity_type_check;
alter table public.sales_activity add constraint sales_activity_type_check check (type in (
  'lead_created', 'status_changed', 'assigned', 'followup_scheduled', 'note_added', 'proposal_sent', 'won', 'lost',
  'opportunity_created', 'quotation_created', 'quotation_sent', 'quotation_revised', 'quotation_accepted',
  'quotation_rejected', 'opportunity_won', 'opportunity_lost',
  'training_handoff_created', 'company_linked', 'company_created',
  'task_created', 'task_completed', 'task_reopened', 'task_cancelled',
  'registration_completed',
  'invoice_created', 'invoice_issued', 'invoice_partially_paid', 'invoice_paid',
  'invoice_cancelled', 'payment_recorded',
  'quotation_cancelled', 'opportunity_reversed'
));
