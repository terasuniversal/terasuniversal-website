-- Original (live) function bodies + M-S7 wrapper + live ACLs. Bodies = docs/security/fpay1-p2/20261123100000_fpay1_p2_cancel_finalize_guards.rollback.sql (md5 d08eaad2 / 78c36cd6).
\set ON_ERROR_STOP on
-- F-PAY-1 P2 rollback: original bodies as read from Staging and Production on 2026-11-23 (identical; prosrc md5 d08eaad2 / 78c36cd6).
CREATE OR REPLACE FUNCTION public.cancel_invoice_unguarded(p_invoice_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.finalize_toyyibpay_payment_from_callback(p_attempt_id uuid, p_billcode text, p_verified_amount numeric, p_provider_transaction_id text, p_provider_transaction_time timestamp with time zone, p_callback_received_at timestamp with time zone, p_raw_response jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app'
AS $function$
declare
  v_attempt record;
  v_invoice record;
  v_invoice_no text;
  v_lead_metadata_id uuid;
  v_paid_at timestamptz;
  v_new_amount_paid numeric(12,2);
  v_new_status text;
  v_actor uuid;
  v_actor_email text;
begin
  select actor_id, actor_email into v_actor, v_actor_email from app.toyyibpay_system_actor();

  if p_verified_amount is null or p_verified_amount <= 0 then
    raise exception 'invalid_amount' using errcode = 'P0001';
  end if;
  if p_provider_transaction_id is null or length(trim(p_provider_transaction_id)) = 0 then
    raise exception 'invalid_provider_transaction_id' using errcode = 'P0001';
  end if;
  if p_billcode is null or length(trim(p_billcode)) = 0 then
    raise exception 'invalid_billcode' using errcode = 'P0001';
  end if;

  select * into v_attempt from public.invoice_payments where id = p_attempt_id and payment_provider = 'toyyibpay' for update;
  if v_attempt.id is null then
    raise exception 'attempt_not_found' using errcode = 'P0001';
  end if;
  if v_attempt.provider_bill_code is distinct from p_billcode then
    raise exception 'billcode_mismatch' using errcode = 'P0001';
  end if;

  select invoice_no into v_invoice_no from public.invoices where id = v_attempt.invoice_id;

  -- Already successful: replay (same refno) or a genuine anomaly (different refno).
  if v_attempt.status = 'successful' then
    if v_attempt.provider_transaction_id = p_provider_transaction_id then
      perform public.log_event_as_service(v_actor, v_actor_email, 'update'::audit_action, 'invoice_payments', p_attempt_id::text,
        format('ToyyibPay callback replay ignored for invoice %s (%s) -- already finalized with the same provider transaction', coalesce(v_invoice_no, '?'), p_billcode),
        jsonb_build_object('invoice_id', v_attempt.invoice_id, 'attempt_id', p_attempt_id, 'billcode', p_billcode, 'provider_transaction_id', p_provider_transaction_id));
      return jsonb_build_object('outcome', 'duplicate_ignored', 'attempt_id', p_attempt_id);
    end if;

    perform public.log_event_as_service(v_actor, v_actor_email, 'update'::audit_action, 'invoice_payments', p_attempt_id::text,
      format('ToyyibPay callback for invoice %s (%s) reports a DIFFERENT provider transaction than the one already recorded -- reconciliation required, nothing changed', coalesce(v_invoice_no, '?'), p_billcode),
      jsonb_build_object('invoice_id', v_attempt.invoice_id, 'attempt_id', p_attempt_id, 'billcode', p_billcode,
        'existing_provider_transaction_id', v_attempt.provider_transaction_id, 'new_provider_transaction_id', p_provider_transaction_id,
        'verified_amount', p_verified_amount, 'raw_response', p_raw_response));
    return jsonb_build_object('outcome', 'reconciliation_required', 'attempt_id', p_attempt_id);
  end if;

  -- Terminal but NOT successful (superseded/failed/cancelled), yet the
  -- provider now confirms real money -- never silently apply against a
  -- balance that may have already moved for another reason (item 10).
  if v_attempt.status <> 'pending' then
    perform public.log_event_as_service(v_actor, v_actor_email, 'update'::audit_action, 'invoice_payments', p_attempt_id::text,
      format('ToyyibPay callback for invoice %s (%s) confirms a real provider transaction, but the local attempt is already "%s" -- reconciliation required, evidence preserved, nothing changed', coalesce(v_invoice_no, '?'), p_billcode, v_attempt.status),
      jsonb_build_object('invoice_id', v_attempt.invoice_id, 'attempt_id', p_attempt_id, 'billcode', p_billcode, 'local_status', v_attempt.status,
        'provider_transaction_id', p_provider_transaction_id, 'verified_amount', p_verified_amount, 'raw_response', p_raw_response));
    return jsonb_build_object('outcome', 'reconciliation_required', 'attempt_id', p_attempt_id);
  end if;

  -- Pending -- the normal path. Re-check against the CURRENT invoice
  -- balance (may have moved since the attempt was created, e.g. a manual
  -- payment) before ever writing anything.
  select * into v_invoice from public.invoices where id = v_attempt.invoice_id for update;
  if v_invoice.id is null then
    raise exception 'invoice_not_found' using errcode = 'P0001';
  end if;
  if p_verified_amount > v_invoice.balance_due then
    perform public.log_event_as_service(v_actor, v_actor_email, 'update'::audit_action, 'invoice_payments', p_attempt_id::text,
      format('ToyyibPay callback for invoice %s (%s): provider-confirmed amount RM %s exceeds current balance RM %s -- left pending, reconciliation required', v_invoice.invoice_no, p_billcode, p_verified_amount, v_invoice.balance_due),
      jsonb_build_object('invoice_id', v_attempt.invoice_id, 'attempt_id', p_attempt_id, 'billcode', p_billcode,
        'verified_amount', p_verified_amount, 'balance_due', v_invoice.balance_due, 'provider_transaction_id', p_provider_transaction_id, 'raw_response', p_raw_response));
    return jsonb_build_object('outcome', 'amount_exceeds_balance', 'attempt_id', p_attempt_id);
  end if;

  v_paid_at := coalesce(p_provider_transaction_time, now());

  update public.invoice_payments
  set status = 'successful',
      verified_amount = p_verified_amount,
      provider_transaction_id = p_provider_transaction_id,
      paid_at = v_paid_at,
      callback_received_at = p_callback_received_at,
      verified_at = now(),
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('raw_response', p_raw_response),
      updated_at = now()
  where id = p_attempt_id;

  select amount_paid, status into v_new_amount_paid, v_new_status from public.invoices where id = v_attempt.invoice_id;
  select lead_metadata_id into v_lead_metadata_id from public.sales_opportunities where id = v_invoice.opportunity_id;

  perform public.log_event_as_service(v_actor, v_actor_email, 'update'::audit_action, 'invoice_payments', p_attempt_id::text,
    format('ToyyibPay payment verified successful via callback for invoice %s (RM %s, %s)', v_invoice.invoice_no, p_verified_amount, p_billcode),
    jsonb_build_object('invoice_id', v_attempt.invoice_id, 'attempt_id', p_attempt_id, 'billcode', p_billcode,
      'verified_amount', p_verified_amount, 'provider_transaction_id', p_provider_transaction_id, 'paid_at', v_paid_at));

  insert into public.sales_activity (lead_metadata_id, opportunity_id, quotation_id, type, note, actor_id)
  values (v_lead_metadata_id, v_invoice.opportunity_id, v_invoice.quotation_id, 'payment_recorded',
    format('%s: ToyyibPay payment of RM %s verified (%s)', v_invoice.invoice_no, p_verified_amount, p_billcode), null);

  if v_new_status = 'paid' then
    insert into public.sales_activity (lead_metadata_id, opportunity_id, quotation_id, type, note, actor_id)
    values (v_lead_metadata_id, v_invoice.opportunity_id, v_invoice.quotation_id, 'invoice_paid', format('%s fully paid (ToyyibPay)', v_invoice.invoice_no), null);
  elsif v_new_status = 'partially_paid' then
    insert into public.sales_activity (lead_metadata_id, opportunity_id, quotation_id, type, note, actor_id)
    values (v_lead_metadata_id, v_invoice.opportunity_id, v_invoice.quotation_id, 'invoice_partially_paid',
      format('%s partially paid via ToyyibPay (balance RM %s)', v_invoice.invoice_no, v_invoice.grand_total - v_new_amount_paid), null);
  end if;

  return jsonb_build_object('outcome', 'finalized', 'attempt_id', p_attempt_id, 'status', 'successful');
end;
$function$
;

CREATE OR REPLACE FUNCTION public.cancel_invoice(p_invoice_id uuid, p_reason text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
begin
  if not public.has_module_access_level('invoices', 'edit') then
    raise exception 'not_authorized' using errcode = 'P0001';
  end if;
  return public.cancel_invoice_unguarded(p_invoice_id, p_reason);
end;
$function$;

-- live ACLs (Production, 2026-11-23)
revoke all on function public.cancel_invoice(uuid, text) from public;
grant execute on function public.cancel_invoice(uuid, text) to authenticated;
revoke all on function public.cancel_invoice_unguarded(uuid, text) from public;
revoke all on function public.finalize_toyyibpay_payment_from_callback(uuid, text, numeric, text, timestamptz, timestamptz, jsonb) from public;
grant execute on function public.finalize_toyyibpay_payment_from_callback(uuid, text, numeric, text, timestamptz, timestamptz, jsonb) to service_role;
