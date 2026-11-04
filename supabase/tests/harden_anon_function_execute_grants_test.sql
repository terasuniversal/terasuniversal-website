-- Behaviour test for the DRAFT grant-hardening migration
-- (supabase/post_baseline_drafts/20261104090000_harden_anon_function_execute_grants.sql).
-- DISPOSABLE DATABASE ONLY (it grants, revokes and inserts an auth.users fixture). Never run it against Staging or Production.
-- Run on a database built from Baseline V3 (the production-shaped grant profile), as role postgres:
--   psql -U postgres -v ON_ERROR_STOP=1 -q -v migration=/path/to/20261104090000_harden_anon_function_execute_grants.sql -f harden_anon_function_execute_grants_test.sql
-- Idea: record the production-shaped profile, simulate the canonical project's drift (the default-privilege grants to
-- anon/authenticated, PUBLIC on app.*), run the migration, and require the profile to come back exactly, except for
-- public.log_event which the migration deliberately leaves alone.

begin;

create temporary table _pristine as
select p.oid as fn_oid, n.nspname, p.proname, p.oid::regprocedure::text as sig,
       has_function_privilege('anon', p.oid, 'execute') as anon_exec,
       has_function_privilege('authenticated', p.oid, 'execute') as auth_exec,
       has_function_privilege('service_role', p.oid, 'execute') as svc_exec
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public', 'app') and p.prokind = 'f' and p.prosecdef and p.proowner = 'postgres'::regrole;

create function pg_temp.qa_assert(p_ok boolean, p_what text) returns void language plpgsql as $$
begin
  if p_ok is not true then raise exception 'assertion_failed: %', p_what; end if;
end;
$$;

-- 0. The intended-public list is exactly what the production-shaped baseline lets anon execute.
do $$
declare
  v_expected text[] := array['begin_public_registration_payment', 'check_public_rate_limit', 'create_public_registration',
    'feedback_get_by_token', 'feedback_submit', 'get_public_registration_schedule', 'get_public_registration_status',
    'get_public_upcoming_schedules', 'submit_proposal_request', 'submit_public_enquiry', 'verify_and_log'];
  v_actual text[];
begin
  -- Baseline V3 (captured from production before the app.* helpers were tightened) still lets anon run a few app.* helpers
  -- through the built-in PUBLIC grant; the baseline staging project does not. Compare the public schema here and handle
  -- app.* explicitly below.
  select array_agg(proname order by proname) into v_actual from _pristine where anon_exec and nspname = 'public';
  -- The baseline also lets anon run three staff-only feedback functions (they check has_min_role inside); the hardened
  -- profile on the baseline staging project does not, and the migration removes them.
  perform pg_temp.qa_assert(v_actual = (select array_agg(x order by x) from unnest(v_expected || array['feedback_anonymous_stats', 'feedback_generate_links', 'feedback_reopen']) x),
    'baseline anon-executable public functions are the intended-public list plus three staff feedback functions, got ' || coalesce(array_to_string(v_actual, ','), '<none>'));
end $$;

-- 1. Simulate the canonical project: Supabase default privileges grant anon/authenticated/service_role on public
--    functions. The five app.* helpers it exposes to anon already carry the built-in PUBLIC grant in Baseline V3, so only
--    the public schema needs simulating (other app.* functions are not anon-executable on the canonical project).
do $$
declare
  r record;
  -- The public functions found anon-executable on the canonical project on 2026-11-04 (read-only inspection), plus the
  -- eleven intended-public ones. Functions that project already keeps closed are not touched, so the simulation matches it.
  v_drift constant text[] := array[
    'attach_public_registration_toyy_pay_bill', 'expire_public_registrations', 'fail_public_registration_payment_setup',
    'finalize_public_registration_payment_from_callback', 'log_public_registration_payment_event',
    'mark_public_registration_payment_failed_from_callback', 'record_public_registration_payment_orphan',
    'recover_public_registration_payment_claim', 'finalize_toyyibpay_payment_from_callback', 'log_event', 'log_event_as_service',
    'log_toyyibpay_callback_event', 'mark_lead_test', 'mark_proposal_delivery_status', 'mark_toyyibpay_attempt_failed_from_callback',
    'resolve_schedule_feedback_participant', 'accept_quotation', 'cancel_invoice', 'convert_lead_to_opportunity',
    'create_invoice_from_quotation', 'finalize_public_registration_crm', 'finalize_toyyibpay_payment', 'get_active_toyyibpay_attempt',
    'issue_invoice', 'legacy_course_map_approve', 'legacy_import_create_batch', 'legacy_import_ingest_rows', 'legacy_merge_dry_run',
    'legacy_merge_execute_row', 'legacy_merge_finalize_batch', 'legacy_merge_verify_checkpoint', 'log_toyyibpay_conflict',
    'log_toyyibpay_orphan_bill_event', 'mark_opportunity_lost', 'mark_toyyibpay_attempt_failed', 'mark_toyyibpay_attempt_superseded',
    'record_manual_payment', 'record_toyyibpay_bill', 'reject_quotation', 'reverse_won_opportunity',
    'verify_public_registration_manual_payment', 'feedback_anonymous_stats', 'feedback_generate_links', 'feedback_reopen',
    'get_my_module_access', 'has_module_access', 'promote_marketing_contact_to_sales', 'clear_password_change_flag',
    'has_module_access_level', 'set_must_change_password', 'set_schedule_assessor', 'set_staff_module_access', 'update_staff_profile'];
