-- Record every provider-verified ToyyibPay payment, never silently (PKG-1d-A, 2 of 4).
--
-- Why (all paths verified against the PKG-1c body of public.finalize_public_registration_payment_from_callback):
--   B1  a verified success on a 'failed' attempt while the registration is still open returned 'terminal_ignored'
--       and wrote nothing at all (no transaction id, no amount, no event): money received, no trace;
--   B3  a verified success on a 'cancelled' attempt (expire_public_registrations) kept only a JSON note, left
--       verified_amount NULL, overwrote the previous raw_response and let a replay overwrite the transaction id;
--   B4  an amount mismatch raised and rolled back, so the provider amount and transaction were never kept;
--   plus a transaction id already stored on another attempt surfaced only as an unhandled unique violation.
--
-- New behaviour (callers unchanged: the callback route still calls this only after hash verification AND a
-- server-to-server getBillTransactions read; every value here comes from that provider read, never from the
-- callback body):
--   * failed/cancelled attempt + verified success (registration open or ended): the attempt becomes 'paid' through
--     the narrow guard transition of 20261122120000 (this function marks the attempt for the current transaction),
--     with verified_amount, verified_at, transaction id and callback time; raw_response is MERGED with a
--     'late_success' evidence object (the previous content is kept); the registration payment_status becomes 'paid'
--     (failed -> processing -> paid, pending/processing -> paid); any other open ToyyibPay attempt of the
--     registration is cancelled so its bill is no longer offered; an audit event with amount and transaction id is
--     written; NO seat is allocated (outcome 'reconciliation_required'; staff allocate through
--     finalize_public_registration_crm, which keeps the PKG-1c capacity guard, or refund manually);
--   * the transaction id is already stored on another attempt, or the attempt already holds a different one: nothing
--     changes, the conflict is kept once per transaction id on the attempt and audited (outcome 'transaction_conflict');
--   * amount differs from the attempt or the registration: NOT paid, transaction id NOT stored (a later correct
--     payment is not blocked), status unchanged; the provider amount is kept once per transaction id under
--     raw_response.amount_mismatch and audited (outcome 'amount_mismatch', no raise);
--   * success on a 'refunded' attempt: unchanged ('terminal_ignored') but recorded once per transaction id and audited;
--   * the 'paid' replay rules, the PKG-1c ended-registration branch for 'processing' attempts and the normal path
--     (paid + finalize_public_registration_crm under the PKG-1c capacity guard) are unchanged.
-- Lock order is unchanged: registration -> payment attempt(s) -> schedule.
--
-- Scope: the body of this one function. Signature, SECURITY DEFINER, search_path, owner and privileges are preserved
-- (asserted below). Requires 20261122110000 (PKG-1c) and 20261122120000. Idempotent. Rollback is a forward migration
-- that re-creates the PKG-1c body (pinned below by md5).

do $$
declare
  v_cb constant regprocedure := to_regprocedure('public.finalize_public_registration_payment_from_callback(uuid,text,numeric,text,timestamptz,jsonb)');
  v_guard constant regprocedure := to_regprocedure('app.public_registration_payment_state_guard()');
  v_md5 text;
  v_src text;
begin
  if v_cb is null or v_guard is null then
    raise exception 'pkg1d_a2_precondition_failed: callback finalization function or payment guard is missing' using errcode = 'P0001';
  end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'finalize_public_registration_payment_from_callback') <> 1 then
    raise exception 'pkg1d_a2_precondition_failed: expected exactly one callback finalization function' using errcode = 'P0001';
  end if;
  if position('pkg1d_late_success_guard' in (select prosrc from pg_proc where oid = v_guard)) = 0 then
    raise exception 'pkg1d_a2_precondition_failed: 20261122120000 (late-success guard) is not applied' using errcode = 'P0001';
  end if;
  -- The PKG-1c body (20261122110000), or already this migration's version (re-run).
  select md5(regexp_replace(pg_get_functiondef(v_cb), '\s+', '', 'g')), prosrc into v_md5, v_src from pg_proc where oid = v_cb;
  if v_md5 <> '6193a289cf03f8fc9cb3fa5b4e4c52b8' and position('pkg1d_late_success_recording' in v_src) = 0 then
    raise exception 'pkg1d_a2_precondition_failed: callback finalization differs from the PKG-1c definition' using errcode = 'P0001';
  end if;
  perform set_config('pkg1d.acl_cb', coalesce((select proacl::text from pg_proc where oid = v_cb), 'null'), false);
end $$;

