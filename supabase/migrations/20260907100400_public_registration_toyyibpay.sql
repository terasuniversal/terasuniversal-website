-- Registration-specific payment finalization. Existing invoice ToyyibPay
-- functions and invoice_payments rows are intentionally untouched.

create or replace function public.finalize_public_registration_payment_from_callback(
  p_attempt_id uuid,
  p_bill_code text,
  p_verified_amount numeric,
  p_provider_transaction_id text,
  p_callback_received_at timestamptz,
  p_raw_response jsonb
)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, app
as $$
declare
  v_registration public.public_registrations%rowtype;
  v_attempt public.public_registration_payments%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if p_attempt_id is null or nullif(btrim(p_bill_code), '') is null
     or nullif(btrim(p_provider_transaction_id), '') is null
     or p_verified_amount is null or p_verified_amount <= 0 then
    raise exception 'invalid_verified_payment' using errcode = 'P0001';
  end if;

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
  if round(p_verified_amount, 2) <> round(v_attempt.amount, 2)
     or round(p_verified_amount, 2) <> round(v_registration.amount_snapshot, 2) then
    raise exception 'payment_amount_mismatch' using errcode = 'P0001';
  end if;

  if v_registration.registration_status in ('cancelled', 'expired') then
    if v_attempt.status in ('paid', 'refunded') then
      return jsonb_build_object('outcome', 'terminal_ignored', 'status', v_attempt.status);
    end if;
    update public.public_registration_payments
    set provider_transaction_id = btrim(p_provider_transaction_id),
        callback_received_at = p_callback_received_at,
        raw_response = jsonb_build_object(
          'late_success_reconciliation_required', true,
          'verified_amount', round(p_verified_amount, 2),
          'provider_response', coalesce(p_raw_response, '{}'::jsonb)
        )
    where id = v_attempt.id;
    perform public.log_public_registration_payment_event(
      v_attempt.id, 'late_success_after_expiry',
      jsonb_build_object('registration_reference', v_registration.registration_reference)
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
$$;

create or replace function public.mark_public_registration_payment_failed_from_callback(
  p_attempt_id uuid,
  p_bill_code text,
  p_callback_received_at timestamptz,
  p_reason text
)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, app
as $$
declare
  v_registration public.public_registrations%rowtype;
  v_attempt public.public_registration_payments%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  -- Lock registration first, then payment attempt; this is the global order.
  select pr.* into v_registration
  from public.public_registrations pr
  where pr.id = (select registration_id from public.public_registration_payments where id = p_attempt_id)
  for update;
  if v_registration.id is null then raise exception 'registration_not_found' using errcode = 'P0001'; end if;
  select * into v_attempt from public.public_registration_payments
  where id = p_attempt_id and payment_provider = 'toyyibpay' for update;
  if v_attempt.id is null or v_attempt.registration_id <> v_registration.id then raise exception 'payment_attempt_not_found' using errcode = 'P0001'; end if;
  if v_attempt.provider_bill_code is distinct from btrim(p_bill_code) then
    raise exception 'payment_bill_mismatch' using errcode = 'P0001';
  end if;
  if v_attempt.status in ('paid', 'refunded') then
    return jsonb_build_object('outcome', 'terminal_ignored', 'status', v_attempt.status);
  end if;
  if v_attempt.status in ('failed', 'cancelled') then
    return jsonb_build_object('outcome', 'duplicate_ignored', 'status', v_attempt.status);
  end if;

  update public.public_registration_payments
  set status = 'failed',
      callback_received_at = p_callback_received_at,
      raw_response = jsonb_build_object('reason', left(coalesce(p_reason, 'provider reported unsuccessful'), 500))
  where id = v_attempt.id;
  update public.public_registrations
  set payment_status = 'failed', registration_status = 'failed'
  where id = v_attempt.registration_id
    and registration_status in ('pending_payment', 'payment_pending');

  return jsonb_build_object('outcome', 'failed');
end;
$$;

create or replace function public.log_public_registration_payment_event(
  p_attempt_id uuid,
  p_event_type text,
  p_detail jsonb
)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, app
as $$
declare
  v_actor uuid;
  v_actor_email text;
begin
  if auth.role() <> 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if p_event_type not in ('invalid_hash', 'missing_fields', 'unknown_attempt', 'billcode_mismatch', 'verification_failed', 'no_matching_transaction', 'amount_mismatch', 'late_success_after_expiry') then
    raise exception 'invalid_payment_event_type' using errcode = 'P0001';
  end if;

  select actor_id, actor_email into v_actor, v_actor_email
  from app.toyyibpay_system_actor();
  perform public.log_event_as_service(
    v_actor,
    v_actor_email,
    'update'::public.audit_action,
    'public_registration_payments',
    coalesce(p_attempt_id::text, 'unknown'),
    'Public registration payment event: ' || p_event_type,
    coalesce(p_detail, '{}'::jsonb)
  );
  return jsonb_build_object('logged', true);
end;
$$;

revoke all on function public.finalize_public_registration_payment_from_callback(uuid, text, numeric, text, timestamptz, jsonb) from public;
grant execute on function public.finalize_public_registration_payment_from_callback(uuid, text, numeric, text, timestamptz, jsonb) to service_role;
revoke all on function public.mark_public_registration_payment_failed_from_callback(uuid, text, timestamptz, text) from public;
grant execute on function public.mark_public_registration_payment_failed_from_callback(uuid, text, timestamptz, text) to service_role;
revoke all on function public.log_public_registration_payment_event(uuid, text, jsonb) from public;
grant execute on function public.log_public_registration_payment_event(uuid, text, jsonb) to service_role;
