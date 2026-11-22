-- M-S7 (DRAFT, NOT APPLIED ANYWHERE): module authorization for the remaining finance/HRDF SECURITY DEFINER RPCs.
--
-- Finding (Production read-only review, 2026-11-22): eleven SECURITY DEFINER RPCs check app.is_admin() only and are
-- EXECUTE-able by authenticated, so an active Admin holding Invoices/HRDF "view" can call them directly through the Data
-- API. The Server Actions already require invoices:edit / hrdf_claims:edit (RC1, e61c078). This migration makes the
-- database enforce the same rule (D1: financial writes are super_admin-only unless a grant is made).
--
-- Group A (have application callers): keep the body byte-for-byte by renaming to *_unguarded (no client EXECUTE) and add a
-- same-signature wrapper that checks the module the calling Server Action already requires, raising the RPC's own error.
--   record_manual_payment, generate_receipt_for_payment, record_toyyibpay_bill, mark_toyyibpay_attempt_superseded,
--   get_active_toyyibpay_attempt, log_toyyibpay_conflict                    -> invoices edit
--   record_hrdf_payment                                                       -> invoices edit AND hrdf_claims edit
--   transition_hrdf_claim                                                     -> hrdf_claims edit
-- Group B (no application, internal, cron or edge caller) is handled by M1, migration 20261123080000, which must already be
-- applied: finalize_toyyibpay_payment, mark_toyyibpay_attempt_failed, reverse_won_opportunity. This migration only asserts
-- their M1 state (postgres-only EXECUTE) and does not change them again.
-- Not touched: *_from_callback finalizers (service_role only, used by the ToyyibPay callbacks and the status refresh),
-- the four M-S4b wrappers, PKG-1 registration RPCs (separate PKG-1 track), all tables and policies.
-- None of the eleven has an internal SQL caller (verified), so renaming cannot redirect another function to a wrapper.
-- No table lock: only pg_proc changes. Fail-closed preflight. Idempotent. Forward-only.
-- Rollback (separate approval; reopens the gap): drop the eight wrappers, rename *_unguarded back, re-grant EXECUTE to
-- authenticated/service_role on those eight as before (M1's three stay revoked).

do $ms7$
declare
  r record;
begin
  -- Preflight: exact pre-state (definition hash, owner, SECURITY DEFINER, ACL) or nothing changes.
  for r in
    select * from (values
      ('public.generate_receipt_for_payment(uuid)', '55acc776bd049b57f1ab2bbe60f90218'),
      ('public.get_active_toyyibpay_attempt(uuid)', '9f0eb10e71703836343d8a300f48ae83'),
      ('public.log_toyyibpay_conflict(uuid,uuid,text)', '70da315bac633830bb0250d9b26c8156'),
      ('public.mark_toyyibpay_attempt_superseded(uuid)', 'f81f10397bb7993bdfaf0da878f03435'),
      ('public.record_hrdf_payment(uuid,numeric,text,text,date,text,text)', '1394d6827bc46d83b6265c1d8ce77bef'),
      ('public.record_manual_payment(uuid,text,text,numeric,date,text,text)', 'db3e3d34fce21530c92e3ae8ab43a82d'),
      ('public.record_toyyibpay_bill(uuid,uuid,text,text,numeric)', 'b77f8fefce280fc7df201a86b1546f0b'),
      ('public.transition_hrdf_claim(uuid,text,jsonb)', 'f86100a8e7d2234912b080ce76280144')
    ) t(sig, src_md5)
  loop
    if to_regprocedure(r.sig) is null
       or (select md5(prosrc) from pg_proc where oid = to_regprocedure(r.sig)) <> r.src_md5
       or not (select prosecdef from pg_proc where oid = to_regprocedure(r.sig))
       or (select pg_get_userbyid(proowner) from pg_proc where oid = to_regprocedure(r.sig)) <> 'postgres'
       or not has_function_privilege('authenticated', r.sig, 'EXECUTE')
       or to_regprocedure(replace(r.sig, '(', '_unguarded(')) is not null then
      raise exception 'ms7_precondition_failed: % is not the reviewed pre-state - nothing changed', r.sig using errcode = 'P0001';
    end if;
  end loop;
  -- M1 (20261123080000) must already have revoked client EXECUTE from Group B.
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '20261123080000')
     or exists (
       select 1 from pg_proc p
       where p.oid in (to_regprocedure('public.finalize_toyyibpay_payment(uuid,numeric,text,jsonb,timestamp with time zone,timestamp with time zone)'),
                       to_regprocedure('public.mark_toyyibpay_attempt_failed(uuid,text,timestamp with time zone)'),
                       to_regprocedure('public.reverse_won_opportunity(uuid,text)'))
         and p.proacl::text <> '{postgres=X/postgres}')
     or (select count(*) from pg_proc p
         where p.oid in (to_regprocedure('public.finalize_toyyibpay_payment(uuid,numeric,text,jsonb,timestamp with time zone,timestamp with time zone)'),
                         to_regprocedure('public.mark_toyyibpay_attempt_failed(uuid,text,timestamp with time zone)'),
                         to_regprocedure('public.reverse_won_opportunity(uuid,text)'))) <> 3 then
    raise exception 'ms7_precondition_failed: M1 (20261123080000) is not applied - nothing changed' using errcode = 'P0001';
  end if;
  if to_regprocedure('public.has_module_access_level(text,text)') is null then
    raise exception 'ms7_precondition_failed: has_module_access_level missing' using errcode = 'P0001';
  end if;
  if (select count(*) from unnest(array['invoices', 'hrdf_claims']) k
      where not exists (select 1 from public.staff_module_catalog c where c.module_key = k and c.is_active)) <> 0 then
    raise exception 'ms7_precondition_failed: module key missing or inactive' using errcode = 'P0001';
  end if;

  -- Group A: rename originals.
  alter function public.record_manual_payment(uuid, text, text, numeric, date, text, text) rename to record_manual_payment_unguarded;
  alter function public.generate_receipt_for_payment(uuid) rename to generate_receipt_for_payment_unguarded;
  alter function public.record_toyyibpay_bill(uuid, uuid, text, text, numeric) rename to record_toyyibpay_bill_unguarded;
  alter function public.mark_toyyibpay_attempt_superseded(uuid) rename to mark_toyyibpay_attempt_superseded_unguarded;
  alter function public.get_active_toyyibpay_attempt(uuid) rename to get_active_toyyibpay_attempt_unguarded;
  alter function public.log_toyyibpay_conflict(uuid, uuid, text) rename to log_toyyibpay_conflict_unguarded;
  alter function public.record_hrdf_payment(uuid, numeric, text, text, date, text, text) rename to record_hrdf_payment_unguarded;
  alter function public.transition_hrdf_claim(uuid, text, jsonb) rename to transition_hrdf_claim_unguarded;
