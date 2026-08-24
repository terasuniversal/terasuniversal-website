-- CRM TERAS -- Invoice Module V1 Core.
-- Accepted Quotation -> Draft Invoice -> Issue -> Manual Payment -> Partial/Paid.
-- No ToyyibPay in this migration -- invoice_payments' payment_provider/status
-- vocab is sized for it (Phase 2) but only cash/bank_transfer/cheque/other are
-- reachable via record_manual_payment() today.

-- ---------------------------------------------------------------------
-- 1. Numbering: reuse the exact quotation/opportunity idiom (sequence +
-- column-default-calling-function), not the certs/schedules/participants
-- BEFORE INSERT trigger idiom -- Invoice is a direct sales-domain sibling of
-- Quotation/Opportunity, so it follows their pattern for consistency.
create sequence if not exists app.sales_invoice_seq;

create or replace function app.next_invoice_number() returns text
language sql security definer set search_path = 'app' as $$
  select 'INV-' || to_char(current_date, 'YYYY') || '-' || lpad(nextval('app.sales_invoice_seq')::text, 4, '0');
$$;

-- ---------------------------------------------------------------------
-- 2. invoices -- one row per issued/draft invoice. quotation_id is UNIQUE:
-- V1 rule is exactly one invoice per accepted quotation (deposit/progress
-- billing is an explicit non-goal for V1, per architecture audit section 23).
create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_no text not null default app.next_invoice_number(),

  quotation_id uuid not null references public.sales_quotations(id),
  opportunity_id uuid not null references public.sales_opportunities(id),
  company_id uuid references public.companies(id) on delete set null,

  -- Snapshot at creation -- never live-joined back to companies/opportunities
  -- once written. billing_name is required (falls back to company_name if no
  -- contact_person on the opportunity); the rest are nullable, matching how
  -- much data actually exists on sales_opportunities/companies today.
  billing_name text not null,
  billing_company text,
  billing_registration_no text,
  billing_address text,
  billing_email text,
  billing_phone text,

  invoice_date date not null default current_date,
  due_date date not null default (current_date + 30),

  currency text not null default 'MYR',

  -- Same integer-sen-safe numeric(12,2) convention as sales_quotations --
  -- never floating point, never a separate cents-integer column that would
  -- require its own conversion layer against the quotation math it must
  -- reconcile with exactly.
  subtotal numeric(12,2) not null default 0,
  discount_amount numeric(12,2) not null default 0,
  taxable_amount numeric(12,2) not null default 0,
  tax_rate numeric(5,2) not null default 0,
  tax_amount numeric(12,2) not null default 0,
  grand_total numeric(12,2) not null default 0,

  -- Maintained by app.recompute_invoice_balance() (trigger on
  -- invoice_payments), never written directly by any Server Action/RPC.
  amount_paid numeric(12,2) not null default 0,
  balance_due numeric(12,2) not null default 0,

  status text not null default 'draft',

  notes text,
  payment_terms text,

  issued_at timestamptz,
  paid_at timestamptz,
  cancelled_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),

  constraint invoices_invoice_no_key unique (invoice_no),
  constraint invoices_quotation_id_key unique (quotation_id),
  constraint invoices_status_check check (status in ('draft', 'issued', 'partially_paid', 'paid', 'cancelled')),
  constraint invoices_grand_total_check check (grand_total >= 0),
  constraint invoices_amount_paid_check check (amount_paid >= 0),
  -- Last-resort DB guard against overpayment -- record_manual_payment()
  -- rejects it first with a readable error, this is the guarantee that
  -- holds even if that check is ever bypassed or has a bug.
  constraint invoices_balance_due_check check (balance_due >= 0)
);

create index if not exists idx_invoices_status_due_date on public.invoices (status, due_date);
create index if not exists idx_invoices_opportunity_id on public.invoices (opportunity_id);
create index if not exists idx_invoices_company_id on public.invoices (company_id);

alter table public.invoices enable row level security;
-- Matches sales_quotations exactly: view = editor+, mutate = admin+, no
-- DELETE policy at all (financial history is cancelled, never hard-deleted).
create policy invoices_select on public.invoices for select using (app.has_min_role('editor'));
create policy invoices_insert on public.invoices for insert with check (app.is_admin());
create policy invoices_update on public.invoices for update using (app.is_admin()) with check (app.is_admin());
grant select, insert, update on public.invoices to authenticated;

