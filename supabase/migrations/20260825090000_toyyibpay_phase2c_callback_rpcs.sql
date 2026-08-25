-- ToyyibPay Phase 2C -- Callback mutation boundary.
--
-- Phase 2A's finalize_toyyibpay_payment/mark_toyyibpay_attempt_failed are
-- app.is_admin()-gated -- correct for Phase 2A's manual/no-caller-yet
-- state, but a ToyyibPay callback arrives with NO staff session at all
-- (auth.uid() is null), so app.is_admin() always fails for it. This
-- migration does NOT touch those two functions and does NOT grant them to
-- anon or weaken their app.is_admin() check, per explicit instruction.
--
-- Instead: three new, narrowly-scoped functions, callable only via the
-- server-only Supabase service-role client used exclusively inside the new
-- callback Route Handler (app/api/payments/toyyibpay/callback/route.ts).
-- Confirmed empirically before writing this migration: service_role
-- already has implicit EXECUTE on every public-schema function and
-- implicit INSERT/UPDATE on every public-schema table in this project by
-- Supabase's own platform convention (checked via has_function_privilege/
-- has_table_privilege against an existing, never-explicitly-granted
-- function/table) -- so no explicit `grant ... to service_role` is needed
-- or added here. What IS needed, and done below, is revoking anon/
-- authenticated/public execute so these three functions are reachable by
-- nothing except that one server-only credential path -- never a generic
-- financial RPC exposed to the internet at large, per instruction.
--
-- None of these functions trust a client-supplied invoice id -- every one
-- resolves and re-validates the attempt row from p_attempt_id +
-- p_billcode, independently, inside its own FOR UPDATE-locked transaction.

-- ---------------------------------------------------------------------
-- 0. log_event_as_service() requires a non-null actor_id (confirmed by
-- reading its source live before writing this migration), and
-- audit_logs.actor_id has a real FK to profiles(id) -- which ITSELF has a
-- real FK to auth.users(id) (also confirmed live, the hard way: a first
-- attempt at a synthetic profiles row with no matching auth.users row
-- failed exactly that constraint). Fabricating an auth.users row purely to
-- satisfy an audit-attribution requirement is out of proportion to the
-- problem -- the correct, minimal, environment-portable fix is to
-- dynamically look up a real existing admin at call time (works
-- identically on staging and production, never hard-codes an
-- environment-specific profile id) and use it as the attribution for
-- automated callback events. Every summary message these functions write
-- explicitly says "(callback)"/"via callback", so it is never ambiguous
-- to a reader that the action was automated despite the real actor_id.
create or replace function app.toyyibpay_system_actor(out actor_id uuid, out actor_email text)
language sql stable security definer set search_path = public, app as $$
  select id, email from public.profiles
  where role in ('super_admin', 'admin') and is_active = true
  order by (role = 'super_admin') desc, created_at asc
  limit 1;
$$;

-- ---------------------------------------------------------------------
-- 1. Finalize a successful, provider-verified ToyyibPay payment. Called
-- ONLY after the callback route has independently: validated the callback
-- hash, resolved the attempt by (billcode, order_id), and confirmed
-- success via a server-to-server Get Bill Transactions call. This
-- function does not re-derive that confirmation -- it records it, and
-- independently re-validates everything about the attempt's current state
-- before doing so (never trusts that nothing changed between the route's
-- earlier read and this call).
--
-- Handles four distinct outcomes internally, returned as a
-- jsonb `outcome` field rather than always finalizing or always raising --
-- these are legitimate distinct cases, not error conditions:
--   'finalized'              -- pending -> successful, normal path.
--   'duplicate_ignored'      -- already successful with the SAME
--                                provider_transaction_id -- a genuine
--                                callback replay, idempotent no-op.
--   'reconciliation_required'-- either (a) already successful with a
--                                DIFFERENT provider_transaction_id, or (b)
--                                terminal in a non-successful state
--                                (superseded/failed/cancelled) but the
--                                provider now confirms real money -- never
--                                silently applied against a balance that
--                                may have already moved for another
--                                reason; evidence is preserved via
--                                audit_logs, never lost.
--   'amount_exceeds_balance' -- provider-confirmed amount is more than the
--                                invoice can currently absorb -- left
--                                pending (nothing committed), logged for
--                                reconciliation rather than finalized.
create or replace function public.finalize_toyyibpay_payment_from_callback(
  p_attempt_id uuid,
  p_billcode text,
  p_verified_amount numeric,
  p_provider_transaction_id text,
  p_provider_transaction_time timestamptz,
  p_callback_received_at timestamptz,
  p_raw_response jsonb
) returns jsonb
language plpgsql security definer set search_path = public, app as $$
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
$$;

revoke all on function public.finalize_toyyibpay_payment_from_callback(uuid, text, numeric, text, timestamptz, timestamptz, jsonb) from public;
revoke all on function public.finalize_toyyibpay_payment_from_callback(uuid, text, numeric, text, timestamptz, timestamptz, jsonb) from anon;
revoke all on function public.finalize_toyyibpay_payment_from_callback(uuid, text, numeric, text, timestamptz, timestamptz, jsonb) from authenticated;

