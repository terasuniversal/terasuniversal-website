-- Invoice V1 -- Final Financial Integrity & Security Hardening.
-- All mutations on invoices/invoice_items/invoice_payments now flow ONLY
-- through the four SECURITY DEFINER RPCs (create_invoice_from_quotation,
-- issue_invoice, record_manual_payment, cancel_invoice) plus the single
-- legitimate direct-table path that remains: updateInvoiceDraft's UPDATE on
-- invoices while status='draft' (a real Server Action need, not an RPC --
-- kept, but now backed by a field-level trigger rather than relying on the
-- app-layer status check alone).

-- ---------------------------------------------------------------------
-- 1. invoice_payments: no direct INSERT/UPDATE/DELETE for authenticated at
-- all. Every legitimate write happens inside record_manual_payment(),
-- which is SECURITY DEFINER and runs as the table owner -- RLS (and the
-- table GRANT) never applies to the owner, so removing authenticated's
-- INSERT here costs the RPC nothing.
drop policy if exists invoice_payments_insert on public.invoice_payments;
revoke insert on public.invoice_payments from authenticated;
-- (no UPDATE/DELETE policy or grant ever existed -- V1 payments were
-- already immutable once written; this just closes the INSERT gap.)

-- ---------------------------------------------------------------------
-- 2. invoice_items: same reasoning -- the only legitimate writer is
-- create_invoice_from_quotation() (owner-run, RLS-exempt). No Server
-- Action ever inserts an item directly. Removing this policy also closes
-- the narrow while-draft gap where an admin could otherwise INSERT an
-- extra item via direct table access and have it silently sit unnoticed
-- until issue_invoice()'s totals check caught it.
drop policy if exists invoice_items_insert on public.invoice_items;
revoke insert on public.invoice_items from authenticated;

-- ---------------------------------------------------------------------
-- 3. invoices: same reasoning for INSERT (only create_invoice_from_quotation
-- creates a row, owner-run). UPDATE is DIFFERENT -- updateInvoiceDraft is a
-- real Server Action that legitimately UPDATEs invoices directly (not
-- through an RPC) to let staff correct billing/date/notes while still
-- draft. That policy is kept, but the trigger below is the actual
-- financial guard from here on -- app.is_admin() alone was never enough,
-- since it says nothing about WHICH fields are being changed.
drop policy if exists invoices_insert on public.invoices;
revoke insert on public.invoices from authenticated;

-- ---------------------------------------------------------------------
-- 4. Field-level immutability trigger on invoices. Three tiers:
--   a) Always-frozen (any status, forever): the structural links and every
--      commercial total -- set once by create_invoice_from_quotation(),
--      never legitimately touched again by anything.
--   b) Frozen once issued: presentation/date fields -- editable while
--      draft (updateInvoiceDraft's real path), frozen the moment status
--      leaves 'draft'.
--   c) System-only fields (status/amount_paid/balance_due/issued_at/
--      paid_at/cancelled_at) -- may only change when the session-local
--      flag app.invoice_trusted_write is set, which only the three
--      controlling functions (issue_invoice, cancel_invoice,
--      app.recompute_invoice_balance) set immediately before their own
--      UPDATE. A raw admin UPDATE of these columns never sets that flag,
--      so it fails closed -- this is what actually stops
--      `UPDATE invoices SET status='paid', amount_paid=999999`, which
--      app.is_admin()-only RLS could not have stopped on its own.
create or replace function app.enforce_invoice_financial_immutability() returns trigger
language plpgsql security definer set search_path = public, app as $$
declare
  v_trusted boolean := coalesce(current_setting('app.invoice_trusted_write', true), '') = 'on';
begin
  if new.quotation_id is distinct from old.quotation_id
     or new.opportunity_id is distinct from old.opportunity_id
     or new.company_id is distinct from old.company_id
     or new.currency is distinct from old.currency
     or new.subtotal is distinct from old.subtotal
     or new.discount_amount is distinct from old.discount_amount
     or new.taxable_amount is distinct from old.taxable_amount
     or new.tax_rate is distinct from old.tax_rate
     or new.tax_amount is distinct from old.tax_amount
     or new.grand_total is distinct from old.grand_total
  then
    raise exception 'invoice_financial_fields_immutable' using errcode = 'P0001';
  end if;

  if old.status <> 'draft' and (
       new.billing_name is distinct from old.billing_name
    or new.billing_company is distinct from old.billing_company
    or new.billing_registration_no is distinct from old.billing_registration_no
    or new.billing_address is distinct from old.billing_address
    or new.billing_email is distinct from old.billing_email
    or new.billing_phone is distinct from old.billing_phone
    or new.invoice_date is distinct from old.invoice_date
    or new.due_date is distinct from old.due_date
    or new.notes is distinct from old.notes
    or new.payment_terms is distinct from old.payment_terms
  ) then
    raise exception 'invoice_presentation_fields_immutable_after_issue' using errcode = 'P0001';
  end if;

  if not v_trusted and (
       new.status is distinct from old.status
    or new.amount_paid is distinct from old.amount_paid
    or new.balance_due is distinct from old.balance_due
    or new.issued_at is distinct from old.issued_at
    or new.paid_at is distinct from old.paid_at
    or new.cancelled_at is distinct from old.cancelled_at
  ) then
    raise exception 'invoice_system_fields_require_controlled_path' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_invoice_financial_immutability on public.invoices;
create trigger trg_enforce_invoice_financial_immutability
  before update on public.invoices
  for each row execute function app.enforce_invoice_financial_immutability();

-- ---------------------------------------------------------------------
-- 5. Mark the three trusted internal writers so they set the flag
-- immediately before their own UPDATE on invoices. transaction-local
-- (is_local=true) so it can never leak to an unrelated later statement in
-- the same pooled connection.
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

  perform set_config('app.invoice_trusted_write', 'on', true);
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

  perform set_config('app.invoice_trusted_write', 'on', true);
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

  perform set_config('app.invoice_trusted_write', 'on', true);
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