end;
$ms7$;

revoke all on function public.record_manual_payment_unguarded(uuid, text, text, numeric, date, text, text) from public, anon, authenticated, service_role;
revoke all on function public.generate_receipt_for_payment_unguarded(uuid) from public, anon, authenticated, service_role;
revoke all on function public.record_toyyibpay_bill_unguarded(uuid, uuid, text, text, numeric) from public, anon, authenticated, service_role;
revoke all on function public.mark_toyyibpay_attempt_superseded_unguarded(uuid) from public, anon, authenticated, service_role;
revoke all on function public.get_active_toyyibpay_attempt_unguarded(uuid) from public, anon, authenticated, service_role;
revoke all on function public.log_toyyibpay_conflict_unguarded(uuid, uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.record_hrdf_payment_unguarded(uuid, numeric, text, text, date, text, text) from public, anon, authenticated, service_role;
revoke all on function public.transition_hrdf_claim_unguarded(uuid, text, jsonb) from public, anon, authenticated, service_role;

-- Group A wrappers: same names, parameter names, defaults and result types (PostgREST named-argument calls keep working).
create or replace function public.record_manual_payment(p_invoice_id uuid, p_payment_provider text, p_payment_method text,
  p_amount numeric, p_payment_date date, p_payment_reference text, p_notes text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_module_access_level('invoices', 'edit') then raise exception 'not_authorized' using errcode = 'P0001'; end if;
  return public.record_manual_payment_unguarded(p_invoice_id, p_payment_provider, p_payment_method, p_amount, p_payment_date, p_payment_reference, p_notes);
end; $$;

create or replace function public.generate_receipt_for_payment(p_payment_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_module_access_level('invoices', 'edit') then raise exception 'not_authorized' using errcode = 'P0001'; end if;
  return public.generate_receipt_for_payment_unguarded(p_payment_id);
end; $$;

create or replace function public.record_toyyibpay_bill(p_invoice_id uuid, p_attempt_id uuid, p_billcode text, p_payment_url text, p_amount numeric)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_module_access_level('invoices', 'edit') then raise exception 'not_authorized' using errcode = 'P0001'; end if;
  return public.record_toyyibpay_bill_unguarded(p_invoice_id, p_attempt_id, p_billcode, p_payment_url, p_amount);
end; $$;

create or replace function public.mark_toyyibpay_attempt_superseded(p_attempt_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_module_access_level('invoices', 'edit') then raise exception 'not_authorized' using errcode = 'P0001'; end if;
  return public.mark_toyyibpay_attempt_superseded_unguarded(p_attempt_id);
end; $$;

create or replace function public.get_active_toyyibpay_attempt(p_invoice_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_module_access_level('invoices', 'edit') then raise exception 'not_authorized' using errcode = 'P0001'; end if;
  return public.get_active_toyyibpay_attempt_unguarded(p_invoice_id);
end; $$;

create or replace function public.log_toyyibpay_conflict(p_invoice_id uuid, p_attempt_id uuid, p_conflict_type text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_module_access_level('invoices', 'edit') then raise exception 'not_authorized' using errcode = 'P0001'; end if;
  return public.log_toyyibpay_conflict_unguarded(p_invoice_id, p_attempt_id, p_conflict_type);
end; $$;

create or replace function public.record_hrdf_payment(p_claim_id uuid, p_amount numeric, p_payment_provider text,
  p_payment_method text, p_payment_date date, p_payment_reference text, p_notes text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not (public.has_module_access_level('invoices', 'edit') and public.has_module_access_level('hrdf_claims', 'edit')) then
    raise exception 'not_authorized' using errcode = 'P0001';
  end if;
  return public.record_hrdf_payment_unguarded(p_claim_id, p_amount, p_payment_provider, p_payment_method, p_payment_date, p_payment_reference, p_notes);
end; $$;

create or replace function public.transition_hrdf_claim(p_claim_id uuid, p_to_status text, p_payload jsonb default '{}'::jsonb)
returns public.hrdf_claims language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_module_access_level('hrdf_claims', 'edit') then raise exception 'not_authorized' using errcode = 'P0001'; end if;
  return public.transition_hrdf_claim_unguarded(p_claim_id, p_to_status, p_payload);
end; $$;

do $ms7w$
declare s text;
begin
  foreach s in array array[
    'public.record_manual_payment(uuid,text,text,numeric,date,text,text)', 'public.generate_receipt_for_payment(uuid)',
    'public.record_toyyibpay_bill(uuid,uuid,text,text,numeric)', 'public.mark_toyyibpay_attempt_superseded(uuid)',
    'public.get_active_toyyibpay_attempt(uuid)', 'public.log_toyyibpay_conflict(uuid,uuid,text)',
    'public.record_hrdf_payment(uuid,numeric,text,text,date,text,text)', 'public.transition_hrdf_claim(uuid,text,jsonb)']
  loop
    execute format('alter function %s owner to postgres', s);
    execute format('revoke all on function %s from public, anon, service_role', s);
    execute format('grant execute on function %s to authenticated', s);
  end loop;
end;
$ms7w$;

-- Postconditions (the Group B entries re-assert M1's state; they are not changed here).
do $ms7p$
declare s text;
begin
  foreach s in array array[
    'public.record_manual_payment_unguarded(uuid,text,text,numeric,date,text,text)', 'public.generate_receipt_for_payment_unguarded(uuid)',
    'public.record_toyyibpay_bill_unguarded(uuid,uuid,text,text,numeric)', 'public.mark_toyyibpay_attempt_superseded_unguarded(uuid)',
    'public.get_active_toyyibpay_attempt_unguarded(uuid)', 'public.log_toyyibpay_conflict_unguarded(uuid,uuid,text)',
    'public.record_hrdf_payment_unguarded(uuid,numeric,text,text,date,text,text)', 'public.transition_hrdf_claim_unguarded(uuid,text,jsonb)',
    'public.finalize_toyyibpay_payment(uuid,numeric,text,jsonb,timestamp with time zone,timestamp with time zone)',
    'public.mark_toyyibpay_attempt_failed(uuid,text,timestamp with time zone)', 'public.reverse_won_opportunity(uuid,text)']
  loop
    if has_function_privilege('authenticated', s, 'EXECUTE') or has_function_privilege('anon', s, 'EXECUTE')
       or has_function_privilege('service_role', s, 'EXECUTE') then
      raise exception 'ms7_postcondition_failed: % is still client-callable', s using errcode = 'P0001';
    end if;
  end loop;
  foreach s in array array[
    'public.record_manual_payment(uuid,text,text,numeric,date,text,text)', 'public.generate_receipt_for_payment(uuid)',
    'public.record_toyyibpay_bill(uuid,uuid,text,text,numeric)', 'public.mark_toyyibpay_attempt_superseded(uuid)',
    'public.get_active_toyyibpay_attempt(uuid)', 'public.log_toyyibpay_conflict(uuid,uuid,text)',
    'public.record_hrdf_payment(uuid,numeric,text,text,date,text,text)', 'public.transition_hrdf_claim(uuid,text,jsonb)']
  loop
    if not has_function_privilege('authenticated', s, 'EXECUTE') or has_function_privilege('anon', s, 'EXECUTE')
       or position('has_module_access_level' in (select prosrc from pg_proc where oid = to_regprocedure(s))) = 0 then
      raise exception 'ms7_postcondition_failed: wrapper % is not as intended', s using errcode = 'P0001';
    end if;
  end loop;
  -- Callbacks and PKG-1 untouched.
  if has_function_privilege('authenticated', 'public.finalize_toyyibpay_payment_from_callback(uuid,text,numeric,text,timestamp with time zone,timestamp with time zone,jsonb)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.finalize_toyyibpay_payment_from_callback(uuid,text,numeric,text,timestamp with time zone,timestamp with time zone,jsonb)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.mark_toyyibpay_attempt_failed_from_callback(uuid,text,timestamp with time zone,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.create_public_registration(uuid,text,text,jsonb)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.create_public_registration(uuid,text,text,jsonb)', 'EXECUTE') then
    raise exception 'ms7_postcondition_failed: callback or PKG-1 privileges changed' using errcode = 'P0001';
  end if;
end;
$ms7p$;