-- ---------------------------------------------------------------------
-- 2. Mark a pending attempt failed via a provider-confirmed callback.
-- Late/duplicate failure callbacks for an already-terminal attempt are
-- genuinely harmless (no real money is implied by "failed") and are
-- simply no-op'd with an audit note, not escalated.
create or replace function public.mark_toyyibpay_attempt_failed_from_callback(
  p_attempt_id uuid,
  p_billcode text,
  p_callback_received_at timestamptz,
  p_reason text
) returns jsonb
language plpgsql security definer set search_path = public, app as $$
declare
  v_attempt record;
  v_invoice_no text;
  v_actor uuid;
  v_actor_email text;
begin
  select actor_id, actor_email into v_actor, v_actor_email from app.toyyibpay_system_actor();

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

  if v_attempt.status <> 'pending' then
    perform public.log_event_as_service(v_actor, v_actor_email, 'update'::audit_action, 'invoice_payments', p_attempt_id::text,
      format('ToyyibPay failure callback ignored for invoice %s (%s) -- attempt already "%s"', coalesce(v_invoice_no, '?'), p_billcode, v_attempt.status),
      jsonb_build_object('invoice_id', v_attempt.invoice_id, 'attempt_id', p_attempt_id, 'billcode', p_billcode, 'local_status', v_attempt.status, 'reason', p_reason));
    return jsonb_build_object('outcome', 'duplicate_ignored', 'attempt_id', p_attempt_id);
  end if;

  update public.invoice_payments
  set status = 'failed',
      callback_received_at = p_callback_received_at,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('failure_reason', p_reason),
      updated_at = now()
  where id = p_attempt_id;

  perform public.log_event_as_service(v_actor, v_actor_email, 'update'::audit_action, 'invoice_payments', p_attempt_id::text,
    format('ToyyibPay payment failed (callback) for invoice %s: %s', coalesce(v_invoice_no, '?'), coalesce(p_reason, 'no reason given')),
    jsonb_build_object('invoice_id', v_attempt.invoice_id, 'attempt_id', p_attempt_id, 'billcode', p_billcode, 'reason', p_reason));

  return jsonb_build_object('outcome', 'marked_failed', 'attempt_id', p_attempt_id);
end;
$$;

revoke all on function public.mark_toyyibpay_attempt_failed_from_callback(uuid, text, timestamptz, text) from public;
revoke all on function public.mark_toyyibpay_attempt_failed_from_callback(uuid, text, timestamptz, text) from anon;
revoke all on function public.mark_toyyibpay_attempt_failed_from_callback(uuid, text, timestamptz, text) from authenticated;

-- ---------------------------------------------------------------------
-- 3. Generic security/audit logger for callback events that never reach a
-- financial mutation at all -- invalid hash, unknown billcode/order_id,
-- or any other reject-before-lookup case. p_attempt_id is nullable
-- (unresolvable callbacks have no attempt to attach to). Never accepts or
-- logs a secret/hash value -- the caller (Route Handler) must never pass
-- one in p_detail.
create or replace function public.log_toyyibpay_callback_event(
  p_attempt_id uuid,
  p_event_type text,
  p_detail jsonb
) returns jsonb
language plpgsql security definer set search_path = public, app as $$
declare
  v_actor uuid;
  v_actor_email text;
begin
  select actor_id, actor_email into v_actor, v_actor_email from app.toyyibpay_system_actor();

  if p_event_type not in ('invalid_hash', 'missing_fields', 'unknown_billcode_or_order_id', 'billcode_mismatch', 'verification_failed', 'no_matching_transaction') then
    raise exception 'invalid_event_type' using errcode = 'P0001';
  end if;

  perform public.log_event_as_service(v_actor, v_actor_email, 'update'::audit_action, 'invoice_payments', coalesce(p_attempt_id::text, 'unresolved'),
    format('ToyyibPay callback security event: %s', p_event_type),
    coalesce(p_detail, '{}'::jsonb) || jsonb_build_object('event_type', p_event_type));

  return jsonb_build_object('logged', true);
end;
$$;

revoke all on function public.log_toyyibpay_callback_event(uuid, text, jsonb) from public;
revoke all on function public.log_toyyibpay_callback_event(uuid, text, jsonb) from anon;
revoke all on function public.log_toyyibpay_callback_event(uuid, text, jsonb) from authenticated;

-- ---------------------------------------------------------------------
-- Deliberately NOT done in this migration:
--
-- * finalize_toyyibpay_payment() and mark_toyyibpay_attempt_failed()
--   (Phase 2A, app.is_admin()-gated) are completely untouched -- no grant
--   change, no logic change. The callback path uses the three new
--   functions above exclusively.
--
-- * No explicit `grant ... to service_role` was added -- confirmed live
--   (has_function_privilege/has_table_privilege against an existing,
--   never-explicitly-granted function/table) that service_role already
--   has implicit execute/insert/update across the public schema in this
--   project by Supabase's own platform convention. Anon/authenticated/
--   public are explicitly revoked above so nothing except the
--   service-role-authenticated callback Route Handler can reach these
--   three functions.
--
-- * public.log_event / app.log_event remain untouched and closed to
--   authenticated -- every log call in this migration goes through the
--   existing log_event_as_service() path, exactly like every other
--   invoice RPC.
