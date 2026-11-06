-- ============================================================================
-- DRAFT -- NOT APPLIED -- NOT IN THE ACTIVE MIGRATION CHAIN.
-- Grant hardening for the canonical staging project (eokiaehnvzbggmacifcf): bring EXECUTE grants on the
-- application's SECURITY DEFINER functions back to the production-shaped profile (Baseline V3 and the baseline
-- staging project pzgtyskhyhuxhzvyzzhe).
--
-- WHY. Supabase's default privileges grant EXECUTE to anon (and authenticated, service_role) whenever postgres creates
-- a function in schema public, and `revoke ... from public` does not remove those separate grants (see
-- 20260814180000_revoke_anon_execute_sales_phase2_rpcs.sql). Read-only inspection on 2026-11-04 found 69 SECURITY DEFINER
-- functions in public/app executable by anon on the canonical project against 11 intended-public ones on the baseline
-- project. Among them: the ToyyibPay payment callbacks and the audit/delivery writers, which rely on grants alone
-- (no caller check in their bodies) and are called only through the service-role client in the application.
--
-- WHAT IT DOES (REVOKE only, plus grants that preserve access a role already effectively has):
--   1. anon: revoke EXECUTE from every SECURITY DEFINER function in public/app owned by postgres, except the 11
--      intended-public functions listed in v_keep_anon.
--   2. authenticated: revoke EXECUTE from the service-only callback/logging functions in v_service_only (the application
--      calls them with createSupabaseServiceClient(); production-shaped schemas grant them to service_role only).
--   3. app.* trigger/sequence helpers get no client privileges; app.is_admin_or_trainer() keeps authenticated if it can run it.
--   4. FUTURE functions: ALTER DEFAULT PRIVILEGES for role postgres in schema public no longer grants EXECUTE to anon.
--      That removes the trap documented in 20260814180000: the repo's standard `revoke all on function ... from public`
--      is now sufficient to keep a new public function away from anon (before, anon kept its own default grant). It does
--      NOT remove PostgreSQL's built-in PUBLIC default, which is a global default and deliberately left alone (changing
--      it would also affect functions installed by extensions). So every migration that creates a function must still
--      `revoke all on function ... from public`, and the public website's functions must `grant execute ... to anon` on
--      purpose. authenticated and service_role defaults are unchanged. New functions in schema app also default to PUBLIC.
--
-- GRANTS. No role gains EFFECTIVE access. Where a function is also granted to PUBLIC, authenticated and service_role first
-- receive explicit grants equal to the access they effectively have at that moment, and only then is PUBLIC revoked
-- (their direct grant replaces inheritance; the set of roles that can run the function does not grow). On the canonical
-- project no public-schema function is granted to PUBLIC, so that branch does not fire there.
-- service_role and postgres are never revoked. Triggers and definer-to-definer calls are unaffected (EXECUTE is
-- checked when a trigger is created, and a definer function runs as its owner).
--
-- SCOPE. Only SECURITY DEFINER functions owned by postgres in schemas public and app. On the canonical project no
-- SECURITY DEFINER function with another owner is anon-executable. 17 SECURITY INVOKER functions (trigger guards and
-- pure helpers such as module_access_rank, set_updated_at) are anon-executable there too; they run with the caller's own
-- rights and give anon nothing extra, so they are left for a separate review together with table/view/storage grants.
--
-- DELIBERATELY NOT CHANGED (owner decision / separate finding):
--   * public.log_event and app.log_event. Production-shaped schemas grant public.log_event to service_role only, but the
--     admin actions call it with the signed-in user's client (export/import/feedback/assessor audit lines). Revoking it
--     here would silently stop those audit lines on the canonical project; on production-shaped schemas they may already
--     be failing silently. This needs its own decision.
--   * Functions that are not SECURITY DEFINER, or are owned by another role.
--   * Authenticated grants on staff RPCs (accept_quotation, issue_invoice, ...): they are meant for signed-in admins and
--     check app.is_admin() inside.
--
-- SAFETY. Idempotent: a second run finds nothing to revoke. It aborts, rolling everything back, if (a) it is not run as
-- postgres, (b) a listed function is missing, is not owned by postgres / SECURITY DEFINER, or has more than one overload
-- (the lists are name based and every overload of a listed name is treated alike, so an overload must be reviewed first),
-- (c) it would revoke from more than 70 functions for anon, more than the service-only count for authenticated or more
-- than 6 app helpers (expected on the canonical project: 53 / 14 / 5; a hardened database changes 0), (d) an
-- intended-public function is not anon-executable at the end, (e) any function this run did not deliberately change lost
-- authenticated or service_role access, (f) a service-only function is still open to authenticated or anon, (g) any
-- non-listed SECURITY DEFINER function is still executable by anon, or (h) the default privileges still grant anon.
--
-- BEFORE RUNNING (staging only): capture the current ACLs so a repair can restore them, e.g.
--   select p.oid::regprocedure::text, p.proacl::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname in ('public','app') order by 1;
-- Rollback is forward repair only: re-GRANT the specific EXECUTE privileges from that capture in a new migration.
-- Run as ONE transaction as role postgres (for example `psql -1 -v ON_ERROR_STOP=1 -f`).
-- ============================================================================

