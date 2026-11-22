-- M3 (PKG-1d-B-DB-G1, D1): staff-authorized verification of a bank transfer to a registered TERAS receiving account.
--
-- Why: the legacy RPC identifies a registration by the PAYER's secret, which staff never hold, so staff could not record
-- a bank transfer from the admin screen. This new RPC identifies the registration by id and the verifier by auth.uid().
--
-- Contract (G0.2 + C1 correction; owner decisions D1-D6, K1-K4):
--   * Active Admin / Super Admin only (auth.uid() + app.is_admin()); EXECUTE for authenticated only.
--   * Active receiving account (M1a); exact amount = amount_snapshot; reference 3-64 [A-Za-z0-9 /_.-]; notes with at
--     least five letters or digits (K2).
--   * Registration row locked first; idempotency through the unique staff_request_id (M2): same facts -> already_recorded,
--     different facts -> request_id_conflict.
--   * Already-paid registration -> 'additional_funds_review' with NO write (no second payment, confirmation or seat);
--     extra money goes through the additional-funds ledger (AF1a/AF1b).
--   * Otherwise one bank record pending -> processing -> paid; open ToyyibPay attempts internally superseded
--     (provider_cancellation_confirmed = false); one 'manual_payment_recorded' event; ended registrations ->
--     reconciliation_required; the R1 A5 r1_schedule_guard block (byte-identical); then the PKG-1c capacity-safe CRM
--     finalization. A shared reference is flagged as a possible duplicate, never rejected (M1b on hold).
--   * No exception handler; every error rolls the whole call back. No refund. No change to any other function.
-- Requires M0 (pinned by md5: staff verification can never exist without the R2 correction), M1a, M2, AF1a, AF1b.

do $$
declare
  v_existing regprocedure := to_regprocedure('public.verify_public_registration_bank_transfer_by_staff(uuid,uuid,numeric,text,uuid,text)');
begin
  if md5(regexp_replace(pg_get_functiondef('public.verify_public_registration_manual_payment(text,text,numeric,text,text,uuid)'::regprocedure), '\s+', '', 'g')) <> '89f34994a0e83a9b12e87e07a456b1cb' then
    raise exception 'm3_precondition_failed: the legacy manual payment RPC is not the M0 (R2-corrected) definition' using errcode = 'P0001';
  end if;
  if md5(regexp_replace(pg_get_functiondef('public.finalize_public_registration_payment_from_callback(uuid,text,numeric,text,timestamptz,jsonb)'::regprocedure), '\s+', '', 'g')) <> '4bfacda586181a3aacd7c8e02b4c7362'
     or md5(regexp_replace(pg_get_functiondef('public.finalize_public_registration_crm(uuid)'::regprocedure), '\s+', '', 'g')) <> 'fe568112a7c9a2ae8ad765557dc5f8c6' then
    raise exception 'm3_precondition_failed: callback or CRM finalization differs from the reviewed definition' using errcode = 'P0001';
  end if;
  if md5(regexp_replace(pg_get_functiondef('app.public_registration_payment_state_guard()'::regprocedure), '\s+', '', 'g')) <> 'b2a2c84993b50291b443bff288d8217d'
     or md5(regexp_replace(pg_get_functiondef('app.public_registration_state_guard()'::regprocedure), '\s+', '', 'g')) <> 'b3df8771aaa6958733bb00ed8426d512'
     or md5(regexp_replace(pg_get_functiondef('app.is_admin()'::regprocedure), '\s+', '', 'g')) <> '8f41288452b95115c01f55d50e2dae10' then
    raise exception 'm3_precondition_failed: a state guard or app.is_admin differs from the reviewed definition' using errcode = 'P0001';
  end if;
  if to_regclass('public.payment_receiving_accounts') is null or to_regclass('public.public_registration_additional_funds') is null
     or to_regprocedure('public.record_public_registration_additional_funds_claim(uuid,uuid,numeric,date,text,uuid,text)') is null
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'public_registration_payments' and column_name = 'receiving_account_id')
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'public_registration_payments' and column_name = 'staff_request_id')
     or not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'public_registration_payments_staff_request_key') then
    raise exception 'm3_precondition_failed: M1a, M2, AF1a or AF1b is not in place' using errcode = 'P0001';
  end if;
  if v_existing is not null and position('staff_bank_transfer' in (select prosrc from pg_proc where oid = v_existing)) = 0 then
    raise exception 'm3_precondition_failed: an unrelated function with this signature exists' using errcode = 'P0001';
  end if;
