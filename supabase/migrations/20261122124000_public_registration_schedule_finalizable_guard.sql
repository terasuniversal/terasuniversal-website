-- R1 (A5): a provider-verified or staff-verified payment is no longer rolled back when its course schedule is
-- cancelled, completed or missing at finalization time.
--
-- Why: both payment paths record the payment as paid and then end with finalize_public_registration_crm(), which raises
-- 'schedule_not_finalizable' (generic SQLSTATE P0001) for a cancelled/completed/missing schedule. That raise rolled back
-- the whole call, including the paid attempt, its transaction id and amount; the ToyyibPay callback route still answers
-- 200, so the provider does not retry and the received money was recorded nowhere.
--
-- What (R1-G0 Option B): in both functions, immediately before finalize_public_registration_crm(), lock the schedule
-- row and, if it is missing, cancelled or completed, keep the payment, set the registration hold to null, append
-- raw_response.schedule_not_finalizable, write exactly one 'schedule_not_finalizable_recorded' audit event and return
-- {outcome: 'reconciliation_required', reason: 'schedule_not_finalizable'}. No seat, participant or enrolment is
-- created; nothing is refunded; the schedule and registration_status are not changed. No exception handler and no
-- error-message matching: every other error still propagates. finalize_public_registration_crm is NOT modified.
--
-- Scope: the bodies of exactly these two functions. Signatures, SECURITY DEFINER, search_path, owner and privileges
-- are preserved (asserted below). Requires PKG-1c (20261122110000) and PKG-1d-A (20261122120000-123000). Idempotent.
-- Rollback is a forward migration that re-creates the previous bodies (pinned below by md5).

do $$
declare
  v_cb constant regprocedure := to_regprocedure('public.finalize_public_registration_payment_from_callback(uuid,text,numeric,text,timestamptz,jsonb)');
  v_vf constant regprocedure := to_regprocedure('public.verify_public_registration_manual_payment(text,text,numeric,text,text,uuid)');
  v_crm constant regprocedure := to_regprocedure('public.finalize_public_registration_crm(uuid)');
  v_md5 text;
  v_src text;
begin
  if v_cb is null or v_vf is null or v_crm is null then
    raise exception 'r1_a5_precondition_failed: a payment or finalization function is missing' using errcode = 'P0001';
  end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
      and p.proname in ('finalize_public_registration_payment_from_callback', 'verify_public_registration_manual_payment')) <> 2 then
    raise exception 'r1_a5_precondition_failed: expected exactly one overload of each payment function' using errcode = 'P0001';
  end if;
  -- PKG-1d-A bodies (live on Staging, 22 Nov 2026), or already this migration's version (re-run).
  select md5(regexp_replace(pg_get_functiondef(v_cb), '\s+', '', 'g')), prosrc into v_md5, v_src from pg_proc where oid = v_cb;
  if v_md5 <> '9e6a173e5e58c216dced5d32b2bd503a' and position('r1_schedule_guard' in v_src) = 0 then
    raise exception 'r1_a5_precondition_failed: callback finalization differs from the PKG-1d-A definition' using errcode = 'P0001';
  end if;
  select md5(regexp_replace(pg_get_functiondef(v_vf), '\s+', '', 'g')), prosrc into v_md5, v_src from pg_proc where oid = v_vf;
  if v_md5 <> '0cdbb4fe6fbf9e81f0dded545ca7c30e' and position('r1_schedule_guard' in v_src) = 0 then
    raise exception 'r1_a5_precondition_failed: manual payment verification differs from the PKG-1d-A definition' using errcode = 'P0001';
  end if;
  -- The PKG-1c capacity-safe CRM finalization this guard sits in front of; it is not modified here.
  if md5(regexp_replace(pg_get_functiondef(v_crm), '\s+', '', 'g')) <> 'fe568112a7c9a2ae8ad765557dc5f8c6' then
    raise exception 'r1_a5_precondition_failed: finalize_public_registration_crm differs from the PKG-1c definition' using errcode = 'P0001';
  end if;
  perform set_config('r1.acl_cb', coalesce((select proacl::text from pg_proc where oid = v_cb), 'null'), false);
  perform set_config('r1.acl_vf', coalesce((select proacl::text from pg_proc where oid = v_vf), 'null'), false);
  perform set_config('r1.owner_cb', (select proowner::regrole::text from pg_proc where oid = v_cb), false);
  perform set_config('r1.owner_vf', (select proowner::regrole::text from pg_proc where oid = v_vf), false);