do $$
declare
  -- Functions the public website calls with the anon key (pages, API routes, lib/public-content.ts, lib/rate-limit.js).
  -- STALE ENTRY: check_public_rate_limit is no longer anon-callable after migration 20261106120000 (PR-2b). Move it to
  -- v_service_only (and update the matching test counts) before this draft is ever run, or the post-check below will fail.
  v_keep_anon constant text[] := array[
    'begin_public_registration_payment', 'check_public_rate_limit', 'create_public_registration',
    'feedback_get_by_token', 'feedback_submit', 'get_public_registration_schedule',
    'get_public_registration_status', 'get_public_upcoming_schedules', 'submit_proposal_request',
    'submit_public_enquiry', 'verify_and_log'
  ];
  -- Called only with the service-role client in this application; production-shaped grants are service_role only.
  v_service_only constant text[] := array[
    'attach_public_registration_toyy_pay_bill', 'expire_public_registrations',
    'fail_public_registration_payment_setup', 'finalize_public_registration_payment_from_callback',
    'finalize_toyyibpay_payment_from_callback', 'log_event_as_service', 'log_public_registration_payment_event',
    'log_toyyibpay_callback_event', 'mark_proposal_delivery_status',
    'mark_public_registration_payment_failed_from_callback', 'mark_toyyibpay_attempt_failed_from_callback',
    'record_public_registration_payment_orphan', 'recover_public_registration_payment_claim',
    'resolve_schedule_feedback_participant'
  ];
  -- app.* helpers nobody but the owner needs (triggers, a column default used only inside definer RPCs).
  v_app_owner_only constant text[] := array[
    'audit_trigger', 'create_sales_lead_metadata', 'next_opportunity_number', 'hrdf_claim_touch_updated_at'
  ];
  r record;
  v_count integer := 0;
  v_anon_revoked integer := 0;
  v_auth_revoked integer := 0;
  v_owner_only integer := 0;
  v_bad text;
  v_max_auth constant integer := cardinality(v_service_only);