-- ---------------------------------------------------------------------
-- 3. invoice_items -- historical snapshot of sales_quotation_items at the
-- moment of invoice creation. source_quotation_item_id is traceability only
-- (ON DELETE SET NULL) -- an issued invoice's items must render identically
-- forever even if the source quotation item is later changed or the
-- quotation itself is revised.
create table if not exists public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  description text not null,
  quantity numeric(10,2) not null,
  unit text not null default 'pax',
  unit_price numeric(12,2) not null default 0,
  discount numeric(12,2) not null default 0,
  -- Same GENERATED formula as sales_quotation_items.line_total -- app and DB
  -- cannot drift on the line level, by construction.
  line_total numeric(12,2) generated always as (round((quantity * unit_price - discount)::numeric, 2)) stored,
  sort_order integer not null default 0,
  source_quotation_item_id uuid references public.sales_quotation_items(id) on delete set null,

  constraint invoice_items_description_check check (char_length(description) between 1 and 500),
  constraint invoice_items_quantity_check check (quantity > 0),
  constraint invoice_items_unit_check check (unit in ('pax', 'session', 'day', 'lot', 'unit')),
  constraint invoice_items_unit_price_check check (unit_price >= 0),
  constraint invoice_items_discount_check check (discount >= 0)
);

create index if not exists idx_invoice_items_invoice_id on public.invoice_items (invoice_id);

alter table public.invoice_items enable row level security;
create policy invoice_items_select on public.invoice_items for select using (app.has_min_role('editor'));
create policy invoice_items_insert on public.invoice_items for insert with check (app.is_admin());
grant select, insert on public.invoice_items to authenticated;

-- The INSERT policy above only checks app.is_admin() -- it has no way to
-- know the parent invoice is no longer 'draft'. Without this trigger, an
-- admin using direct table access (bypassing create_invoice_from_quotation)
-- could insert a new item onto an already-issued invoice, silently
-- desyncing invoice.subtotal from the true item sum. Caught by staging QA:
-- a direct INSERT against an issued invoice's items succeeded before this
-- trigger existed. Guards INSERT/UPDATE/DELETE alike -- item rows are
-- fully frozen the moment their invoice leaves 'draft'.
create or replace function app.enforce_invoice_items_immutable() returns trigger
language plpgsql security definer set search_path = public, app as $$
declare
  v_invoice_id uuid := coalesce(new.invoice_id, old.invoice_id);
  v_status text;
begin
  select status into v_status from public.invoices where id = v_invoice_id;
  if v_status is not null and v_status <> 'draft' then
    raise exception 'invoice_items_immutable_after_issue' using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_enforce_invoice_items_immutable on public.invoice_items;
create trigger trg_enforce_invoice_items_immutable
  before insert or update or delete on public.invoice_items
  for each row execute function app.enforce_invoice_items_immutable();

-- ---------------------------------------------------------------------
-- 4. invoice_payments -- one invoice can have many payments. Append-only:
-- no UPDATE/DELETE policy in V1 -- a mistaken entry is a Phase 3 reversal
-- concern, not something V1 lets anyone edit or remove. status/provider
-- vocab already covers the Phase 2 ToyyibPay shape (pending/failed/
-- cancelled/refunded, provider='toyyibpay') so that migration is additive,
-- not a rework -- but record_manual_payment() below only ever inserts
-- status='successful' rows for provider IN (cash, bank_transfer, cheque,
-- other).
create table if not exists public.invoice_payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id),

  payment_provider text not null,
  payment_method text,
  amount numeric(12,2) not null,
  currency text not null default 'MYR',
  status text not null default 'successful',

  provider_bill_code text,
  provider_transaction_id text,
  provider_reference text,
  payment_reference text,
  notes text,

  paid_at timestamptz not null default now(),
  verified_at timestamptz,

  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id),

  constraint invoice_payments_provider_check check (payment_provider in ('cash', 'bank_transfer', 'cheque', 'toyyibpay', 'other')),
  constraint invoice_payments_status_check check (status in ('pending', 'successful', 'failed', 'cancelled', 'refunded')),
  constraint invoice_payments_amount_check check (amount > 0)
);

create index if not exists idx_invoice_payments_invoice_id on public.invoice_payments (invoice_id);
-- Phase 2 idempotency key, created now so the table never needs a later
-- migration for it -- harmless (partial, nullable-friendly) today since no
-- provider transaction IDs exist until ToyyibPay lands.
create unique index if not exists idx_invoice_payments_provider_txn
  on public.invoice_payments (payment_provider, provider_transaction_id)
  where provider_transaction_id is not null;

