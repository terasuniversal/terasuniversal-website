-- Phase 3 registration/payment state guards and payment-attempt reservation.
-- Global lock order: registration -> payment attempt -> schedule. All
-- multi-row payment/finalization paths must acquire locks in this order.

create or replace function app.public_registration_state_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and old.registration_status is distinct from new.registration_status then
    if not (
      (old.registration_status = 'pending_payment' and new.registration_status in ('payment_pending', 'failed', 'cancelled', 'expired'))
      or (old.registration_status = 'payment_pending' and new.registration_status in ('confirmed', 'failed', 'cancelled', 'expired'))
      or (old.registration_status = 'failed' and new.registration_status = 'payment_pending')
      or (old.registration_status = 'confirmed' and new.registration_status = 'cancelled')
    ) then
      raise exception 'invalid_public_registration_transition' using errcode = 'P0001';
    end if;
  end if;

  if old.registration_status in ('cancelled', 'expired')
     and new.registration_status is distinct from old.registration_status then
    raise exception 'terminal_public_registration_state' using errcode = 'P0001';
  end if;

  if tg_op = 'UPDATE' and old.payment_status is distinct from new.payment_status then
    if not (
      (old.payment_status = 'pending' and new.payment_status in ('processing', 'paid', 'failed', 'cancelled'))
      or (old.payment_status = 'processing' and new.payment_status in ('paid', 'failed', 'cancelled'))
      or (old.payment_status = 'failed' and new.payment_status = 'processing')
      or (old.payment_status = 'paid' and new.payment_status = 'refunded')
    ) then
      raise exception 'invalid_public_payment_transition' using errcode = 'P0001';
    end if;
  end if;

  return new;
end;
$$;

create or replace function app.public_registration_payment_state_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and old.status is distinct from new.status then
    if not (
      (old.status = 'pending' and new.status in ('processing', 'failed', 'cancelled'))
      or (old.status = 'processing' and new.status in ('paid', 'failed', 'cancelled'))
      or (old.status = 'paid' and new.status = 'refunded')
    ) then
      raise exception 'invalid_public_payment_attempt_transition' using errcode = 'P0001';
    end if;
  end if;

  if old.status in ('failed', 'cancelled', 'refunded')
     and new.status is distinct from old.status then
    raise exception 'terminal_public_payment_attempt_state' using errcode = 'P0001';
  end if;

  if old.status = 'paid' and (
    new.amount is distinct from old.amount
    or new.registration_id is distinct from old.registration_id
    or new.payment_provider is distinct from old.payment_provider
    or new.provider_bill_code is distinct from old.provider_bill_code
    or new.provider_transaction_id is distinct from old.provider_transaction_id
  ) then
    raise exception 'paid_public_payment_attempt_immutable' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_public_registration_state_guard on public.public_registrations;
create trigger trg_public_registration_state_guard
  before update on public.public_registrations
  for each row execute function app.public_registration_state_guard();
drop trigger if exists trg_public_registration_payment_state_guard on public.public_registration_payments;
create trigger trg_public_registration_payment_state_guard
  before update on public.public_registration_payments
  for each row execute function app.public_registration_payment_state_guard();

create or replace function public.begin_public_registration_payment(
  p_registration_reference text,
  p_registration_secret text,
  p_provider text default 'toyyibpay'
)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_registration public.public_registrations%rowtype;
  v_attempt public.public_registration_payments%rowtype;
  v_token_hash text;
