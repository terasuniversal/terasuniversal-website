-- I2 C5 security contract. Local/test PostgreSQL only; never Production.
-- Uses no real participant data. Every runtime probe is rolled back.

begin;

do $$
declare
  v_log oid := pg_catalog.to_regclass('public.certificate_verifications');
  v_seq oid := pg_catalog.to_regclass('public.certificate_verifications_id_seq');
  v_verify oid := pg_catalog.to_regprocedure('public.verify_and_log(text,text,text,text)');
  v_public_import oid := pg_catalog.to_regprocedure('public.import_legacy_certificate(uuid,uuid,jsonb)');
  v_app_import oid := pg_catalog.to_regprocedure('app.import_legacy_certificate(uuid,uuid,jsonb)');
  v_owner name;
  v_security_definer boolean;
  v_config text[];
  v_rls boolean;
  v_force_rls boolean;
begin
  if v_log is null or v_seq is null or v_verify is null
    or v_public_import is null or v_app_import is null then
    raise exception 'I2 precondition failed: required C5 objects are missing';
  end if;

  if pg_catalog.has_table_privilege('anon', v_log, 'SELECT') then
    raise exception 'I2 fail: anon retains direct verification-log SELECT';
  end if;
  if pg_catalog.has_table_privilege('anon', v_log, 'INSERT')
    or pg_catalog.has_table_privilege('anon', v_log, 'UPDATE')
    or pg_catalog.has_table_privilege('anon', v_log, 'DELETE')
    or pg_catalog.has_table_privilege('anon', v_log, 'TRUNCATE') then
    raise exception 'I2 fail: anon retains direct verification-log write access';
  end if;
  if pg_catalog.has_sequence_privilege('anon', v_seq, 'USAGE')
    or pg_catalog.has_sequence_privilege('anon', v_seq, 'SELECT')
    or pg_catalog.has_sequence_privilege('anon', v_seq, 'UPDATE')
    or pg_catalog.has_sequence_privilege('authenticated', v_seq, 'USAGE')
    or pg_catalog.has_sequence_privilege('authenticated', v_seq, 'SELECT')
    or pg_catalog.has_sequence_privilege('authenticated', v_seq, 'UPDATE') then
    raise exception 'I2 fail: public/authenticated retains direct verification-log sequence access';
  end if;

  select c.relrowsecurity, c.relforcerowsecurity
    into v_rls, v_force_rls
  from pg_catalog.pg_class c where c.oid = v_log;
  if not v_rls or not v_force_rls then
    raise exception 'I2 fail: verification log must enable and FORCE RLS';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_policies p
    where p.schemaname = 'public' and p.tablename = 'certificate_verifications'
      and p.policyname = 'cert_verif_staff_read' and p.cmd = 'SELECT'
      and p.roles = array['authenticated']::name[]
  ) then
    raise exception 'I2 fail: staff log SELECT policy must target authenticated only';
  end if;
  if exists (
    select 1 from pg_catalog.pg_policies p
    where p.schemaname = 'public' and p.tablename = 'certificate_verifications'
      and p.cmd in ('SELECT', 'ALL')
      and (p.roles @> array['public']::name[] or p.roles @> array['anon']::name[])
  ) then
    raise exception 'I2 fail: public/anon verification-log SELECT policy remains';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_policies p
    where p.schemaname = 'public' and p.tablename = 'certificate_verifications'
      and p.policyname = 'cert_verif_definer_insert' and p.cmd = 'INSERT'
      and p.roles = array['postgres']::name[]
  ) or exists (
    select 1 from pg_catalog.pg_policies p
    where p.schemaname = 'public' and p.tablename = 'certificate_verifications'
      and p.cmd in ('INSERT', 'ALL')
      and (p.roles @> array['public']::name[]
        or p.roles @> array['anon']::name[]
        or p.roles @> array['authenticated']::name[])
  ) then
    raise exception 'I2 fail: verifier log INSERT policy must target only the trusted definer owner';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_policies p
    where p.schemaname = 'public' and p.tablename = 'certificate_issuance_snapshots'
      and p.policyname = 'cert_issuance_snapshot_definer_read' and p.cmd = 'SELECT'
      and p.roles = array['certificate_lifecycle_executor']::name[]
      and p.qual like '%app.is_active()%'
      and p.qual like '%app.is_admin()%'
      and p.qual like '%has_module_access_level%'
  ) or exists (
    select 1 from pg_catalog.pg_policies p
    where p.schemaname = 'public' and p.tablename = 'certificate_issuance_snapshots'
      and p.cmd in ('SELECT', 'ALL')
      and (p.roles @> array['public']::name[] or p.roles @> array['anon']::name[])
  ) then
    raise exception 'I2 fail: immutable snapshot read policy must target only the trusted definer owner';
  end if;
  if not pg_catalog.has_table_privilege('authenticated', v_log, 'SELECT')
    or pg_catalog.has_table_privilege('authenticated', v_log, 'INSERT')
    or pg_catalog.has_table_privilege('authenticated', v_log, 'UPDATE')
    or pg_catalog.has_table_privilege('authenticated', v_log, 'DELETE')
    or pg_catalog.has_table_privilege('authenticated', v_log, 'TRUNCATE') then
    raise exception 'I2 fail: authenticated log access must be read-only';
  end if;

  select pg_catalog.pg_get_userbyid(p.proowner), p.prosecdef, p.proconfig
    into v_owner, v_security_definer, v_config
  from pg_catalog.pg_proc p where p.oid = v_verify;
  if v_owner <> 'postgres' or not v_security_definer
    or v_config is distinct from array['search_path=pg_catalog']::text[] then
    raise exception 'I2 fail: canonical verifier owner/security context changed';
  end if;
  if not pg_catalog.has_function_privilege('anon', v_verify, 'EXECUTE')
    or not pg_catalog.has_function_privilege('authenticated', v_verify, 'EXECUTE') then
    raise exception 'I2 fail: canonical verifier must remain callable by anon/authenticated';
  end if;

  if pg_catalog.has_function_privilege('anon', v_public_import, 'EXECUTE')
    or pg_catalog.has_function_privilege('service_role', v_public_import, 'EXECUTE')
    or not pg_catalog.has_function_privilege('authenticated', v_public_import, 'EXECUTE') then
    raise exception 'I2 fail: public legacy-import wrapper grants are not explicit/auth-only';
  end if;
  if pg_catalog.has_function_privilege('anon', v_app_import, 'EXECUTE')
    or pg_catalog.has_function_privilege('service_role', v_app_import, 'EXECUTE')
    or pg_catalog.has_function_privilege('authenticated', v_app_import, 'EXECUTE') then
    raise exception 'I2 fail: internal legacy-import grants must remain executor-only';
  end if;
  if pg_catalog.has_schema_privilege('authenticated', 'app', 'USAGE') is false then
    raise exception 'I2 precondition failed: authenticated admin wrapper cannot resolve app implementation';
  end if;
