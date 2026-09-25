-- C5B1 corrective forward-only migration.
-- Correct only the invalid pg_catalog.boolean type reference in the legacy
-- import RPC. The previously applied C5B1 migration remains untouched.
-- No schema changes, backfill, or existing certificate-row updates are made.

begin;

do $$
declare
  v_fn oid := pg_catalog.to_regprocedure('app.import_legacy_certificate(uuid,uuid,jsonb)');
  v_owner name;
  v_is_security_definer boolean;
  v_config text[];
  v_definition text;
begin
  if not exists (
    select 1 from supabase_migrations.schema_migrations
    where version = '20260924120000'
  ) then
    raise exception 'C5B1 corrective precondition failed: base migration is not recorded as applied';
  end if;
  if pg_catalog.to_regtype('pg_catalog.bool') is null then
    raise exception 'C5B1 corrective precondition failed: pg_catalog.bool is unavailable';
  end if;
  if v_fn is null then
    raise exception 'C5B1 corrective precondition failed: legacy import function is missing';
  end if;

  select pg_catalog.pg_get_userbyid(p.proowner), p.prosecdef, p.proconfig,
         pg_catalog.pg_get_functiondef(p.oid)
    into v_owner, v_is_security_definer, v_config, v_definition
  from pg_catalog.pg_proc p
  where p.oid = v_fn;

  if v_owner <> 'postgres'
    or not v_is_security_definer
    or v_config is distinct from array['search_path=public, app, extensions']::text[] then
    raise exception 'C5B1 corrective precondition failed: import function security properties differ';
  end if;
  if pg_catalog.strpos(v_definition, '::pg_catalog.boolean') = 0 then
    raise exception 'C5B1 corrective precondition failed: expected invalid cast is absent';
  end if;
  if not pg_catalog.has_function_privilege('authenticated', v_fn, 'EXECUTE')
    or pg_catalog.has_function_privilege('anon', v_fn, 'EXECUTE')
    or pg_catalog.has_function_privilege('service_role', v_fn, 'EXECUTE') then
    raise exception 'C5B1 corrective precondition failed: import ACL differs from expected';
  end if;
end;
$$;

-- CREATE OR REPLACE preserves the function owner and ACL. Keep the existing
-- authorization, validation, mapping, fields, and legacy no-snapshot behavior.
create or replace function app.import_legacy_certificate(
  p_participant_id uuid,
  p_course_id uuid,
  p_certificate jsonb
)
returns table (id uuid, certificate_number text, verification_token text)
language plpgsql
security definer
set search_path = public, app, extensions
as $$
declare
  v_id uuid;
  v_certificate_number text;
  v_token text;
  v_status text := coalesce(nullif(pg_catalog.btrim(p_certificate->>'status'), ''), 'valid');
  v_certificate_no text := nullif(pg_catalog.btrim(p_certificate->>'certificate_no'), '');
  v_participant_name text := nullif(pg_catalog.btrim(p_certificate->>'participant_name'), '');
  v_course_name text := nullif(pg_catalog.btrim(p_certificate->>'course_name'), '');
  v_course_date date;
  v_course_end_date date;
  v_expiry_date date;
  v_public_verification_enabled boolean;