alter table public.invoice_payments enable row level security;
create policy invoice_payments_select on public.invoice_payments for select using (app.has_min_role('editor'));
create policy invoice_payments_insert on public.invoice_payments for insert with check (app.is_admin());
grant select, insert on public.invoice_payments to authenticated;

-- ---------------------------------------------------------------------
-- 5. Balance recompute -- the ONLY writer of invoices.amount_paid/
-- balance_due/status/paid_at. Fires after every invoice_payments insert
-- (the only write path that exists in V1 -- no UPDATE/DELETE policy on that
-- table), so a direct-table-insert (bypassing record_manual_payment(), if
-- RLS ever allowed one) still can't desync the parent invoice's balance.
create or replace function app.recompute_invoice_balance() returns trigger
language plpgsql security definer set search_path = public, app as $$
declare
  v_amount_paid numeric(12,2);
  v_grand_total numeric(12,2);
  v_status text;
  v_balance numeric(12,2);
begin
  select coalesce(sum(amount), 0) into v_amount_paid
  from public.invoice_payments
  where invoice_id = new.invoice_id and status = 'successful';

  select grand_total, status into v_grand_total, v_status
  from public.invoices where id = new.invoice_id;

  v_balance := v_grand_total - v_amount_paid;

  update public.invoices
  set amount_paid = v_amount_paid,
      balance_due = v_balance,
      status = case
        when v_status = 'cancelled' then v_status
        when v_balance <= 0 and v_grand_total > 0 then 'paid'
        when v_amount_paid > 0 then 'partially_paid'
        else v_status
      end,
      paid_at = case when v_balance <= 0 and v_grand_total > 0 and paid_at is null then now() else paid_at end,
      updated_at = now()
  where id = new.invoice_id;

  return new;
end;
$$;

drop trigger if exists trg_recompute_invoice_balance on public.invoice_payments;
create trigger trg_recompute_invoice_balance
  after insert on public.invoice_payments
  for each row execute function app.recompute_invoice_balance();

-- ---------------------------------------------------------------------
-- 6. sales_activity gets 6 new additive event types for the invoice
-- lifecycle -- extends the existing closed CHECK list, does not touch any
-- existing value.
alter table public.sales_activity drop constraint if exists sales_activity_type_check;
alter table public.sales_activity add constraint sales_activity_type_check
  check (type = any (array[
    'lead_created', 'status_changed', 'assigned', 'followup_scheduled', 'note_added',
    'proposal_sent', 'won', 'lost', 'opportunity_created', 'quotation_created',
    'quotation_sent', 'quotation_revised', 'quotation_accepted', 'quotation_rejected',
    'opportunity_won', 'opportunity_lost', 'training_handoff_created', 'company_linked',
    'company_created', 'task_created', 'task_completed', 'task_reopened', 'task_cancelled',
    'invoice_created', 'invoice_issued', 'invoice_partially_paid', 'invoice_paid',
    'invoice_cancelled', 'payment_recorded'
  ]));

-- ---------------------------------------------------------------------
-- 7. create_invoice_from_quotation -- the only way an invoice comes into
-- existence. Rejects every quotation status except 'accepted', and rejects
-- a second invoice for the same quotation (also DB-enforced by
-- invoices_quotation_id_key). Recomputes taxable_amount server-side
-- (sales_quotations has no persisted taxable_amount column) and verifies it
-- reconciles with the quotation's own stored tax/total before ever writing
-- the snapshot -- "the DB must reject inconsistent totals".
create or replace function public.create_invoice_from_quotation(p_quotation_id uuid) returns uuid
language plpgsql security definer set search_path = public, app as $$
declare
  v_quotation record;
  v_opportunity record;
  v_company record;
  v_invoice_id uuid;
  v_taxable numeric(12,2);
  v_actor uuid := auth.uid();
  v_actor_email text;