end $$;

CREATE OR REPLACE FUNCTION public.verify_public_registration_bank_transfer_by_staff(p_registration_id uuid, p_receiving_bank_account_id uuid, p_amount numeric, p_payment_reference text, p_request_id uuid, p_notes text)
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
  v_existing public.public_registration_payments%rowtype;
  v_account public.payment_receiving_accounts%rowtype;
  v_verifier_id uuid := auth.uid();
  v_verifier_email text;
  v_ended boolean;
  v_payment_status text;
  v_ref text;
  v_ref_key text;
  v_notes text;
  v_paid uuid[];
  v_dups uuid[];
  v_superseded uuid[];
  v_superseded_id uuid;
begin
  -- staff_bank_transfer: an active Admin / Super Admin records a bank transfer they verified on the statement of a
  -- registered TERAS receiving account. The verifier is always auth.uid(); no identity is taken from the caller.
  if v_verifier_id is null or not app.is_admin() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  v_ref := regexp_replace(btrim(coalesce(p_payment_reference, '')), '\s+', ' ', 'g');
  v_notes := btrim(coalesce(p_notes, ''));
  if p_registration_id is null or p_receiving_bank_account_id is null or p_request_id is null
     or p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2)
     or v_ref !~ '^[A-Za-z0-9][A-Za-z0-9 /_.-]{2,63}$' then
    raise exception 'invalid_manual_payment' using errcode = 'P0001';
  end if;
  if length(v_notes) > 500 or length(regexp_replace(v_notes, '[^[:alnum:]]', '', 'g')) < 5 then
    raise exception 'invalid_manual_payment_notes' using errcode = 'P0001';
  end if;
  v_ref_key := upper(regexp_replace(v_ref, '\s+', '', 'g'));
  select * into v_account from public.payment_receiving_accounts
  where id = p_receiving_bank_account_id and is_active and deleted_at is null;
  if v_account.id is null then
    raise exception 'invalid_receiving_account' using errcode = 'P0001';
  end if;
  select email into v_verifier_email from public.profiles where id = v_verifier_id;

  -- Lock order (as every payment writer): registration -> payment records -> schedule (r1_schedule_guard) -> CRM.
  select * into v_registration from public.public_registrations where id = p_registration_id for update;
  if v_registration.id is null then
    raise exception 'registration_not_found' using errcode = 'P0001';
  end if;

  -- Idempotency (M2): one money record per staff request id; a replay with the same money facts returns it unchanged.
  select * into v_existing from public.public_registration_payments where staff_request_id = p_request_id for update;
  if v_existing.id is not null then
    if v_existing.registration_id = p_registration_id
       and v_existing.receiving_account_id = p_receiving_bank_account_id
       and round(v_existing.amount, 2) = round(p_amount, 2)
       and upper(regexp_replace(coalesce(v_existing.provider_reference, ''), '\s+', '', 'g')) = v_ref_key then
      return jsonb_build_object('outcome', 'already_recorded', 'payment_id', v_existing.id, 'payment_status', v_existing.status,
        'registration_reference', v_registration.registration_reference);
    end if;
    raise exception 'request_id_conflict' using errcode = 'P0001';
  end if;

  if round(p_amount, 2) <> round(v_registration.amount_snapshot, 2) then
    raise exception 'manual_payment_amount_mismatch' using errcode = 'P0001';
  end if;

  -- staff_additional_funds_review: a registration that is already paid never receives a second registration payment
  -- (no second confirmation, no second seat). Nothing is written and nothing is claimed as recorded: genuine extra money
  -- is recorded through the separate additional-funds ledger (record_public_registration_additional_funds_claim).
  perform 1 from public.public_registration_payments where registration_id = v_registration.id for update;
  select coalesce(array_agg(id order by created_at, id), '{}'::uuid[]) into v_paid
  from public.public_registration_payments where registration_id = v_registration.id and status in ('paid', 'refunded');
  if v_registration.payment_status = 'paid' or cardinality(v_paid) > 0 then
    return jsonb_build_object('outcome', 'additional_funds_review', 'reason', 'registration_already_paid',
      'next_action', 'record_additional_funds_claim', 'recorded', false, 'existing_paid_payment_ids', to_jsonb(v_paid),
      'registration_reference', v_registration.registration_reference);
  end if;
  if v_registration.payment_status = 'refunded' then
    raise exception 'registration_not_payable' using errcode = 'P0001';
  end if;
  v_ended := v_registration.registration_status in ('cancelled', 'expired');

  -- Possible duplicate reference (same receiving account): flagged, never rejected (M1b on hold).
  select coalesce(array_agg(x.id order by x.id), '{}'::uuid[]) into v_dups from (
    select p.id from public.public_registration_payments p
    where p.payment_provider = 'bank_transfer' and p.receiving_account_id = v_account.id and p.status in ('paid', 'refunded')
      and upper(regexp_replace(coalesce(p.provider_reference, ''), '\s+', '', 'g')) = v_ref_key
    union all
    select af.id from public.public_registration_additional_funds af
    where af.receiving_account_id = v_account.id and af.status <> 'rejected'
      and upper(regexp_replace(af.payment_reference, '\s+', '', 'g')) = v_ref_key
  ) x;

  -- The bounded payment state machine: never inserted directly as 'paid'.
  insert into public.public_registration_payments (
    registration_id, payment_provider, status, amount, currency, provider_reference, receiving_account_id, staff_request_id
  ) values (
    v_registration.id, 'bank_transfer', 'pending', v_registration.amount_snapshot, v_registration.currency, v_ref,
    v_account.id, p_request_id
  ) returning * into v_payment;
  update public.public_registration_payments set status = 'processing' where id = v_payment.id;
  update public.public_registration_payments
  set status = 'paid', verified_amount = v_registration.amount_snapshot, verified_at = now(),
      raw_response = jsonb_build_object('channel', 'staff', 'notes', v_notes, 'verified_by', v_verifier_id,
        'verified_by_email', v_verifier_email, 'request_id', p_request_id, 'receiving_account_code', v_account.code,
        'reference_scheme', v_account.reference_scheme,
        'possible_duplicate_reference', case when cardinality(v_dups) > 0 then to_jsonb(v_dups) else null end)
  where id = v_payment.id
  returning * into v_payment;

  -- staff_supersede_open_toyyibpay: the bank transfer is now the payment path. Still-open ToyyibPay attempts are marked
  -- internally superseded ('cancelled'), so a later genuine provider success takes the late-success path (recorded,
  -- flagged, no seat). This is NOT a provider-side cancellation (provider_cancellation_confirmed = false).
  select coalesce(array_agg(id order by created_at, id), '{}'::uuid[]) into v_superseded
  from public.public_registration_payments
  where registration_id = v_registration.id and payment_provider = 'toyyibpay' and status in ('pending', 'processing');
  if cardinality(v_superseded) > 0 then
    update public.public_registration_payments
    set status = 'cancelled',
        raw_response = coalesce(raw_response, '{}'::jsonb) || jsonb_build_object('superseded_by_bank_transfer',
          jsonb_build_object('bank_payment_id', v_payment.id, 'at', now(), 'by', v_verifier_id,
            'provider_cancellation_confirmed', false))
    where id = any(v_superseded);
    foreach v_superseded_id in array v_superseded loop
      perform public.log_event_as_service(v_verifier_id, v_verifier_email, 'update'::public.audit_action,
        'public_registration_payments', v_superseded_id::text,
        'Public registration ToyyibPay attempt superseded by bank transfer: ' || v_registration.registration_reference,
        jsonb_build_object('event', 'toyyibpay_attempt_superseded', 'registration_reference', v_registration.registration_reference,
          'bank_payment_id', v_payment.id, 'provider_cancellation_confirmed', false));
    end loop;
  end if;

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
    'Public registration bank transfer verified by staff: ' || v_registration.registration_reference,
    jsonb_build_object('event', 'manual_payment_recorded', 'channel', 'staff', 'registration_reference', v_registration.registration_reference,
      'payment_reference', v_ref, 'verified_amount', round(v_registration.amount_snapshot, 2), 'request_id', p_request_id,
      'receiving_account_code', v_account.code, 'registration_status', v_registration.registration_status,
      'registration_payment_status', v_payment_status, 'superseded_attempts', cardinality(v_superseded),
      'possible_duplicate_reference', cardinality(v_dups) > 0,
      'seat_allocation', case when v_ended or v_payment_status <> 'paid' then 'not_attempted' else 'finalize' end));

  if v_ended then
    return jsonb_build_object('outcome', 'reconciliation_required', 'reason', 'registration_ended', 'payment_id', v_payment.id,
      'registration_reference', v_registration.registration_reference);
  end if;
  if v_payment_status <> 'paid' then
    return jsonb_build_object('outcome', 'reconciliation_required', 'reason', 'registration_payment_status', 'payment_id', v_payment.id,
      'registration_reference', v_registration.registration_reference);
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