begin
  if p_provider <> 'toyyibpay' then
    raise exception 'unsupported_payment_provider' using errcode = 'P0001';
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
  if v_registration.hold_expires_at is null or v_registration.hold_expires_at <= now() then
    raise exception 'registration_expired' using errcode = 'P0001';
  end if;
  if v_registration.registration_status in ('cancelled', 'expired', 'confirmed') then
    raise exception 'registration_not_payable' using errcode = 'P0001';
  end if;
  if v_registration.amount_snapshot <= 0 then
    raise exception 'zero_amount_registration' using errcode = 'P0001';
  end if;

  select * into v_attempt
  from public.public_registration_payments
  where registration_id = v_registration.id
    and payment_provider = p_provider
    and status in ('pending', 'processing')
  order by created_at desc
  limit 1
  for update;

  if v_attempt.id is null then
    insert into public.public_registration_payments (
      registration_id, payment_provider, status, amount, currency
    ) values (
      v_registration.id, p_provider, 'pending', v_registration.amount_snapshot, v_registration.currency
    ) returning * into v_attempt;
  end if;

  if v_attempt.payment_url is not null then
    return jsonb_build_object(
      'registration_reference', v_registration.registration_reference,
      'amount', v_attempt.amount,
      'currency', v_attempt.currency,
      'status', v_attempt.status,
      'payment_url', v_attempt.payment_url,
      'bill_creation_owner', false
    );
  end if;

  if v_attempt.bill_creation_state = 'claimed' then
    return jsonb_build_object(
      'registration_reference', v_registration.registration_reference,
      'amount', v_attempt.amount,
      'currency', v_attempt.currency,
      'status', 'bill_creation_in_progress',
      'payment_url', null,
      'bill_creation_owner', false
    );
  end if;

  update public.public_registration_payments
  set bill_creation_state = 'claimed', bill_creation_claimed_at = now()
  where id = v_attempt.id
    and bill_creation_state = 'not_claimed';
  if not found then
    return jsonb_build_object(
      'registration_reference', v_registration.registration_reference,
      'amount', v_attempt.amount,
      'currency', v_attempt.currency,
      'status', 'bill_creation_in_progress',
      'payment_url', null,
      'bill_creation_owner', false
    );
  end if;

  if v_registration.registration_status in ('pending_payment', 'failed') then
    update public.public_registrations
    set registration_status = 'payment_pending', payment_status = 'processing'
    where id = v_registration.id;
  elsif v_registration.payment_status = 'pending' then
    update public.public_registrations
    set payment_status = 'processing'
    where id = v_registration.id;
  end if;

  return jsonb_build_object(
    'registration_reference', v_registration.registration_reference,
    'amount', v_attempt.amount,
    'currency', v_attempt.currency,
    'status', v_attempt.status,
    'payment_url', v_attempt.payment_url,
    'bill_creation_owner', true
  );
end;
$$;

create or replace function public.attach_public_registration_toyy_pay_bill(
  p_attempt_id uuid,
  p_bill_code text,
  p_payment_url text
)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_attempt public.public_registration_payments%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if p_attempt_id is null or nullif(btrim(p_bill_code), '') is null or nullif(btrim(p_payment_url), '') is null then
    raise exception 'invalid_payment_bill' using errcode = 'P0001';
  end if;

  select * into v_attempt
  from public.public_registration_payments
  where id = p_attempt_id and payment_provider = 'toyyibpay'
  for update;

  if v_attempt.id is null then
    raise exception 'payment_attempt_not_found' using errcode = 'P0001';
  end if;
  if v_attempt.status not in ('pending', 'processing') or v_attempt.bill_creation_state <> 'claimed' then
    if v_attempt.provider_bill_code = p_bill_code then
      return jsonb_build_object('status', 'already_attached', 'payment_url', v_attempt.payment_url);
    end if;
    raise exception 'payment_attempt_not_attachable' using errcode = 'P0001';
  end if;

  update public.public_registration_payments
  set provider_bill_code = btrim(p_bill_code),
      payment_url = btrim(p_payment_url),
      bill_creation_state = 'attached',
      status = 'processing'
  where id = p_attempt_id;

  return jsonb_build_object('status', 'attached', 'payment_url', btrim(p_payment_url));
end;
$$;

create or replace function public.expire_public_registrations()
returns integer
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_count integer;
  v_registration_id uuid;
begin
  if auth.role() <> 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  v_count := 0;
  -- Registration is locked before its payment attempts, preserving the
  -- global registration -> payment lock order.
  for v_registration_id in
    select id from public.public_registrations
    where registration_status in ('pending_payment', 'payment_pending')
      and hold_expires_at is not null and hold_expires_at <= now()
    order by hold_expires_at, id
    for update
  loop
    update public.public_registrations
    set registration_status = 'expired', expired_at = coalesce(expired_at, now())
    where id = v_registration_id;
    update public.public_registration_payments
    set status = 'cancelled',
        bill_creation_state = bill_creation_state,
        raw_response = jsonb_build_object('expired_at', now(), 'reason', 'registration_hold_expired')
    where registration_id = v_registration_id and status in ('pending', 'processing');
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

