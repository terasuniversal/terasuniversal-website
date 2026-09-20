-- TERAS Receipt V1
-- Local-only implementation for schema/security review.
-- DO NOT APPLY to staging or production without independent review and human approval.
-- A receipt is an immutable snapshot of one eligible successful payment.

create sequence if not exists app.sales_receipt_seq;

create or replace function app.next_receipt_number() returns text
language sql
security definer
set search_path = 'app'
as $$
  select 'RCPT-' || to_char(current_date, 'YYYY') || '-' || lpad(nextval('app.sales_receipt_seq')::text, 4, '0');
$$;

revoke all on function app.next_receipt_number() from public, anon, authenticated;

create table if not exists public.receipts (
  id uuid primary key default gen_random_uuid(),
  receipt_no text not null default app.next_receipt_number(),

  invoice_id uuid not null references public.invoices(id),
  invoice_payment_id uuid not null unique references public.invoice_payments(id),

  receipt_date timestamptz not null,
  currency text not null,
  amount_received numeric(12,2) not null,

  payment_provider_snapshot text,
  payment_method_snapshot text,
  payment_source_snapshot text,
  payment_reference_snapshot text,
  provider_reference_snapshot text,

  invoice_number_snapshot text not null,
  customer_name_snapshot text,
  customer_company_snapshot text,
  customer_registration_no_snapshot text,
  customer_email_snapshot text,

  invoice_grand_total_snapshot numeric(12,2) not null,
  amount_paid_after_snapshot numeric(12,2) not null,
  balance_after_snapshot numeric(12,2) not null,

  notes text,
  status text not null default 'issued',
  issued_at timestamptz not null default now(),
  refunded_at timestamptz,
  voided_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),

  constraint receipts_receipt_no_key unique (receipt_no),
  constraint receipts_status_check check (status in ('issued', 'refunded', 'voided')),
  constraint receipts_amount_received_check check (amount_received > 0),
  constraint receipts_invoice_total_check check (invoice_grand_total_snapshot >= 0),
  constraint receipts_amount_paid_after_check check (amount_paid_after_snapshot >= 0),
  constraint receipts_balance_after_check check (balance_after_snapshot >= 0)
);

create index if not exists idx_receipts_invoice_id on public.receipts (invoice_id);
create index if not exists idx_receipts_status on public.receipts (status);

alter table public.receipts enable row level security;
create policy receipts_select on public.receipts
  for select using (app.has_min_role('editor'));
revoke insert, update, delete on public.receipts from authenticated;
grant select on public.receipts to authenticated;

alter table public.sales_activity drop constraint if exists sales_activity_type_check;
alter table public.sales_activity add constraint sales_activity_type_check
  check (type = any (array[
    'lead_created', 'status_changed', 'assigned', 'followup_scheduled', 'note_added',
    'proposal_sent', 'won', 'lost', 'opportunity_created', 'quotation_created',
    'quotation_sent', 'quotation_revised', 'quotation_accepted', 'quotation_rejected',
    'opportunity_won', 'opportunity_lost', 'training_handoff_created', 'company_linked',
    'company_created', 'task_created', 'task_completed', 'task_reopened', 'task_cancelled',
    'invoice_created', 'invoice_issued', 'invoice_partially_paid', 'invoice_paid',
    'invoice_cancelled', 'payment_recorded', 'receipt_issued'
  ]));

