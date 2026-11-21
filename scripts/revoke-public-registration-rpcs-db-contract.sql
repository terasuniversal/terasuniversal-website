-- Synthetic fixtures only. Executed by revoke-public-registration-rpcs-db-contract.mts against a disposable local
-- PostgreSQL that holds Baseline V3 + 20261106090000 + 20261122100000 (PKG-1). Never run elsewhere.
--
-- Permission is read ONLY from the SQLSTATE of each probe:
--   42501 = EXECUTE denied by the permission check (the function body never ran)
--   P0001 = the body ran and refused the input (a validation result, never evidence of a permission denial)
-- The anon/authenticated probes use a VALID input on an ELIGIBLE schedule, so the only reason they can fail is EXECUTE.

create temp table t_results (name text, ok boolean, detail text);
create function pg_temp.chk(p_name text, p_ok boolean, p_detail text default '') returns void
language sql as $$ insert into t_results values (p_name, coalesce(p_ok, false), p_detail) $$;

-- Runs p_sql as p_role inside a subtransaction; returns 'OK:<value>' or '<SQLSTATE>:<message>'. A failed probe rolls back
-- its subtransaction, so the role switch and any partial write are undone.
create function pg_temp.probe(p_role text, p_sql text) returns text
language plpgsql as $$
declare v_res text; v_state text; v_msg text;
begin
  begin
    execute format('set local role %I', p_role);
    execute p_sql into v_res;
    reset role;
    return 'OK:' || coalesce(v_res, '');
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
    return v_state || ':' || v_msg;
  end;
end $$;

create function pg_temp.secret(p_key text) returns text language sql as $$ select md5(p_key) || md5(p_key || 'x') $$;
create function pg_temp.create_sql(p_schedule uuid, p_key text) returns text language sql as $$
  select format('select public.create_public_registration(%L::uuid, %L, %L, %L::jsonb)::text',
    p_schedule, p_key, pg_temp.secret(p_key), '[{"full_name":"SYNTHETIC PKG1 Attendee","email":"pkg1@example.invalid"}]')
$$;
create function pg_temp.begin_sql(p_ref text, p_key text) returns text language sql as $$
  select format('select public.begin_public_registration_payment(%L, %L, %L)::text', p_ref, pg_temp.secret(p_key), 'toyyibpay')
$$;
create function pg_temp.state(p_result text) returns text language sql as $$ select split_part(p_result, ':', 1) $$;

-- ---- fixtures: one eligible schedule (published course, open, future, positive fee, capacity) -------------------
insert into public.courses (title, course_name, slug, status)
values ('SYNTHETIC PKG1 Course', 'SYNTHETIC PKG1 Course', 'synthetic-pkg1-course', 'published');
create temp table t_ctx (k text primary key, v text);
insert into public.course_schedules (course_id, start_date, end_date, status, is_published, capacity, fee)
select id, current_date + 30, current_date + 31, 'open'::public.schedule_status, true, 20, 1500
from public.courses where slug = 'synthetic-pkg1-course';
insert into t_ctx select 'schedule', id::text from public.course_schedules
where course_id = (select id from public.courses where slug = 'synthetic-pkg1-course');
create function pg_temp.sid() returns uuid language sql as $$ select v::uuid from t_ctx where k = 'schedule' $$;
create function pg_temp.regs() returns integer language sql as $$
  select count(*)::integer from public.public_registrations where schedule_id = pg_temp.sid()
$$;

select pg_temp.chk('fixture: the synthetic schedule is registrable (so a denial cannot be a schedule refusal)',
  (select registration_available from public.get_public_registration_schedule(pg_temp.sid())) is true);

-- ---- ACL after PKG-1 ----------------------------------------------------------------------------------------------
select pg_temp.chk('acl: ' || f || ' -- service_role keeps EXECUTE', has_function_privilege('service_role', f::regprocedure, 'execute'))
from unnest(array['public.create_public_registration(uuid,text,text,jsonb)', 'public.begin_public_registration_payment(text,text,text)']) f;
select pg_temp.chk('acl: ' || f || ' -- anon, authenticated and PUBLIC have no EXECUTE',
  not has_function_privilege('anon', f::regprocedure, 'execute')
  and not has_function_privilege('authenticated', f::regprocedure, 'execute')
  and not has_function_privilege('public', f::regprocedure, 'execute'))
