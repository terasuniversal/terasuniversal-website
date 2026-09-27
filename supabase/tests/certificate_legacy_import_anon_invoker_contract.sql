-- I2 final-state legacy import boundary contract. Local/test PostgreSQL only.
-- Anon EXECUTE is explicitly revoked. The public SECURITY DEFINER wrapper and
-- app implementation are executor-owned; only the wrapper is callable by
-- authenticated, and its guarded admin/module path is tested below.
-- All probes are synthetic and transaction-scoped.

begin;
set local role anon;
set local request.jwt.claim.sub = '';
set local request.jwt.claim.role = 'anon';
set local request.jwt.claims = '{"role":"anon","aud":"anon"}';

do $$
declare
  v_wrapper oid := pg_catalog.to_regprocedure('public.import_legacy_certificate(uuid,uuid,jsonb)');
  v_import oid;
  v_wrapper_definer boolean;
  v_import_definer boolean;
  v_wrapper_owner name;
  v_import_owner name;
  v_wrapper_config text[];
  v_import_config text[];
  v_state text;
  v_message text;
begin
  if current_user <> 'anon' then
    raise exception 'C5B1 anon wrapper contract did not assume anon role';
  end if;
  select p.oid, p.prosecdef, pg_catalog.pg_get_userbyid(p.proowner)::name, p.proconfig
  into v_import, v_import_definer, v_import_owner, v_import_config
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'app'
    and p.proname = 'import_legacy_certificate'
    and pg_catalog.pg_get_function_identity_arguments(p.oid)
      = 'p_participant_id uuid, p_course_id uuid, p_certificate jsonb';
  if v_wrapper is null or v_import is null then
    raise exception 'C5B1 legacy import wrapper or implementation is missing';
  end if;
  select prosecdef, pg_catalog.pg_get_userbyid(proowner)::name, proconfig
  into v_wrapper_definer, v_wrapper_owner, v_wrapper_config
  from pg_catalog.pg_proc where oid = v_wrapper;
  if not v_wrapper_definer or not v_import_definer
    or v_wrapper_owner <> 'certificate_lifecycle_executor'
    or v_import_owner <> 'certificate_lifecycle_executor'
    or not ('search_path=pg_catalog' = any(v_wrapper_config))
    or not ('search_path=pg_catalog, public, app, extensions' = any(v_import_config)) then
    raise exception 'C5B1 wrapper/import executor owner or fixed search-path contract changed';
  end if;
  if pg_catalog.has_function_privilege('anon', v_wrapper, 'EXECUTE') then
    raise exception 'I2 anon retains legacy-import EXECUTE';
  end if;
  if pg_catalog.has_function_privilege('anon', v_import, 'EXECUTE') then
    raise exception 'I2 anon retains app-import EXECUTE';
  end if;
  if not pg_catalog.has_function_privilege('authenticated', v_wrapper, 'EXECUTE')
    or pg_catalog.has_function_privilege('authenticated', v_import, 'EXECUTE')
    or pg_catalog.has_function_privilege('service_role', v_wrapper, 'EXECUTE')
    or pg_catalog.has_function_privilege('service_role', v_import, 'EXECUTE')
    or not pg_catalog.has_schema_privilege('authenticated', 'app', 'USAGE') then
    raise exception 'I2 legacy-import wrapper grant boundary is not executor-only';
  end if;

  begin
    perform * from public.import_legacy_certificate(
      '00000000-0000-4000-8000-00000000ca11',
      '00000000-0000-4000-8000-00000000ca12',
      '{"certificate_no":"C5B1-ANON-INVOKER-CONTRACT","participant_name":"C5B1 Synthetic","course_name":"C5B1 Synthetic","course_date":"2026-09-25","identity_no":"C5B1-SYNTHETIC-ANON-CONTRACT","public_verification_enabled":true}'::pg_catalog.jsonb
    );
    raise exception using errcode = 'P0001', message = 'C5B1 anon import unexpectedly succeeded';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_message = message_text;
    if v_state <> '42501' then
      raise exception 'C5B1 anon import must be denied with 42501, got %: %', v_state, v_message;
    end if;
  end;
end;
$$;

rollback;

do $$
begin
  if exists (
    select 1 from public.certificates
    where certificate_no = 'C5B1-ANON-INVOKER-CONTRACT'
  ) then
    raise exception 'C5B1 anon import wrapper left a certificate row';
  end if;
  raise notice 'C5B1 anon legacy import wrapper denied and rolled back';
end;
$$;
