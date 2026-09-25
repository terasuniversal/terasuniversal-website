-- C5B1: fail-closed public certificate verification control.
-- Forward-only. No certificate, snapshot, or verification-log rows are backfilled.
-- Apply only to the explicitly approved non-Production staging project after review.

begin;

do $$
begin
  if to_regclass('public.certificates') is null
    or to_regclass('public.certificate_issuance_snapshots') is null
    or to_regclass('public.certificate_verifications') is null then
    raise exception 'C5B1 precondition failed: required certificate objects are missing';
  end if;

  if to_regprocedure('public.verify_and_log(text,text,text,text)') is null
    or to_regprocedure('app.import_legacy_certificate(uuid,uuid,jsonb)') is null
    or to_regprocedure('app.set_certificate_verification_enabled(uuid,boolean)') is null
    or to_regprocedure('public.verify_certificate(text)') is null
    or to_regprocedure('public.verify_certificate_by_value(text)') is null then
    raise exception 'C5B1 precondition failed: an expected verification function is missing';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'certificates'
      and column_name = 'verification_enabled' and data_type = 'boolean'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'certificates'
      and column_name = 'public_verification_enabled' and data_type = 'boolean'
  ) then
    raise exception 'C5B1 precondition failed: verification flag columns are missing or not boolean';
  end if;
end;
$$;

-- The stable public RPC is the only anonymous/authenticated verifier. Keep its
-- result shape and C2 snapshot-first/legacy-fallback data selection unchanged.
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

comment on function public.verify_and_log(text, text, text, text) is
  'Public certificate verification + logging. Returns safe fields only for enabled, non-deleted valid/issued/expired/revoked certificates; uses immutable snapshots when present.';

revoke all on function public.verify_and_log(text, text, text, text) from public;
grant execute on function public.verify_and_log(text, text, text, text) to anon, authenticated, service_role;

-- Legacy import accepts the old JSON key, parses it once, and initializes both
-- fields consistently. It intentionally remains a legacy row without a C2 snapshot.
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
      (p_certificate->>'public_verification_enabled')::pg_catalog.boolean,
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

revoke all on function app.import_legacy_certificate(uuid, uuid, jsonb) from public;
grant execute on function app.import_legacy_certificate(uuid, uuid, jsonb) to authenticated;

-- Admin toggle is the canonical write path and keeps the compatibility value
-- synchronized for older trusted readers during the transition.
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

revoke all on function app.set_certificate_verification_enabled(uuid, boolean) from public;
grant execute on function app.set_certificate_verification_enabled(uuid, boolean) to authenticated;

-- These SECURITY DEFINER legacy lookup paths have no active application
-- call-sites and do not implement C5B1's canonical policy. Keep trusted
-- service-role compatibility, but close all public/session execution paths.
revoke all on function public.verify_certificate(text) from public, anon, authenticated;
grant execute on function public.verify_certificate(text) to service_role;

revoke all on function public.verify_certificate_by_value(text) from public, anon, authenticated;
grant execute on function public.verify_certificate_by_value(text) to service_role;

-- This older token-only verifier is also unused by the current app and omits
-- the verification flags. Revoke it if it exists in this environment.
do $$
begin
  if to_regprocedure('public.verify_certificate_by_token(text)') is not null then
    execute 'revoke all on function public.verify_certificate_by_token(text) from public, anon, authenticated, service_role';
  end if;
end;
$$;

commit;
