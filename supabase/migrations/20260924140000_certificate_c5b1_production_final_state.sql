-- C5B1 Production final-state convergence migration (forward-only).
--
-- HISTORY INDEPENDENCE: this migration never queries or requires migration
-- history versions 20260924120000 or 20260924130000. It applies the final
-- reviewed definitions directly to required actual baseline objects.
-- BASELINE OBJECT DEPENDENCY: the Production database must already contain the
-- target function signatures, C2-compatible verifier result shape, lifecycle,
-- snapshot/log tables and authorization helpers checked below. Those object
-- preconditions are intentional and are not migration-history dependencies.
--
-- Function bodies are taken directly from committed 2412 and 2413 sources;
-- the import body is the corrected pg_catalog.bool implementation. Existing
-- source migrations are immutable. This script modifies functions/grants only;
-- it does not write certificate, participant, course, snapshot, or log rows.
-- Runtime verifier calls do write logs; none are made by this migration.

begin;

do $$
declare
  v_missing text := '';
  v_col record;
  v_owner name;
  v_secdef boolean;
  v_config text[];
  v_result text;
  v_fn oid;
  v_status_constraint text;
begin
  if to_regclass('public.certificates') is null
    or to_regclass('public.certificate_issuance_snapshots') is null
    or to_regclass('public.certificate_verifications') is null
    or to_regclass('public.participants') is null
    or to_regclass('public.courses') is null
    or to_regnamespace('app') is null then
    raise exception 'C5B1 final-state precondition failed: required baseline tables/schema missing';
  end if;
  if to_regtype('pg_catalog.bool') is null then
    raise exception 'C5B1 final-state precondition failed: pg_catalog.bool unavailable';
  end if;

  -- Executor identity is not assumed to equal function owner. CREATE OR REPLACE
  -- retains each existing postgres owner; only postgres or a role authorized
  -- to retain that owner may execute this transaction.
  if current_user <> 'postgres'
    and not pg_has_role(current_user, 'postgres', 'MEMBER') then
    raise exception 'C5B1 final-state precondition failed: executor % cannot preserve postgres ownership',current_user;
  end if;

  if to_regprocedure('public.verify_and_log(text,text,text,text)') is null
    or to_regprocedure('app.import_legacy_certificate(uuid,uuid,jsonb)') is null
    or to_regprocedure('app.set_certificate_verification_enabled(uuid,boolean)') is null
    or to_regprocedure('public.verify_certificate(text)') is null
    or to_regprocedure('public.verify_certificate_by_value(text)') is null
    or to_regprocedure('app.is_active()') is null
    or to_regprocedure('app.is_admin()') is null
    or to_regprocedure('public.has_module_access_level(text,text)') is null then
    raise exception 'C5B1 final-state precondition failed: required baseline function/helper missing';
  end if;

  for v_col in
    select * from (values
      ('certificates','id'),('certificates','certificate_number'),('certificates','certificate_no'),
      ('certificates','holder_name'),('certificates','participant_name'),('certificates','identity_last4'),
      ('certificates','identity_no'),('certificates','course_name'),('certificates','trainer_name'),
      ('certificates','instructor'),('certificates','venue'),('certificates','certificate_file_url'),
      ('certificates','participant_id'),('certificates','course_id'),('certificates','status'),
      ('certificates','deleted_at'),('certificates','verification_token'),('certificates','training_start_date'),
      ('certificates','training_end_date'),('certificates','issue_date'),('certificates','expiry_date'),('certificates','metadata'),
      ('certificate_issuance_snapshots','certificate_id'),('certificate_issuance_snapshots','participant_code_snapshot'),
      ('certificate_issuance_snapshots','company_snapshot'),('certificate_issuance_snapshots','course_name'),
      ('certificate_issuance_snapshots','training_start_date'),('certificate_issuance_snapshots','training_end_date'),
      ('certificate_verifications','certificate_id'),('certificate_verifications','certificate_number'),
      ('certificate_verifications','method'),('certificate_verifications','query_value'),
      ('certificate_verifications','status_returned'),('certificate_verifications','ip_address'),('certificate_verifications','user_agent'),
      ('participants','id'),('participants','participant_id'),('participants','company'),
      ('courses','id'),('courses','title'),('courses','course_name')
    ) as required(table_name,column_name)
    where not exists (select 1 from information_schema.columns c
      where c.table_schema='public' and c.table_name=required.table_name and c.column_name=required.column_name)
  loop
    v_missing := v_missing || 'public.'||v_col.table_name||'.'||v_col.column_name||'; ';
  end loop;
  if v_missing <> '' then
    raise exception 'C5B1 final-state precondition failed: missing columns: %',v_missing;
  end if;

  -- Both flags are policy booleans, NOT NULL and default true on verified
  -- Production and staging. Unexpected nullability/default fails closed.
  if (select count(*) from information_schema.columns where table_schema='public'
      and table_name='certificates' and column_name in ('verification_enabled','public_verification_enabled')
      and data_type='boolean' and is_nullable='NO' and column_default='true') <> 2 then
    raise exception 'C5B1 final-state precondition failed: flags must be boolean NOT NULL DEFAULT true';
  end if;
  if not exists(select 1 from information_schema.columns where table_schema='public'
      and table_name='certificates' and column_name='status' and data_type='text' and is_nullable='NO')
    or not exists(select 1 from information_schema.columns where table_schema='public'
      and table_name='certificates' and column_name='deleted_at' and data_type='timestamp with time zone') then
    raise exception 'C5B1 final-state precondition failed: status/deleted_at type assumptions differ';
  end if;

  select regexp_replace(pg_get_constraintdef(c.oid),'[[:space:]]','','g') into v_status_constraint
  from pg_constraint c where c.conrelid='public.certificates'::regclass
    and c.contype='c' and c.conname='certificates_status_check';
  if v_status_constraint is distinct from
    'CHECK((status=ANY(ARRAY[''valid''::text,''expired''::text,''revoked''::text,''draft''::text,''issued''::text,''archived''::text])))' then
    raise exception 'C5B1 final-state precondition failed: expected certificate lifecycle constraint differs';
  end if;

  v_fn := to_regprocedure('public.verify_and_log(text,text,text,text)');
  v_result := pg_get_function_result(v_fn);
  if v_result is distinct from 'TABLE(found boolean, certificate_number text, holder_name text, participant_code_masked text, company text, course_title text, training_date date, training_start_date date, training_end_date date, issue_date date, expiry_date date, status text, is_valid boolean, verified_at timestamp with time zone)' then
    raise exception 'C5B1 final-state precondition failed: unsupported verifier return shape: %',v_result;
  end if;
  foreach v_fn in array array[
    to_regprocedure('public.verify_and_log(text,text,text,text)'),
    to_regprocedure('app.import_legacy_certificate(uuid,uuid,jsonb)'),
    to_regprocedure('app.set_certificate_verification_enabled(uuid,boolean)'),
    to_regprocedure('public.verify_certificate(text)'),
    to_regprocedure('public.verify_certificate_by_value(text)')
  ] loop
    select pg_get_userbyid(p.proowner),p.prosecdef,p.proconfig into v_owner,v_secdef,v_config
    from pg_proc p where p.oid=v_fn;
    if v_owner <> 'postgres' or not v_secdef then
      raise exception 'C5B1 final-state precondition failed: target % is not postgres-owned SECURITY DEFINER',v_fn::regprocedure;
    end if;
  end loop;
  -- Legacy bodies stay untouched; validate their observed baseline search_path.
  foreach v_fn in array array[
    to_regprocedure('public.verify_certificate(text)'),
    to_regprocedure('public.verify_certificate_by_value(text)')
  ] loop
    select p.proconfig into v_config from pg_proc p where p.oid=v_fn;
    if v_fn=to_regprocedure('public.verify_certificate(text)')
      and v_config is distinct from array['search_path=""']::text[] then
      raise exception 'C5B1 final-state precondition failed: unsupported legacy verifier search_path %',v_fn::regprocedure;
    elsif v_fn=to_regprocedure('public.verify_certificate_by_value(text)')
      and v_config is distinct from array['search_path=public']::text[] then
      raise exception 'C5B1 final-state precondition failed: unsupported legacy verifier search_path %',v_fn::regprocedure;
    end if;
  end loop;
  if (select count(*) from information_schema.columns where table_schema='public'
      and table_name='certificate_issuance_snapshots'
      and column_name in ('certificate_id','participant_code_snapshot','company_snapshot','course_name','training_start_date','training_end_date')) <> 6
    or (select count(*) from information_schema.columns where table_schema='public'
      and table_name='certificate_verifications'
      and column_name in ('certificate_id','certificate_number','method','query_value','status_returned','ip_address','user_agent')) <> 7 then
    raise exception 'C5B1 final-state precondition failed: snapshot or log structure differs';
  end if;
