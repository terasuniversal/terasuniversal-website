-- Sales CRM Phase 2: real Opportunity + Quotation workflow on top of the
-- live Phase 1 foundation (public.enquiries / public.proposal_requests →
-- sales_lead_metadata → sales_activity → v_sales_lead_inbox). Does not
-- redesign or touch any Phase 1 table.
--
-- Numbering: "OPP-2026-0001" / "QT-2026-0001" (+"-R1"/"-R2"... for
-- revisions) are NOT invented here -- both formats already exist as
-- precedent in lib/sales/opportunities-data.ts / lib/sales/demo-data.ts's
-- SalesQuotation.quotationNumber. Reused verbatim, now generated
-- server-side via a real sequence instead of being hand-typed demo data.
--
-- Money math (lineTotal/subtotal/taxable/tax/grandTotal, integer-sen
-- rounding) mirrors lib/sales/quotation-math.ts's algorithm -- ported, not
-- imported, to keep zero runtime dependency on the demo module (per the
-- Phase 1 dependency-hardening pass). line_total is a GENERATED column so
-- the arithmetic is deterministic at the database level, not just in
-- application code.
--
-- Idempotent: safe to re-run.

-- ---------------------------------------------------------------------
-- Opportunities
-- ---------------------------------------------------------------------

create sequence if not exists app.sales_opportunity_seq;
create sequence if not exists app.sales_quotation_seq;

-- SECURITY DEFINER: found via testing that a direct authenticated INSERT
-- (the real production path -- the create-quotation/create-opportunity
-- Server Actions insert as the logged-in admin, not through a wrapper RPC)
-- fails with "permission denied for sequence" otherwise, since a plain
-- LANGUAGE SQL function runs with the caller's own privileges and
-- `authenticated` was never granted USAGE on the sequence directly.
create or replace function app.next_opportunity_number()
returns text
language sql
security definer
set search_path = 'app'
as $$
  select 'OPP-' || to_char(current_date, 'YYYY') || '-' || lpad(nextval('app.sales_opportunity_seq')::text, 4, '0');
$$;

create or replace function app.next_quotation_number()
returns text
language sql
security definer
set search_path = 'app'
as $$
  select 'QT-' || to_char(current_date, 'YYYY') || '-' || lpad(nextval('app.sales_quotation_seq')::text, 4, '0');
$$;

-- One opportunity per lead (Task 3's duplicate-prevention rule, enforced by
-- the UNIQUE constraint rather than app-layer checking alone). Contact/
-- company fields are a snapshot at conversion time -- matches the existing
-- denormalization precedent on public.certificates (participant_name/
-- course_name) rather than always joining back through
-- sales_lead_metadata -> enquiries/proposal_requests for display. No
-- free-text "notes" column: notes go through sales_activity, consistent
-- with how sales_lead_metadata already has no notes column either
-- (append-only activity is the one note-taking mechanism across the CRM).
create table if not exists public.sales_opportunities (
  id uuid primary key default gen_random_uuid(),
  lead_metadata_id uuid not null unique references public.sales_lead_metadata(id),
  opportunity_no text not null unique default app.next_opportunity_number(),
  company_name text,
  contact_person text,
  contact_email text,
  contact_phone text,
  title text not null,
  programme text,
  stage text not null default 'qualified' check (stage in ('new', 'qualified', 'quotation', 'negotiation', 'won', 'lost', 'archived')),
  assigned_to uuid references public.profiles(id),
  expected_close_date date,
  probability integer check (probability is null or (probability >= 0 and probability <= 100)),
  estimated_value numeric(12, 2) check (estimated_value is null or estimated_value >= 0),
  lost_reason text check (lost_reason is null or lost_reason in ('price', 'no_budget', 'no_response', 'timing', 'competitor', 'requirement_changed', 'duplicate', 'other')),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  won_at timestamptz,
  lost_at timestamptz
);

create index if not exists sales_opportunities_stage_idx on public.sales_opportunities (stage);
create index if not exists sales_opportunities_assigned_to_idx on public.sales_opportunities (assigned_to);
create index if not exists sales_opportunities_created_at_idx on public.sales_opportunities (created_at desc);

alter table public.sales_opportunities enable row level security;

