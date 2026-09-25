-- I2 final-state legacy import boundary contract. Local/test PostgreSQL only.
-- Anon EXECUTE is explicitly revoked; do not rely on missing app-schema USAGE.
-- The authenticated SECURITY INVOKER wrapper preserves the guarded admin and
-- certificates-module path. All probes are transaction-scoped and synthetic.

begin;
set local role anon;

do $$
declare
  v_wrapper oid := pg_catalog.to_regprocedure('public.import_legacy_certificate(uuid,uuid,jsonb)');
  v_import oid;
  v_wrapper_definer boolean;
  v_import_definer boolean;
  v_state text;
  v_message text;
begin
  if current_user <> 'anon' then
    raise exception 'C5B1 anon wrapper contract did not assume anon role';
  end if;
  select p.oid, p.prosecdef
  into v_import, v_import_definer
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'app'
    and p.proname = 'import_legacy_certificate'
    and pg_catalog.pg_get_function_identity_arguments(p.oid)
      = 'p_participant_id uuid, p_course_id uuid, p_certificate jsonb';
  if v_wrapper is null or v_import is null then
    raise exception 'C5B1 legacy import wrapper or implementation is missing';
  end if;
  select prosecdef into v_wrapper_definer from pg_catalog.pg_proc where oid = v_wrapper;
  if v_wrapper_definer or not v_import_definer then
    raise exception 'C5B1 wrapper/import SECURITY INVOKER/DEFINER contract changed';
  end if;
  if pg_catalog.has_function_privilege('anon', v_wrapper, 'EXECUTE') then
    raise exception 'I2 anon retains legacy-import EXECUTE';
  end if;
  if pg_catalog.has_function_privilege('anon', v_import, 'EXECUTE') then
    raise exception 'I2 anon retains app-import EXECUTE';
  end if;
  if not pg_catalog.has_function_privilege('authenticated', v_wrapper, 'EXECUTE')
    or not pg_catalog.has_function_privilege('authenticated', v_import, 'EXECUTE')
    or not pg_catalog.has_schema_privilege('authenticated', 'app', 'USAGE') then
    raise exception 'I2 authenticated guarded import path is unavailable';
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
