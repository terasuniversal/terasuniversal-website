-- M0 (PKG-1d-B-DB-G1, D6): the legacy manual bank-transfer RPC no longer creates a second money record for a
-- registration that is already paid (R2), and supersedes any still-open ToyyibPay attempt once the transfer is recorded.
--
-- Why (R2): verify_public_registration_manual_payment found no active bank record for a registration already paid by
-- ToyyibPay, inserted pending -> processing -> paid and returned the CRM result 'already_confirmed': two 'paid' money
-- records, nothing flagged. Separately, a ToyyibPay attempt left open after a bank transfer would later take the
-- callback's normal path and be recorded paid without any reconciliation flag.
--
-- What (exactly these two blocks; every other line of the A5 body is byte-identical):
--   * r2_already_paid_guard: after the registration and active bank record are locked, a registration whose
--     payment_status is 'paid', or that has another 'paid'/'refunded' payment record, raises registration_already_paid
--     (no record, no audit). The active bank record's own replay still returns 'already_paid'.
--   * r2_supersede_open_toyyibpay: once the bank record is paid, open ToyyibPay attempts become 'cancelled' with
--     raw_response.superseded_by_bank_transfer.provider_cancellation_confirmed = false and one
--     'toyyibpay_attempt_superseded' audit event each. Internal supersession only, never a provider cancellation.
-- Signature, SECURITY DEFINER, search_path, owner and privileges are preserved (asserted below). The R1 A5
-- r1_schedule_guard block is unchanged. Rollback is a forward migration re-creating the pinned A5 body
-- (md5 b13e9b7ff5d3c8ebf1be8443aa21fa0a).

do $$
declare
  v_vf constant regprocedure := to_regprocedure('public.verify_public_registration_manual_payment(text,text,numeric,text,text,uuid)');
  v_cb constant regprocedure := to_regprocedure('public.finalize_public_registration_payment_from_callback(uuid,text,numeric,text,timestamptz,jsonb)');
  v_crm constant regprocedure := to_regprocedure('public.finalize_public_registration_crm(uuid)');
  v_src text;
begin
  if v_vf is null or v_cb is null or v_crm is null then
    raise exception 'm0_precondition_failed: a payment function is missing' using errcode = 'P0001';
  end if;
  select prosrc into v_src from pg_proc where oid = v_vf;
  if md5(regexp_replace(pg_get_functiondef(v_vf), '\s+', '', 'g')) <> 'b13e9b7ff5d3c8ebf1be8443aa21fa0a'
     and position('r2_already_paid_guard' in v_src) = 0 then
    raise exception 'm0_precondition_failed: manual payment verification differs from the R1 A5 definition' using errcode = 'P0001';
  end if;
  if md5(regexp_replace(pg_get_functiondef(v_cb), '\s+', '', 'g')) <> '4bfacda586181a3aacd7c8e02b4c7362' then
    raise exception 'm0_precondition_failed: callback finalization differs from the R1 A5 definition' using errcode = 'P0001';
  end if;
  if md5(regexp_replace(pg_get_functiondef(v_crm), '\s+', '', 'g')) <> 'fe568112a7c9a2ae8ad765557dc5f8c6' then
    raise exception 'm0_precondition_failed: finalize_public_registration_crm differs from the PKG-1c definition' using errcode = 'P0001';
  end if;
  if md5(regexp_replace(pg_get_functiondef('app.public_registration_payment_state_guard()'::regprocedure), '\s+', '', 'g')) <> 'b2a2c84993b50291b443bff288d8217d' then
    raise exception 'm0_precondition_failed: payment state guard differs from the PKG-1d-A definition' using errcode = 'P0001';
  end if;
  perform set_config('m0.acl_vf', coalesce((select proacl::text from pg_proc where oid = v_vf), 'null'), false);
  perform set_config('m0.owner_vf', (select proowner::regrole::text from pg_proc where oid = v_vf), false);
end $$;

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
  v_superseded uuid[];
  v_superseded_id uuid;
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

  -- r2_already_paid_guard: a registration already paid by another payment record never receives a second money record
  -- through this function. The active bank record itself (replay) still returns 'already_paid' below. Checked under
  -- the registration row lock, which every payment writer takes first.
  if (v_payment.id is null or v_payment.status <> 'paid')
     and (v_registration.payment_status = 'paid'
          or exists (select 1 from public.public_registration_payments
                     where registration_id = v_registration.id
                       and status in ('paid', 'refunded')
                       and id is distinct from v_payment.id)) then
    raise exception 'registration_already_paid' using errcode = 'P0001';
  end if;

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

  -- r2_supersede_open_toyyibpay: the bank transfer is now the payment path. Any still-open ToyyibPay attempt of this
  -- registration is marked internally superseded ('cancelled'), so a later genuine provider success takes the late-success
  -- path (recorded, flagged, no seat) instead of the normal path. This is NOT a provider-side cancellation.
  perform 1 from public.public_registration_payments
  where registration_id = v_registration.id and payment_provider = 'toyyibpay' and status in ('pending', 'processing')
  for update;
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
  v_vf constant regprocedure := 'public.verify_public_registration_manual_payment(text,text,numeric,text,text,uuid)'::regprocedure;
  v_src text;
begin
  select prosrc into v_src from pg_proc where oid = v_vf;
  if coalesce((select proacl::text from pg_proc where oid = v_vf), 'null') <> current_setting('m0.acl_vf') then
    raise exception 'm0_postcondition_failed: privileges of the manual payment function changed' using errcode = 'P0001';
  end if;
  if (select proowner::regrole::text from pg_proc where oid = v_vf) <> current_setting('m0.owner_vf') then
    raise exception 'm0_postcondition_failed: owner of the manual payment function changed' using errcode = 'P0001';
  end if;
  if not (select prosecdef from pg_proc where oid = v_vf)
     or (select proconfig from pg_proc where oid = v_vf) is distinct from array['search_path=pg_catalog, public, app, extensions'] then
    raise exception 'm0_postcondition_failed: SECURITY DEFINER or search_path of the manual payment function changed' using errcode = 'P0001';
  end if;
  if position('r2_already_paid_guard' in v_src) = 0 or position('r2_supersede_open_toyyibpay' in v_src) = 0
     or position('r1_schedule_guard' in v_src) = 0 then
    raise exception 'm0_postcondition_failed: new manual payment body is not in place' using errcode = 'P0001';
  end if;
  if md5(regexp_replace(pg_get_functiondef('public.finalize_public_registration_payment_from_callback(uuid,text,numeric,text,timestamptz,jsonb)'::regprocedure), '\s+', '', 'g')) <> '4bfacda586181a3aacd7c8e02b4c7362'
     or md5(regexp_replace(pg_get_functiondef('public.finalize_public_registration_crm(uuid)'::regprocedure), '\s+', '', 'g')) <> 'fe568112a7c9a2ae8ad765557dc5f8c6' then
    raise exception 'm0_postcondition_failed: callback or CRM finalization changed' using errcode = 'P0001';
  end if;
end $$;
