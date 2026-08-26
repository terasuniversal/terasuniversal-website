-- ToyyibPay Phase 2E -- verified_amount financial truth fix.
--
-- Proven defect (live-reproduced against staging, 2026-08-26): a ToyyibPay
-- attempt requested for RM265.00 but provider-verified for only RM100.00
-- was recorded correctly on invoice_payments (amount=265.00,
-- verified_amount=100.00), but app.recompute_invoice_balance() summed
-- invoice_payments.amount for every successful row -- crediting the
-- invoice the full RM265.00 originally-requested amount instead of the
-- RM100.00 ToyyibPay actually confirmed. The invoice was left showing
-- status='paid', amount_paid=265.00, balance_due=0.00, which is wrong.
--
-- For manual payments `amount` IS the true collected amount (there is no
-- separate verified concept for a cash/bank_transfer/cheque/other row --
-- record_manual_payment() never populates verified_amount for those), so
-- only the ToyyibPay branch changes here.
--
-- enforce_toyyibpay_attempt_transition (BEFORE UPDATE on invoice_payments,
-- unchanged by this migration) already hard-requires verified_amount,
-- provider_transaction_id, verified_at and paid_at to be non-null on any
-- pending -> successful transition, so a toyyibpay row can only ever reach
-- status = 'successful' with verified_amount already populated, through
-- every real RPC path (finalize_toyyibpay_payment /
-- finalize_toyyibpay_payment_from_callback). This function intentionally
-- does NOT fall back to `amount` if verified_amount is ever unexpectedly
-- null on a toyyibpay row -- per instruction, that row must never be
-- silently credited for an amount the provider never confirmed; it simply
-- contributes nothing to amount_paid (sum() skips a null case-expression
-- result) rather than falling back to the unverified requested amount.
--
-- Read-only aggregate change to the trigger function only -- no table,
-- index, grant, or trigger-attachment change; invoice_payments rows
-- already written (including the underpayment QA evidence row on staging)
-- are untouched by this migration and will simply recompute correctly the
-- next time trg_recompute_invoice_balance fires for their invoice.
create or replace function app.recompute_invoice_balance() returns trigger
language plpgsql security definer set search_path = public, app as $$
declare
  v_amount_paid numeric(12,2);
  v_grand_total numeric(12,2);
  v_status text;
  v_balance numeric(12,2);
begin
  select coalesce(sum(
    case
      when payment_provider = 'toyyibpay' then verified_amount
      else amount
    end
  ), 0) into v_amount_paid
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
