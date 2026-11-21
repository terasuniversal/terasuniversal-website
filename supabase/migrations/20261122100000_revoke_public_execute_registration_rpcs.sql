-- Withdraw public EXECUTE from the two public registration write RPCs (PKG-1).
--
-- Why: public.create_public_registration(uuid, text, text, jsonb) and
-- public.begin_public_registration_payment(text, text, text) are SECURITY DEFINER and executable by anon and
-- authenticated. Public registration is switched off (F-1, TERAS_PUBLIC_REGISTRATION) only in the application routes,
-- which answer 503 before any database call; lib/public-registration-gate.ts documents that RPCs are deliberately not
-- gated. Anyone holding the publishable key could therefore call these RPCs directly and create registrations and
-- capacity holds for any eligible schedule while registration is meant to be off. Today no legitimate caller exists:
-- both routes are behind F-1, and Supabase API logs (13-21 Nov 2026) show zero calls to either RPC.
--
-- Scope: privileges on these two functions only. No body, signature, SECURITY DEFINER or search_path change, no table,
-- policy, data or default-privilege change, and no DROP/CREATE (a re-created function could inherit default ACLs).
-- The read RPCs get_public_registration_schedule and get_public_registration_status, and every ToyyibPay callback RPC,
-- are untouched.
--
-- Consequence: before public registration is switched on again (F-1 ON), the two routes must call these RPCs through
-- the server-only service-role client (PKG-1b). Until then nothing legitimate depends on anon/authenticated EXECUTE.
--
-- Idempotent: re-running leaves the same ACL. Rollback is forward repair only: a new migration that re-grants EXECUTE
-- to anon and authenticated. That restores the public exposure, so only do it for a proven legitimate caller.

do $$
declare
  v_create constant regprocedure := to_regprocedure('public.create_public_registration(uuid,text,text,jsonb)');
  v_begin constant regprocedure := to_regprocedure('public.begin_public_registration_payment(text,text,text)');
  v_overloads integer;
begin
  if v_create is null or v_begin is null then
    raise exception 'pkg1_precondition_failed: a registration RPC is missing' using errcode = 'P0001';
  end if;
  select count(*) into v_overloads
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in ('create_public_registration', 'begin_public_registration_payment');
  if v_overloads <> 2 then
    raise exception 'pkg1_precondition_failed: expected exactly one overload of each RPC, found %', v_overloads using errcode = 'P0001';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role')
     or not exists (select 1 from pg_roles where rolname = 'anon')
     or not exists (select 1 from pg_roles where rolname = 'authenticated') then
    raise exception 'pkg1_precondition_failed: anon/authenticated/service_role roles are missing' using errcode = 'P0001';
  end if;
end $$;

revoke all on function public.create_public_registration(uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.create_public_registration(uuid, text, text, jsonb) to service_role;

revoke all on function public.begin_public_registration_payment(text, text, text) from public, anon, authenticated;
grant execute on function public.begin_public_registration_payment(text, text, text) to service_role;

do $$
declare
  v_fn regprocedure;
  v_bad integer;
begin
  foreach v_fn in array array[
    'public.create_public_registration(uuid,text,text,jsonb)'::regprocedure,
    'public.begin_public_registration_payment(text,text,text)'::regprocedure
  ] loop
    if not has_function_privilege('service_role', v_fn, 'execute') then
      raise exception 'pkg1_postcondition_failed: service_role lost EXECUTE on %', v_fn using errcode = 'P0001';
    end if;
    if has_function_privilege('anon', v_fn, 'execute') or has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception 'pkg1_postcondition_failed: anon or authenticated can still execute %', v_fn using errcode = 'P0001';
    end if;
    -- No grantee may remain besides the owner (postgres) and service_role; PUBLIC (grantee 0) included.
    select count(*) into v_bad
    from pg_proc p, lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where p.oid = v_fn and a.privilege_type = 'EXECUTE'
      and a.grantee not in (p.proowner, 'service_role'::regrole);
    if v_bad <> 0 then
      raise exception 'pkg1_postcondition_failed: unexpected EXECUTE grantee on %', v_fn using errcode = 'P0001';
    end if;
  end loop;
end $$;