-- One payment can produce at most one receipt. The RPC below is the only
-- normal application creation path and is idempotent under this constraint.
-- REFUND_MUTATION_FLOW = DEFERRED for Receipt V1. No refund UI/RPC is added;
-- the defensive trigger below preserves Receipt semantics if an approved,
-- trusted refund path is introduced later.
create or replace function public.generate_receipt_for_payment(p_payment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_payment record;
  v_invoice record;
  v_existing record;
  v_amount_received numeric(12,2);
  v_amount_paid_after numeric(12,2);
  v_balance_after numeric(12,2);
  v_receipt_id uuid;
  v_receipt_no text;
  v_actor uuid := auth.uid();
  v_actor_email text;
  v_lead_metadata_id uuid;
begin
  if not app.is_admin() then
    raise exception 'not_authorized' using errcode = 'P0001';
  end if;

  select email into v_actor_email from public.profiles where id = v_actor;

  select * into v_payment
  from public.invoice_payments
  where id = p_payment_id
  for update;

  if v_payment.id is null then
    raise exception 'payment_not_found' using errcode = 'P0001';
  end if;

  select * into v_invoice
  from public.invoices
  where id = v_payment.invoice_id
  for update;

  if v_invoice.id is null then
    raise exception 'invoice_not_found' using errcode = 'P0001';
  end if;

  if v_payment.currency is distinct from v_invoice.currency then
    raise exception 'receipt_currency_mismatch' using errcode = 'P0001';
  end if;

  select id, receipt_no, status into v_existing
  from public.receipts
  where invoice_payment_id = p_payment_id;

  if v_existing.id is not null then
    return jsonb_build_object(
      'receipt_id', v_existing.id,
      'receipt_no', v_existing.receipt_no,
      'status', v_existing.status,
      'existing', true
    );
  end if;

  if v_payment.payment_source = 'hrdf' then
    raise exception 'hrdf_receipt_unavailable' using errcode = 'P0001';
  end if;

  if v_payment.status <> 'successful' then
    raise exception 'payment_not_successful' using errcode = 'P0001';
  end if;

  if v_payment.paid_at is null then
    raise exception 'successful_payment_missing_paid_at' using errcode = 'P0001';
  end if;

  if v_payment.payment_provider = 'toyyibpay' then
    if v_payment.verified_amount is null
       or v_payment.verified_amount <= 0
       or v_payment.provider_transaction_id is null
       or v_payment.verified_at is null
    then
      raise exception 'toyyibpay_payment_not_verified' using errcode = 'P0001';
    end if;
    v_amount_received := round(v_payment.verified_amount, 2);
  else
    if v_payment.amount is null or v_payment.amount <= 0 then
      raise exception 'payment_amount_invalid' using errcode = 'P0001';
    end if;
    v_amount_received := round(v_payment.amount, 2);
  end if;

  if exists (
    select 1
    from public.invoice_payments p
    where p.invoice_id = v_payment.invoice_id
      and p.payment_provider = 'toyyibpay'
      and p.status = 'successful'
      and (
        p.paid_at is null
        or (
          (
            p.paid_at < v_payment.paid_at
            or (p.paid_at = v_payment.paid_at and p.created_at < v_payment.created_at)
            or (p.paid_at = v_payment.paid_at and p.created_at = v_payment.created_at and p.id <= v_payment.id)
          )
          and (
            p.verified_amount is null
            or p.verified_amount <= 0
            or p.provider_transaction_id is null
            or p.verified_at is null
          )
        )
      )
  ) then
    raise exception 'receipt_payment_history_invalid' using errcode = 'P0001';
  end if;

  -- Historical total: include only eligible successful payments whose
  -- payment ordering is at or before this payment. Generation order is not
  -- part of the financial snapshot.
  select round(coalesce(sum(
    case
      when p.payment_provider = 'toyyibpay' then p.verified_amount
      else p.amount
    end
  ), 0), 2)
  into v_amount_paid_after
  from public.invoice_payments p
  where p.invoice_id = v_payment.invoice_id
    and p.status = 'successful'
    and p.paid_at is not null
    and (
      p.paid_at < v_payment.paid_at
      or (p.paid_at = v_payment.paid_at and p.created_at < v_payment.created_at)
      or (p.paid_at = v_payment.paid_at and p.created_at = v_payment.created_at and p.id <= v_payment.id)
    )
    and (
      p.payment_provider <> 'toyyibpay'
      or (p.verified_amount is not null and p.verified_amount > 0
          and p.provider_transaction_id is not null and p.verified_at is not null)
    );

  if v_amount_paid_after > round(v_invoice.grand_total, 2) then
    raise exception 'receipt_snapshot_overpayment' using errcode = 'P0001';
  end if;

  v_balance_after := round(v_invoice.grand_total - v_amount_paid_after, 2);
  if v_balance_after < 0 then
    raise exception 'receipt_snapshot_negative_balance' using errcode = 'P0001';
  end if;

  insert into public.receipts (
    invoice_id,
    invoice_payment_id,
    receipt_date,
    currency,
    amount_received,
    payment_provider_snapshot,
    payment_method_snapshot,
    payment_source_snapshot,
    payment_reference_snapshot,
    provider_reference_snapshot,
    invoice_number_snapshot,
    customer_name_snapshot,
    customer_company_snapshot,
    customer_registration_no_snapshot,
    customer_email_snapshot,
    invoice_grand_total_snapshot,
    amount_paid_after_snapshot,
    balance_after_snapshot,
    notes,
    created_by
  ) values (
    v_payment.invoice_id,
    v_payment.id,
    v_payment.paid_at,
    v_payment.currency,
    v_amount_received,
    v_payment.payment_provider,
    v_payment.payment_method,
    v_payment.payment_source,
    v_payment.payment_reference,
    coalesce(v_payment.provider_reference, v_payment.provider_transaction_id),
    v_invoice.invoice_no,
    v_invoice.billing_name,
    v_invoice.billing_company,
    v_invoice.billing_registration_no,
    v_invoice.billing_email,
    round(v_invoice.grand_total, 2),
    v_amount_paid_after,
    v_balance_after,
    v_payment.notes,
    auth.uid()
  )
  returning id, receipt_no into v_receipt_id, v_receipt_no;

  perform public.log_event_as_service(
    v_actor,
    v_actor_email,
    'create'::audit_action,
    'receipts',
    v_receipt_id::text,
    format('Receipt %s issued for invoice %s', v_receipt_no, v_invoice.invoice_no),
    jsonb_build_object(
      'event', 'receipt_issued',
      'receipt_id', v_receipt_id,
      'receipt_no', v_receipt_no,
      'invoice_id', v_invoice.id,
      'invoice_payment_id', v_payment.id,
      'amount_received', v_amount_received,
      'currency', v_payment.currency,
      'actor_id', v_actor
    )
  );

  -- CRM activity is secondary context. It must never prevent the financial
  -- Receipt and mandatory audit event from being committed. Do not invent a
  -- lead id when the invoice has no linked opportunity/lead.
  begin
    select lead_metadata_id into v_lead_metadata_id
    from public.sales_opportunities
    where id = v_invoice.opportunity_id;

    if v_lead_metadata_id is not null then
      insert into public.sales_activity (
        lead_metadata_id, opportunity_id, quotation_id, type, note, actor_id
      ) values (
        v_lead_metadata_id,
        v_invoice.opportunity_id,
        v_invoice.quotation_id,
        'receipt_issued',
        format('%s issued for payment %s (%s %s)', v_receipt_no, v_payment.id, v_amount_received, v_payment.currency),
        v_actor
      );
    end if;
  exception
    when others then
      -- Receipt issuance and its audit event remain authoritative even when
      -- optional CRM context is unavailable or cannot be written.
      null;
  end;

  return jsonb_build_object(
    'receipt_id', v_receipt_id,
    'receipt_no', v_receipt_no,
    'status', 'issued',
    'existing', false
  );
exception
  when unique_violation then
    select id, receipt_no, status into v_existing
    from public.receipts
    where invoice_payment_id = p_payment_id;
    if v_existing.id is not null then
      return jsonb_build_object(
        'receipt_id', v_existing.id,
        'receipt_no', v_existing.receipt_no,
        'status', v_existing.status,
        'existing', true
      );
    end if;
    raise;
end;
$$;

revoke all on function public.generate_receipt_for_payment(uuid) from public;
grant execute on function public.generate_receipt_for_payment(uuid) to authenticated;

-- Receipt history is never deleted or manually edited. If a trusted payment
-- path later transitions a successful payment to refunded, the linked receipt
-- is automatically marked refunded while retaining its original snapshots.
create or replace function app.void_receipt_on_refunded_payment() returns trigger
language plpgsql
security definer
set search_path = public, app
as $$
begin
  if old.status = 'successful' and new.status = 'refunded' then
    update public.receipts
    set status = 'refunded',
        refunded_at = coalesce(refunded_at, now())
    where invoice_payment_id = new.id
      and status = 'issued';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_void_receipt_on_refunded_payment on public.invoice_payments;
create trigger trg_void_receipt_on_refunded_payment
after update of status on public.invoice_payments
for each row execute function app.void_receipt_on_refunded_payment();

revoke all on function app.void_receipt_on_refunded_payment() from public;
