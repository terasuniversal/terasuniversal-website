-- Staff-verified bank transfers that arrive late can be recorded (PKG-1d-A, 3 of 4).
--
-- Why (verified against the live body of public.verify_public_registration_manual_payment, md5 pinned below):
--   B7  a registration whose payment_status is 'failed' (for example after an unsuccessful ToyyibPay attempt) could not
--       be verified: the function moved payment_status straight to 'paid', which the registration state guard forbids
--       (only failed -> processing is allowed), so the whole verification raised and rolled back;
--   B5  a registration that had already expired or been cancelled raised 'registration_not_verifiable', so money that
--       an admin confirmed in the bank statement could not be recorded at all.
--
-- New behaviour (authorization unchanged: service_role or an active admin / super_admin verifier; amount must still
-- equal the registration amount, a different amount is still refused):
--   * payment_status 'failed' is stepped failed -> processing -> paid inside the guard's allowed transitions;
--   * an expired / cancelled registration gets its bank_transfer attempt recorded as 'paid' and payment_status 'paid'
--     (when the guard allows it), with NO seat allocation and outcome 'reconciliation_required'; staff allocate or
--     refund from the "Paid, not confirmed" queue;
--   * when payment_status cannot become 'paid' (for example 'refunded'), the verified money is still recorded on the
--     attempt and the outcome is 'reconciliation_required' instead of an unhandled error;
--   * every recorded manual payment writes an audit event with amount, reference and verifier;
--   * an open, payable registration is finalized exactly as before (finalize_public_registration_crm with the PKG-1c
--     capacity guard); 'already_paid' for a repeated verification is unchanged.
--
-- Scope: the body of this one function. Signature, SECURITY DEFINER, search_path, owner and privileges are preserved
-- (asserted below). Idempotent. Rollback is a forward migration that re-creates the previous body (pinned by md5).

do $$
declare
  v_fn constant regprocedure := to_regprocedure('public.verify_public_registration_manual_payment(text,text,numeric,text,text,uuid)');
  v_md5 text;
  v_src text;
begin
  if v_fn is null then
    raise exception 'pkg1d_a3_precondition_failed: manual payment verification function is missing' using errcode = 'P0001';
  end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'verify_public_registration_manual_payment') <> 1 then
    raise exception 'pkg1d_a3_precondition_failed: expected exactly one manual payment verification function' using errcode = 'P0001';
  end if;
  -- The body captured on Staging and Production on 22 Nov 2026, or already this migration's version (re-run).
  select md5(regexp_replace(pg_get_functiondef(v_fn), '\s+', '', 'g')), prosrc into v_md5, v_src from pg_proc where oid = v_fn;
  if v_md5 <> 'b8ad44d4ad70f1412fbfe184e03fdc96' and position('pkg1d_manual_payment_states' in v_src) = 0 then
    raise exception 'pkg1d_a3_precondition_failed: manual payment verification differs from the expected definition' using errcode = 'P0001';
  end if;
  perform set_config('pkg1d.acl_manual', coalesce((select proacl::text from pg_proc where oid = v_fn), 'null'), false);
end $$;

create or replace function public.verify_public_registration_manual_payment(p_registration_reference text, p_registration_secret text, p_amount numeric, p_payment_reference text, p_notes text default null::text, p_verifier_id uuid default null::uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'pg_catalog', 'public', 'app', 'extensions'
as $function$
declare
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
  return public.finalize_public_registration_crm(v_registration.id);
end;
$function$;

do $$
declare
  v_fn constant regprocedure := 'public.verify_public_registration_manual_payment(text,text,numeric,text,text,uuid)'::regprocedure;
begin
  if coalesce((select proacl::text from pg_proc where oid = v_fn), 'null') <> current_setting('pkg1d.acl_manual') then
    raise exception 'pkg1d_a3_postcondition_failed: privileges of the manual payment verification function changed' using errcode = 'P0001';
  end if;
  if not (select prosecdef from pg_proc where oid = v_fn) then
    raise exception 'pkg1d_a3_postcondition_failed: manual payment verification is no longer SECURITY DEFINER' using errcode = 'P0001';
  end if;
  if (select proconfig from pg_proc where oid = v_fn) is distinct from array['search_path=pg_catalog, public, app, extensions'] then
    raise exception 'pkg1d_a3_postcondition_failed: search_path of the manual payment verification function changed' using errcode = 'P0001';
  end if;
  if position('pkg1d_manual_payment_states' in (select prosrc from pg_proc where oid = v_fn)) = 0 then
    raise exception 'pkg1d_a3_postcondition_failed: new manual payment verification body is not in place' using errcode = 'P0001';
  end if;
end $$;