begin
  if not app.is_active() or not app.is_admin()
    or not public.has_module_access_level('certificates', 'admin') then
    raise exception 'Not authorized to import legacy certificates.' using errcode = '42501';
  end if;
  if v_certificate_no is null or v_participant_name is null or v_course_name is null then
    raise exception 'Legacy certificate provenance fields are required.' using errcode = '22023';
  end if;
  if v_status not in ('valid', 'expired', 'revoked') then
    raise exception 'Invalid legacy certificate status.' using errcode = '22023';
  end if;

  begin
    v_course_date := nullif(pg_catalog.btrim(p_certificate->>'course_date'), '')::pg_catalog.date;
    v_course_end_date := nullif(pg_catalog.btrim(p_certificate->>'course_end_date'), '')::pg_catalog.date;
    v_expiry_date := nullif(pg_catalog.btrim(p_certificate->>'expiry_date'), '')::pg_catalog.date;
  exception when others then
    raise exception 'Invalid legacy certificate date.' using errcode = '22023';
  end;

  begin
    v_public_verification_enabled := coalesce(
      (p_certificate->>'public_verification_enabled')::pg_catalog.bool,
      true
    );
  exception when others then
    raise exception 'Invalid legacy certificate verification flag.' using errcode = '22023';
  end;

  if v_course_date is null then
    raise exception 'Legacy certificate issue date is required.' using errcode = '22023';
  end if;
  if v_course_end_date is not null and v_course_end_date < v_course_date then
    raise exception 'Legacy certificate end date cannot precede its start date.' using errcode = '22023';
  end if;

  insert into public.certificates (
    certificate_no, participant_name, identity_last4, course_name,
    training_start_date, training_end_date, issue_date, expiry_date, status,
    trainer_name, venue, participant_id, course_id, identity_no, instructor,
    certificate_file_url, public_verification_enabled, verification_enabled, metadata
  ) values (
    pg_catalog.upper(v_certificate_no), v_participant_name,
    pg_catalog.right(nullif(pg_catalog.btrim(p_certificate->>'identity_no'), ''), 4), v_course_name,
    v_course_date, v_course_end_date, v_course_date, v_expiry_date, v_status,
    nullif(pg_catalog.btrim(p_certificate->>'instructor'), ''),
    nullif(pg_catalog.btrim(p_certificate->>'venue'), ''), p_participant_id, p_course_id,
    pg_catalog.upper(nullif(pg_catalog.btrim(p_certificate->>'identity_no'), '')),
    nullif(pg_catalog.btrim(p_certificate->>'instructor'), ''),
    nullif(pg_catalog.btrim(p_certificate->>'certificate_file_url'), ''),
    v_public_verification_enabled, v_public_verification_enabled,
    pg_catalog.jsonb_set(coalesce(p_certificate->'metadata', '{}'::pg_catalog.jsonb), '{provenance}', '"legacy_import"'::pg_catalog.jsonb, true)
  )
  returning certificates.id, certificates.certificate_number, certificates.verification_token
  into v_id, v_certificate_number, v_token;

  return query select v_id, v_certificate_number, v_token;
end;
$$;

do $$
declare
  v_fn oid := pg_catalog.to_regprocedure('app.import_legacy_certificate(uuid,uuid,jsonb)');
  v_owner name;
  v_is_security_definer boolean;
  v_config text[];
  v_definition text;
begin
  select pg_catalog.pg_get_userbyid(p.proowner), p.prosecdef, p.proconfig,
         pg_catalog.pg_get_functiondef(p.oid)
    into v_owner, v_is_security_definer, v_config, v_definition
  from pg_catalog.pg_proc p
  where p.oid = v_fn;

  if v_owner <> 'postgres'
    or not v_is_security_definer
    or v_config is distinct from array['search_path=public, app, extensions']::text[]
    or pg_catalog.strpos(v_definition, '::pg_catalog.bool') = 0
    or pg_catalog.strpos(v_definition, '::pg_catalog.boolean') > 0 then
    raise exception 'C5B1 corrective postcondition failed: function definition or security properties differ';
  end if;
  if not pg_catalog.has_function_privilege('authenticated', v_fn, 'EXECUTE')
    or pg_catalog.has_function_privilege('anon', v_fn, 'EXECUTE')
    or pg_catalog.has_function_privilege('service_role', v_fn, 'EXECUTE')
    or not pg_catalog.has_function_privilege('postgres', v_fn, 'EXECUTE') then
    raise exception 'C5B1 corrective postcondition failed: import ACL changed';
  end if;
end;
$$;

commit;
