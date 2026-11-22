-- M-S7 stage M1: withdraw client EXECUTE from three SECURITY DEFINER finance/sales RPCs that no application
-- code calls (verified at main@e61c078 and on every remote branch, 2026-11-22):
--   public.finalize_toyyibpay_payment(uuid, numeric, text, jsonb, timestamptz, timestamptz)
--   public.mark_toyyibpay_attempt_failed(uuid, text, timestamptz)
--   public.reverse_won_opportunity(uuid, text)
-- Why: each is gated only by app.is_admin(), so any active Admin could call it directly through the Data API
-- regardless of module grants (Owner decision D1: invoice edits are super_admin only). finalize_toyyibpay_payment
-- does not check invoice status, so it would accept a pending attempt on a cancelled invoice.
-- The ToyyibPay callbacks use the separate *_from_callback functions (service_role only); they are not touched.
-- service_role loses EXECUTE as well: it never passed app.is_admin() (no auth.uid()), so no service flow changes.
-- Function bodies, owners and signatures are unchanged; only ACLs change. Re-running is safe (REVOKE is idempotent;
-- the preflight accepts both the original ACL and the already-revoked ACL). Recovery: this migration only removes
-- grants that no caller uses; do not re-grant without a separate Owner decision, because that reopens the gap.
do $m1_pre$
declare
  r record;
  v_cnt int;
  v_roles text[];
begin
  for r in
    select * from (values
      ('public.finalize_toyyibpay_payment(uuid,numeric,text,jsonb,timestamp with time zone,timestamp with time zone)', 'finalize_toyyibpay_payment', 'c9b3dc0a2f381f8fe1a5e7a9e28deb55'),
      ('public.mark_toyyibpay_attempt_failed(uuid,text,timestamp with time zone)', 'mark_toyyibpay_attempt_failed', '9809e8b549e2be8d2232b76cab437ac0'),
      ('public.reverse_won_opportunity(uuid,text)', 'reverse_won_opportunity', '91063e2921fd6d231e4d3771213a3db4')
    ) t(sig, fname, body_md5)
  loop
    if to_regprocedure(r.sig) is null then
      raise exception 'm1_pre: % not found', r.sig;
    end if;
    select count(*) into v_cnt from pg_proc p where p.proname = r.fname;
    if v_cnt <> 1 then
      raise exception 'm1_pre: % has % overloads (expected 1)', r.fname, v_cnt;
    end if;
    if not exists (
      select 1 from pg_proc p
      where p.oid = to_regprocedure(r.sig)
        and p.prosecdef
        and pg_get_userbyid(p.proowner) = 'postgres'
        and md5(p.prosrc) = r.body_md5
    ) then
      raise exception 'm1_pre: % drifted (security definer / owner / body md5)', r.sig;
    end if;
    -- Grantees must be exactly the original set or the already-revoked set; anything else is unreviewed drift.
    select coalesce(array_agg(distinct case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end
                              order by case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end), '{}')
      into v_roles
      from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      where p.oid = to_regprocedure(r.sig) and a.privilege_type = 'EXECUTE';
    if v_roles not in (array['authenticated', 'postgres', 'service_role'], array['postgres']) then
      raise exception 'm1_pre: % has unexpected EXECUTE grantees %', r.sig, v_roles;
    end if;
    if exists (select 1 from pg_trigger t where t.tgfoid = to_regprocedure(r.sig)) then
      raise exception 'm1_pre: % is used by a trigger', r.sig;
    end if;
  end loop;

  -- No SQL-level caller of the three functions (another function body that invokes them).
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname not in ('pg_catalog', 'information_schema')
      and p.proname not in ('finalize_toyyibpay_payment', 'mark_toyyibpay_attempt_failed', 'reverse_won_opportunity')
      and (p.prosrc ~ 'finalize_toyyibpay_payment\s*\(' or p.prosrc ~ 'mark_toyyibpay_attempt_failed\s*\(' or p.prosrc ~ 'reverse_won_opportunity\s*\(')
  ) then
    raise exception 'm1_pre: an internal SQL caller exists - review before revoking';
  end if;

  -- The callback finalizers this change must not affect: unchanged body, service_role only.
  if not exists (select 1 from pg_proc p where p.oid = to_regprocedure('public.finalize_toyyibpay_payment_from_callback(uuid,text,numeric,text,timestamp with time zone,timestamp with time zone,jsonb)') and md5(p.prosrc) = '78c36cd603dfa7c4f3d8d45a2d6d07a7')
     or not exists (select 1 from pg_proc p where p.oid = to_regprocedure('public.mark_toyyibpay_attempt_failed_from_callback(uuid,text,timestamp with time zone,text)') and md5(p.prosrc) = 'bec0303da090cf4c44fceca98d380fb9')
     or not has_function_privilege('service_role', 'public.finalize_toyyibpay_payment_from_callback(uuid,text,numeric,text,timestamp with time zone,timestamp with time zone,jsonb)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.mark_toyyibpay_attempt_failed_from_callback(uuid,text,timestamp with time zone,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.finalize_toyyibpay_payment_from_callback(uuid,text,numeric,text,timestamp with time zone,timestamp with time zone,jsonb)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.mark_toyyibpay_attempt_failed_from_callback(uuid,text,timestamp with time zone,text)', 'EXECUTE') then
    raise exception 'm1_pre: callback finalizers are not in the expected state';
  end if;
end;
$m1_pre$;

revoke all on function public.finalize_toyyibpay_payment(uuid, numeric, text, jsonb, timestamptz, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.mark_toyyibpay_attempt_failed(uuid, text, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.reverse_won_opportunity(uuid, text) from public, anon, authenticated, service_role;

do $m1_post$
declare
  r record;
  v_role text;
begin
  for r in
    select * from (values
      ('public.finalize_toyyibpay_payment(uuid,numeric,text,jsonb,timestamp with time zone,timestamp with time zone)', 'c9b3dc0a2f381f8fe1a5e7a9e28deb55'),
      ('public.mark_toyyibpay_attempt_failed(uuid,text,timestamp with time zone)', '9809e8b549e2be8d2232b76cab437ac0'),
      ('public.reverse_won_opportunity(uuid,text)', '91063e2921fd6d231e4d3771213a3db4')
    ) t(sig, body_md5)
  loop
    foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
      if has_function_privilege(v_role, r.sig, 'EXECUTE') then
        raise exception 'm1_post: % still executable by %', r.sig, v_role;
      end if;
    end loop;
    if not exists (
      select 1 from pg_proc p
      where p.oid = to_regprocedure(r.sig)
        and p.proacl::text = '{postgres=X/postgres}'
        and p.prosecdef
        and pg_get_userbyid(p.proowner) = 'postgres'
        and md5(p.prosrc) = r.body_md5
    ) then
      raise exception 'm1_post: % ACL / owner / body not as expected', r.sig;
    end if;
  end loop;

  if not has_function_privilege('service_role', 'public.finalize_toyyibpay_payment_from_callback(uuid,text,numeric,text,timestamp with time zone,timestamp with time zone,jsonb)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.mark_toyyibpay_attempt_failed_from_callback(uuid,text,timestamp with time zone,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.finalize_toyyibpay_payment_from_callback(uuid,text,numeric,text,timestamp with time zone,timestamp with time zone,jsonb)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.mark_toyyibpay_attempt_failed_from_callback(uuid,text,timestamp with time zone,text)', 'EXECUTE') then
    raise exception 'm1_post: callback finalizer privileges changed';
  end if;
end;
$m1_post$;
