-- I2 legacy-import authorization runtime contract. Local/test PostgreSQL only.
-- Uses synthetic admin identities and rows; transaction is always rolled back.

begin;

do $$
declare
  v_unauthorized uuid := '00000000-0000-4000-8000-00000000e201';
  v_authorized uuid := '00000000-0000-4000-8000-00000000e202';
  v_participant uuid := '00000000-0000-4000-8000-00000000e203';
  v_course uuid := '00000000-0000-4000-8000-00000000e204';
begin
  if exists (select 1 from auth.users where id in (v_unauthorized, v_authorized))
    or exists (select 1 from public.profiles where id in (v_unauthorized, v_authorized))
    or exists (select 1 from public.participants where id = v_participant)
    or exists (select 1 from public.courses where id = v_course)
    or exists (select 1 from public.certificates where certificate_no like 'I2-LEGACY-%')
    or exists (select 1 from public.certificate_verifications where query_value = 'I2-STAFF-LOG-PROBE') then
    raise exception 'I2 legacy-import fixture collision; refusing to write test rows';
  end if;

  if not has_schema_privilege('authenticated', 'app', 'USAGE')
    or not has_function_privilege('authenticated', 'public.import_legacy_certificate(uuid,uuid,jsonb)', 'EXECUTE') then
    raise exception 'I2 precondition failed: authenticated wrapper route is not callable';
  end if;

  insert into auth.users(id, email, raw_user_meta_data)
  values
    (v_unauthorized, 'i2-unauthorized@example.invalid', '{"full_name":"I2 Unauthorized"}'::pg_catalog.jsonb),
    (v_authorized, 'i2-authorized@example.invalid', '{"full_name":"I2 Authorized"}'::pg_catalog.jsonb);
  insert into public.profiles(id, email, full_name, role, is_active, access_control_enabled)
  values
    (v_unauthorized, 'i2-unauthorized@example.invalid', 'I2 Unauthorized', 'admin', true, true),
    (v_authorized, 'i2-authorized@example.invalid', 'I2 Authorized', 'admin', true, true)
  on conflict (id) do update set role = excluded.role, is_active = excluded.is_active,
    access_control_enabled = excluded.access_control_enabled;
  update public.profiles
  set role = 'admin', is_active = true, access_control_enabled = true
  where id in (v_unauthorized, v_authorized);
  insert into public.staff_module_catalog(module_key, label, group_key, min_role, is_active)
  values ('certificates', 'I2 Synthetic Certificates', 'I2 Synthetic', 'admin', true)
  on conflict (module_key) do nothing;
  insert into public.staff_module_access(user_id, module_key, access_level)
  values (v_authorized, 'certificates', 'admin');

  insert into public.participants (id, full_name, status)
  values (v_participant, 'I2 Synthetic Import Participant', 'active');
  insert into public.courses (id, course_name, title, active)
  values (v_course, 'I2 Synthetic Import Course', 'I2 Synthetic Import Course', true);
  insert into public.certificate_verifications(method, query_value, status_returned)
  values ('token', 'I2-STAFF-LOG-PROBE', 'valid');
end;
$$;

set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000e201', true);
select pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
select pg_catalog.set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e201","role":"authenticated","aud":"authenticated"}', true);
do $$
declare
  v_state text;
begin
  begin
    perform * from public.import_legacy_certificate(
      '00000000-0000-4000-8000-00000000e203',
      '00000000-0000-4000-8000-00000000e204',
      '{"certificate_no":"I2-LEGACY-UNAUTHORIZED","participant_name":"I2 Synthetic Unauthorized","course_name":"I2 Synthetic Course","course_date":"2026-09-24"}'::pg_catalog.jsonb
    );
    raise exception using errcode = 'P0001', message = 'I2 fail: authenticated user without module access imported a certificate';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;

select pg_catalog.set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000e202', true);
select pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
select pg_catalog.set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e202","role":"authenticated","aud":"authenticated"}', true);
do $$
declare
  v_log_count integer;
begin
  select pg_catalog.count(*) into v_log_count
  from public.certificate_verifications
  where query_value = 'I2-STAFF-LOG-PROBE';
  if v_log_count <> 1 then
    raise exception 'I2 fail: authorized authenticated staff could not read the verification log through RLS';
  end if;
end;
$$;
do $$
declare
  v_result record;
begin
  select * into v_result
  from public.import_legacy_certificate(
    '00000000-0000-4000-8000-00000000e203',
    '00000000-0000-4000-8000-00000000e204',
    '{"certificate_no":"I2-LEGACY-AUTHORIZED","participant_name":"I2 Synthetic Authorized","course_name":"I2 Synthetic Course","course_date":"2026-09-24","public_verification_enabled":true}'::pg_catalog.jsonb
  );
  if not found or v_result.id is null or v_result.certificate_number is null
    or v_result.verification_token is null then
    raise exception 'I2 fail: authorized admin with certificate-module access could not import';
  end if;
end;
$$;

reset role;
rollback;

DO $$
begin
  if exists (select 1 from auth.users where id in (
      '00000000-0000-4000-8000-00000000e201',
      '00000000-0000-4000-8000-00000000e202'))
    or exists (select 1 from public.certificates where certificate_no like 'I2-LEGACY-%')
    or exists (select 1 from public.certificate_verifications where query_value = 'I2-STAFF-LOG-PROBE') then
    raise exception 'I2 legacy-import rollback verification failed';
  end if;
  raise notice 'I2 legacy-import authorization probes rolled back';
end;
$$;
