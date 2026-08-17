-- TERAS UNIVERSAL — Sales Test/Demo classification (exclude from real reporting)
--
-- Forward-only, post-baseline migration. Adds an explicit is_test flag to the
-- Sales chain so training/demo records never distort operational KPIs:
--   * sales_lead_metadata  = SOURCE OF TRUTH (is_test).
--   * sales_opportunities  = denormalized copy, set from the lead on INSERT
--                            and kept in sync by an AFTER UPDATE trigger.
--   * sales_quotations     = denormalized copy, set from the opportunity on
--                            INSERT and kept in sync by an AFTER UPDATE trigger.
-- Existing real production data defaults to is_test=false (DEFAULT false on
-- the ADD COLUMN). Archived semantics are NOT changed — an archived REAL lead
-- stays a valid historical record and remains reportable.
--
-- Reporting: every operational KPI / report / CSV export filters
-- is_test = false on the table it reads. Test chains are excluded from Leads,
-- Qualified, Opportunities, Quotation Sent, Won/Lost, Won Value, conversion
-- rates, Sales Dashboard, Sales Reports, and monthly CSV exports.
--
-- A safe Super-Admin-only RPC (mark_lead_test) toggles the classification;
-- ordinary Sales staff cannot hide real revenue.
--
-- All DDL is idempotent/guarded. No destructive DROP. No reset.

-- ---------------------------------------------------------------------------
-- 1. is_test columns (source + propagated)
-- ---------------------------------------------------------------------------
alter table public.sales_lead_metadata
  add column if not exists is_test boolean not null default false;
alter table public.sales_opportunities
  add column if not exists is_test boolean not null default false;
alter table public.sales_quotations
  add column if not exists is_test boolean not null default false;

create index if not exists sales_lead_metadata_is_test_idx
  on public.sales_lead_metadata (is_test);
create index if not exists sales_opportunities_is_test_idx
  on public.sales_opportunities (is_test);
create index if not exists sales_quotations_is_test_idx
  on public.sales_quotations (is_test);

-- ---------------------------------------------------------------------------
-- 2. Propagation triggers — the lead is authoritative; opportunity/quotation
--    copies are derived from it automatically (also covers rows inserted by
--    the SECURITY DEFINER cascade RPCs).
-- ---------------------------------------------------------------------------
create or replace function app.sync_opportunity_is_test()
returns trigger
language plpgsql
security definer
set search_path = 'public'
as $$
begin
  if tg_op = 'INSERT' then
    new.is_test := coalesce(
      (select m.is_test from public.sales_lead_metadata m where m.id = new.lead_metadata_id),
      new.is_test, false
    );
  end if;
  return new;
end;
$$;

create or replace function app.sync_quotation_is_test()
returns trigger
language plpgsql
security definer
set search_path = 'public'
as $$
begin
  if tg_op = 'INSERT' then
    new.is_test := coalesce(
      (select o.is_test from public.sales_opportunities o where o.id = new.opportunity_id),
      new.is_test, false
    );
  end if;
  return new;
end;
$$;

create or replace function app.propagate_lead_is_test()
returns trigger
language plpgsql
security definer
set search_path = 'public'
as $$
begin
  if old.is_test is distinct from new.is_test then
    update public.sales_opportunities
    set is_test = new.is_test
    where lead_metadata_id = old.id;
  end if;
  return new;
end;
$$;

create or replace function app.propagate_opportunity_is_test()
returns trigger
language plpgsql
security definer
set search_path = 'public'
as $$
begin
  if old.is_test is distinct from new.is_test then
    update public.sales_quotations
    set is_test = new.is_test
    where opportunity_id = old.id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_opportunity_is_test_default on public.sales_opportunities;
create trigger trg_opportunity_is_test_default
  before insert on public.sales_opportunities
  for each row execute function app.sync_opportunity_is_test();

drop trigger if exists trg_quotation_is_test_default on public.sales_quotations;
create trigger trg_quotation_is_test_default
  before insert on public.sales_quotations
  for each row execute function app.sync_quotation_is_test();

drop trigger if exists trg_lead_is_test_propagate on public.sales_lead_metadata;
create trigger trg_lead_is_test_propagate
  after update of is_test on public.sales_lead_metadata
  for each row execute function app.propagate_lead_is_test();

drop trigger if exists trg_opportunity_is_test_propagate on public.sales_opportunities;
create trigger trg_opportunity_is_test_propagate
  after update of is_test on public.sales_opportunities
  for each row execute function app.propagate_opportunity_is_test();

-- ---------------------------------------------------------------------------
-- 3. v_sales_lead_inbox gains is_test (inbox can badge test rows; reporting
--    filters them out). CREATE OR REPLACE cannot add a column, so the view is
--    dropped and recreated in the same transaction — no data is lost (the
--    view is derived) and dependent app/RPC references resolve at runtime.
-- ---------------------------------------------------------------------------
drop view if exists public.v_sales_lead_inbox;
create view public.v_sales_lead_inbox
with (security_invoker = true) as
select
  m.id as lead_metadata_id,
  m.lead_source,
  m.source_id,
  m.status,
  m.assigned_to,
  m.follow_up_at,
  m.priority,
  m.lost_reason,
  m.won_at,
  m.is_test,
  m.created_at,
  m.updated_at,
  case when m.lead_source = 'enquiry' then e.name else p.contact_person end as contact_name,
  case when m.lead_source = 'enquiry' then e.company else p.company_name end as company,
  case when m.lead_source = 'enquiry' then e.email else p.email end as email,
  case when m.lead_source = 'enquiry' then e.phone else p.phone end as phone,
  case when m.lead_source = 'enquiry' then e.subject else coalesce(p.programme, p.category) end as subject
from public.sales_lead_metadata m
left join public.enquiries e on m.lead_source = 'enquiry' and e.id = m.source_id
left join public.proposal_requests p on m.lead_source = 'proposal_request' and p.id = m.source_id;

revoke all on public.v_sales_lead_inbox from anon;
grant select on public.v_sales_lead_inbox to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Super-Admin-only classification RPC. Explicitly super_admin (not admin):
--    only a confirmed Super Admin may mark a chain as test/demo or restore it
--    to real. The propagation triggers cascade to opportunities/quotations.
-- ---------------------------------------------------------------------------
create or replace function public.mark_lead_test(p_lead_metadata_id uuid, p_is_test boolean)
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
begin
  if app.current_role() <> 'super_admin' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_lead_metadata_id is null then
    raise exception 'invalid_input' using errcode = 'P0001';
  end if;
  update public.sales_lead_metadata
  set is_test = coalesce(p_is_test, false),
      updated_at = now()
  where id = p_lead_metadata_id;
  if not found then
    raise exception 'lead_not_found' using errcode = 'P0001';
  end if;
end;
$$;

revoke all on function public.mark_lead_test(uuid, boolean) from public;
grant execute on function public.mark_lead_test(uuid, boolean) to authenticated;
