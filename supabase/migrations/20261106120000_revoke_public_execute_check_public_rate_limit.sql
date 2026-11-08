-- Withdraw public EXECUTE from the shared rate-limit RPC (PR-2b).
--
-- Why: public.check_public_rate_limit(text, integer, integer) was executable by anon and authenticated because the
-- limiter used to call it with the publishable key. Anyone holding that (public) key could therefore drive arbitrary
-- rate-limit keys, e.g. exhaust the bucket of a known ToyyibPay order id or fill public_rate_limits. Since PR #220 the
-- application calls it only through the server-side service-role client behind the Preview isolation guards, so the
-- only legitimate caller is service_role.
--
-- Scope: privileges on this one function only. No function body, signature, SECURITY DEFINER or search_path change,
-- no table, policy, data or default-privilege change, and no DROP/CREATE (a re-created function could inherit default
-- ACLs; the Custom Staging project still carries broader default privileges than Production).
--
-- Deployment order: PR #220 must already be live (verified). Idempotent: re-running leaves the same ACL.
--
-- Rollback is forward repair only: a new migration that re-grants EXECUTE to the role(s) captured before this runs.
-- Doing so restores the public exposure, so only do it for a proven legitimate caller.

do $$
declare
  v_fn constant regprocedure := to_regprocedure('public.check_public_rate_limit(text,integer,integer)');
  v_overloads integer;
begin
  if v_fn is null then
    raise exception 'pr2b_precondition_failed: public.check_public_rate_limit(text,integer,integer) is missing' using errcode = 'P0001';
  end if;
  select count(*) into v_overloads
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'check_public_rate_limit';
  if v_overloads <> 1 then
    raise exception 'pr2b_precondition_failed: expected exactly one check_public_rate_limit overload, found %', v_overloads using errcode = 'P0001';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role')
     or not exists (select 1 from pg_roles where rolname = 'anon')
     or not exists (select 1 from pg_roles where rolname = 'authenticated') then
    raise exception 'pr2b_precondition_failed: anon/authenticated/service_role roles are missing' using errcode = 'P0001';
  end if;
end $$;

revoke all on function public.check_public_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.check_public_rate_limit(text, integer, integer) to service_role;

do $$
declare
  v_fn constant regprocedure := 'public.check_public_rate_limit(text,integer,integer)'::regprocedure;
  v_public_grants integer;
  v_other_grants integer;
begin
  if not has_function_privilege('service_role', v_fn, 'execute') then
    raise exception 'pr2b_postcondition_failed: service_role lost EXECUTE' using errcode = 'P0001';
  end if;
  if has_function_privilege('anon', v_fn, 'execute') or has_function_privilege('authenticated', v_fn, 'execute') then
    raise exception 'pr2b_postcondition_failed: anon or authenticated can still execute' using errcode = 'P0001';
  end if;
  select count(*) into v_public_grants
  from pg_proc p, lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
  where p.oid = v_fn and a.grantee = 0;
  if v_public_grants <> 0 then
    raise exception 'pr2b_postcondition_failed: PUBLIC still holds a grant' using errcode = 'P0001';
  end if;
  -- No grantee may remain besides the function owner and service_role (a direct grant to any other role would survive
  -- the REVOKE above, which only names PUBLIC, anon and authenticated).
  select count(*) into v_other_grants
  from pg_proc p, lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
  where p.oid = v_fn and a.grantee <> p.proowner and a.grantee <> 'service_role'::regrole;
  if v_other_grants <> 0 then
    raise exception 'pr2b_postcondition_failed: % unexpected grantee(s) still hold a grant', v_other_grants using errcode = 'P0001';
  end if;
end $$;