end;
$$;

set local role anon;
set local request.jwt.claim.sub = '';
set local request.jwt.claim.role = 'anon';
set local request.jwt.claims = '{"role":"anon","aud":"anon"}';
select pg_catalog.count(*) from public.verify_and_log('I2-ANON-RPC-PROBE', 'token', null, 'I2 synthetic probe');

do $$
begin
  begin
    perform 1 from public.certificate_verifications limit 1;
    raise exception using errcode = 'P0001', message = 'I2 fail: direct anon log SELECT unexpectedly ran';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform pg_catalog.nextval('public.certificate_verifications_id_seq'::pg_catalog.regclass);
    raise exception using errcode = 'P0001', message = 'I2 fail: direct anon log sequence access unexpectedly ran';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform * from public.import_legacy_certificate(
      '00000000-0000-4000-8000-00000000ca11',
      '00000000-0000-4000-8000-00000000ca12',
      '{"certificate_no":"I2-ANON-DENY","participant_name":"I2 Synthetic","course_name":"I2 Synthetic","course_date":"2026-09-25"}'::pg_catalog.jsonb
    );
    raise exception using errcode = 'P0001', message = 'I2 fail: direct anon legacy import unexpectedly ran';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000ca13';
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000ca13","role":"authenticated","aud":"authenticated"}';
select pg_catalog.count(*) from public.verify_and_log('I2-AUTH-RPC-PROBE', 'token', null, 'I2 synthetic probe');

rollback;

DO $$
begin
  if exists (
    select 1 from public.certificate_verifications
    where query_value in ('I2-ANON-RPC-PROBE', 'I2-AUTH-RPC-PROBE')
  ) then
    raise exception 'I2 rollback verification failed';
  end if;
  raise notice 'I2 security contract probes rolled back';
end;
$$;