alter function public.verify_public_registration_bank_transfer_by_staff(uuid, uuid, numeric, text, uuid, text) owner to postgres;
revoke all on function public.verify_public_registration_bank_transfer_by_staff(uuid, uuid, numeric, text, uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.verify_public_registration_bank_transfer_by_staff(uuid, uuid, numeric, text, uuid, text) to authenticated;

do $$
declare
  v_fn constant regprocedure := 'public.verify_public_registration_bank_transfer_by_staff(uuid,uuid,numeric,text,uuid,text)'::regprocedure;
  v_src text;
begin
  select prosrc into v_src from pg_proc where oid = v_fn;
  if (select proacl::text from pg_proc where oid = v_fn) <> '{postgres=X/postgres,authenticated=X/postgres}' then
    raise exception 'm3_postcondition_failed: privileges of the staff RPC are not as specified' using errcode = 'P0001';
  end if;
  if (select proowner::regrole::text from pg_proc where oid = v_fn) <> 'postgres' or not (select prosecdef from pg_proc where oid = v_fn)
     or (select proconfig from pg_proc where oid = v_fn) is distinct from array['search_path=pg_catalog, public, app, extensions'] then
    raise exception 'm3_postcondition_failed: owner, SECURITY DEFINER or search_path of the staff RPC is not as specified' using errcode = 'P0001';
  end if;
  if position('staff_bank_transfer' in v_src) = 0 or position('r1_schedule_guard' in v_src) = 0
     or position('staff_additional_funds_review' in v_src) = 0 or position('staff_supersede_open_toyyibpay' in v_src) = 0 then
    raise exception 'm3_postcondition_failed: staff RPC body is not in place' using errcode = 'P0001';
  end if;
  if md5(regexp_replace(pg_get_functiondef('public.verify_public_registration_manual_payment(text,text,numeric,text,text,uuid)'::regprocedure), '\s+', '', 'g')) <> '89f34994a0e83a9b12e87e07a456b1cb'
     or md5(regexp_replace(pg_get_functiondef('public.finalize_public_registration_payment_from_callback(uuid,text,numeric,text,timestamptz,jsonb)'::regprocedure), '\s+', '', 'g')) <> '4bfacda586181a3aacd7c8e02b4c7362'
     or md5(regexp_replace(pg_get_functiondef('public.finalize_public_registration_crm(uuid)'::regprocedure), '\s+', '', 'g')) <> 'fe568112a7c9a2ae8ad765557dc5f8c6' then
    raise exception 'm3_postcondition_failed: another payment function changed' using errcode = 'P0001';
  end if;
end $$;
