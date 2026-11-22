-- Never offer a new ToyyibPay bill for a registration that is already paid (PKG-1d-A, 4 of 4).
--
-- Why: public.begin_public_registration_payment checked the registration status (cancelled / expired / confirmed) but
-- not payment_status. A registration that is paid but not confirmed -- PKG-1c 'paid_unallocated', or a late success
-- recorded by 20261122121000 -- could still be handed an open attempt's payment URL or a new bill, so the payer could
-- be charged twice for one registration.
--
-- New behaviour: payment_status = 'paid' raises 'registration_already_paid' before any attempt is read, created or
-- claimed. Everything else in the function is the previous body unchanged.
--
-- Scope: the body of this one function. Signature, SECURITY DEFINER, search_path, owner and privileges are preserved
-- (asserted below). Idempotent. Rollback is a forward migration that re-creates the previous body (pinned by md5).

do $$
declare
  v_fn constant regprocedure := to_regprocedure('public.begin_public_registration_payment(text,text,text)');
  v_md5 text;
  v_src text;
begin
  if v_fn is null then
    raise exception 'pkg1d_a4_precondition_failed: begin_public_registration_payment is missing' using errcode = 'P0001';
  end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'begin_public_registration_payment') <> 1 then
    raise exception 'pkg1d_a4_precondition_failed: expected exactly one begin_public_registration_payment' using errcode = 'P0001';
  end if;
  -- The body captured on Staging and Production on 22 Nov 2026, or already this migration's version (re-run).
  select md5(regexp_replace(pg_get_functiondef(v_fn), '\s+', '', 'g')), prosrc into v_md5, v_src from pg_proc where oid = v_fn;
  if v_md5 <> 'f39fbc4261fbc8043a4d6e45ef86059d' and position('pkg1d_begin_paid_guard' in v_src) = 0 then
    raise exception 'pkg1d_a4_precondition_failed: begin_public_registration_payment differs from the expected definition' using errcode = 'P0001';
  end if;
  perform set_config('pkg1d.acl_begin', coalesce((select proacl::text from pg_proc where oid = v_fn), 'null'), false);
end $$;

create or replace function public.begin_public_registration_payment(p_registration_reference text, p_registration_secret text, p_provider text default 'toyyibpay'::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'pg_catalog', 'public', 'extensions'
as $function$
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
  -- pkg1d_begin_paid_guard: a registration that is already paid must never be offered another bill.
  if v_registration.payment_status = 'paid' then
    raise exception 'registration_already_paid' using errcode = 'P0001';
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
$function$;

do $$
declare
  v_fn constant regprocedure := 'public.begin_public_registration_payment(text,text,text)'::regprocedure;
begin
  if coalesce((select proacl::text from pg_proc where oid = v_fn), 'null') <> current_setting('pkg1d.acl_begin') then
    raise exception 'pkg1d_a4_postcondition_failed: privileges of begin_public_registration_payment changed' using errcode = 'P0001';
  end if;
  if not (select prosecdef from pg_proc where oid = v_fn) then
    raise exception 'pkg1d_a4_postcondition_failed: begin_public_registration_payment is no longer SECURITY DEFINER' using errcode = 'P0001';
  end if;
  if (select proconfig from pg_proc where oid = v_fn) is distinct from array['search_path=pg_catalog, public, extensions'] then
    raise exception 'pkg1d_a4_postcondition_failed: search_path of begin_public_registration_payment changed' using errcode = 'P0001';
  end if;
  if position('pkg1d_begin_paid_guard' in (select prosrc from pg_proc where oid = v_fn)) = 0 then
    raise exception 'pkg1d_a4_postcondition_failed: new begin_public_registration_payment body is not in place' using errcode = 'P0001';
  end if;
end $$;