create or replace function public.fail_public_registration_payment_setup(
  p_attempt_id uuid,
  p_reason text
)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_attempt public.public_registration_payments%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  select pr.* into v_attempt
  from public.public_registration_payments pr
  where pr.id = p_attempt_id;
  if v_attempt.id is null then
    return jsonb_build_object('outcome', 'unknown_attempt');
  end if;

  -- Global lock order: registration -> payment attempt -> schedule.
  perform 1
  from public.public_registrations r
  where r.id = v_attempt.registration_id
  for update;
  if not found then
    return jsonb_build_object('outcome', 'unknown_registration');
  end if;

  select * into v_attempt
  from public.public_registration_payments
  where id = p_attempt_id
  for update;
  if v_attempt.status in ('paid', 'refunded') then
    return jsonb_build_object('outcome', 'terminal_ignored', 'status', v_attempt.status);
  end if;

  update public.public_registration_payments
  set status = 'failed',
      bill_creation_state = 'failed',
      raw_response = jsonb_build_object('setup_failure', left(coalesce(p_reason, 'payment setup failed'), 500))
  where id = v_attempt.id;
  update public.public_registrations
  set payment_status = 'failed', registration_status = 'failed'
  where id = v_attempt.registration_id
    and registration_status in ('pending_payment', 'payment_pending');
  return jsonb_build_object('outcome', 'failed');
end;
$$;

create or replace function public.recover_public_registration_payment_claim(
  p_attempt_id uuid,
  p_reason text
)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_attempt public.public_registration_payments%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  -- Claims are never automatically reclaimed. This trusted recovery path
  -- explicitly closes a stale claim before a fresh payment attempt may be
  -- created for the registration.
  select pr.* into v_attempt
  from public.public_registration_payments pr
  where pr.id = p_attempt_id;
  if v_attempt.id is null then
    return jsonb_build_object('outcome', 'unknown_attempt');
  end if;
  perform 1 from public.public_registrations r where r.id = v_attempt.registration_id for update;
  select * into v_attempt from public.public_registration_payments where id = p_attempt_id for update;
  if v_attempt.bill_creation_state <> 'claimed' or v_attempt.status in ('paid', 'refunded', 'cancelled') then
    return jsonb_build_object('outcome', 'not_recoverable', 'status', v_attempt.status, 'bill_creation_state', v_attempt.bill_creation_state);
  end if;
  update public.public_registration_payments
  set status = 'failed',
      bill_creation_state = 'orphaned',
      raw_response = jsonb_build_object('claim_recovery', left(coalesce(p_reason, 'manual claim recovery'), 500))
  where id = p_attempt_id;
  return jsonb_build_object('outcome', 'recovered');
end;
$$;

create or replace function public.record_public_registration_payment_orphan(
  p_attempt_id uuid, p_bill_code text, p_payment_url text, p_reason text
)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_attempt public.public_registration_payments%rowtype;
begin
  if auth.role() <> 'service_role' then raise exception 'not_authorized' using errcode = '42501'; end if;
  select * into v_attempt from public.public_registration_payments where id = p_attempt_id for update;
  if v_attempt.id is null then return jsonb_build_object('outcome', 'unknown_attempt'); end if;
  if v_attempt.status in ('paid', 'refunded') then
    return jsonb_build_object('outcome', 'terminal_ignored', 'status', v_attempt.status);
  end if;
  update public.public_registration_payments
  set status = case when status in ('paid', 'refunded') then status else 'failed' end,
      bill_creation_state = 'orphaned',
      provider_bill_code = coalesce(provider_bill_code, nullif(btrim(p_bill_code), '')),
      payment_url = coalesce(payment_url, nullif(btrim(p_payment_url), '')),
      provider_reference = 'orphaned_provider_bill',
      raw_response = jsonb_build_object('reason', left(coalesce(p_reason, 'provider bill attachment failed'), 500), 'bill_code', btrim(p_bill_code), 'payment_url', btrim(p_payment_url))
  where id = v_attempt.id;
  return jsonb_build_object('outcome', 'recorded');
end;
$$;

revoke all on function public.begin_public_registration_payment(text, text, text) from public;
grant execute on function public.begin_public_registration_payment(text, text, text) to anon, authenticated;
revoke all on function public.attach_public_registration_toyy_pay_bill(uuid, text, text) from public;
grant execute on function public.attach_public_registration_toyy_pay_bill(uuid, text, text) to service_role;
revoke all on function public.expire_public_registrations() from public;
grant execute on function public.expire_public_registrations() to service_role;
revoke all on function public.fail_public_registration_payment_setup(uuid, text) from public;
grant execute on function public.fail_public_registration_payment_setup(uuid, text) to service_role;
revoke all on function public.record_public_registration_payment_orphan(uuid, text, text, text) from public;
grant execute on function public.record_public_registration_payment_orphan(uuid, text, text, text) to service_role;
revoke all on function public.recover_public_registration_payment_claim(uuid, text) from public;
grant execute on function public.recover_public_registration_payment_claim(uuid, text) to service_role;
revoke all on function app.public_registration_state_guard() from public, anon, authenticated;
revoke all on function app.public_registration_payment_state_guard() from public, anon, authenticated;