begin
  for r in select fn_oid::regprocedure as sig from _pristine where nspname = 'public' and proname = any (v_drift) loop
    execute format('grant execute on function %s to anon, authenticated, service_role', r.sig);
  end loop;
end $$;
select pg_temp.qa_assert((select count(*) from _pristine p where has_function_privilege('anon', p.fn_oid, 'execute')) > 60,
  'simulated drift exposes many functions to anon');

create temporary table _drifted as
select p.fn_oid, p.proname, p.nspname,
       has_function_privilege('anon', p.fn_oid, 'execute') as anon_exec,
       has_function_privilege('authenticated', p.fn_oid, 'execute') as auth_exec,
       has_function_privilege('service_role', p.fn_oid, 'execute') as svc_exec
from _pristine p;

-- A function whose only client access is the PUBLIC grant (no direct grants): removing PUBLIC must not lock authenticated
-- or service_role out of it, while anon loses it.
do $$
begin
  revoke execute on function public.issue_invoice(uuid) from anon, authenticated, service_role;
  grant execute on function public.issue_invoice(uuid) to public;
end $$;
select pg_temp.qa_assert(has_function_privilege('anon', 'public.issue_invoice(uuid)', 'execute') and has_function_privilege('authenticated', 'public.issue_invoice(uuid)', 'execute')
  and has_function_privilege('service_role', 'public.issue_invoice(uuid)', 'execute'), 'issue_invoice is reachable only through PUBLIC in the simulation');

-- Supabase's default privileges: every function postgres creates in public later is granted to anon too.
alter default privileges for role postgres in schema public grant execute on functions to anon, authenticated, service_role;
-- ... and a GLOBAL explicit anon default too, which a schema-level revoke alone could not remove.
alter default privileges for role postgres grant execute on functions to anon;

-- 2. Run the migration.
\i :migration

-- 3. The production-shaped profile is back, except public.log_event (left alone on purpose).
do $$
declare
  v_bad text;
