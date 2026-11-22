-- Narrow late-success transition in the payment-attempt state guard (PKG-1d-A, 1 of 4).
--
-- Why: app.public_registration_payment_state_guard() makes 'failed' and 'cancelled' attempts terminal. A payment that
-- ToyyibPay later reports (server to server, via getBillTransactions) as successful for such an attempt therefore
-- cannot be recorded as 'paid': the verified money is either dropped (failed attempt, registration still open) or kept
-- only as a JSON note (cancelled attempt). "Money received" must be one rule -- status 'paid' (later 'refunded') with
-- verified_amount -- so a provider-verified late success has to be able to reach 'paid'.
--
-- New behaviour: exactly one additional transition, failed|cancelled -> paid, and only when ALL hold:
--   * provenance: the update runs inside public.finalize_public_registration_payment_from_callback (current_user is
--     that SECURITY DEFINER function's owner) and that function has marked this very attempt for the current
--     transaction (app.pkg1d_late_success_attempt = attempt id). A populated transaction id, amount or timestamp is
--     NOT proof on its own: a direct UPDATE by any other role, or without the marker, is refused;
--   * ToyyibPay attempt with a bill code, new provider_transaction_id present and unchanged if one was already stored;
--   * verified_amount present and equal to the attempt amount, verified_at present;
--   * amount, registration, provider and bill code unchanged; raw_response carries the 'late_success' evidence.
-- Every other rule of the guard is unchanged (the original body follows the new block verbatim). No seat is
-- allocated here; allocation stays in finalize_public_registration_crm.
--
-- Scope: the body of app.public_registration_payment_state_guard() only. The trigger, owner and privileges are
-- unchanged (CREATE OR REPLACE keeps the ACL; asserted below). Idempotent. Rollback is a forward migration that
-- re-creates the previous body (pinned below by md5); it must run after 20261122121000 is rolled back.

do $$
declare
  v_guard constant regprocedure := to_regprocedure('app.public_registration_payment_state_guard()');
  v_md5 text;
  v_src text;
begin
  if v_guard is null then
    raise exception 'pkg1d_a1_precondition_failed: payment state guard is missing' using errcode = 'P0001';
  end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'app' and p.proname = 'public_registration_payment_state_guard') <> 1 then
    raise exception 'pkg1d_a1_precondition_failed: expected exactly one payment state guard' using errcode = 'P0001';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_public_registration_payment_state_guard'
      and tgrelid = 'public.public_registration_payments'::regclass and tgfoid = v_guard and not tgisinternal) then
    raise exception 'pkg1d_a1_precondition_failed: payment state guard trigger is not attached' using errcode = 'P0001';
  end if;
  -- Refuse to overwrite an unknown version: the body captured on Staging and Production on 22 Nov 2026, or already
  -- this migration's version (re-run).
  select md5(regexp_replace(pg_get_functiondef(v_guard), '\s+', '', 'g')), prosrc into v_md5, v_src from pg_proc where oid = v_guard;
  if v_md5 <> '72758ed85418fdfdaadd414fb4dad917' and position('pkg1d_late_success_guard' in v_src) = 0 then
    raise exception 'pkg1d_a1_precondition_failed: payment state guard differs from the expected definition' using errcode = 'P0001';
  end if;
  perform set_config('pkg1d.acl_guard', coalesce((select proacl::text from pg_proc where oid = v_guard), 'null'), false);
end $$;

create or replace function app.public_registration_payment_state_guard()
 returns trigger
 language plpgsql
as $function$
declare
  v_callback_owner oid;
begin
  -- pkg1d_late_success_guard: the only way out of 'failed'/'cancelled' is a provider-verified late success recorded
  -- by the callback finalization function itself.
  if tg_op = 'UPDATE' and old.status in ('failed', 'cancelled') and new.status = 'paid' then
    select p.proowner into v_callback_owner
    from pg_proc p
    where p.oid = to_regprocedure('public.finalize_public_registration_payment_from_callback(uuid,text,numeric,text,timestamptz,jsonb)');
    if v_callback_owner is null
       or (select r.oid from pg_roles r where r.rolname = current_user) is distinct from v_callback_owner
       or coalesce(current_setting('app.pkg1d_late_success_attempt', true), '') <> new.id::text
       or new.payment_provider <> 'toyyibpay'
       or new.provider_bill_code is null
       or nullif(btrim(coalesce(new.provider_transaction_id, '')), '') is null
       or (old.provider_transaction_id is not null and new.provider_transaction_id is distinct from old.provider_transaction_id)
       or new.verified_amount is null
       or round(new.verified_amount, 2) <> round(new.amount, 2)
       or new.verified_at is null
       or new.amount is distinct from old.amount
       or new.registration_id is distinct from old.registration_id
       or new.payment_provider is distinct from old.payment_provider
       or new.provider_bill_code is distinct from old.provider_bill_code
       or not (coalesce(new.raw_response, '{}'::jsonb) ? 'late_success') then
      raise exception 'invalid_late_success_transition' using errcode = 'P0001';
    end if;
    return new;
  end if;

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
$function$;

do $$
declare
  v_guard constant regprocedure := 'app.public_registration_payment_state_guard()'::regprocedure;
begin
  if coalesce((select proacl::text from pg_proc where oid = v_guard), 'null') <> current_setting('pkg1d.acl_guard') then
    raise exception 'pkg1d_a1_postcondition_failed: privileges of the payment state guard changed' using errcode = 'P0001';
  end if;
  if (select prosecdef from pg_proc where oid = v_guard) then
    raise exception 'pkg1d_a1_postcondition_failed: the payment state guard must not be SECURITY DEFINER' using errcode = 'P0001';
  end if;
  if position('pkg1d_late_success_guard' in (select prosrc from pg_proc where oid = v_guard)) = 0 then
    raise exception 'pkg1d_a1_postcondition_failed: new guard body is not in place' using errcode = 'P0001';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_public_registration_payment_state_guard'
      and tgrelid = 'public.public_registration_payments'::regclass and tgfoid = v_guard and not tgisinternal) then
    raise exception 'pkg1d_a1_postcondition_failed: payment state guard trigger is not attached' using errcode = 'P0001';
  end if;
end $$;