begin
  if not app.is_admin() then
    raise exception 'not_authorized' using errcode = 'P0001';
  end if;

  select email into v_actor_email from public.profiles where id = v_actor;

  select * into v_quotation from public.sales_quotations where id = p_quotation_id;
  if v_quotation.id is null then
    raise exception 'quotation_not_found' using errcode = 'P0001';
  end if;
  if v_quotation.status <> 'accepted' then
    raise exception 'quotation_not_accepted' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.invoices where quotation_id = p_quotation_id) then
    raise exception 'invoice_already_exists' using errcode = 'P0001';
  end if;

  select * into v_opportunity from public.sales_opportunities where id = v_quotation.opportunity_id;
  if v_opportunity.id is null then
    raise exception 'opportunity_not_found' using errcode = 'P0001';
  end if;

  -- Always run the lookup (even when company_id is null) so v_company is a
  -- properly-assigned all-NULL record rather than an unassigned one --
  -- referencing an unassigned plpgsql record's fields raises
  -- "record is not assigned yet", which an IF-guarded SELECT INTO (only run
  -- when company_id IS NOT NULL) leaves unassigned on the common no-company
  -- path. Caught by staging QA on a fixture with no linked company.
  select * into v_company from public.companies where id = v_opportunity.company_id;

  v_taxable := round(v_quotation.subtotal - v_quotation.discount, 2);
  if round(v_taxable + v_quotation.tax, 2) <> round(v_quotation.total, 2) then
    raise exception 'quotation_totals_inconsistent' using errcode = 'P0001';
  end if;

  insert into public.invoices (
    quotation_id, opportunity_id, company_id,
    billing_name, billing_company, billing_registration_no, billing_address, billing_email, billing_phone,
    subtotal, discount_amount, taxable_amount, tax_rate, tax_amount, grand_total,
    balance_due, payment_terms, created_by
  ) values (
    p_quotation_id, v_quotation.opportunity_id, v_opportunity.company_id,
    coalesce(v_opportunity.contact_person, v_opportunity.company_name, 'N/A'),
    v_opportunity.company_name,
    v_company.registration_no,
    coalesce(v_company.billing_address, v_company.address),
    v_opportunity.contact_email,
    v_opportunity.contact_phone,
    v_quotation.subtotal, v_quotation.discount, v_taxable, v_quotation.sst_rate, v_quotation.tax, v_quotation.total,
    v_quotation.total, v_quotation.terms, v_actor
  ) returning id into v_invoice_id;

  insert into public.invoice_items (invoice_id, description, quantity, unit, unit_price, discount, sort_order, source_quotation_item_id)
  select v_invoice_id, description, quantity, unit, unit_price, discount, sort_order, id
  from public.sales_quotation_items
  where quotation_id = p_quotation_id
  order by sort_order;

  perform public.log_event_as_service(v_actor, v_actor_email, 'create'::audit_action, 'invoices', v_invoice_id::text,
    format('Invoice created from quotation %s', v_quotation.quotation_no),
    jsonb_build_object('invoice_id', v_invoice_id, 'quotation_id', p_quotation_id));

  insert into public.sales_activity (lead_metadata_id, opportunity_id, quotation_id, type, note, actor_id)
  values (v_opportunity.lead_metadata_id, v_quotation.opportunity_id, p_quotation_id, 'invoice_created', format('Draft invoice created from %s', v_quotation.quotation_no), v_actor);

  return v_invoice_id;
end;
$$;

