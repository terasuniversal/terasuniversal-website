-- RBAC M-01 (H1, D-01): no client role may call the two public-registration payment finalisation RPCs directly.
-- Finding (read-only, Production 2026-11-24): public.verify_public_registration_manual_payment(...) and
-- public.finalize_public_registration_crm(uuid) are SECURITY DEFINER, owned by postgres, and EXECUTE-able by
-- authenticated. Inside, they only require app.is_admin(), so any departmental admin could mark a registration paid
-- (given its secret) or create CRM records for it through a direct RPC call. No application code calls either function.
--
-- Change: REVOKE EXECUTE ... FROM authenticated (and, defensively, PUBLIC/anon). Nothing else.
--   * Bodies, owner, SECURITY DEFINER and search_path are untouched (no DROP/CREATE: Supabase default privileges would
--     re-grant EXECUTE on a re-created function).
--   * service_role keeps EXECUTE (server-side ToyyibPay route and any future Finance verification route).
--   * The ToyyibPay callback path is unaffected: service_role -> finalize_public_registration_payment_from_callback
--     (SECURITY DEFINER, owner postgres) -> finalize_public_registration_crm runs as the function owner, which keeps
--     EXECUTE; verify_* -> finalize_* likewise.
--
-- Fail-closed: aborts unless both functions exist with the reviewed owner, SECURITY DEFINER flag and grantee set.
-- Rollback: docs/security/crm-rbac/20261201100000_rbac_m01_h1_revoke_registration_payment_rpcs.rollback.sql
-- Approval: OWNER-CRM-RBAC-DEV-20261124 (local development; not applied anywhere).

set local lock_timeout = '5s';

do $m01_pre$
declare
  s text;
begin
  foreach s in array array[
    'public.verify_public_registration_manual_payment(text,text,numeric,text,text,uuid)',
    'public.finalize_public_registration_crm(uuid)']
  loop
    if to_regprocedure(s) is null then
      raise exception 'm01_precondition_failed: % does not exist - nothing changed', s using errcode = 'P0001';
    end if;
    if not (select p.prosecdef and pg_get_userbyid(p.proowner) = 'postgres' from pg_proc p where p.oid = to_regprocedure(s)) then
      raise exception 'm01_precondition_failed: % is not SECURITY DEFINER owned by postgres - nothing changed', s using errcode = 'P0001';
    end if;
    if not has_function_privilege('authenticated', s, 'EXECUTE') or not has_function_privilege('service_role', s, 'EXECUTE')
       or has_function_privilege('anon', s, 'EXECUTE') then
      raise exception 'm01_precondition_failed: % grantees are not the reviewed pre-state - nothing changed', s using errcode = 'P0001';
    end if;
  end loop;
end;
$m01_pre$;

revoke execute on function public.verify_public_registration_manual_payment(text, text, numeric, text, text, uuid) from public, anon, authenticated;
revoke execute on function public.finalize_public_registration_crm(uuid) from public, anon, authenticated;

do $m01_post$
declare
  s text;
begin
  foreach s in array array[
    'public.verify_public_registration_manual_payment(text,text,numeric,text,text,uuid)',
    'public.finalize_public_registration_crm(uuid)']
  loop
    if has_function_privilege('authenticated', s, 'EXECUTE') or has_function_privilege('anon', s, 'EXECUTE')
       or not has_function_privilege('service_role', s, 'EXECUTE') then
      raise exception 'm01_postcondition_failed: % privileges are not as intended', s using errcode = 'P0001';
    end if;
  end loop;
  -- The callback wrapper and the public registration entry points are untouched.
  if has_function_privilege('authenticated', 'public.finalize_public_registration_payment_from_callback(uuid,text,numeric,text,timestamp with time zone,jsonb)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.finalize_public_registration_payment_from_callback(uuid,text,numeric,text,timestamp with time zone,jsonb)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.create_public_registration(uuid,text,text,jsonb)', 'EXECUTE') then
    raise exception 'm01_postcondition_failed: callback or registration entry-point privileges changed' using errcode = 'P0001';
  end if;
end;
$m01_post$;