end $$;

CREATE OR REPLACE FUNCTION public.finalize_public_registration_payment_from_callback(p_attempt_id uuid, p_bill_code text, p_verified_amount numeric, p_provider_transaction_id text, p_callback_received_at timestamp with time zone, p_raw_response jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app'
AS $function$
declare
  v_schedule_status text;
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

  -- r1_schedule_guard: a verified payment must never be rolled back because the schedule can no longer take
  -- enrolments. Lock the schedule row (global order: registration -> payment -> schedule; finalize_public_registration_crm
  -- re-locks the same row in this transaction, so the status cannot change in between). If the schedule is missing,
  -- cancelled or completed: keep the recorded payment, release the hold, allocate nothing and leave it to staff.
  -- There is no exception handler here: every other error still propagates and rolls the whole call back.
  select cs.status::text into v_schedule_status
  from public.course_schedules cs
  where cs.id = v_registration.schedule_id
  for update;
  if not found or v_schedule_status in ('cancelled', 'completed') then
    update public.public_registrations set hold_expires_at = null where id = v_registration.id;
    update public.public_registration_payments
    set raw_response = coalesce(raw_response, '{}'::jsonb) || jsonb_build_object('schedule_not_finalizable',
          jsonb_build_object('schedule_status', coalesce(v_schedule_status, 'missing'), 'observed_at', now()))
    where id = v_attempt.id;
    select actor_id, actor_email into v_actor, v_actor_email from app.toyyibpay_system_actor();
    perform public.log_event_as_service(v_actor, v_actor_email, 'update'::public.audit_action,
      'public_registration_payments', v_attempt.id::text,
      'Public registration paid but schedule not finalizable: ' || v_registration.registration_reference,
      jsonb_build_object('event', 'schedule_not_finalizable_recorded', 'registration_reference', v_registration.registration_reference,
        'schedule_id', v_registration.schedule_id, 'schedule_status', coalesce(v_schedule_status, 'missing'),
        'provider_transaction_id', v_txn, 'verified_amount', v_amount, 'payment_provider', 'toyyibpay', 'seat_allocated', false));
    return jsonb_build_object('outcome', 'reconciliation_required', 'reason', 'schedule_not_finalizable',
      'registration_reference', v_registration.registration_reference);
  end if;
  return public.finalize_public_registration_crm(v_registration.id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.verify_public_registration_manual_payment(p_registration_reference text, p_registration_secret text, p_amount numeric, p_payment_reference text, p_notes text DEFAULT NULL::text, p_verifier_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app', 'extensions'
AS $function$
declare
  v_schedule_status text;
  v_actor uuid;
  v_actor_email text;
  v_registration public.public_registrations%rowtype;
  v_payment public.public_registration_payments%rowtype;
  v_token_hash text;
  v_verifier_id uuid;
  v_verifier_email text;
  v_ended boolean;
  v_payment_status text;
begin
  if auth.role() <> 'service_role' and not app.is_admin() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  v_verifier_id := coalesce(p_verifier_id, auth.uid());
  if auth.role() = 'authenticated' and p_verifier_id is not null and p_verifier_id <> auth.uid() then
    raise exception 'invalid_manual_verifier' using errcode = '42501';
  end if;
  if v_verifier_id is null or not exists (
    select 1 from public.profiles
    where id = v_verifier_id and is_active = true and role in ('admin', 'super_admin')
  ) then
    raise exception 'invalid_manual_verifier' using errcode = '42501';
  end if;
  select email into v_verifier_email from public.profiles where id = v_verifier_id;
  if p_amount is null or p_amount <= 0 or nullif(btrim(p_payment_reference), '') is null then
    raise exception 'invalid_manual_payment' using errcode = 'P0001';
  end if;

  v_token_hash := encode(digest(lower(btrim(p_registration_secret)), 'sha256'), 'hex');
  select * into v_registration
  from public.public_registrations
  where registration_reference = btrim(p_registration_reference)
    and confirmation_token_hash = v_token_hash
  for update;
  if v_registration.id is null then
    raise exception 'registration_not_found' using errcode = 'P0001';
  end if;
  if round(p_amount, 2) <> round(v_registration.amount_snapshot, 2) then
    raise exception 'manual_payment_amount_mismatch' using errcode = 'P0001';
  end if;
  -- pkg1d_manual_payment_states: an ended registration is still recorded (no seat), instead of refusing the money.
  v_ended := v_registration.registration_status in ('cancelled', 'expired');

  select * into v_payment
  from public.public_registration_payments
  where registration_id = v_registration.id
    and payment_provider = 'bank_transfer'
    and status in ('pending', 'processing', 'paid')
  order by created_at desc
  limit 1
  for update;

  if v_payment.id is null then
    insert into public.public_registration_payments (
      registration_id, payment_provider, status, amount, currency,
      provider_reference
    ) values (
      v_registration.id, 'bank_transfer', 'pending', v_registration.amount_snapshot, v_registration.currency,
      btrim(p_payment_reference)
    ) returning * into v_payment;
  elsif v_payment.status = 'paid' then
    return jsonb_build_object('outcome', 'already_paid', 'registration_reference', v_registration.registration_reference);
  end if;

  -- Move through the bounded payment state machine even for staff-verified
  -- transfers; never create a payment attempt directly in `paid` state.
  update public.public_registration_payments
  set status = 'processing', provider_reference = btrim(p_payment_reference)
  where id = v_payment.id and status = 'pending';
  update public.public_registration_payments
  set status = 'paid', provider_reference = btrim(p_payment_reference),
      verified_amount = v_registration.amount_snapshot, verified_at = now(),
      raw_response = jsonb_build_object('notes', left(coalesce(p_notes, ''), 500), 'verified_by', v_verifier_id, 'verified_by_email', v_verifier_email)
  where id = v_payment.id and status = 'processing';

  -- Registration payment status, only through transitions the registration state guard allows.
  if v_registration.payment_status in ('pending', 'failed') then
    update public.public_registrations set payment_status = 'processing' where id = v_registration.id;
  end if;
  if v_registration.payment_status in ('pending', 'processing', 'failed') then
    update public.public_registrations set payment_status = 'paid' where id = v_registration.id;
  end if;
  select payment_status into v_payment_status from public.public_registrations where id = v_registration.id;

  perform public.log_event_as_service(v_verifier_id, v_verifier_email, 'update'::public.audit_action,
    'public_registration_payments', v_payment.id::text,
    'Public registration manual payment recorded: ' || v_registration.registration_reference,
    jsonb_build_object('event', 'manual_payment_recorded', 'registration_reference', v_registration.registration_reference,
      'payment_reference', btrim(p_payment_reference), 'verified_amount', round(v_registration.amount_snapshot, 2),
      'registration_status', v_registration.registration_status, 'registration_payment_status', v_payment_status,
      'seat_allocation', case when v_ended or v_payment_status <> 'paid' then 'not_attempted' else 'finalize' end));

  if v_ended or v_payment_status <> 'paid' then
    return jsonb_build_object('outcome', 'reconciliation_required', 'registration_reference', v_registration.registration_reference);
  end if;
  -- r1_schedule_guard: a verified payment must never be rolled back because the schedule can no longer take
  -- enrolments. Lock the schedule row (global order: registration -> payment -> schedule; finalize_public_registration_crm
  -- re-locks the same row in this transaction, so the status cannot change in between). If the schedule is missing,
  -- cancelled or completed: keep the recorded payment, release the hold, allocate nothing and leave it to staff.
  -- There is no exception handler here: every other error still propagates and rolls the whole call back.
  select cs.status::text into v_schedule_status
  from public.course_schedules cs
  where cs.id = v_registration.schedule_id
  for update;
  if not found or v_schedule_status in ('cancelled', 'completed') then
    update public.public_registrations set hold_expires_at = null where id = v_registration.id;
    update public.public_registration_payments
    set raw_response = coalesce(raw_response, '{}'::jsonb) || jsonb_build_object('schedule_not_finalizable',
          jsonb_build_object('schedule_status', coalesce(v_schedule_status, 'missing'), 'observed_at', now()))
    where id = v_payment.id;
    v_actor := v_verifier_id;
    v_actor_email := v_verifier_email;
    perform public.log_event_as_service(v_actor, v_actor_email, 'update'::public.audit_action,
      'public_registration_payments', v_payment.id::text,
      'Public registration paid but schedule not finalizable: ' || v_registration.registration_reference,
      jsonb_build_object('event', 'schedule_not_finalizable_recorded', 'registration_reference', v_registration.registration_reference,
        'schedule_id', v_registration.schedule_id, 'schedule_status', coalesce(v_schedule_status, 'missing'),
        'payment_reference', btrim(p_payment_reference), 'verified_amount', round(v_registration.amount_snapshot, 2), 'payment_provider', 'bank_transfer', 'seat_allocated', false));
    return jsonb_build_object('outcome', 'reconciliation_required', 'reason', 'schedule_not_finalizable',
      'registration_reference', v_registration.registration_reference);
  end if;
  return public.finalize_public_registration_crm(v_registration.id);
end;
$function$;

do $$
declare
  v_cb constant regprocedure := 'public.finalize_public_registration_payment_from_callback(uuid,text,numeric,text,timestamptz,jsonb)'::regprocedure;
  v_vf constant regprocedure := 'public.verify_public_registration_manual_payment(text,text,numeric,text,text,uuid)'::regprocedure;
  v_crm constant regprocedure := 'public.finalize_public_registration_crm(uuid)'::regprocedure;
begin
  if coalesce((select proacl::text from pg_proc where oid = v_cb), 'null') <> current_setting('r1.acl_cb')
     or coalesce((select proacl::text from pg_proc where oid = v_vf), 'null') <> current_setting('r1.acl_vf') then
    raise exception 'r1_a5_postcondition_failed: privileges of a payment function changed' using errcode = 'P0001';
  end if;
  if (select proowner::regrole::text from pg_proc where oid = v_cb) <> current_setting('r1.owner_cb')
     or (select proowner::regrole::text from pg_proc where oid = v_vf) <> current_setting('r1.owner_vf') then
    raise exception 'r1_a5_postcondition_failed: owner of a payment function changed' using errcode = 'P0001';
  end if;
  if not (select prosecdef from pg_proc where oid = v_cb) or not (select prosecdef from pg_proc where oid = v_vf) then
    raise exception 'r1_a5_postcondition_failed: a payment function is no longer SECURITY DEFINER' using errcode = 'P0001';
  end if;
  if (select proconfig from pg_proc where oid = v_cb) is distinct from array['search_path=pg_catalog, public, app']
     or (select proconfig from pg_proc where oid = v_vf) is distinct from array['search_path=pg_catalog, public, app, extensions'] then
    raise exception 'r1_a5_postcondition_failed: search_path of a payment function changed' using errcode = 'P0001';
  end if;
  if position('r1_schedule_guard' in (select prosrc from pg_proc where oid = v_cb)) = 0
     or position('r1_schedule_guard' in (select prosrc from pg_proc where oid = v_vf)) = 0 then
    raise exception 'r1_a5_postcondition_failed: new payment function bodies are not in place' using errcode = 'P0001';
  end if;
  if md5(regexp_replace(pg_get_functiondef(v_crm), '\s+', '', 'g')) <> 'fe568112a7c9a2ae8ad765557dc5f8c6' then
    raise exception 'r1_a5_postcondition_failed: finalize_public_registration_crm changed' using errcode = 'P0001';
  end if;
end $$;