revoke all on function public.create_invoice_from_quotation(uuid) from public;
grant execute on function public.create_invoice_from_quotation(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 8. issue_invoice -- freezes commercial fields/items. Re-verifies totals
-- one more time against the actual invoice_items rows before flipping
-- status, independent of what create_invoice_from_quotation already
-- checked (defense in depth against any future second insert path into
-- invoice_items).
create or replace function public.issue_invoice(p_invoice_id uuid) returns jsonb
language plpgsql security definer set search_path = public, app as $$
declare
  v_invoice record;
  v_lead_metadata_id uuid;
  v_item_count integer;
  v_item_sum numeric(12,2);
  v_actor uuid := auth.uid();
  v_actor_email text;
begin
  if not app.is_admin() then
    raise exception 'not_authorized' using errcode = 'P0001';
  end if;

  select email into v_actor_email from public.profiles where id = v_actor;

  select * into v_invoice from public.invoices where id = p_invoice_id for update;
  if v_invoice.id is null then
    raise exception 'invoice_not_found' using errcode = 'P0001';
  end if;
  if v_invoice.status <> 'draft' then
    raise exception 'invoice_not_draft' using errcode = 'P0001';
  end if;
  if v_invoice.due_date is null then
    raise exception 'due_date_required' using errcode = 'P0001';
  end if;
  if v_invoice.grand_total <= 0 then
    raise exception 'invalid_grand_total' using errcode = 'P0001';
  end if;

  select count(*), coalesce(sum(line_total), 0) into v_item_count, v_item_sum
  from public.invoice_items where invoice_id = p_invoice_id;
  if v_item_count = 0 then
    raise exception 'no_items' using errcode = 'P0001';
  end if;
  if round(v_item_sum, 2) <> round(v_invoice.subtotal, 2) then
    raise exception 'totals_mismatch' using errcode = 'P0001';
  end if;
  if round(v_invoice.taxable_amount + v_invoice.tax_amount, 2) <> round(v_invoice.grand_total, 2) then
    raise exception 'totals_mismatch' using errcode = 'P0001';
  end if;

  select lead_metadata_id into v_lead_metadata_id from public.sales_opportunities where id = v_invoice.opportunity_id;

  update public.invoices
  set status = 'issued', issued_at = now(), updated_at = now()
  where id = p_invoice_id;

  perform public.log_event_as_service(v_actor, v_actor_email, 'update'::audit_action, 'invoices', p_invoice_id::text,
    format('Invoice %s issued', v_invoice.invoice_no), jsonb_build_object('invoice_id', p_invoice_id, 'grand_total', v_invoice.grand_total));

  insert into public.sales_activity (lead_metadata_id, opportunity_id, quotation_id, type, note, actor_id)
  values (v_lead_metadata_id, v_invoice.opportunity_id, v_invoice.quotation_id, 'invoice_issued', format('%s issued (RM %s)', v_invoice.invoice_no, v_invoice.grand_total), v_actor);

  return jsonb_build_object('status', 'issued', 'invoice_id', p_invoice_id);
end;
$$;

revoke all on function public.issue_invoice(uuid) from public;
grant execute on function public.issue_invoice(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 9. record_manual_payment -- V1's only payment-writing path. Locks the
-- invoice row (FOR UPDATE) so two concurrent payment submissions against
-- the same invoice can't both pass the overpayment check and jointly
-- overpay -- the second waits for the first's transaction to commit (and
-- its balance_due update) before its own check runs.
create or replace function public.record_manual_payment(
  p_invoice_id uuid,
  p_payment_provider text,
  p_payment_method text,
  p_amount numeric,
  p_payment_date date,
  p_payment_reference text,
  p_notes text
) returns jsonb
language plpgsql security definer set search_path = public, app as $$
declare
  v_invoice record;
  v_lead_metadata_id uuid;
  v_actor uuid := auth.uid();
  v_actor_email text;
  v_payment_id uuid;
  v_new_amount_paid numeric(12,2);
  v_new_status text;
begin
  if not app.is_admin() then
    raise exception 'not_authorized' using errcode = 'P0001';
  end if;
  if p_payment_provider not in ('cash', 'bank_transfer', 'cheque', 'other') then
    raise exception 'invalid_payment_provider' using errcode = 'P0001';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'invalid_amount' using errcode = 'P0001';
  end if;

  select email into v_actor_email from public.profiles where id = v_actor;

  select * into v_invoice from public.invoices where id = p_invoice_id for update;
  if v_invoice.id is null then
    raise exception 'invoice_not_found' using errcode = 'P0001';
  end if;
  if v_invoice.status not in ('issued', 'partially_paid') then
    raise exception 'invoice_not_payable' using errcode = 'P0001';
  end if;
  if p_amount > v_invoice.balance_due then
    raise exception 'payment_exceeds_balance' using errcode = 'P0001';
  end if;

  select lead_metadata_id into v_lead_metadata_id from public.sales_opportunities where id = v_invoice.opportunity_id;

  insert into public.invoice_payments (
    invoice_id, payment_provider, payment_method, amount, currency, status,
    payment_reference, notes, paid_at, created_by
  ) values (
    p_invoice_id, p_payment_provider, p_payment_method, p_amount, v_invoice.currency, 'successful',
    p_payment_reference, p_notes, coalesce(p_payment_date, current_date)::timestamptz, v_actor
  ) returning id into v_payment_id;

  select amount_paid, status into v_new_amount_paid, v_new_status from public.invoices where id = p_invoice_id;

  perform public.log_event_as_service(v_actor, v_actor_email, 'create'::audit_action, 'invoice_payments', v_payment_id::text,
    format('Manual payment of RM %s recorded on invoice %s (%s)', p_amount, v_invoice.invoice_no, p_payment_provider),
    jsonb_build_object('invoice_id', p_invoice_id, 'payment_id', v_payment_id, 'amount', p_amount, 'provider', p_payment_provider));

  insert into public.sales_activity (lead_metadata_id, opportunity_id, quotation_id, type, note, actor_id)
  values (v_lead_metadata_id, v_invoice.opportunity_id, v_invoice.quotation_id, 'payment_recorded',
    format('%s: payment of RM %s recorded (%s)', v_invoice.invoice_no, p_amount, p_payment_provider), v_actor);

  if v_new_status = 'paid' then
    perform public.log_event_as_service(v_actor, v_actor_email, 'update'::audit_action, 'invoices', p_invoice_id::text,
      format('Invoice %s fully paid', v_invoice.invoice_no), jsonb_build_object('invoice_id', p_invoice_id));
    insert into public.sales_activity (lead_metadata_id, opportunity_id, quotation_id, type, note, actor_id)
    values (v_lead_metadata_id, v_invoice.opportunity_id, v_invoice.quotation_id, 'invoice_paid', format('%s fully paid', v_invoice.invoice_no), v_actor);
  elsif v_new_status = 'partially_paid' then
    insert into public.sales_activity (lead_metadata_id, opportunity_id, quotation_id, type, note, actor_id)
    values (v_lead_metadata_id, v_invoice.opportunity_id, v_invoice.quotation_id, 'invoice_partially_paid',
      format('%s partially paid (balance RM %s)', v_invoice.invoice_no, v_invoice.grand_total - v_new_amount_paid), v_actor);
  end if;

  return jsonb_build_object('payment_id', v_payment_id, 'amount_paid', v_new_amount_paid, 'status', v_new_status);
end;
$$;

revoke all on function public.record_manual_payment(uuid, text, text, numeric, date, text, text) from public;
grant execute on function public.record_manual_payment(uuid, text, text, numeric, date, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 10. cancel_invoice -- draft cancels freely; issued cancels only while
-- amount_paid = 0; partially_paid/paid can never be cancelled directly in
-- V1 (a real reversal/refund flow is an explicit Phase 3 deferral, not
-- built here).
create or replace function public.cancel_invoice(p_invoice_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, app as $$
declare
  v_invoice record;
  v_lead_metadata_id uuid;
  v_actor uuid := auth.uid();
  v_actor_email text;
begin
  if not app.is_admin() then
    raise exception 'not_authorized' using errcode = 'P0001';
  end if;

  select email into v_actor_email from public.profiles where id = v_actor;

  select * into v_invoice from public.invoices where id = p_invoice_id for update;
  if v_invoice.id is null then
    raise exception 'invoice_not_found' using errcode = 'P0001';
  end if;
  if v_invoice.status = 'cancelled' then
    raise exception 'already_cancelled' using errcode = 'P0001';
  end if;
  if v_invoice.status = 'draft' then
    null;
  elsif v_invoice.status = 'issued' and v_invoice.amount_paid = 0 then
    null;
  else
    raise exception 'cannot_cancel_invoice_with_payments' using errcode = 'P0001';
  end if;

  select lead_metadata_id into v_lead_metadata_id from public.sales_opportunities where id = v_invoice.opportunity_id;

  update public.invoices
  set status = 'cancelled', cancelled_at = now(), updated_at = now()
  where id = p_invoice_id;

  perform public.log_event_as_service(v_actor, v_actor_email, 'update'::audit_action, 'invoices', p_invoice_id::text,
    format('Invoice %s cancelled%s', v_invoice.invoice_no, case when p_reason is not null and length(trim(p_reason)) > 0 then ': ' || p_reason else '' end),
    jsonb_build_object('invoice_id', p_invoice_id, 'reason', p_reason));

  insert into public.sales_activity (lead_metadata_id, opportunity_id, quotation_id, type, note, actor_id)
  values (v_lead_metadata_id, v_invoice.opportunity_id, v_invoice.quotation_id, 'invoice_cancelled',
    format('%s cancelled%s', v_invoice.invoice_no, case when p_reason is not null and length(trim(p_reason)) > 0 then ': ' || p_reason else '' end), v_actor);

  return jsonb_build_object('status', 'cancelled', 'invoice_id', p_invoice_id);
end;
$$;

revoke all on function public.cancel_invoice(uuid, text) from public;
grant execute on function public.cancel_invoice(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 11. Register the module. Sales/editor can view (list + detail); creating
-- a draft, issuing, recording a payment, and cancelling all additionally
-- require app.is_admin() via RLS/the RPCs above -- same two-layer gate as
-- sales_quotations. No separate "payments" module key -- payments have no
-- list/detail page of their own, always viewed in an invoice's context.
insert into public.staff_module_catalog (module_key, label, group_key, min_role, is_active)
values ('invoices', 'Invoices', 'sales', 'editor', true)
on conflict (module_key) do nothing;