begin
  if current_user <> 'postgres' then
    raise exception 'grant_hardening_precondition_failed: run as role postgres, not %', current_user using errcode = 'P0001';
  end if;
  if exists (select 1 from unnest(array['anon', 'authenticated', 'service_role']) as x(role_name) where not exists (select 1 from pg_roles where rolname = x.role_name)) then
    raise exception 'grant_hardening_precondition_failed: anon/authenticated/service_role roles are missing' using errcode = 'P0001';
  end if;

  -- (b) every listed name must resolve to exactly ONE function in schema public of any kind, and that one must be a
  -- SECURITY DEFINER function owned by postgres: an overload of another owner or of SECURITY INVOKER kind is refused too.
  select string_agg(l.name || ' (' || l.cnt_all || ' with this name, ' || l.cnt_ok || ' postgres-owned SECURITY DEFINER)', ', ') into v_bad
  from (
    select x.name,
           (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = x.name) as cnt_all,
           (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = x.name and p.prokind = 'f' and p.prosecdef and p.proowner = 'postgres'::regrole) as cnt_ok
    from unnest(v_keep_anon || v_service_only) as x(name)
  ) l
  where l.cnt_all <> 1 or l.cnt_ok <> 1;
  if v_bad is not null then
    raise exception 'grant_hardening_precondition_failed: listed function(s) missing or overloaded (expected exactly one postgres-owned SECURITY DEFINER each): %', v_bad using errcode = 'P0001';
  end if;
  if exists (select 1 from unnest(v_keep_anon) k join unnest(v_service_only) s2 on s2 = k) then
    raise exception 'grant_hardening_precondition_failed: a function is on both the keep list and the service-only list' using errcode = 'P0001';
  end if;

  -- Snapshot of who could execute what BEFORE the change, to prove nothing else is lost.
  drop table if exists pg_temp._acl_before;
  create temporary table _acl_before as
  select p.oid as fn_oid, n.nspname, p.proname,
         has_function_privilege('authenticated', p.oid, 'execute') as auth_exec,
         has_function_privilege('service_role', p.oid, 'execute') as svc_exec,
         has_function_privilege('anon', p.oid, 'execute') as anon_exec
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'app') and p.prokind = 'f' and p.prosecdef and p.proowner = 'postgres'::regrole;

  create temporary table _acl_changed (fn_oid oid primary key, kind text not null, sig text not null);

  -- 1. anon: explicit grants on public.* (Supabase default privileges).
  for r in
    select p.oid, p.oid::regprocedure as sig,
           exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0 and a.privilege_type = 'EXECUTE') as via_public,
           has_function_privilege('authenticated', p.oid, 'execute') as auth_now,
           has_function_privilege('service_role', p.oid, 'execute') as svc_now
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f' and p.prosecdef and p.proowner = 'postgres'::regrole
      and not (p.proname = any (v_keep_anon))
      and has_function_privilege('anon', p.oid, 'execute')
    order by p.oid::regprocedure::text
  loop
    execute format('revoke execute on function %s from anon', r.sig);
    v_anon_revoked := v_anon_revoked + 1;
    insert into _acl_changed values (r.oid, 'anon', r.sig::text);
    raise notice 'grant hardening: anon revoked on %', r.sig;
    -- A function that is also granted to PUBLIC keeps anon reachable through PUBLIC. Removing PUBLIC would also remove
    -- whatever authenticated / service_role only had through it, so give them that access explicitly first.
    if r.via_public then
      if r.auth_now then execute format('grant execute on function %s to authenticated', r.sig); end if;
      if r.svc_now then execute format('grant execute on function %s to service_role', r.sig); end if;
      execute format('revoke execute on function %s from public', r.sig);
    end if;
  end loop;

  -- 2. authenticated: the service-only functions.
  for r in
    select p.oid, p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f' and p.prosecdef and p.proowner = 'postgres'::regrole
      and p.proname = any (v_service_only)
      and has_function_privilege('authenticated', p.oid, 'execute')
    order by p.oid::regprocedure::text
  loop
    execute format('revoke execute on function %s from authenticated', r.sig);
    v_auth_revoked := v_auth_revoked + 1;
    insert into _acl_changed values (r.oid, 'authenticated', r.sig::text) on conflict (fn_oid) do update set kind = 'anon+authenticated';
    raise notice 'grant hardening: authenticated revoked on %', r.sig;
  end loop;

  -- 3. app.* helpers. They default to PUBLIC EXECUTE (no default privileges in schema app).
  for r in
    select p.oid, p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and p.prokind = 'f' and p.prosecdef and p.proowner = 'postgres'::regrole
      and p.proname = any (v_app_owner_only)
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.sig);
    v_owner_only := v_owner_only + 1;
    insert into _acl_changed values (r.oid, 'app_helper', r.sig::text) on conflict (fn_oid) do nothing;
    raise notice 'grant hardening: made owner-only %', r.sig;
  end loop;
  for r in
    select p.oid, p.oid::regprocedure as sig, has_function_privilege('authenticated', p.oid, 'execute') as auth_now
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and p.proname = 'is_admin_or_trainer' and p.prosecdef and p.proowner = 'postgres'::regrole
  loop
    -- Keep signed-in access that exists today (as an explicit grant, since PUBLIC is about to be removed). A role that
    -- could not run it before does not gain it.
    if r.auth_now then
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
    execute format('revoke execute on function %s from public, anon', r.sig);
    v_owner_only := v_owner_only + 1;
    insert into _acl_changed values (r.oid, 'app_helper', r.sig::text) on conflict (fn_oid) do nothing;
    raise notice 'grant hardening: closed to public/anon, authenticated kept: %', r.sig;
  end loop;

  -- 4. Future functions created by postgres: remove explicit anon default entries. The schema-level revoke affects only
  -- new functions in public (the Supabase default privilege). The global revoke removes a global anon entry if one exists,
  -- and so affects new functions created by postgres in EVERY schema (on the canonical project there is no global entry,
  -- so it changes nothing there). Neither touches existing functions, the built-in PUBLIC default, schema-level entries
  -- for other schemas (e.g. storage), or the authenticated/service_role defaults.
  alter default privileges for role postgres in schema public revoke execute on functions from anon;
  -- A GLOBAL (all schemas) explicit anon entry would survive the schema-level revoke, so remove that too. Revoking an entry
  -- that is not there changes nothing; PostgreSQL's built-in PUBLIC default is not an anon entry and is not affected.
  alter default privileges for role postgres revoke execute on functions from anon;

  v_count := v_anon_revoked + v_auth_revoked + v_owner_only;
  -- Expected on the canonical project: 53 / 14 / 5. A larger number means the database is not what this file was written
  -- for; roll back and inspect instead of applying it.
  if v_anon_revoked > 70 or v_auth_revoked > v_max_auth or v_owner_only > 6 then
    raise exception 'grant_hardening_aborted: unexpectedly many changes (anon %, authenticated %, app helpers %); caps are 70 / % / 6', v_anon_revoked, v_auth_revoked, v_owner_only, v_max_auth using errcode = 'P0001';
  end if;

  -- Post-conditions ---------------------------------------------------------------------------------------
  -- (c) every intended-public function that exists must be anon-executable at the end, whether it lost the access in this
  -- run or was already closed: finishing with a public endpoint unreachable is a failure, not a warning.
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = any (v_keep_anon) and p.prosecdef and p.proowner = 'postgres'::regrole
    and not has_function_privilege('anon', p.oid, 'execute');
  if v_bad is not null then
    raise exception 'grant_hardening_aborted: intended-public function(s) not executable by anon: %', v_bad using errcode = 'P0001';
  end if;

  -- (d) nothing outside the explicit lists lost authenticated/service_role access. The app.* helpers are the one exception:
  -- they only had the built-in PUBLIC grant, so removing PUBLIC also removes service_role's access to trigger and
  -- sequence helpers that no backend code calls directly (production-shaped schemas have them owner-only too).
  select string_agg(b.nspname || '.' || b.proname, ', ') into v_bad
  from _acl_before b
  where not exists (select 1 from _acl_changed c where c.fn_oid = b.fn_oid and c.kind in ('app_helper', 'anon+authenticated', 'authenticated'))
    and (
      (b.auth_exec and not has_function_privilege('authenticated', b.fn_oid, 'execute'))
      or (b.svc_exec and not has_function_privilege('service_role', b.fn_oid, 'execute'))
    );
  if v_bad is null and exists (
    select 1 from _acl_before b where b.nspname = 'app' and b.proname = 'is_admin_or_trainer' and b.auth_exec
      and not has_function_privilege('authenticated', b.fn_oid, 'execute')
  ) then
    v_bad := 'app.is_admin_or_trainer';
  end if;
  if v_bad is not null then
    raise exception 'grant_hardening_aborted: unexpected loss of authenticated/service_role access: %', v_bad using errcode = 'P0001';
  end if;

  -- service-only functions still executable by service_role (the application's callback path).
  select string_agg(p.proname, ', ') into v_bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = any (v_service_only) and p.prosecdef and p.proowner = 'postgres'::regrole
    and not has_function_privilege('service_role', p.oid, 'execute');
  if v_bad is not null then
    raise exception 'grant_hardening_aborted: service-only function(s) not executable by service_role: %', v_bad using errcode = 'P0001';
  end if;

  -- (f) every service-only function is closed to authenticated and anon, whatever it was before.
  select string_agg(p.proname, ', ') into v_bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = any (v_service_only) and p.prosecdef and p.proowner = 'postgres'::regrole
    and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'));
  if v_bad is not null then
    raise exception 'grant_hardening_aborted: service-only function(s) still open to clients: %', v_bad using errcode = 'P0001';
  end if;

  -- (e) no non-listed SECURITY DEFINER function is left executable by anon.
  select string_agg(n.nspname || '.' || p.proname, ', ') into v_bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'app') and p.prokind = 'f' and p.prosecdef and p.proowner = 'postgres'::regrole
    and not (n.nspname = 'public' and p.proname = any (v_keep_anon))
    and has_function_privilege('anon', p.oid, 'execute');
  if v_bad is not null then
    raise exception 'grant_hardening_aborted: still executable by anon: %', v_bad using errcode = 'P0001';
  end if;

  -- (h) no default privilege entry (schema-level for public, or global) grants EXECUTE on functions that postgres creates
  -- to anon.
  if exists (
    select 1 from pg_default_acl d
    where d.defaclrole = 'postgres'::regrole and d.defaclobjtype = 'f'
      and (d.defaclnamespace = 0 or d.defaclnamespace = 'public'::regnamespace)
      and exists (select 1 from aclexplode(d.defaclacl) a where a.grantee = 'anon'::regrole and a.privilege_type = 'EXECUTE')
  ) then
    raise exception 'grant_hardening_aborted: default privileges still grant EXECUTE on new functions to anon' using errcode = 'P0001';
  end if;

  drop table if exists pg_temp._acl_before;
  drop table if exists pg_temp._acl_changed;

  raise notice 'grant hardening: anon revoked on % function(s), authenticated revoked on % service-only function(s), % app helper(s) enforced (matched functions %)',
    v_anon_revoked, v_auth_revoked, v_owner_only, v_count;
end;
$$;