create or replace function public.finalize_public_registration_payment_from_callback(p_attempt_id uuid, p_bill_code text, p_verified_amount numeric, p_provider_transaction_id text, p_callback_received_at timestamp with time zone, p_raw_response jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'pg_catalog', 'public', 'app'
as $function$
declare
  v_registration public.public_registrations%rowtype;
  v_attempt public.public_registration_payments%rowtype;
  v_txn text;
  v_amount numeric;
  v_other uuid;
  v_cancelled integer := 0;
  v_actor uuid;
  v_actor_email text;
begin
  if auth.role() <> 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if p_attempt_id is null or nullif(btrim(p_bill_code), '') is null
     or nullif(btrim(p_provider_transaction_id), '') is null
     or p_verified_amount is null or p_verified_amount <= 0 then
    raise exception 'invalid_verified_payment' using errcode = 'P0001';
  end if;
  v_txn := btrim(p_provider_transaction_id);
  v_amount := round(p_verified_amount, 2);

  -- Lock registration first, then payment attempt; this is the global order.
  select pr.* into v_registration
  from public.public_registrations pr
  where pr.id = (select registration_id from public.public_registration_payments where id = p_attempt_id)
  for update;
  if v_registration.id is null then
    raise exception 'registration_not_found' using errcode = 'P0001';
  end if;
  select * into v_attempt
  from public.public_registration_payments
  where id = p_attempt_id and payment_provider = 'toyyibpay'
  for update;
  if v_attempt.id is null or v_attempt.registration_id <> v_registration.id then
    raise exception 'payment_attempt_not_found' using errcode = 'P0001';
  end if;

  if v_attempt.provider_bill_code is distinct from btrim(p_bill_code) then
    raise exception 'payment_bill_mismatch' using errcode = 'P0001';
  end if;

  if v_attempt.status = 'paid' then
    if v_attempt.provider_transaction_id = btrim(p_provider_transaction_id)
       and v_attempt.verified_amount = p_verified_amount then
      return jsonb_build_object('outcome', 'duplicate_ignored');
    end if;
    raise exception 'paid_attempt_conflict' using errcode = 'P0001';
  end if;

  -- pkg1d_late_success_recording: an amount that differs is evidence, not a payment. Keep it once per transaction id;
  -- never mark it paid and never store the transaction id (a later correct payment must not be blocked).
  if v_amount <> round(v_attempt.amount, 2)
     or v_amount <> round(v_registration.amount_snapshot, 2) then
    if not coalesce(v_attempt.raw_response -> 'amount_mismatch' ? v_txn, false) then
      update public.public_registration_payments
      set raw_response = coalesce(raw_response, '{}'::jsonb) || jsonb_build_object('amount_mismatch',
            coalesce(raw_response -> 'amount_mismatch', '{}'::jsonb) || jsonb_build_object(v_txn, jsonb_build_object(
              'provider_amount', v_amount,
              'expected_amount', round(v_attempt.amount, 2),
              'registration_amount', round(v_registration.amount_snapshot, 2),
              'attempt_status', v_attempt.status,
              'observed_at', now(),
              'provenance', 'toyyibpay_get_bill_transactions')))
      where id = v_attempt.id;
      select actor_id, actor_email into v_actor, v_actor_email from app.toyyibpay_system_actor();
      perform public.log_event_as_service(v_actor, v_actor_email, 'update'::public.audit_action,
        'public_registration_payments', v_attempt.id::text,
        'Public registration payment amount mismatch: ' || v_registration.registration_reference,
        jsonb_build_object('event', 'amount_mismatch_recorded', 'registration_reference', v_registration.registration_reference,
          'provider_transaction_id', v_txn, 'provider_amount', v_amount, 'expected_amount', round(v_attempt.amount, 2),
          'registration_amount', round(v_registration.amount_snapshot, 2), 'attempt_status', v_attempt.status));
    end if;
    return jsonb_build_object('outcome', 'amount_mismatch', 'registration_reference', v_registration.registration_reference);
  end if;

  -- One transaction id is one money record: refuse to attach it a second time or to replace another one.
  select id into v_other from public.public_registration_payments
  where payment_provider = 'toyyibpay' and provider_transaction_id = v_txn and id <> v_attempt.id
  limit 1;
  if v_other is not null
     or (v_attempt.provider_transaction_id is not null and v_attempt.provider_transaction_id <> v_txn) then
    if not coalesce(v_attempt.raw_response -> 'transaction_conflicts' ? v_txn, false) then
      update public.public_registration_payments
      set raw_response = coalesce(raw_response, '{}'::jsonb) || jsonb_build_object('transaction_conflicts',
            coalesce(raw_response -> 'transaction_conflicts', '{}'::jsonb) || jsonb_build_object(v_txn, jsonb_build_object(
              'verified_amount', v_amount,
              'stored_transaction_id', v_attempt.provider_transaction_id,
              'other_attempt_id', v_other,
              'attempt_status', v_attempt.status,
              'observed_at', now())))
      where id = v_attempt.id;
      select actor_id, actor_email into v_actor, v_actor_email from app.toyyibpay_system_actor();
      perform public.log_event_as_service(v_actor, v_actor_email, 'update'::public.audit_action,
        'public_registration_payments', v_attempt.id::text,
        'Public registration payment transaction conflict: ' || v_registration.registration_reference,
        jsonb_build_object('event', 'transaction_conflict', 'registration_reference', v_registration.registration_reference,
          'provider_transaction_id', v_txn, 'verified_amount', v_amount, 'stored_transaction_id', v_attempt.provider_transaction_id,
          'other_attempt_id', v_other, 'attempt_status', v_attempt.status));
    end if;
    return jsonb_build_object('outcome', 'transaction_conflict', 'registration_reference', v_registration.registration_reference);
  end if;

  if v_attempt.status = 'refunded' then
    if not coalesce(v_attempt.raw_response -> 'success_after_refund' ? v_txn, false) then
      update public.public_registration_payments
      set raw_response = coalesce(raw_response, '{}'::jsonb) || jsonb_build_object('success_after_refund',
            coalesce(raw_response -> 'success_after_refund', '{}'::jsonb) || jsonb_build_object(v_txn, jsonb_build_object(
              'verified_amount', v_amount, 'observed_at', now())))
      where id = v_attempt.id;
      select actor_id, actor_email into v_actor, v_actor_email from app.toyyibpay_system_actor();
      perform public.log_event_as_service(v_actor, v_actor_email, 'update'::public.audit_action,
        'public_registration_payments', v_attempt.id::text,
        'Public registration payment success after refund: ' || v_registration.registration_reference,
        jsonb_build_object('event', 'success_after_refund', 'registration_reference', v_registration.registration_reference,
          'provider_transaction_id', v_txn, 'verified_amount', v_amount));
    end if;
    return jsonb_build_object('outcome', 'terminal_ignored', 'status', v_attempt.status);
  end if;

  if v_attempt.status in ('failed', 'cancelled') then
    -- Provider-verified late success on a terminal attempt: record the money, allocate nothing.
    perform set_config('app.pkg1d_late_success_attempt', v_attempt.id::text, true);
    update public.public_registration_payments
    set status = 'paid',
        verified_amount = v_amount,
        provider_transaction_id = v_txn,
        verified_at = now(),
        callback_received_at = p_callback_received_at,
        raw_response = coalesce(raw_response, '{}'::jsonb) || jsonb_build_object(
          'late_success_reconciliation_required', true,
          'late_success', jsonb_build_object(
            'original_status', v_attempt.status,
            'registration_status', v_registration.registration_status,
            'provider_transaction_id', v_txn,
            'verified_amount', v_amount,
            'recorded_at', now(),
            'provenance', 'toyyibpay_get_bill_transactions',
            'provider_response', coalesce(p_raw_response, '{}'::jsonb)))
    where id = v_attempt.id;
    perform set_config('app.pkg1d_late_success_attempt', '', true);

    if v_registration.payment_status = 'failed' then
      update public.public_registrations set payment_status = 'processing' where id = v_registration.id;
    end if;
    if v_registration.payment_status in ('pending', 'processing', 'failed') then
      update public.public_registrations set payment_status = 'paid' where id = v_registration.id;
    end if;

    -- No other bill of this registration may still be offered for payment.
    with c as (
      update public.public_registration_payments
      set status = 'cancelled',
          raw_response = coalesce(raw_response, '{}'::jsonb) || jsonb_build_object('cancelled_by_late_success',
            jsonb_build_object('paid_attempt_id', v_attempt.id, 'at', now()))
      where registration_id = v_registration.id and id <> v_attempt.id
        and payment_provider = 'toyyibpay' and status in ('pending', 'processing')
      returning 1
    )
    select count(*) into v_cancelled from c;

    select actor_id, actor_email into v_actor, v_actor_email from app.toyyibpay_system_actor();
    perform public.log_event_as_service(v_actor, v_actor_email, 'update'::public.audit_action,
      'public_registration_payments', v_attempt.id::text,
      'Public registration late payment recorded: ' || v_registration.registration_reference,
      jsonb_build_object('event', 'late_success_recorded', 'registration_reference', v_registration.registration_reference,
        'provider_transaction_id', v_txn, 'verified_amount', v_amount, 'original_attempt_status', v_attempt.status,
        'registration_status', v_registration.registration_status, 'registration_payment_status', v_registration.payment_status,
        'cancelled_open_attempts', v_cancelled, 'seat_allocated', false, 'provenance', 'toyyibpay_get_bill_transactions'));
    return jsonb_build_object('outcome', 'reconciliation_required', 'registration_reference', v_registration.registration_reference,
      'late_success', true);
  end if;

  if v_registration.registration_status in ('cancelled', 'expired') then
    if v_attempt.status in ('paid', 'refunded') then
      return jsonb_build_object('outcome', 'terminal_ignored', 'status', v_attempt.status);
    end if;
    if v_attempt.status = 'processing' then
      -- pkg1c_late_success_paid: the provider verified this payment, so record it as paid. No seat is allocated and
      -- the ended registration status is kept; staff refund or transfer it from the "Paid, not confirmed" queue.
      update public.public_registration_payments
      set status = 'paid',
          verified_amount = round(p_verified_amount, 2),
          provider_transaction_id = btrim(p_provider_transaction_id),
          verified_at = now(),
          callback_received_at = p_callback_received_at,
          raw_response = jsonb_build_object(
            'late_success_reconciliation_required', true,
            'verified_amount', round(p_verified_amount, 2),
            'provider_response', coalesce(p_raw_response, '{}'::jsonb)
          )
      where id = v_attempt.id;
      if v_registration.payment_status in ('pending', 'processing') then
        update public.public_registrations
        set payment_status = 'paid'
        where id = v_registration.id;
      end if;
    else
      update public.public_registration_payments
      set provider_transaction_id = btrim(p_provider_transaction_id),
          callback_received_at = p_callback_received_at,
          raw_response = jsonb_build_object(
            'late_success_reconciliation_required', true,
            'verified_amount', round(p_verified_amount, 2),
            'provider_response', coalesce(p_raw_response, '{}'::jsonb)
          )
      where id = v_attempt.id;
    end if;
    perform public.log_public_registration_payment_event(
      v_attempt.id, 'late_success_after_expiry',
      jsonb_build_object('registration_reference', v_registration.registration_reference,
        'attempt_recorded_paid', v_attempt.status = 'processing')
    );
    return jsonb_build_object('outcome', 'reconciliation_required', 'registration_reference', v_registration.registration_reference);
  end if;
  if v_attempt.status not in ('pending', 'processing') then
    return jsonb_build_object('outcome', 'terminal_ignored', 'status', v_attempt.status);
  end if;

  update public.public_registration_payments
  set status = 'paid',
      verified_amount = round(p_verified_amount, 2),
      provider_transaction_id = btrim(p_provider_transaction_id),
      verified_at = now(),
      callback_received_at = p_callback_received_at,
      raw_response = coalesce(p_raw_response, '{}'::jsonb)
  where id = v_attempt.id;

  update public.public_registrations
  set payment_status = 'paid'
  where id = v_registration.id;

  return public.finalize_public_registration_crm(v_registration.id);
end;
$function$;

do $$
declare
  v_cb constant regprocedure := 'public.finalize_public_registration_payment_from_callback(uuid,text,numeric,text,timestamptz,jsonb)'::regprocedure;
begin
  if coalesce((select proacl::text from pg_proc where oid = v_cb), 'null') <> current_setting('pkg1d.acl_cb') then
    raise exception 'pkg1d_a2_postcondition_failed: privileges of the callback finalization function changed' using errcode = 'P0001';
  end if;
  if not (select prosecdef from pg_proc where oid = v_cb) then
    raise exception 'pkg1d_a2_postcondition_failed: callback finalization is no longer SECURITY DEFINER' using errcode = 'P0001';
  end if;
  if (select proconfig from pg_proc where oid = v_cb) is distinct from array['search_path=pg_catalog, public, app'] then
    raise exception 'pkg1d_a2_postcondition_failed: search_path of the callback finalization function changed' using errcode = 'P0001';
  end if;
  if position('pkg1d_late_success_recording' in (select prosrc from pg_proc where oid = v_cb)) = 0 then
    raise exception 'pkg1d_a2_postcondition_failed: new callback finalization body is not in place' using errcode = 'P0001';
  end if;
end $$;