begin
  select string_agg(p.sig, '; ') into v_bad
  from _pristine p
  where not (p.nspname = 'public' and p.proname = 'log_event')
    and not (p.nspname = 'app' and p.proname in ('audit_trigger', 'create_sales_lead_metadata', 'next_opportunity_number', 'hrdf_claim_touch_updated_at', 'is_admin_or_trainer'))
    and not (p.nspname = 'public' and p.proname in ('feedback_anonymous_stats', 'feedback_generate_links', 'feedback_reopen'))
    and (has_function_privilege('anon', p.fn_oid, 'execute') is distinct from p.anon_exec
      or has_function_privilege('authenticated', p.fn_oid, 'execute') is distinct from p.auth_exec
      or has_function_privilege('service_role', p.fn_oid, 'execute') is distinct from p.svc_exec);
  perform pg_temp.qa_assert(v_bad is null, 'grant profile restored for every function, differences: ' || coalesce(v_bad, ''));

  perform pg_temp.qa_assert(not exists (select 1 from _pristine p where p.nspname = 'public' and p.proname in ('feedback_anonymous_stats', 'feedback_generate_links', 'feedback_reopen')
      and (has_function_privilege('anon', p.fn_oid, 'execute') or not has_function_privilege('authenticated', p.fn_oid, 'execute'))), 'staff feedback functions: anon removed, authenticated kept');
  perform pg_temp.qa_assert(not has_function_privilege('anon', 'public.log_event(public.audit_action,text,text,text,jsonb)', 'execute'), 'log_event is no longer anon-executable');
  perform pg_temp.qa_assert(has_function_privilege('authenticated', 'public.log_event(public.audit_action,text,text,text,jsonb)', 'execute'), 'log_event keeps authenticated (admin actions call it with the user session)');
  perform pg_temp.qa_assert(has_function_privilege('service_role', 'public.log_event(public.audit_action,text,text,text,jsonb)', 'execute'), 'log_event keeps service_role');

  perform pg_temp.qa_assert(not has_function_privilege('anon', 'public.issue_invoice(uuid)', 'execute') and not has_function_privilege('public', 'public.issue_invoice(uuid)', 'execute')
    and has_function_privilege('authenticated', 'public.issue_invoice(uuid)', 'execute') and has_function_privilege('service_role', 'public.issue_invoice(uuid)', 'execute'),
    'a PUBLIC-only function keeps authenticated and service_role through explicit grants once PUBLIC is removed');

  -- Spot checks that matter to the application.
  perform pg_temp.qa_assert(has_function_privilege('authenticated', 'public.accept_quotation(uuid)', 'execute') and not has_function_privilege('anon', 'public.accept_quotation(uuid)', 'execute'), 'staff RPC: authenticated yes, anon no');
  perform pg_temp.qa_assert(has_function_privilege('service_role', 'public.finalize_toyyibpay_payment_from_callback(uuid,text,numeric,text,timestamptz,timestamptz,jsonb)', 'execute')
    and not has_function_privilege('authenticated', 'public.finalize_toyyibpay_payment_from_callback(uuid,text,numeric,text,timestamptz,timestamptz,jsonb)', 'execute')
    and not has_function_privilege('anon', 'public.finalize_toyyibpay_payment_from_callback(uuid,text,numeric,text,timestamptz,timestamptz,jsonb)', 'execute'), 'payment callback: service_role only');
  perform pg_temp.qa_assert(has_function_privilege('authenticated', 'app.is_admin_or_trainer()', 'execute') and not has_function_privilege('anon', 'app.is_admin_or_trainer()', 'execute')
    and not has_function_privilege('public', 'app.is_admin_or_trainer()', 'execute'), 'app.is_admin_or_trainer: authenticated only');
  perform pg_temp.qa_assert(not exists (
    select 1 from _pristine p where p.nspname = 'app' and p.proname in ('audit_trigger', 'create_sales_lead_metadata', 'next_opportunity_number', 'hrdf_claim_touch_updated_at')
      and (has_function_privilege('anon', p.fn_oid, 'execute') or has_function_privilege('authenticated', p.fn_oid, 'execute') or has_function_privilege('public', p.fn_oid, 'execute'))),
    'app trigger/sequence helpers: owner only');
  -- is_admin_or_trainer: authenticated access is kept exactly when it existed before (Baseline V3: it did); never gained.
  perform pg_temp.qa_assert(not exists (select 1 from _pristine p where p.nspname = 'app' and p.proname = 'is_admin_or_trainer'
    and has_function_privilege('authenticated', p.fn_oid, 'execute') is distinct from p.auth_exec), 'is_admin_or_trainer: authenticated access equals what it had before');

  -- Future functions. The built-in PUBLIC default is global and untouched, so a function that skips the repo's standard
  -- `revoke all ... from public` is still reachable by anon through PUBLIC; what the migration fixes is that, WITH the
  -- standard revoke, anon no longer keeps its own default grant.
  create function public.qa_new_public_fn() returns integer language sql as 'select 1';
  perform pg_temp.qa_assert(has_function_privilege('authenticated', 'public.qa_new_public_fn()', 'execute') and has_function_privilege('service_role', 'public.qa_new_public_fn()', 'execute'), 'a NEW public function keeps the authenticated/service_role defaults');
  revoke all on function public.qa_new_public_fn() from public;
  perform pg_temp.qa_assert(not has_function_privilege('anon', 'public.qa_new_public_fn()', 'execute'), 'a NEW public function is NOT anon-executable after the standard revoke from public');
  perform pg_temp.qa_assert(has_function_privilege('authenticated', 'public.qa_new_public_fn()', 'execute') and has_function_privilege('service_role', 'public.qa_new_public_fn()', 'execute'), 'authenticated/service_role still hold their defaults after the standard revoke');
  perform pg_temp.qa_assert(not exists (select 1 from pg_default_acl d join pg_namespace n on n.oid = d.defaclnamespace, aclexplode(d.defaclacl) a
    where d.defaclrole = 'postgres'::regrole and n.nspname = 'public' and d.defaclobjtype = 'f' and a.grantee = 'anon'::regrole), 'default ACL no longer grants anon');
  perform pg_temp.qa_assert(not exists (select 1 from pg_default_acl d, aclexplode(d.defaclacl) a
    where d.defaclrole = 'postgres'::regrole and d.defaclnamespace = 0 and d.defaclobjtype = 'f' and a.grantee = 'anon'::regrole), 'the GLOBAL default ACL no longer grants anon either');