end;
$$;

create or replace function public.verify_and_log(
  p_query text,
  p_method text default 'auto',
  p_ip text default null,
  p_ua text default null
)
returns table (
  found boolean,
  certificate_number text,
  holder_name text,
  participant_code_masked text,
  company text,
  course_title text,
  training_date date,
  training_start_date date,
  training_end_date date,
  issue_date date,
  expiry_date date,
  status text,
  is_valid boolean,
  verified_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v record;
  v_status text;
  v_ip inet;
  q text := pg_catalog.btrim(coalesce(p_query, ''));
begin
  if q = '' then
    return;
  end if;

  begin
    v_ip := nullif(p_ip, '')::pg_catalog.inet;
  exception when others then
    v_ip := null;
  end;

  select
    c.id,
    c.certificate_number,
    c.holder_name,
    c.status,
    c.issue_date,
    c.expiry_date,
    c.verification_enabled,
    c.public_verification_enabled,
    case
      when s.certificate_id is not null
        then coalesce(s.participant_code_snapshot, p.participant_id)
      else p.participant_id
    end as p_code,
    case
      when s.certificate_id is not null then s.company_snapshot
      else p.company
    end as p_company,
    case
      when s.certificate_id is not null then s.course_name
      else coalesce(co.title, co.course_name)
    end as course_title,
    coalesce(s.training_start_date, c.training_start_date) as training_start_date,
    coalesce(s.training_end_date, c.training_end_date) as training_end_date
  into v
  from public.certificates c
  left join public.participants p on p.id = c.participant_id
  left join public.courses co on co.id = c.course_id
  left join public.certificate_issuance_snapshots s on s.certificate_id = c.id
  where c.deleted_at is null
    and (
      ((p_method in ('auto', 'token')) and c.verification_token = q)
      or ((p_method in ('auto', 'number')) and pg_catalog.upper(c.certificate_number) = pg_catalog.upper(q))
    )
  limit 1;

  if not found then
    insert into public.certificate_verifications(
      method, query_value, status_returned, ip_address, user_agent
    ) values (
      p_method, q, 'not_found', v_ip, p_ua
    );
    return;
  end if;

  -- The canonical flag controls permission; the compatibility flag can only
  -- deny. Neither flag can grant access when the other is explicitly false.
  if v.verification_enabled is false
    or coalesce(v.public_verification_enabled, true) is false then
    insert into public.certificate_verifications(
      certificate_id, certificate_number, method, query_value,
      status_returned, ip_address, user_agent
    ) values (
      v.id, v.certificate_number, p_method, q,
      'disabled', v_ip, p_ua
    );
    return;
  end if;

  -- Fail closed for drafts, archived records, and future/unrecognized states.
  if v.status is null or v.status not in ('valid', 'issued', 'expired', 'revoked') then
    insert into public.certificate_verifications(
      certificate_id, certificate_number, method, query_value,
      status_returned, ip_address, user_agent
    ) values (
      v.id, v.certificate_number, p_method, q,
      'not_found', v_ip, p_ua
    );
    return;
  end if;

  if v.status in ('valid', 'issued') then
    if v.expiry_date is null or v.expiry_date >= current_date then
      v_status := 'valid';
    else
      v_status := 'expired';
    end if;
  elsif v.status = 'revoked' then
    v_status := 'revoked';
  else
    v_status := 'expired';
  end if;

  insert into public.certificate_verifications(
    certificate_id, certificate_number, method, query_value,
    status_returned, ip_address, user_agent
  ) values (
    v.id, v.certificate_number, p_method, q,
    v_status, v_ip, p_ua
  );

  return query select
    true,
    v.certificate_number,
    v.holder_name,
    case
      when v.p_code is null then null
      when pg_catalog.length(v.p_code) <= 6 then v.p_code
      else pg_catalog.left(v.p_code, 4)
        || pg_catalog.repeat('•', greatest(pg_catalog.length(v.p_code) - 6, 1))
        || pg_catalog.right(v.p_code, 2)
    end,
    v.p_company,
    v.course_title,
    v.training_start_date,
    v.training_start_date,
    v.training_end_date,
    v.issue_date,
    v.expiry_date,
    v_status,
    (v_status = 'valid'),
    pg_catalog.now();
end;
$$;

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

create or replace function app.set_certificate_verification_enabled(
  p_certificate_id uuid,
  p_enabled boolean
)
returns void
language plpgsql
security definer
set search_path = public, app, extensions
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null or not app.is_active() or not app.is_admin()
    or not public.has_module_access_level('certificates', 'admin') then
    raise exception 'Not authorized to update verification settings.' using errcode = '42501';
  end if;

  perform 1 from public.certificates
  where id = p_certificate_id and deleted_at is null
  for update;
  if not found then
    raise exception 'Certificate not found.' using errcode = 'P0002';
  end if;

  update public.certificates
  set verification_enabled = p_enabled,
      public_verification_enabled = p_enabled
  where id = p_certificate_id;
end;
$$;

comment on function public.verify_and_log(text,text,text,text) is
  'Public certificate verification + logging. Returns safe fields only for enabled, non-deleted valid/issued/expired/revoked certificates; uses immutable snapshots when present.';
revoke all on function public.verify_and_log(text,text,text,text) from public;
grant execute on function public.verify_and_log(text,text,text,text) to anon,authenticated,service_role;

revoke all on function app.import_legacy_certificate(uuid,uuid,jsonb) from public,anon,service_role;
grant execute on function app.import_legacy_certificate(uuid,uuid,jsonb) to authenticated;
revoke all on function app.set_certificate_verification_enabled(uuid,boolean) from public,anon,service_role;
grant execute on function app.set_certificate_verification_enabled(uuid,boolean) to authenticated;

revoke all on function public.verify_certificate(text) from public,anon,authenticated;
grant execute on function public.verify_certificate(text) to service_role;
revoke all on function public.verify_certificate_by_value(text) from public,anon,authenticated;
grant execute on function public.verify_certificate_by_value(text) to service_role;
do $$ begin
  if to_regprocedure('public.verify_certificate_by_token(text)') is not null then
    execute 'revoke all on function public.verify_certificate_by_token(text) from public,anon,authenticated,service_role';
  end if;
end; $$;

do $$
declare v_fn oid; v_owner name; v_sd boolean; v_path text[]; v_def text;
begin
  v_fn:=to_regprocedure('public.verify_and_log(text,text,text,text)');
  select pg_get_userbyid(proowner),prosecdef,proconfig into v_owner,v_sd,v_path from pg_proc where oid=v_fn;
  if v_owner<>'postgres' or not v_sd or v_path is distinct from array['search_path=pg_catalog']::text[]
    or has_function_privilege('anon',v_fn,'EXECUTE') is false
    or has_function_privilege('authenticated',v_fn,'EXECUTE') is false
    or has_function_privilege('service_role',v_fn,'EXECUTE') is false
    or exists(select 1 from aclexplode(coalesce((select proacl from pg_proc where oid=v_fn),acldefault('f',(select proowner from pg_proc where oid=v_fn)))) a where a.grantee=0 and a.privilege_type='EXECUTE') then
    raise exception 'C5B1 final-state postcondition failed: public verifier security/ACL';
  end if;
  foreach v_fn in array array[to_regprocedure('app.import_legacy_certificate(uuid,uuid,jsonb)'),to_regprocedure('app.set_certificate_verification_enabled(uuid,boolean)')] loop
    select pg_get_userbyid(proowner),prosecdef,proconfig,pg_get_functiondef(oid) into v_owner,v_sd,v_path,v_def from pg_proc where oid=v_fn;
    if v_owner<>'postgres' or not v_sd or v_path is distinct from array['search_path=public, app, extensions']::text[]
      or has_function_privilege('anon',v_fn,'EXECUTE') or has_function_privilege('service_role',v_fn,'EXECUTE')
      or not has_function_privilege('authenticated',v_fn,'EXECUTE')
      or exists(select 1 from aclexplode(coalesce((select proacl from pg_proc where oid=v_fn),acldefault('f',(select proowner from pg_proc where oid=v_fn)))) a where a.grantee=0 and a.privilege_type='EXECUTE') then
      raise exception 'C5B1 final-state postcondition failed: app function security/ACL %',v_fn::regprocedure;
    end if;
    if v_fn=to_regprocedure('app.import_legacy_certificate(uuid,uuid,jsonb)')
      and strpos(v_def,'::pg_catalog.bool,')=0 then
      raise exception 'C5B1 final-state postcondition failed: import cast';
    end if;
  end loop;
  foreach v_fn in array array[to_regprocedure('public.verify_certificate(text)'),to_regprocedure('public.verify_certificate_by_value(text)')] loop
    select pg_get_userbyid(proowner),prosecdef,proconfig into v_owner,v_sd,v_path from pg_proc where oid=v_fn;
    if v_owner<>'postgres' or not v_sd
      or (v_fn=to_regprocedure('public.verify_certificate(text)') and v_path is distinct from array['search_path=""']::text[])
      or (v_fn=to_regprocedure('public.verify_certificate_by_value(text)') and v_path is distinct from array['search_path=public']::text[])
      or has_function_privilege('anon',v_fn,'EXECUTE') or has_function_privilege('authenticated',v_fn,'EXECUTE')
      or not has_function_privilege('service_role',v_fn,'EXECUTE')
      or exists(select 1 from aclexplode(coalesce((select proacl from pg_proc where oid=v_fn),acldefault('f',(select proowner from pg_proc where oid=v_fn)))) a where a.grantee=0 and a.privilege_type='EXECUTE') then
      raise exception 'C5B1 final-state postcondition failed: legacy verifier ACL %',v_fn::regprocedure;
    end if;
  end loop;
  v_fn:=to_regprocedure('public.verify_certificate_by_token(text)');
  if v_fn is not null and (has_function_privilege('anon',v_fn,'EXECUTE') or has_function_privilege('authenticated',v_fn,'EXECUTE')
    or has_function_privilege('service_role',v_fn,'EXECUTE')
    or exists(select 1 from aclexplode(coalesce((select proacl from pg_proc where oid=v_fn),acldefault('f',(select proowner from pg_proc where oid=v_fn)))) a where a.grantee=0 and a.privilege_type='EXECUTE')) then
    raise exception 'C5B1 final-state postcondition failed: token verifier ACL';
  end if;
end; $$;

commit;