from unnest(array['public.create_public_registration(uuid,text,text,jsonb)', 'public.begin_public_registration_payment(text,text,text)']) f;
select pg_temp.chk('acl: ' || p.proname || ' -- only the owner and service_role hold EXECUTE',
  not exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
              where a.privilege_type = 'EXECUTE' and a.grantee not in (p.proowner, 'service_role'::regrole)),
  coalesce(p.proacl::text, '(default)'))
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in ('create_public_registration', 'begin_public_registration_payment');
select pg_temp.chk('acl: the read RPCs stay public (get_public_registration_schedule/status executable by anon)',
  has_function_privilege('anon', 'public.get_public_registration_schedule(uuid)', 'execute')
  and has_function_privilege('anon', 'public.get_public_registration_status(text,text)', 'execute'));

-- ---- service_role: positive path (creates the registration used by the begin probes) --------------------------------
insert into t_ctx values ('svc_create', pg_temp.probe('service_role', pg_temp.create_sql(pg_temp.sid(), 'pkg1-service-role-key-0001')));
select pg_temp.chk('service_role: create_public_registration succeeds on a valid input',
  (select v from t_ctx where k = 'svc_create') like 'OK:%"status": "created"%', (select v from t_ctx where k = 'svc_create'));
insert into t_ctx select 'ref', (substring(v from 4))::jsonb->>'registration_reference' from t_ctx where k = 'svc_create';

-- ---- anon / authenticated: permission denial on a VALID input ----------------------------------------------------
create temp table t_probe as
select 'anon' as r, pg_temp.probe('anon', pg_temp.create_sql(pg_temp.sid(), 'pkg1-anon-key-000001')) as create_res,
       pg_temp.probe('anon', pg_temp.begin_sql((select v from t_ctx where k = 'ref'), 'pkg1-service-role-key-0001')) as begin_res
union all
select 'authenticated', pg_temp.probe('authenticated', pg_temp.create_sql(pg_temp.sid(), 'pkg1-auth-key-000001')),
       pg_temp.probe('authenticated', pg_temp.begin_sql((select v from t_ctx where k = 'ref'), 'pkg1-service-role-key-0001'));
select pg_temp.chk(r || ': create_public_registration is refused with SQLSTATE 42501 (permission, not validation)',
  pg_temp.state(create_res) = '42501', create_res) from t_probe;
select pg_temp.chk(r || ': begin_public_registration_payment is refused with SQLSTATE 42501 for a REAL reference and secret',
  pg_temp.state(begin_res) = '42501', begin_res) from t_probe;
select pg_temp.chk('anon/authenticated: the refused calls created no registration', pg_temp.regs() = 1, pg_temp.regs()::text);

-- ---- service_role: payment start still works; validation is still enforced -----------------------------------------
insert into t_ctx values ('svc_begin', pg_temp.probe('service_role', pg_temp.begin_sql((select v from t_ctx where k = 'ref'), 'pkg1-service-role-key-0001')));
select pg_temp.chk('service_role: begin_public_registration_payment starts the payment attempt (bill creation owner)',
  (select v from t_ctx where k = 'svc_begin') like 'OK:%"bill_creation_owner": true%', (select v from t_ctx where k = 'svc_begin'));
select pg_temp.chk('service_role: an unknown schedule is a validation refusal P0001 schedule_unavailable (control, not permission)',
  pg_temp.probe('service_role', pg_temp.create_sql('00000000-0000-0000-0000-000000000000', 'pkg1-service-role-key-0002')) like 'P0001:schedule_unavailable%');
select pg_temp.chk('service_role: an unknown reference is a validation refusal P0001 registration_not_found (control, not permission)',
  pg_temp.probe('service_role', pg_temp.begin_sql('PKG1-NOT-A-REFERENCE', 'pkg1-service-role-key-0003')) like 'P0001:registration_not_found%');

-- ---- unchanged public read path ------------------------------------------------------------------------------------
select pg_temp.chk('anon: get_public_registration_status still answers for the holder of the reference and secret',
  pg_temp.state(pg_temp.probe('anon', format('select count(*)::text from public.get_public_registration_status(%L, %L)',
    (select v from t_ctx where k = 'ref'), pg_temp.secret('pkg1-service-role-key-0001')))) = 'OK');
select pg_temp.chk('anon: get_public_registration_schedule still answers',
  pg_temp.probe('anon', format('select registration_available::text from public.get_public_registration_schedule(%L::uuid)', pg_temp.sid())) = 'OK:true');

select 'RESULT|' || case when ok then 'PASS' else 'FAIL' end || '|' || name || '|' || coalesce(detail, '') from t_results;