end $$;

-- 4. Idempotent: a second run changes nothing.
create temporary table _after_first as
select fn_oid, has_function_privilege('anon', fn_oid, 'execute') a, has_function_privilege('authenticated', fn_oid, 'execute') u, has_function_privilege('service_role', fn_oid, 'execute') s from _pristine;
\i :migration
select pg_temp.qa_assert(not exists (select 1 from _after_first f where has_function_privilege('anon', f.fn_oid, 'execute') is distinct from f.a
  or has_function_privilege('authenticated', f.fn_oid, 'execute') is distinct from f.u or has_function_privilege('service_role', f.fn_oid, 'execute') is distinct from f.s), 'second run changes nothing');

-- 5. The application's service-role path still works, and clients cannot reach the callback or logging writers.
insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at)
values ('aaaaaaaa-0000-0000-0000-0000000000a1', 'authenticated', 'authenticated', 'qa-grants@local.test', 'x', now()) on conflict (id) do nothing;
insert into public.profiles (id, email, full_name, role, is_active)
values ('aaaaaaaa-0000-0000-0000-0000000000a1', 'qa-grants@local.test', 'QA Grants Admin', 'super_admin', true) on conflict (id) do update set role = 'super_admin', is_active = true;

create function pg_temp.qa_err(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'NO_ERROR';
exception when others then
  return sqlstate || '|' || sqlerrm;
end;
$$;
grant execute on function pg_temp.qa_err(text) to public;

set local role service_role;
select pg_temp.qa_assert(pg_temp.qa_err('select public.log_toyyibpay_callback_event(gen_random_uuid(), ''invalid_hash'', ''{}''::jsonb)') = 'NO_ERROR',
  'service_role can still log a callback event (definer-to-definer call into log_event_as_service works)');
reset role;

set local role anon;
select pg_temp.qa_assert(pg_temp.qa_err('select public.log_toyyibpay_callback_event(gen_random_uuid(), ''invalid_hash'', ''{}''::jsonb)') like '42501|%', 'anon cannot log a callback event');
select pg_temp.qa_assert(pg_temp.qa_err('select public.log_event_as_service(null::uuid, null, ''update''::public.audit_action, ''x'', ''x'', ''x'', null)') like '42501|%', 'anon cannot write audit rows as a chosen actor');
select pg_temp.qa_assert(pg_temp.qa_err('select public.accept_quotation(gen_random_uuid())') like '42501|%', 'anon cannot call accept_quotation');
reset role;

set local role authenticated;
select pg_temp.qa_assert(pg_temp.qa_err('select public.log_toyyibpay_callback_event(gen_random_uuid(), ''invalid_hash'', ''{}''::jsonb)') like '42501|%', 'a signed-in user cannot log a callback event');
select pg_temp.qa_assert(pg_temp.qa_err('select public.finalize_toyyibpay_payment_from_callback(gen_random_uuid(), ''x'', 1, ''x'', now(), now(), ''{}''::jsonb)') like '42501|%', 'a signed-in user cannot finalize a payment from a callback');
select pg_temp.qa_assert(pg_temp.qa_err('select public.accept_quotation(gen_random_uuid())') not like '42501|permission denied%', 'a signed-in user still reaches the staff RPC (it then checks app.is_admin() itself)');
reset role;

rollback;
select 'harden_anon_function_execute_grants_test: PASS' as result;