drop policy if exists sales_opportunities_select on public.sales_opportunities;
create policy sales_opportunities_select on public.sales_opportunities
  for select to authenticated
  using (app.has_min_role('editor'::public.user_role));

drop policy if exists sales_opportunities_insert on public.sales_opportunities;
create policy sales_opportunities_insert on public.sales_opportunities
  for insert to authenticated
  with check (app.is_admin());

drop policy if exists sales_opportunities_update on public.sales_opportunities;
create policy sales_opportunities_update on public.sales_opportunities
  for update to authenticated
  using (app.is_admin())
  with check (app.is_admin());

-- No DELETE policy for anyone -- sales history is never hard-deleted
-- (Task 12); "archived" is a stage value, not a row removal.
revoke all on public.sales_opportunities from anon;
revoke delete, truncate, references, trigger on public.sales_opportunities from authenticated;

-- ---------------------------------------------------------------------
-- Quotations
-- ---------------------------------------------------------------------

-- Header carries the derived totals (subtotal/taxable/tax/total) rather
-- than computing them on every read -- written once per save by the
-- issuing Server Action using the same math as sales_quotation_items'
-- generated line_total, so the two can never disagree if the action does
-- its job (verified in this migration's own test pass, see final report).
-- "terms" is a single free-text field, deliberately simpler than the demo
-- module's structured SalesQuotationTerms -- that struct is explicitly
-- labelled "DEMO terms... NOT TERAS production policy" in
-- lib/sales/constants.ts's demoQuotationTerms(), and this migration does
-- not invent real business terms/SST policy (Task 6's explicit
-- instruction). SST fields exist but default to inactive (sst_applicable
-- default false) until a real, verified SST policy is provided.
create table if not exists public.sales_quotations (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.sales_opportunities(id),
  quotation_no text not null default app.next_quotation_number(),
  revision_no integer not null default 0,
  parent_quotation_id uuid references public.sales_quotations(id),
  status text not null default 'draft' check (status in ('draft', 'sent', 'accepted', 'rejected', 'expired', 'superseded')),
  issue_date date not null default current_date,
  valid_until date,
  currency text not null default 'MYR',
  subtotal numeric(12, 2) not null default 0,
  discount numeric(12, 2) not null default 0 check (discount >= 0),
  sst_applicable boolean not null default false,
  sst_rate numeric(5, 2) not null default 0,
  tax numeric(12, 2) not null default 0,
  total numeric(12, 2) not null default 0,
  terms text,
  notes text,
  rejection_reason text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  accepted_at timestamptz,
  rejected_at timestamptz,
  superseded_at timestamptz,
  unique (quotation_no, revision_no)
);

create index if not exists sales_quotations_opportunity_id_idx on public.sales_quotations (opportunity_id);
create index if not exists sales_quotations_status_idx on public.sales_quotations (status);
create index if not exists sales_quotations_parent_idx on public.sales_quotations (parent_quotation_id);

alter table public.sales_quotations enable row level security;

drop policy if exists sales_quotations_select on public.sales_quotations;
create policy sales_quotations_select on public.sales_quotations
  for select to authenticated
  using (app.has_min_role('editor'::public.user_role));

drop policy if exists sales_quotations_insert on public.sales_quotations;
create policy sales_quotations_insert on public.sales_quotations
  for insert to authenticated
  with check (app.is_admin());

drop policy if exists sales_quotations_update on public.sales_quotations;
create policy sales_quotations_update on public.sales_quotations
  for update to authenticated
  using (app.is_admin())
  with check (app.is_admin());

revoke all on public.sales_quotations from anon;
revoke delete, truncate, references, trigger on public.sales_quotations from authenticated;

-- line_total is GENERATED, not application-computed, so the stored value
-- can never drift from quantity/unit_price/discount (Task 8: "Calculations
-- must be deterministic"). Matches lib/sales/quotation-math.ts's
-- lineTotal(): quantity * unitPrice - discount, rounded to 2dp.
create table if not exists public.sales_quotation_items (
  id uuid primary key default gen_random_uuid(),
  quotation_id uuid not null references public.sales_quotations(id) on delete cascade,
  description text not null check (char_length(description) between 1 and 500),
  quantity numeric(10, 2) not null default 1 check (quantity > 0),
  unit text not null default 'pax' check (unit in ('pax', 'session', 'day', 'lot', 'unit')),
  unit_price numeric(12, 2) not null default 0 check (unit_price >= 0),
  discount numeric(12, 2) not null default 0 check (discount >= 0),
  line_total numeric(12, 2) generated always as (round((quantity * unit_price - discount)::numeric, 2)) stored,
  sort_order integer not null default 0
);

create index if not exists sales_quotation_items_quotation_id_idx on public.sales_quotation_items (quotation_id, sort_order);

alter table public.sales_quotation_items enable row level security;

drop policy if exists sales_quotation_items_select on public.sales_quotation_items;
create policy sales_quotation_items_select on public.sales_quotation_items
  for select to authenticated
  using (app.has_min_role('editor'::public.user_role));

drop policy if exists sales_quotation_items_insert on public.sales_quotation_items;
create policy sales_quotation_items_insert on public.sales_quotation_items
  for insert to authenticated
  with check (app.is_admin());

drop policy if exists sales_quotation_items_update on public.sales_quotation_items;
create policy sales_quotation_items_update on public.sales_quotation_items
  for update to authenticated
  using (app.is_admin())
  with check (app.is_admin());

drop policy if exists sales_quotation_items_delete on public.sales_quotation_items;
create policy sales_quotation_items_delete on public.sales_quotation_items
  for delete to authenticated
  using (app.is_admin());

revoke all on public.sales_quotation_items from anon;
revoke truncate, references, trigger on public.sales_quotation_items from authenticated;

-- ---------------------------------------------------------------------
-- Activity: extend the existing sales_activity table (Task 13 explicitly
-- says reuse it / do not duplicate audit systems). Additive columns only.
-- lead_metadata_id stays NOT NULL and every opportunity/quotation activity
-- still logs against it too, so Lead Detail's existing timeline
-- automatically shows the full downstream Opportunity/Quotation journey
-- with zero changes to LeadActivityTimeline.tsx.
-- ---------------------------------------------------------------------

alter table public.sales_activity add column if not exists opportunity_id uuid references public.sales_opportunities(id);
alter table public.sales_activity add column if not exists quotation_id uuid references public.sales_quotations(id);

alter table public.sales_activity drop constraint if exists sales_activity_type_check;
alter table public.sales_activity add constraint sales_activity_type_check check (type in (
  'lead_created', 'status_changed', 'assigned', 'followup_scheduled', 'note_added', 'proposal_sent', 'won', 'lost',
  'opportunity_created', 'quotation_created', 'quotation_sent', 'quotation_revised', 'quotation_accepted',
  'quotation_rejected', 'opportunity_won', 'opportunity_lost'
));

create index if not exists sales_activity_opportunity_id_idx on public.sales_activity (opportunity_id, created_at desc);
create index if not exists sales_activity_quotation_id_idx on public.sales_activity (quotation_id, created_at desc);

-- ---------------------------------------------------------------------
-- Cascade RPCs. SECURITY DEFINER for cross-table atomicity (a partial
-- cascade -- e.g. quotation accepted but opportunity left open -- would be
-- a worse data-integrity problem than the extra guard), but each still
-- explicitly re-checks app.is_admin() rather than relying solely on the
-- caller's own RLS, since these touch three tables at once.
-- ---------------------------------------------------------------------

-- Task 3: Convert Lead to Opportunity. Blocked if the lead already has one
-- (the UNIQUE constraint on sales_opportunities.lead_metadata_id is the
-- real enforcement; this function turns that into a friendly error instead
-- of a raw unique_violation). Does not touch/archive the source lead
-- automatically -- the lead's own status field can be moved forward by
-- staff independently via the existing Lead Detail status control, per
-- Task 3's "do not delete/archive lead automatically unless business rule
-- says so" (no such rule was specified, so this stays manual).
create or replace function public.convert_lead_to_opportunity(
  p_lead_metadata_id uuid,
  p_title text,
  p_expected_close_date date,
  p_estimated_value numeric
)
returns uuid
language plpgsql
security definer
set search_path = 'public'
as $$
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

  insert into public.sales_activity (lead_metadata_id, opportunity_id, type, note, actor_id)
  values (p_lead_metadata_id, v_opportunity_id, 'opportunity_created', 'Converted to opportunity', auth.uid());

  return v_opportunity_id;
end;
$$;

revoke all on function public.convert_lead_to_opportunity(uuid, text, date, numeric) from public;
grant execute on function public.convert_lead_to_opportunity(uuid, text, date, numeric) to authenticated;

-- Task 11: accepted quotation cascades opportunity -> won and lead -> won.
create or replace function public.accept_quotation(p_quotation_id uuid)
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_opportunity_id uuid;
  v_lead_metadata_id uuid;
  v_now timestamptz := now();
begin
  if not app.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select opportunity_id into v_opportunity_id from public.sales_quotations where id = p_quotation_id;
  if v_opportunity_id is null then
    raise exception 'quotation_not_found' using errcode = 'P0001';
  end if;
  select lead_metadata_id into v_lead_metadata_id from public.sales_opportunities where id = v_opportunity_id;

  update public.sales_quotations set status = 'accepted', accepted_at = v_now, updated_at = v_now where id = p_quotation_id;
  update public.sales_opportunities set stage = 'won', won_at = v_now, updated_at = v_now where id = v_opportunity_id;
  update public.sales_lead_metadata set status = 'won', won_at = v_now, updated_at = v_now where id = v_lead_metadata_id;

  insert into public.sales_activity (lead_metadata_id, opportunity_id, quotation_id, type, note, actor_id) values
    (v_lead_metadata_id, v_opportunity_id, p_quotation_id, 'quotation_accepted', 'Quotation accepted', auth.uid()),
    (v_lead_metadata_id, v_opportunity_id, null, 'opportunity_won', 'Opportunity won', auth.uid()),
    (v_lead_metadata_id, null, null, 'won', 'Lead won (quotation accepted)', auth.uid());
end;
$$;

revoke all on function public.accept_quotation(uuid) from public;
grant execute on function public.accept_quotation(uuid) to authenticated;

-- Rejection does not auto-cascade the opportunity/lead to lost -- the
-- business flow is Revision/Negotiation -> Accepted/Rejected -> Won/Lost,
-- meaning a rejected quotation commonly leads to a revision, not an
-- automatic loss. Staff marks the opportunity lost separately if the deal
-- is truly over (see mark_opportunity_lost below).
create or replace function public.reject_quotation(p_quotation_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_opportunity_id uuid;
  v_lead_metadata_id uuid;
begin
  if not app.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'reason_required' using errcode = 'P0001';
  end if;

  select opportunity_id into v_opportunity_id from public.sales_quotations where id = p_quotation_id;
  if v_opportunity_id is null then
    raise exception 'quotation_not_found' using errcode = 'P0001';
  end if;
  select lead_metadata_id into v_lead_metadata_id from public.sales_opportunities where id = v_opportunity_id;

  update public.sales_quotations
  set status = 'rejected', rejected_at = now(), rejection_reason = trim(p_reason), updated_at = now()
  where id = p_quotation_id;

  insert into public.sales_activity (lead_metadata_id, opportunity_id, quotation_id, type, note, actor_id)
  values (v_lead_metadata_id, v_opportunity_id, p_quotation_id, 'quotation_rejected', 'Rejected — ' || trim(p_reason), auth.uid());
end;
$$;

revoke all on function public.reject_quotation(uuid, text) from public;
grant execute on function public.reject_quotation(uuid, text) to authenticated;

-- Task 12: lost flow. Requires a reason; cascades to the source lead
-- (losing the opportunity means the lead's outcome is also lost). Never
-- deletes anything -- quotations/activities on a lost opportunity remain
-- fully readable.
create or replace function public.mark_opportunity_lost(p_opportunity_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_lead_metadata_id uuid;
  v_now timestamptz := now();
begin
  if not app.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_reason is null or p_reason not in ('price', 'no_budget', 'no_response', 'timing', 'competitor', 'requirement_changed', 'duplicate', 'other') then
    raise exception 'invalid_reason' using errcode = 'P0001';
  end if;

  select lead_metadata_id into v_lead_metadata_id from public.sales_opportunities where id = p_opportunity_id;
  if v_lead_metadata_id is null then
    raise exception 'opportunity_not_found' using errcode = 'P0001';
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

revoke all on function public.mark_opportunity_lost(uuid, text) from public;
grant execute on function public.mark_opportunity_lost(uuid, text) to authenticated;
